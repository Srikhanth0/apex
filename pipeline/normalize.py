import hashlib
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING = re.compile(r"^(utm_\w+|ref|ref_src|fbclid|gclid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|mkt_tok|source|s|si|r)$", re.I)


def canonical_url(url: str) -> str:
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower() or "https"
    host = (parts.hostname or "").lower()
    port = parts.port
    netloc = host if port in (None, 80, 443) else f"{host}:{port}"
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    query = urlencode(sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not TRACKING.match(k)))
    return urlunsplit((scheme, netloc, path, query, ""))


def article_id(canonical: str) -> str:
    return hashlib.sha1(canonical.encode()).hexdigest()[:12]


def content_hash(title: str, text: str) -> str:
    norm = re.sub(r"\s+", " ", f"{title} {text[:5000]}".lower()).strip()
    return hashlib.sha256(norm.encode()).hexdigest()[:16]


def parse_date(value):
    """Return an ISO-8601 UTC string, or None when the value is missing or unparseable."""
    if value in (None, "", 0):
        return None
    try:
        if isinstance(value, (int, float)):
            ts = value / 1000 if value > 1e11 else value
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        elif hasattr(value, "tm_year"):
            dt = datetime(*value[:6], tzinfo=timezone.utc)
        else:
            s = str(value).strip()
            try:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            except ValueError:
                dt = parsedate_to_datetime(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError, IndexError):
        return None
    if dt.year < 1995 or dt > datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year + 1):
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def hours_since(iso, now=None):
    if not iso:
        return None
    now = now or datetime.now(timezone.utc)
    return (now - datetime.fromisoformat(iso.replace("Z", "+00:00"))).total_seconds() / 3600


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def excerpt(s: str, n: int) -> str:
    s = clean_text(s)
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(" ", 1)[0]
    return cut.rstrip(",;:") + "…"


def reading_minutes(text: str):
    words = len((text or "").split())
    return max(1, round(words / 230)) if words >= 120 else None


STOP_EN = {"the", "and", "of", "to", "in", "is", "that", "for", "with", "it", "on", "as", "this", "are", "be"}


def guess_language(text: str, declared=None):
    if declared:
        return declared.split("-")[0].lower()[:5]
    words = re.findall(r"[a-zA-Z']+", (text or "").lower())[:400]
    if len(words) < 20:
        return "unknown"
    return "en" if sum(w in STOP_EN for w in words) / len(words) > 0.08 else "unknown"


EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u20E3]+")


def clean_title(s: str) -> str:
    """Titles are shown as text: drop decorative emoji and collapse whitespace."""
    return clean_text(EMOJI.sub(" ", s or ""))
