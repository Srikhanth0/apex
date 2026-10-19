import time

from pipeline.normalize import canonical_url, clean_title, content_hash, excerpt, parse_date, reading_minutes


def test_canonical_strips_tracking_fragment_and_slash():
    a = canonical_url("HTTPS://Example.com:443/Post/?utm_source=x&b=2&a=1&fbclid=z#section")
    assert a == "https://example.com/Post?a=1&b=2"
    assert canonical_url("https://example.com/") == "https://example.com/"


def test_parse_date_formats():
    assert parse_date("Mon, 06 Oct 2025 19:00:00 GMT") == "2025-10-06T19:00:00Z"
    assert parse_date("2025-10-06T19:00:00+02:00") == "2025-10-06T17:00:00Z"
    assert parse_date(1759777200000) == "2025-10-06T19:00:00Z"
    assert parse_date(time.strptime("2025-10-06", "%Y-%m-%d")) == "2025-10-06T00:00:00Z"
    assert parse_date("next tuesday") is None and parse_date(None) is None and parse_date("") is None
    assert parse_date("2999-01-01T00:00:00Z") is None and parse_date("1970-01-01T00:00:00Z") is None


def test_hash_ignores_whitespace_and_case():
    assert content_hash("Title", "Some  text\n") == content_hash("title", "some text")


def test_excerpt_and_reading_time():
    assert excerpt("word " * 200, 50).endswith("…") and len(excerpt("word " * 200, 50)) <= 51
    assert reading_minutes("short text") is None
    assert reading_minutes("w " * 2300) == 10


def test_clean_title_drops_emoji():
    assert clean_title("\U0001F399\uFE0F How I AI:  Muse") == "How I AI: Muse"
