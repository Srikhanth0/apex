import json
from datetime import datetime, timedelta, timezone

from pipeline import config, publish
from pipeline.rank import diversify, near_duplicate, score

NOW = datetime(2025, 10, 10, tzinfo=timezone.utc)
iso = lambda d: (NOW - timedelta(days=d)).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_recency_does_not_dominate():
    old_good = {"published_at": iso(4), "topics": ["llm-engineering"], "summary": "s", "takeaways": ["a", "b", "c"], "experiments": ["x"], "reading_minutes": 8, "author": "A"}
    new_off = {"published_at": iso(0), "topics": ["health"]}
    assert score(old_good, 5, ["llm-engineering"], NOW)[0] > score(new_off, 2, ["llm-engineering"], NOW)[0]


def test_undated_is_never_treated_as_new():
    dated = {"published_at": iso(0), "fetched_at": iso(0)}
    undated = {"published_at": None, "fetched_at": iso(0)}
    assert score(dated, 3, [], NOW)[1]["recency"] > score(undated, 3, [], NOW)[1]["recency"] * 3


def test_diversify_caps_sources_and_near_duplicates():
    items = [{"id": str(i), "source_id": "a", "title": f"Unique headline number {i}", "topics": ["x"]} for i in range(5)]
    items.insert(1, {"id": "d", "source_id": "b", "title": "Unique headline number 0", "topics": ["y"]})
    out = diversify(items, 3, per_source=2)
    assert [o["id"] for o in out][:2] == ["0", "1"] and "d" not in [o["id"] for o in out]
    assert near_duplicate("OpenAI releases GPT-6 today", "OpenAI releases GPT-6 today, says CEO")


def test_publish_writes_api_without_full_text():
    store = {"a1": {"id": "a1", "title": "T", "url": "https://x/1", "source_id": "s", "source_name": "S", "published_at": None, "first_seen_at": iso(0),
                    "score": 0.5, "topics": ["llm-engineering"], "summary": "sum", "content_hash": "h"},
             "a2": {"id": "a2", "title": "Dated", "url": "https://x/2", "source_id": "s", "source_name": "S", "published_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "score": 0.4, "topics": ["llm-engineering"], "summary": "sum", "content_hash": "h2", "experiments": ["Try it"], "score_parts": {"trust": 1}}}
    publish.publish_articles(store, [{"id": "s", "name": "S", "url": "https://x", "type": "rss"}], {}, {"llm-engineering": {"label": "LLM engineering"}})
    api = config.API
    idx = json.loads((api / "articles/index.json").read_text())
    assert idx["count"] == 2 and not idx["personalized"]
    digest = json.loads((api / "digest/today.json").read_text())
    assert [r["id"] for r in digest["reads"]] == ["a2"] and digest["action_ideas"][0]["text"] == "Try it"
    assert "content_text" not in (api / "articles/a1.json").read_text()


def test_publish_jobs_respects_no_republish_flag():
    store = {"j1": {"id": "j1", "title": "Eng", "is_active": True, "source_id": "r", "description": "secret text", "publish_description": False, "first_seen_at": iso(0)}}
    publish.publish_jobs(store, {"sources": [{"id": "r", "adapter": "remotive"}]}, {})
    assert json.loads((config.API / "jobs/j1.json").read_text())["description"] is None
