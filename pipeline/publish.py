"""Write the read-only static API under api/v1/. GitHub Pages serves it; the browser reads it."""
import shutil
from collections import Counter
from datetime import datetime, timedelta, timezone

from . import config
from .normalize import hours_since, now_iso
from .rank import diversify
from .store import save

CARD = ("id", "title", "url", "date_basis", "source_id", "source_name", "author", "published_at", "first_seen_at", "description", "image_url",
        "topics", "reading_minutes", "score", "relevance_score", "quality_score", "summary", "method", "duplicate_of", "extraction")
DETAIL = CARD + ("canonical_url", "updated_at", "takeaways", "why_useful", "techniques", "experiments", "verify", "extraction_complete",
                 "score_parts", "processing_status", "language", "votes")
JOB_CARD = ("id", "title", "company", "location", "work_mode", "employment_type", "salary_min", "salary_max", "salary_currency", "salary_text",
            "published_at", "published_verified", "first_seen_at", "required_skills", "preferred_skills", "experience_min_years", "seniority",
            "source_id", "adapter", "url", "application_url", "department", "attribution")
PUBLIC_SOURCE = ("id", "name", "url", "type", "categories", "enabled", "trust", "priority", "fetch_every_hours")


def pick(d, keys):
    return {k: d.get(k) for k in keys if d.get(k) not in (None, [], "")}


def _reset(folder):
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True, exist_ok=True)


def publish_articles(store, registry, state, topics, prefs_digest=8, now=None):
    now = now or datetime.now(timezone.utc)
    api = config.API
    items = sorted((a for a in store.values() if not a.get("duplicate_of")), key=lambda a: -a.get("score", 0))
    cards = [pick(a, CARD) for a in items]
    _reset(api / "articles")
    save("articles/index", {"generated_at": now_iso(), "count": len(cards), "personalized": False, "items": cards}, api)
    per = 50
    for i in range(0, max(len(cards), 1), per):
        save(f"articles/page/{i // per + 1}", {"page": i // per + 1, "per_page": per, "total": len(cards), "pages": (len(cards) + per - 1) // per, "items": cards[i:i + per]}, api)
    for a in store.values():
        save(f"articles/{a['id']}", pick(a, DETAIL), api)
    save("feed", {"generated_at": now_iso(), "personalized": False, "note": "Base ranking. The app re-ranks with your interests and feedback on your device.",
                  "items": [pick(a, CARD) for a in diversify(items, 30)]}, api)
    # Daily briefing: recent reads first, diversified, with the article's own action ideas.
    recent = [a for a in items if a.get("published_at") and (hours_since(a["published_at"], now) or 999) <= 48] or [a for a in items if a.get("published_at")][:40] or items
    reads = diversify(recent, prefs_digest)
    themes = Counter(t for a in recent for t in (a.get("topics") or [])[:1]).most_common(5)
    ideas = [{"text": e, "article_id": a["id"], "source": a["source_name"]} for a in reads for e in (a.get("experiments") or [])[:1]][:5]
    devs = [pick(a, CARD) for a in recent if a.get("score_parts", {}).get("trust", 0) >= 0.8 and any(t in ("ai-tools", "ai-research") for t in a.get("topics") or [])][:5]
    label = {k: v["label"] for k, v in topics.items()}
    overview = (f"{len(recent)} new pieces in the last 48 hours across {len({a['source_id'] for a in recent})} sources. "
                f"Most of it is about {', '.join(label.get(t, t)[0].lower() + label.get(t, t)[1:] if not label.get(t, t).startswith(('AI', 'LLM')) else label.get(t, t) for t, _ in themes[:3]) or 'a mix of topics'}.") if recent else "No new articles yet."
    save("digest/today", {"date": now.strftime("%Y-%m-%d"), "generated_at": now_iso(), "overview": overview,
                          "themes": [{"topic": t, "label": label.get(t, t), "count": n} for t, n in themes],
                          "reads": [pick(a, CARD) for a in reads], "total_minutes": sum(a.get("reading_minutes") or 5 for a in reads),
                          "minutes_estimated": any(not a.get("reading_minutes") for a in reads),
                          "action_ideas": ideas, "developments": devs}, api)
    counts = Counter(t for a in items for t in a.get("topics") or [])
    save("topics", {"topics": [{"id": k, "label": v["label"], "articles": counts.get(k, 0)} for k, v in topics.items()]}, api)
    per_source = Counter(a["source_id"] for a in store.values())
    save("sources", {"generated_at": now_iso(), "sources": [dict(pick(s, PUBLIC_SOURCE), enabled=s.get("enabled", True), articles=per_source.get(s["id"], 0),
                     **{k: state.get(s["id"], {}).get(k) for k in ("last_success", "last_attempt", "last_error", "consecutive_failures", "next_due")}) for s in registry]}, api)


def publish_jobs(store, registry, state, now=None):
    api = config.API
    active = sorted((j for j in store.values() if j.get("is_active")), key=lambda j: j.get("published_at") or j.get("first_seen_at") or "", reverse=True)
    _reset(api / "jobs")
    save("jobs/index", {"generated_at": now_iso(), "count": len(active), "items": [pick(j, JOB_CARD) for j in active]}, api)
    for j in active:
        d = pick(j, JOB_CARD + ("canonical_url", "careers_url", "updated_at", "last_checked_at", "last_seen_at"))
        d["description"] = j["description"] if j.get("publish_description", True) else None
        save(f"jobs/{j['id']}", d, api)
    comp = {}
    for j in active:
        c = comp.setdefault(j.get("company") or "Unknown", {"company": j.get("company") or "Unknown", "jobs": 0, "remote": 0, "careers_url": j.get("careers_url")})
        c["jobs"] += 1
        c["remote"] += j.get("work_mode") == "remote"
    save("companies", {"companies": sorted(comp.values(), key=lambda c: -c["jobs"])}, api)
    save("job-sources", {"generated_at": now_iso(), "sources": [dict({k: s.get(k) for k in ("id", "adapter", "board", "company", "enabled", "fetch_every_hours")},
                         jobs=sum(1 for j in active if j["source_id"] == s["id"]), **{k: state.get(s["id"], {}).get(k) for k in ("last_success", "last_attempt", "last_error", "consecutive_failures", "next_due")})
                         for s in registry["sources"]]}, api)


def publish_runs(runs):
    save("admin/runs", {"runs": runs[-60:][::-1]}, config.API)
    last = {k: next((r for r in reversed(runs) if r["kind"] == k), None) for k in ("articles", "jobs")}
    save("health", {"generated_at": now_iso(), "ok": all(r is None or r["totals"].get("failed_sources", 0) < len(r["sources"]) or not r["sources"] for r in last.values()),
                    "last": {k: r and {"id": r["id"], "finished_at": r.get("finished_at"), "totals": r["totals"]} for k, r in last.items()}}, config.API)
