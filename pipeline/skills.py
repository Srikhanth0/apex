"""Deterministic skill, experience and seniority extraction from job text (shared vocabulary: sources/skills.json)."""
import json
import re

from . import config

PREFERRED_HDR = re.compile(r"(nice[- ]to[- ]have|preferred|bonus|a plus|ideally|good to have|pluses|extra credit)", re.I)
REQUIRED_HDR = re.compile(r"(requirements|qualifications|what you.ll need|what we.re looking for|must[- ]have|you have|about you|minimum|you will bring|who you are)", re.I)
YEARS = re.compile(r"(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*years?", re.I)
SENIORITY = [("intern", r"\bintern(ship)?\b"), ("new grad", r"\bnew grad|graduate\b|\bentry[- ]level\b"), ("junior", r"\bjunior\b|\bjr\.?\b"),
             ("principal", r"\bprincipal\b|\bdistinguished\b"), ("staff", r"\bstaff\b"), ("lead", r"\blead\b|\bhead of\b"),
             ("manager", r"\bmanager\b|\bdirector\b|\bvp\b"), ("senior", r"\bsenior\b|\bsr\.?\b")]


def load_vocab(path=None):
    data = json.load(open(path or config.SOURCES / "skills.json", encoding="utf-8"))
    vocab = []
    for s in data["skills"]:
        pats = [re.compile(r"(?<![a-z0-9+#])" + re.escape(a.strip().lower()) + r"(?![a-z0-9+#])") for a in (s["aliases"] or [s["name"]]) if a.strip()]
        vocab.append((s["name"], pats))
    return vocab


def find(text, vocab):
    low = (text or "").lower()
    return [name for name, pats in vocab if any(p.search(low) for p in pats)]


def split_skills(text, vocab):
    """Skills under a 'nice to have' heading are preferred; everything else found is required."""
    required, preferred, mode = set(), set(), "required"
    for line in re.split(r"\n|(?<=[.:;])\s+(?=[A-Z])", text or ""):
        short = len(line) < 90
        if short and PREFERRED_HDR.search(line):
            mode = "preferred"
        elif short and REQUIRED_HDR.search(line):
            mode = "required"
        for s in find(line, vocab):
            (preferred if mode == "preferred" else required).add(s)
    preferred -= required
    return sorted(required), sorted(preferred)


def experience_years(text):
    """Minimum years asked for, only when 'experience' appears near the number. None when not stated."""
    best = None
    for m in YEARS.finditer(text or ""):
        window = (text[max(0, m.start() - 40): m.end() + 60]).lower()
        if "experience" in window or "exp." in window:
            lo = int(m.group(1))
            if 0 < lo <= 25:
                best = lo if best is None else min(best, lo)
    return best


def seniority(title):
    t = (title or "").lower()
    for label, pat in SENIORITY:
        if re.search(pat, t):
            return label
    return None
