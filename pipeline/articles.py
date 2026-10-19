"""Article ingestion: discover → fetch → extract → validate → dedupe → store → enrich → score."""
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from . import config
from .enrich import enrich
from .extract import extract_page, list_links, parse_feed, parse_hf_papers
from .fetch import FetchError
from .normalize import (article_id, canonical_url, clean_text, clean_title, content_hash, excerpt, guess_language, hours_since,
                        now_iso, reading_minutes)
from .rank import classify, near_duplicate, score

log = logging.getLogger("apex.articles")
FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"


def due(src, st, now, force):
    if force:
        return True
    nd = st.get("next_due")
    return not nd or datetime.fromisoformat(nd.replace("Z", "+00:00")) <= now


def sanitize_error(msg):
    return re.sub(r"(token|key|secret)=[^&\s]+", r"\1=***", str(msg))[:200]


def fetch_source(src, st, fetch, known_ids):
    """Fetch one source and return candidate articles. Raises FetchError on failure."""
    kind, url, limit = src["type"], src["url"], src.get("max_items", 15)
    if kind in ("rss", "atom"):
        res = fetch.get(url, etag=st.get("etag"), last_modified=st.get("last_modified"), accept=FEED_ACCEPT)
        if res.status == 304:
            return [], {"not_modified": True}
        entries, _ = parse_feed(res.body, url)
        meta = {"etag": res.headers.get("etag"), "last_modified": res.headers.get("last-modified")}
    elif kind == "hf_papers":
        res = fetch.get(url, accept="application/json")
        entries, meta = parse_hf_papers(res.body), {}
    elif kind == "sitemap":
        res = fetch.get(url, accept="application/xml")
        locs = re.findall(r"<loc>\s*([^<]+?)\s*</loc>(?:\s*<lastmod>\s*([^<]+?)\s*</lastmod>)?", res.text)
        locs.sort(key=lambda x: x[1] or "", reverse=True)
        entries, meta = [{"url": u, "title": "", "published_at": None} for u, _ in locs[:limit]], {}
    elif kind == "webpage":
        res = fetch.get(url, accept="text/html")
        sel = (src.get("list") or {}).get("item_link", "a::attr(href)")
        entries, meta = [{"url": u, "title": "", "published_at": None} for u in list_links(res.text, res.url, sel, limit)], {}
    else:
        raise FetchError(f"unknown source type {kind}")
    entries = entries[:limit]
    out, full_budget = [], limit if src.get("full_text") else 0
    for e in entries:
        canon = canonical_url(e["url"])
        aid = article_id(canon)
        e.update(canonical_url=canon, id=aid)
        if aid in known_ids and not e.get("updated_at"):
            e["_known"] = True  # incremental: seen before and the feed reports no update
            out.append(e)
            continue
        needs_page = full_budget > 0 and (not e.get("content_text") or not e.get("title"))
        if needs_page:
            full_budget -= 1
            try:
                page = fetch.get(e["url"], accept="text/html")
                p = extract_page(page.text, page.url)
                for k in ("title", "author", "published_at", "updated_at", "description", "image_url", "content_text", "language"):
                    if not e.get(k) and p.get(k):
                        e[k] = p[k]
                if p.get("canonical") and canonical_url(p["canonical"]).split("/")[2] == canon.split("/")[2]:
                    e["canonical_url"] = canonical_url(p["canonical"])
                    e["id"] = article_id(e["canonical_url"])
            except FetchError as exc:
                e["_page_error"] = str(exc)
        out.append(e)
    return out, meta


DATE_LEAD = re.compile(r"^(?:[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]{2,8} \d{4}|\d{4}-\d{2}-\d{2})\s*")


def strip_heading(text, title):
    """Page text often starts with a category label, the title and a date; drop that lead-in."""
    probe = title[:40].lower()
    i = text.lower().find(probe) if probe else -1
    if 0 <= i < 200:
        text = text[i + len(title):].lstrip(" :|-–")
    return DATE_LEAD.sub("", text, count=1)


def build(e, src, now):
    title = clean_title(e.get("title"))
    if len(title) < 3 or not e.get("canonical_url", "").startswith("http"):
        return None
    text = strip_heading(clean_text(e.get("content_text")), title)[: config.FULL_TEXT_CHARS]
    desc = clean_text(e.get("description")) or excerpt(text, config.DESCRIPTION_CHARS)
    return {
        "id": e["id"], "title": title[:300], "canonical_url": e["canonical_url"], "url": e["url"],
        "source_id": src["id"], "source_name": src["name"], "author": e.get("author"),
        "published_at": e.get("published_at") or e.get("updated_at"), "updated_at": e.get("updated_at"), "fetched_at": now,
        "date_basis": "published" if e.get("published_at") else "updated" if e.get("updated_at") else None,
        "description": excerpt(desc, config.DESCRIPTION_CHARS), "content_text": text,
        "image_url": e.get("image_url") if str(e.get("image_url") or "").startswith("https://") else None,
        "content_hash": content_hash(title, text or desc), "language": guess_language(text or desc, e.get("language")),
        "reading_minutes": reading_minutes(text), "categories": src.get("categories", []),
        "extraction": "full" if len(text) > 1500 else "excerpt", "votes": e.get("votes"),
    }


def run(registry, topics, store, state, cache, fetch, provider, interests, only=None, force=False, max_enrich=25, now=None):
    now_dt = now or datetime.now(timezone.utc)
    now_s = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    topics_kw = {k: v["keywords"] for k, v in topics.items()}
    sources = [s for s in registry if s.get("enabled", True) and (not only or s["id"] == only)]
    todo = [s for s in sources if due(s, state.get(s["id"], {}), now_dt, force or bool(only))]
    report = {"kind": "articles", "started_at": now_s, "sources": {}, "totals": {"new": 0, "updated": 0, "unchanged": 0, "duplicates": 0, "invalid": 0, "failed_sources": 0, "enriched_ai": 0, "enriched_extractive": 0}}
    known = set(store)
    hashes = {a["content_hash"]: aid for aid, a in store.items()}

    def work(src):
        t0 = time.monotonic()
        try:
            entries, meta = fetch_source(src, state.get(src["id"], {}), fetch, known)
            return src, entries, meta, None, int((time.monotonic() - t0) * 1000)
        except Exception as exc:  # one failing source never stops the others
            return src, [], {}, exc, int((time.monotonic() - t0) * 1000)

    with ThreadPoolExecutor(max_workers=config.WORKERS) as pool:
        results = list(pool.map(work, todo))

    enrich_budget = max_enrich
    for src, entries, meta, err, ms in results:
        st = state.setdefault(src["id"], {})
        st["last_attempt"] = now_s
        r = {"status": "ok", "new": 0, "updated": 0, "unchanged": 0, "duplicates": 0, "invalid": 0, "ms": ms, "page_errors": 0}
        if err:
            fails = st.get("consecutive_failures", 0) + 1
            st.update(consecutive_failures=fails, last_error=sanitize_error(err),
                      next_due=(now_dt + timedelta(hours=min(48, src.get("fetch_every_hours", 6) * 2 ** (fails - 1)))).strftime("%Y-%m-%dT%H:%M:%SZ"))
            r.update(status="failed", error=sanitize_error(err))
            report["totals"]["failed_sources"] += 1
            log.warning("source failed", extra={"source": src["id"], "error": r["error"]})
            report["sources"][src["id"]] = r
            continue
        st.update(consecutive_failures=0, last_error=None, last_success=now_s,
                  next_due=(now_dt + timedelta(hours=src.get("fetch_every_hours", 6))).strftime("%Y-%m-%dT%H:%M:%SZ"))
        if meta.get("etag"): st["etag"] = meta["etag"]
        if meta.get("last_modified"): st["last_modified"] = meta["last_modified"]
        if meta.get("not_modified"):
            r["status"] = "not-modified"
        for e in entries:
            if e.get("_page_error"):
                r["page_errors"] += 1
            if e.get("_known"):
                r["unchanged"] += 1
                continue
            a = build(e, src, now_s)
            if not a:
                r["invalid"] += 1
                continue
            old = store.get(a["id"])
            if old and old["source_id"] != a["source_id"]:  # same URL from a second source: first one wins
                r["duplicates"] += 1
                continue
            if old and old["content_hash"] == a["content_hash"]:
                r["unchanged"] += 1
                old["last_seen_at"] = now_s
                continue
            dup = hashes.get(a["content_hash"])
            if dup and dup != a["id"]:
                r["duplicates"] += 1
                continue
            for other in store.values():  # same story from another source within 3 days
                if other["source_id"] != a["source_id"] and near_duplicate(other["title"], a["title"]) and abs((hours_since(other["fetched_at"], now_dt) or 0)) < 72:
                    a["duplicate_of"] = other["id"]
                    break
            # enrichment, cached by content hash; AI only for new/changed content and within budget
            cached = cache.get(a["content_hash"])
            if cached and (cached.get("method") != "extractive" or not provider or enrich_budget <= 0):
                enr = cached
            else:
                use = provider if (provider and enrich_budget > 0 and not a.get("duplicate_of")) else None
                enr = enrich(a, use, topics_kw)
                if use:
                    enrich_budget -= 1
                cache[a["content_hash"]] = enr
            report["totals"]["enriched_ai" if enr.get("method") not in ("extractive", None) else "enriched_extractive"] += 1
            topic_text = f"{a['title']} {a['description']} {a['content_text'][:3000]}"
            a["topics"] = list(dict.fromkeys((enr.get("topics") or []) + classify(topic_text, a["categories"], topics_kw)))[:3]
            a.update({k: enr.get(k) for k in ("summary", "takeaways", "why_useful", "techniques", "experiments", "verify", "method")})
            a["extraction_complete"] = enr.get("extraction_complete", False) and a["extraction"] == "full"
            a["processing_status"] = "enriched" if enr.get("method") != "extractive" else "extracted"
            a.pop("content_text", None)  # full text is never stored or published
            a["first_seen_at"] = old.get("first_seen_at", now_s) if old else now_s
            a["last_seen_at"] = now_s
            store[a["id"]] = a
            hashes[a["content_hash"]] = a["id"]
            r["updated" if old else "new"] += 1
        for k in ("new", "updated", "unchanged", "duplicates", "invalid"):
            report["totals"][k] += r[k]
        report["sources"][src["id"]] = r

    # re-score everything (recency changes every run) and apply retention
    trust = {s["id"]: s.get("trust", 3) for s in registry}
    cutoff = now_dt - timedelta(days=config.ARTICLE_RETENTION_DAYS)
    for aid in list(store):
        a = store[aid]
        when = a.get("published_at") or a.get("first_seen_at")
        if when and datetime.fromisoformat(when.replace("Z", "+00:00")) < cutoff:
            del store[aid]
            continue
        a["score"], a["score_parts"], a["relevance_score"] = score(a, trust.get(a["source_id"], 3), interests, now_dt)
        a["quality_score"] = a["score_parts"]["quality"]
    live_hashes = {a["content_hash"] for a in store.values()}
    for h in [h for h in cache if h not in live_hashes]:
        cache.pop(h, None)
    report["finished_at"] = now_iso()
    report["skipped_not_due"] = len(sources) - len(todo)
    return report
