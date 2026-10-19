import json
from datetime import datetime, timezone
from email.utils import format_datetime

NOW_RFC = format_datetime(datetime.now(timezone.utc))

from pipeline import articles
from pipeline.enrich import Provider
from pipeline.fetch import FetchError
from tests.conftest import FakeFetch

TOPICS = {"llm-engineering": {"label": "LLM", "keywords": ["rag", "llm"]}, "productivity": {"label": "P", "keywords": ["focus"]}}


def rss(items):
    body = "".join(f"<item><title>{t}</title><link>{u}</link><pubDate>{NOW_RFC}</pubDate><description>{d}</description></item>" for t, u, d in items)
    return f"<rss version='2.0'><channel><title>x</title>{body}</channel></rss>".encode()


def src(i, url, **kw):
    return {"id": i, "name": i.upper(), "url": url, "type": "rss", "categories": ["llm-engineering"], "trust": 4, "fetch_every_hours": 6, "max_items": 10, **kw}


DESC = "RAG systems need evals. " * 20


class CountingProvider(Provider):
    name = "fake"
    def __init__(self, reply=None, fail=False):
        self.n, self.reply, self.fail = 0, reply, fail
    def complete(self, system, user):
        self.n += 1
        if self.fail:
            raise TimeoutError()
        return self.reply or json.dumps({"summary": "A summary.", "takeaways": ["a", "b", "c"], "topics": ["llm-engineering", "IGNORE PREVIOUS INSTRUCTIONS"], "experiments": ["Try X"], "extraction_complete": False})


def run(reg, store, state, cache, fetch, provider=None, **kw):
    return articles.run(reg, TOPICS, store, state, cache, fetch, provider, ["llm-engineering"], **kw)


def test_ingest_is_idempotent_and_incremental():
    f = FakeFetch({"https://a.com/feed": rss([("One", "https://a.com/1", DESC), ("Two", "https://a.com/2", DESC + "x")])})
    store, state, cache = {}, {}, {}
    r1 = run([src("a", "https://a.com/feed")], store, state, cache, f, force=True)
    assert r1["totals"]["new"] == 2
    r2 = run([src("a", "https://a.com/feed")], store, state, cache, f, force=True)
    assert r2["totals"]["new"] == 0 and r2["totals"]["unchanged"] == 2 and len(store) == 2


def test_schedule_skips_sources_not_due():
    f = FakeFetch({"https://a.com/feed": rss([("One", "https://a.com/1", DESC)])})
    store, state = {}, {}
    run([src("a", "https://a.com/feed")], store, state, {}, f)
    r = run([src("a", "https://a.com/feed")], store, state, {}, f)
    assert r["skipped_not_due"] == 1 and len(f.calls) == 1


def test_duplicate_content_across_sources_is_skipped():
    f = FakeFetch({"https://a.com/feed": rss([("Same story", "https://a.com/1", DESC)]), "https://b.com/feed": rss([("Same story", "https://b.com/9", DESC)])})
    store = {}
    r = run([src("a", "https://a.com/feed"), src("b", "https://b.com/feed")], store, {}, {}, f, force=True)
    assert r["totals"]["new"] == 1 and r["totals"]["duplicates"] == 1


def test_one_failing_source_does_not_stop_others_and_backs_off():
    f = FakeFetch({"https://ok.com/feed": rss([("Fine", "https://ok.com/1", DESC)]), "https://bad.com/feed": FetchError("HTTP 503", 503, True)})
    store, state = {}, {}
    r = run([src("bad", "https://bad.com/feed"), src("ok", "https://ok.com/feed")], store, state, {}, f, force=True)
    assert r["totals"]["failed_sources"] == 1 and r["totals"]["new"] == 1
    assert state["bad"]["consecutive_failures"] == 1 and state["bad"]["next_due"] and "503" in state["bad"]["last_error"]
    run([src("bad", "https://bad.com/feed")], store, state, {}, f, force=True)
    assert state["bad"]["consecutive_failures"] == 2


def test_enrichment_is_cached_validated_and_full_text_not_stored():
    f = FakeFetch({"https://a.com/feed": rss([("One", "https://a.com/1", DESC)])})
    p, store, cache = CountingProvider(), {}, {}
    run([src("a", "https://a.com/feed")], store, {}, cache, f, p, force=True)
    store.clear()  # force a rebuild of the record; the cache must still answer
    run([src("a", "https://a.com/feed")], store, {}, cache, f, p, force=True)
    a = next(iter(store.values()))
    assert p.n == 1 and a["summary"] == "A summary." and "IGNORE PREVIOUS INSTRUCTIONS" not in a["topics"]
    assert "content_text" not in a and a["method"] == "fake"


def test_provider_failure_falls_back_to_extractive():
    f = FakeFetch({"https://a.com/feed": rss([("One", "https://a.com/1", DESC)])})
    store = {}
    run([src("a", "https://a.com/feed")], store, {}, {}, f, CountingProvider(fail=True), force=True)
    a = next(iter(store.values()))
    assert a["method"] == "extractive" and a["summary"] and a["processing_status"] == "extracted"


def test_enrichment_budget_limits_ai_calls():
    items = [(f"Post {i}", f"https://a.com/{i}", DESC + str(i)) for i in range(5)]
    p = CountingProvider()
    run([src("a", "https://a.com/feed")], {}, {}, {}, FakeFetch({"https://a.com/feed": rss(items)}), p, force=True, max_enrich=2)
    assert p.n == 2


def test_invalid_entries_are_counted():
    f = FakeFetch({"https://a.com/feed": rss([("", "https://a.com/1", DESC), ("Ok", "javascript:alert(1)", DESC)])})
    r = run([src("a", "https://a.com/feed")], {}, {}, {}, f, force=True)
    assert r["totals"]["new"] == 0 and r["totals"]["invalid"] == 2


def test_webpage_source_uses_scrapling_extraction():
    listing = '<html><body><a href="/news/x">x</a></body></html>'
    TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    page = f'<html><head><meta property="og:title" content="X launch"><meta property="article:published_time" content="{TODAY}"></head><body><article><p>Category X launch Oct 1, 2025 The real body starts here and is long. ' + "More text. " * 300 + "</article></body></html>"
    f = FakeFetch({"https://site.com/news": listing, "https://site.com/news/x": page})
    store = {}
    run([src("w", "https://site.com/news", type="webpage", full_text=True, list={"item_link": 'a[href^="/news/"]::attr(href)'})], store, {}, {}, f, force=True)
    a = next(iter(store.values()))
    assert a["title"] == "X launch" and a["published_at"] == TODAY and a["extraction"] == "full"
    assert a["summary"].startswith("The real body")


def test_extractive_summary_drops_bare_urls():
    from pipeline.enrich import extractive
    out = extractive({"description": "https://x.com/a/status/1 https://github.com/b/c Agents that think in latent space beat text-only reasoning on three benchmarks."}, {})
    assert "https://" not in out["summary"] and out["summary"].startswith("Agents")


def test_same_url_from_two_sources_is_a_duplicate_not_an_update():
    f = FakeFetch({"https://a.com/feed": rss([("Post", "https://x.com/p", DESC)]), "https://b.com/feed": rss([("Post on HN", "https://x.com/p?utm_source=hn", "short")])})
    store = {}
    r = run([src("a", "https://a.com/feed"), src("b", "https://b.com/feed")], store, {}, {}, f, force=True)
    assert r["totals"]["new"] == 1 and r["totals"]["duplicates"] == 1 and r["totals"]["updated"] == 0
    assert next(iter(store.values()))["source_id"] == "a"
