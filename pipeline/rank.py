"""Transparent ranking. Every score is a weighted sum you can read below; recency is one factor of five."""
import re
from collections import Counter
from datetime import datetime, timezone

from .normalize import hours_since

WEIGHTS = {"recency": 0.25, "trust": 0.20, "relevance": 0.25, "quality": 0.15, "practical": 0.15}
HALF_LIFE_HOURS = 72


def classify(text, categories, topics_kw, limit=3):
    low = (text or "").lower()
    counts = Counter()
    for topic, words in topics_kw.items():
        for w in words:
            if w in low:
                counts[topic] += low.count(w)
    for c in categories:  # the source's own categories act as a prior
        counts[c] += 2
    return [t for t, n in counts.most_common(limit) if n > 0]


def quality(a):
    q = 0.0
    q += 0.3 if a.get("summary") else 0
    q += 0.25 if len(a.get("takeaways") or []) >= 3 else 0.1 if a.get("takeaways") else 0
    q += 0.2 if a.get("reading_minutes") else 0
    q += 0.15 if a.get("published_at") else 0
    q += 0.1 if a.get("author") else 0
    return round(q, 3)


def score(a, trust, interests, now=None):
    now = now or datetime.now(timezone.utc)
    age = hours_since(a.get("published_at") or a.get("fetched_at"), now) or 0
    recency = 0.5 ** (max(age, 0) / HALF_LIFE_HOURS)
    if not a.get("published_at"):
        recency *= 0.25  # unknown publication date: never treated as brand new
    topics = a.get("topics") or []
    relevance = min(1.0, sum(1.0 if t == topics[0] else 0.5 for t in topics if t in interests)) if topics else 0.0
    practical = 1.0 if a.get("experiments") or a.get("techniques") else 0.4 if a.get("takeaways") else 0.0
    parts = {"recency": recency, "trust": trust / 5, "relevance": relevance, "quality": quality(a), "practical": practical}
    total = sum(WEIGHTS[k] * v for k, v in parts.items())
    if (a.get("reading_minutes") or 0) > 40:
        total *= 0.9
    return round(total, 4), {k: round(v, 3) for k, v in parts.items()}, round(relevance, 3)


def shingles(title):
    words = re.findall(r"[a-z0-9]+", (title or "").lower())
    return {" ".join(words[i:i + 2]) for i in range(max(1, len(words) - 1))}


def near_duplicate(a, b, threshold=0.6):
    sa, sb = shingles(a), shingles(b)
    return bool(sa and sb) and len(sa & sb) / len(sa | sb) >= threshold


def diversify(items, n, per_source=2, per_topic=3):
    out, src, top = [], Counter(), Counter()
    for it in items:
        t = (it.get("topics") or ["other"])[0]
        if src[it["source_id"]] >= per_source or top[t] >= per_topic:
            continue
        if any(near_duplicate(it["title"], o["title"]) for o in out):
            continue
        out.append(it); src[it["source_id"]] += 1; top[t] += 1
        if len(out) >= n:
            break
    if len(out) < n:  # relax caps rather than return a short feed
        for it in items:
            if it not in out and not any(near_duplicate(it["title"], o["title"]) for o in out):
                out.append(it)
            if len(out) >= n:
                break
    return out
