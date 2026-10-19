import json

from pipeline import jobs
from pipeline.fetch import FetchError
from pipeline.skills import experience_years, load_vocab, seniority, split_skills
from tests.conftest import FakeFetch

VOCAB = load_vocab()
GH = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true&pay_transparency=true"
ASHBY = "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true"
LEVER = "https://api.lever.co/v0/postings/acme?mode=json"
DESC = "&lt;h3&gt;Requirements&lt;/h3&gt;&lt;p&gt;3+ years of experience with Python and PyTorch.&lt;/p&gt;&lt;h3&gt;Nice to have&lt;/h3&gt;&lt;p&gt;Kubernetes&lt;/p&gt;"


def gh_body(ids):
    return json.dumps({"jobs": [{"id": i, "title": "Machine Learning Engineer", "absolute_url": f"https://job-boards.greenhouse.io/acme/jobs/{i}", "location": {"name": "Remote - India"},
                                  "first_published": "2025-10-01T10:00:00-04:00", "updated_at": "2025-10-05T10:00:00-04:00", "content": DESC,
                                  "pay_input_ranges": [{"min_cents": 10000000, "max_cents": 15000000, "currency_type": "USD"}]} for i in ids]
                       + [{"id": 999, "title": "Office Manager", "absolute_url": "https://x/999", "location": {"name": "NYC"}, "content": ""}]})


def reg(*sources):
    return {"title_filter": ["engineer", "ml"], "sources": list(sources)}


GH_SRC = {"id": "greenhouse-acme", "adapter": "greenhouse", "board": "acme", "company": "Acme", "fetch_every_hours": 12}


def test_greenhouse_adapter_normalizes_and_filters():
    store = {}
    r = jobs.run(reg(GH_SRC), store, {}, FakeFetch({GH: gh_body([1, 2])}), VOCAB, force=True)
    assert r["totals"]["new"] == 2 and r["totals"]["filtered"] == 1
    j = next(iter(store.values()))
    assert j["company"] == "Acme" and j["work_mode"] == "remote" and j["salary_min"] == 100000 and j["salary_currency"] == "USD"
    assert j["published_verified"] and j["published_at"] == "2025-10-01T14:00:00Z"
    assert j["required_skills"] == ["PyTorch", "Python"] and j["preferred_skills"] == ["Kubernetes"] and j["experience_min_years"] == 3


def test_rerun_is_idempotent_and_missing_listings_expire():
    store, state = {}, {}
    jobs.run(reg(GH_SRC), store, state, FakeFetch({GH: gh_body([1, 2])}), VOCAB, force=True)
    r2 = jobs.run(reg(GH_SRC), store, state, FakeFetch({GH: gh_body([1, 2])}), VOCAB, force=True)
    assert r2["totals"]["new"] == 0 and r2["totals"]["unchanged"] == 2
    r3 = jobs.run(reg(GH_SRC), store, state, FakeFetch({GH: gh_body([1])}), VOCAB, force=True)
    assert r3["totals"]["expired"] == 1 and sum(j["is_active"] for j in store.values()) == 1


def test_failed_fetch_does_not_expire_jobs():
    store, state = {}, {}
    jobs.run(reg(GH_SRC), store, state, FakeFetch({GH: gh_body([1, 2])}), VOCAB, force=True)
    r = jobs.run(reg(GH_SRC), store, state, FakeFetch({GH: FetchError("HTTP 500", 500, True)}), VOCAB, force=True)
    assert r["totals"]["failed_sources"] == 1 and all(j["is_active"] for j in store.values())


def test_ashby_and_lever_adapters_and_cross_source_dedupe():
    ashby = json.dumps({"jobs": [{"id": "a1", "title": "AI Engineer", "location": "Bengaluru", "isRemote": False, "workplaceType": "Hybrid", "employmentType": "FullTime",
                                   "publishedAt": "2025-10-02T00:00:00Z", "jobUrl": "https://jobs.ashbyhq.com/acme/a1", "applyUrl": "https://jobs.ashbyhq.com/acme/a1/application",
                                   "descriptionPlain": "Build RAG with LangChain.", "compensation": {"summaryComponents": [{"compensationType": "Salary", "minValue": 3000000, "maxValue": 4500000, "currencyCode": "INR"}]}}]})
    lever = json.dumps([{"id": "l1", "text": "AI Engineer", "hostedUrl": "https://jobs.lever.co/acme/l1", "applyUrl": "https://jobs.lever.co/acme/l1/apply",
                         "createdAt": 1759363200000, "categories": {"location": "Bengaluru", "commitment": "Full-time"}, "descriptionPlain": "Build RAG with LangChain.", "lists": []}])
    store = {}
    r = jobs.run(reg({"id": "ashby-acme", "adapter": "ashby", "board": "acme", "company": "Acme"}, {"id": "lever-acme", "adapter": "lever", "board": "acme", "company": "Acme"}),
                 store, {}, FakeFetch({ASHBY: ashby, LEVER: lever}), VOCAB, force=True)
    assert r["totals"]["new"] == 1 and r["totals"]["duplicates"] == 1
    j = next(iter(store.values()))
    assert j["work_mode"] == "hybrid" and j["employment_type"] == "full-time" and j["salary_currency"] == "INR" and "RAG" in j["required_skills"]


def test_skill_extraction_avoids_false_positives():
    req, pref = split_skills("We go to market fast and react to customer trust issues.", VOCAB)
    assert req == [] and pref == []
    assert experience_years("Salary for 5 years old company") is None
    assert experience_years("5-8 years of professional experience") == 5
    assert seniority("Senior Staff ML Engineer") == "staff" and seniority("Machine Learning Engineer") is None
