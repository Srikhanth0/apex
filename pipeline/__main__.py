"""python -m pipeline [articles|jobs|all] [--source ID] [--force] [--max-enrich N] [--trigger schedule|manual]"""
import argparse
import json
import logging
import sys
import time
import uuid

from . import articles, config, jobs, publish
from .enrich import provider_from_env
from .fetch import Fetch
from .skills import load_vocab
from .store import load, load_json, save


class JsonLog(logging.Formatter):
    def format(self, r):
        extra = {k: v for k, v in r.__dict__.items() if k in ("source", "error")}
        return json.dumps({"t": self.formatTime(r, "%H:%M:%S"), "level": r.levelname, "logger": r.name, "msg": r.getMessage(), **extra})


def main(argv=None):
    ap = argparse.ArgumentParser(prog="pipeline")
    ap.add_argument("kind", choices=["articles", "jobs", "all"], nargs="?", default="all")
    ap.add_argument("--source")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--max-enrich", type=int, default=25)
    ap.add_argument("--trigger", default="manual")
    a = ap.parse_args(argv)
    h = logging.StreamHandler(sys.stdout); h.setFormatter(JsonLog())
    logging.basicConfig(level=logging.INFO, handlers=[h])
    logging.getLogger("scrapling").setLevel(logging.WARNING)
    fetch, runs, failures = Fetch(), load("runs", []), 0
    topics = load_json(config.SOURCES / "topics.json")
    if a.kind in ("articles", "all"):
        reg = load_json(config.SOURCES / "articles.json")["sources"]
        store, state, cache = load("articles", {}), load("article_state", {}), load("enrich_cache", {})
        if not a.source or any(s["id"] == a.source for s in reg):
            rep = articles.run(reg, topics["topics"], store, state, cache, fetch, provider_from_env(), topics.get("interests_default", []),
                               only=a.source, force=a.force, max_enrich=a.max_enrich)
            rep.update(id=uuid.uuid4().hex[:10], trigger=a.trigger)
            runs.append(rep)
            save("articles", store); save("article_state", state); save("enrich_cache", cache)
            publish.publish_articles(store, reg, state, topics["topics"])
            failures += rep["totals"]["failed_sources"]
            logging.info("articles done %s", json.dumps(rep["totals"]))
    if a.kind in ("jobs", "all"):
        reg = load_json(config.SOURCES / "jobs.json")
        store, state = load("jobs", {}), load("job_state", {})
        if not a.source or any(s["id"] == a.source for s in reg["sources"]):
            rep = jobs.run(reg, store, state, fetch, load_vocab(), only=a.source, force=a.force)
            rep.update(id=uuid.uuid4().hex[:10], trigger=a.trigger)
            runs.append(rep)
            save("jobs", store); save("job_state", state)
            publish.publish_jobs(store, reg, state)
            failures += rep["totals"]["failed_sources"]
            logging.info("jobs done %s", json.dumps(rep["totals"]))
    save("runs", runs[-200:])
    publish.publish_runs(runs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
