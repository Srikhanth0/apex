import pytest

from pipeline import config
from pipeline.fetch import FetchError
from tests.conftest import make_fetch


def test_redirect_to_metadata_endpoint_is_blocked():
    def t(url, headers, timeout):
        return 302, {"location": "http://169.254.169.254/latest/meta-data"}, b""
    with pytest.raises(FetchError, match="blocked"):
        make_fetch(t).get("https://example.com/feed")


def test_follows_safe_redirect():
    def t(url, headers, timeout):
        if url.endswith("/old"):
            return 301, {"location": "/new"}, b""
        return 200, {}, b"ok"
    r = make_fetch(t).get("https://example.com/old")
    assert r.status == 200 and r.url == "https://example.com/new" and r.redirects == ["https://example.com/old"]


def test_retries_5xx_then_succeeds_with_backoff():
    calls, sleeps = [], []
    def t(url, headers, timeout):
        calls.append(url)
        return (503, {}, b"") if len(calls) < 3 else (200, {}, b"fine")
    r = make_fetch(t, sleep=sleeps.append).get("https://example.com/x")
    assert r.body == b"fine" and len(calls) == 3 and len(sleeps) == 2 and sleeps[1] > sleeps[0] * 1.2


def test_honours_retry_after():
    sleeps, n = [], []
    def t(url, headers, timeout):
        n.append(1)
        return (429, {"retry-after": "5"}, b"") if len(n) == 1 else (200, {}, b"ok")
    make_fetch(t, sleep=sleeps.append).get("https://example.com/x")
    assert 5.0 in sleeps


def test_gives_up_after_retries_on_network_errors():
    def t(url, headers, timeout):
        raise TimeoutError()
    with pytest.raises(FetchError, match="network error") as e:
        make_fetch(t).get("https://example.com/x")
    assert e.value.retryable


def test_rejects_oversized_response(monkeypatch):
    monkeypatch.setattr(config, "MAX_BYTES", 10)
    with pytest.raises(FetchError, match="larger"):
        make_fetch(lambda u, h, t: (200, {}, b"x" * 11)).get("https://example.com/big")


def test_robots_disallow_is_respected():
    def t(url, headers, timeout):
        if url.endswith("/robots.txt"):
            return 200, {}, b"User-agent: *\nDisallow: /private"
        return 200, {}, b"page"
    f = make_fetch(t, robots=True)
    assert f.get("https://example.com/public").body == b"page"
    with pytest.raises(FetchError, match="robots"):
        f.get("https://example.com/private/x")


def test_conditional_get_returns_304():
    seen = {}
    def t(url, headers, timeout):
        seen.update(headers)
        return 304, {}, b""
    r = make_fetch(t).get("https://example.com/feed", etag='"abc"')
    assert r.status == 304 and seen["if-none-match"] == '"abc"' and "ApexBot" in seen["user-agent"]
