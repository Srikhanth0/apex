"""Job discovery from public ATS and job-board APIs. One adapter per source type, one shared schema."""
import hashlib
import html as htmllib
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from . import config
from .articles import due, sanitize_error
from .extract import html_to_text
from .normalize import canonical_url, clean_title, now_iso, parse_date
from .skills import experience_years, seniority, split_skills

log = logging.getLogger("apex.jobs")


def _mode(text, is_remote=None, workplace=None):
    w = (workplace or "").lower()
    if is_remote or w == "remote":
        return "remote"
    if "hybrid" in w:
        return "hybrid"
    if w in ("onsite", "on-site", "in office", "inoffice"):
        return "onsite"
    t = (text or "").lower()
    if "hybrid" in t:
        return "hybrid"
    if "remote" in t:
        return "remote"
    return None


def _emp(v):
    v = (v or "").lower().replace("_", " ").replace("-", " ")
    for k, label in (("intern", "internship"), ("full", "full-time"), ("part", "part-time"), ("contract", "contract"), ("temp", "temporary")):
        if k in v:
            return label
    return None


def greenhouse(src, fetch):
    res = fetch.get(f"https://boards-api.greenhouse.io/v1/boards/{src['board']}/jobs?content=true&pay_transparency=true", accept="application/json", max_bytes=config.JOB_MAX_BYTES)
    out = []
    for j in json.loads(res.body).get("jobs", []):
        loc = (j.get("location") or {}).get("name") or ""
        pay = (j.get("pay_input_ranges") or [{}])[0] if j.get("pay_input_ranges") else {}
        out.append(dict(source_job_id=str(j["id"]), title=j.get("title", ""), company=src.get("company") or j.get("company_name"),
                        url=j.get("absolute_url"), apply_url=j.get("absolute_url"), location=loc,
                        description=html_to_text(htmllib.unescape(j.get("content") or "")),
                        published_at=parse_date(j.get("first_published")), updated_at=parse_date(j.get("updated_at")),
                        work_mode=_mode(loc), employment_type=None,
                        salary_min=pay.get("min_cents") and pay["min_cents"] // 100, salary_max=pay.get("max_cents") and pay["max_cents"] // 100,
                        salary_currency=pay.get("currency_type"), department=((j.get("departments") or [{}])[0] or {}).get("name"),
                        careers_url=f"https://job-boards.greenhouse.io/{src['board']}"))
    return out


def ashby(src, fetch):
    res = fetch.get(f"https://api.ashbyhq.com/posting-api/job-board/{src['board']}?includeCompensation=true", accept="application/json", max_bytes=config.JOB_MAX_BYTES)
    out = []
    for j in json.loads(res.body).get("jobs", []):
        comp = next((c for c in ((j.get("compensation") or {}).get("summaryComponents") or []) if (c.get("compensationType") or "").lower() == "salary"), {})
        loc = j.get("location") or ""
        out.append(dict(source_job_id=str(j["id"]), title=j.get("title", ""), company=src.get("company"), url=j.get("jobUrl"),
                        apply_url=j.get("applyUrl") or j.get("jobUrl"), location=loc, description=(j.get("descriptionPlain") or html_to_text(j.get("descriptionHtml") or "")),
                        published_at=parse_date(j.get("publishedAt")), updated_at=None,
                        work_mode=_mode(loc, j.get("isRemote"), j.get("workplaceType")), employment_type=_emp(j.get("employmentType")),
                        salary_min=comp.get("minValue"), salary_max=comp.get("maxValue"), salary_currency=comp.get("currencyCode"),
                        department=j.get("department"), careers_url=f"https://jobs.ashbyhq.com/{src['board']}"))
    return out


def lever(src, fetch):
    res = fetch.get(f"https://api.lever.co/v0/postings/{src['board']}?mode=json", accept="application/json", max_bytes=config.JOB_MAX_BYTES)
    out = []
    for j in json.loads(res.body):
        cat = j.get("categories") or {}
        lists = "\n".join(f"{l.get('text', '')}\n{html_to_text(l.get('content', ''))}" for l in j.get("lists") or [])
        sal = j.get("salaryRange") or {}
        loc = cat.get("location") or ""
        out.append(dict(source_job_id=j["id"], title=j.get("text", ""), company=src.get("company"), url=j.get("hostedUrl"),
                        apply_url=j.get("applyUrl") or j.get("hostedUrl"), location=loc,
                        description=f"{j.get('descriptionPlain') or ''}\n{lists}\n{j.get('additionalPlain') or ''}".strip(),
                        published_at=parse_date(j.get("createdAt")), updated_at=None,
                        work_mode=_mode(loc, None, j.get("workplaceType")), employment_type=_emp(cat.get("commitment")),
                        salary_min=sal.get("min"), salary_max=sal.get("max"), salary_currency=sal.get("currency"),
                        department=cat.get("team"), careers_url=f"https://jobs.lever.co/{src['board']}"))
    return out


def remotive(src, fetch):
    # Remotive terms: link back to the Remotive URL, name Remotive, max ~4 requests a day. Description is not republished.
    res = fetch.get(f"https://remotive.com/api/remote-jobs?category={src['board']}&limit=100", accept="application/json", max_bytes=config.JOB_MAX_BYTES)
    out = []
    for j in json.loads(res.body).get("jobs", []):
        out.append(dict(source_job_id=str(j["id"]), title=j.get("title", ""), company=j.get("company_name"), url=j.get("url"), apply_url=j.get("url"),
                        location=j.get("candidate_required_location") or "", description=html_to_text(j.get("description") or ""),
                        published_at=parse_date(j.get("publication_date")), updated_at=None, work_mode="remote",
                        employment_type=_emp(j.get("job_type")), salary_min=None, salary_max=None, salary_currency=None,
                        salary_text=(j.get("salary") or "")[:80] or None, department=j.get("category"), careers_url=None,
                        attribution="Remotive", publish_description=False))
    return out


def arbeitnow(src, fetch):
    res = fetch.get("https://www.arbeitnow.com/api/job-board-api", accept="application/json", max_bytes=config.JOB_MAX_BYTES)
    out = []
    for j in json.loads(res.body).get("data", []):
        out.append(dict(source_job_id=j["slug"], title=j.get("title", ""), company=j.get("company_name"), url=j.get("url"), apply_url=j.get("url"),
                        location=j.get("location") or "", description=html_to_text(j.get("description") or ""),
                        published_at=parse_date(j.get("created_at")), updated_at=None, work_mode="remote" if j.get("remote") else _mode(j.get("location")),
                        employment_type=_emp(" ".join(j.get("job_types") or [])), salary_min=None, salary_max=None, salary_currency=None,
                        department=None, careers_url=None, attribution="Arbeitnow"))
    return out


ADAPTERS = {"greenhouse": greenhouse, "ashby": ashby, "lever": lever, "remotive": remotive, "arbeitnow": arbeitnow}


def title_ok(title, words):
    t = f" {re.sub(r'[^a-z0-9+]+', ' ', (title or '').lower())} "
    return any(f" {w} " in t for w in words)


def job_key(company, title, location):
    norm = lambda s: re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
    return hashlib.sha1(f"{norm(company)}|{norm(title)}|{norm(location)}".encode()).hexdigest()[:16]


def normalize(raw, src, vocab, now_s):
    if not raw.get("title") or not str(raw.get("url") or "").startswith("http"):
        return None
    desc = (raw.get("description") or "").strip()
    req, pref = split_skills(desc, vocab)
    canon = canonical_url(raw["url"])
    jid = hashlib.sha1(f"{src['id']}:{raw['source_job_id']}".encode()).hexdigest()[:12]
    try:
        smin = int(raw["salary_min"]) if raw.get("salary_min") is not None else None
        smax = int(raw["salary_max"]) if raw.get("salary_max") is not None else None
    except (TypeError, ValueError):
        smin = smax = None
    return {
        "id": jid, "source_id": src["id"], "source_job_id": raw["source_job_id"], "adapter": src["adapter"],
        "title": clean_title(raw["title"])[:200], "company": (raw.get("company") or "").strip()[:120] or None,
        "canonical_url": canon, "url": raw["url"], "application_url": raw.get("apply_url") or raw["url"],
        "location": (raw.get("location") or "").strip()[:160] or None, "work_mode": raw.get("work_mode"),
        "employment_type": raw.get("employment_type"), "salary_min": smin, "salary_max": smax,
        "salary_currency": raw.get("salary_currency") if (smin or smax) else None, "salary_text": raw.get("salary_text"),
        "department": raw.get("department"), "description": desc[: config.JOB_DESCRIPTION_CHARS],
        "publish_description": raw.get("publish_description", True), "attribution": raw.get("attribution"),
        "required_skills": req, "preferred_skills": pref, "experience_min_years": experience_years(desc),
        "seniority": seniority(raw["title"]), "published_at": raw.get("published_at"),
        "published_verified": bool(raw.get("published_at")), "updated_at": raw.get("updated_at"),
        "careers_url": raw.get("careers_url"), "content_hash": hashlib.sha256(f"{raw['title']}|{desc}".encode()).hexdigest()[:16],
        "dedupe_key": job_key(raw.get("company"), raw["title"], raw.get("location")), "last_checked_at": now_s,
    }


def run(registry, store, state, fetch, vocab, only=None, force=False, now=None):
    now_dt = now or datetime.now(timezone.utc)
    now_s = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    words = registry.get("title_filter") or []
    sources = [s for s in registry["sources"] if s.get("enabled", True) and (not only or s["id"] == only)]
    todo = [s for s in sources if due(s, state.get(s["id"], {}), now_dt, force or bool(only))]
    report = {"kind": "jobs", "started_at": now_s, "sources": {}, "totals": {"new": 0, "updated": 0, "unchanged": 0, "duplicates": 0, "filtered": 0, "expired": 0, "failed_sources": 0, "active": 0}}

    def work(src):
        t0 = time.monotonic()
        try:
            adapter = ADAPTERS[src["adapter"]]
            return src, adapter(src, fetch), None, int((time.monotonic() - t0) * 1000)
        except Exception as exc:
            return src, [], exc, int((time.monotonic() - t0) * 1000)

    with ThreadPoolExecutor(max_workers=config.WORKERS) as pool:
        results = list(pool.map(work, todo))

    by_key = {j["dedupe_key"]: jid for jid, j in store.items() if j.get("is_active")}
    for src, raws, err, ms in results:
        st = state.setdefault(src["id"], {})
        st["last_attempt"] = now_s
        r = {"status": "ok", "fetched": len(raws), "new": 0, "updated": 0, "unchanged": 0, "duplicates": 0, "filtered": 0, "expired": 0, "ms": ms}
        if err:
            fails = st.get("consecutive_failures", 0) + 1
            st.update(consecutive_failures=fails, last_error=sanitize_error(err),
                      next_due=(now_dt + timedelta(hours=min(48, src.get("fetch_every_hours", 12) * 2 ** (fails - 1)))).strftime("%Y-%m-%dT%H:%M:%SZ"))
            r.update(status="failed", error=sanitize_error(err))
            report["totals"]["failed_sources"] += 1
            report["sources"][src["id"]] = r
            continue
        st.update(consecutive_failures=0, last_error=None, last_success=now_s,
                  next_due=(now_dt + timedelta(hours=src.get("fetch_every_hours", 12))).strftime("%Y-%m-%dT%H:%M:%SZ"))
        seen = set()
        for raw in raws:
            if words and not title_ok(raw.get("title"), words):
                r["filtered"] += 1
                continue
            j = normalize(raw, src, vocab, now_s)
            if not j:
                r["filtered"] += 1
                continue
            seen.add(j["id"])
            old = store.get(j["id"])
            other = by_key.get(j["dedupe_key"])
            if not old and other and other != j["id"] and store[other]["source_id"] != src["id"]:  # same role, same company and place, other source
                r["duplicates"] += 1
                store[other]["last_seen_at"] = now_s
                continue
            if old and old["content_hash"] == j["content_hash"] and old.get("is_active"):
                old.update(last_seen_at=now_s, last_checked_at=now_s)
                r["unchanged"] += 1
                continue
            j["first_seen_at"] = old["first_seen_at"] if old else now_s
            j.update(last_seen_at=now_s, is_active=True, closed_at=None)
            store[j["id"]] = j
            by_key[j["dedupe_key"]] = j["id"]
            r["updated" if old else "new"] += 1
        # listings missing from a successful fetch are no longer live
        for jid, j in store.items():
            if j["source_id"] == src["id"] and j.get("is_active") and jid not in seen:
                j.update(is_active=False, closed_at=now_s)
                r["expired"] += 1
        for k in ("new", "updated", "unchanged", "duplicates", "filtered", "expired"):
            report["totals"][k] += r[k]
        report["sources"][src["id"]] = r
    cutoff = (now_dt - timedelta(days=config.JOB_RETENTION_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for jid in [jid for jid, j in store.items() if not j.get("is_active") and (j.get("closed_at") or "") < cutoff]:
        del store[jid]
    report["totals"]["active"] = sum(1 for j in store.values() if j.get("is_active"))
    report["finished_at"] = now_iso()
    report["skipped_not_due"] = len(sources) - len(todo)
    return report
