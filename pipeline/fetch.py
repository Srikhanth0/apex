"""Polite, safe HTTP fetching built on Scrapling's static Fetcher.

- Every hop (including redirects) is checked by netsafe.validate_url.
- robots.txt is honoured per host.
- One request at a time per host, with a minimum delay between them.
- Retries with exponential backoff and jitter on network errors, 429 and 5xx.
- Responses larger than MAX_BYTES are rejected.
"""
import logging
import random
import threading
import time
import urllib.robotparser
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

from . import config
from .netsafe import UnsafeURL, validate_url

log = logging.getLogger("apex.fetch")


class FetchError(Exception):
    def __init__(self, message, status=None, retryable=False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass
class Result:
    status: int
    url: str
    headers: dict
    body: bytes
    elapsed_ms: int = 0
    redirects: list = field(default_factory=list)

    @property
    def text(self):
        return self.body.decode("utf-8", errors="replace")


def scrapling_transport(url, headers, timeout):
    """Default transport: Scrapling's Fetcher with honest headers and manual redirects."""
    from scrapling.fetchers import Fetcher
    r = Fetcher.get(url, timeout=timeout, headers=headers, stealthy_headers=False, follow_redirects=False, retries=1)
    return r.status, {str(k).lower(): str(v) for k, v in dict(r.headers).items()}, bytes(r.body or b"")


class Fetch:
    def __init__(self, transport=scrapling_transport, sleep=time.sleep, validate=validate_url, robots=True):
        self.transport, self.sleep, self.validate, self.check_robots = transport, sleep, validate, robots
        self._host_locks, self._last, self._robots = {}, {}, {}
        self._guard = threading.Lock()

    def _lock(self, host):
        with self._guard:
            return self._host_locks.setdefault(host, threading.Lock())

    def _throttle(self, host):
        wait = config.PER_HOST_DELAY - (time.monotonic() - self._last.get(host, 0))
        if wait > 0:
            self.sleep(wait)
        self._last[host] = time.monotonic()

    def allowed(self, url):
        if not self.check_robots:
            return True
        parts = urlsplit(url)
        base = f"{parts.scheme}://{parts.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                res = self._get_once(base + "/robots.txt", {"user-agent": config.USER_AGENT})
                if res.status == 200:
                    rp.parse(res.text.splitlines())
                else:
                    rp.parse([])  # 4xx/5xx: no rules published
            except Exception:  # unreachable robots.txt: treat as no rules
                rp.parse([])
            self._robots[base] = rp
        return self._robots[base].can_fetch(config.USER_AGENT, url)

    def _get_once(self, url, headers, max_bytes=None):
        host = urlsplit(url).netloc
        with self._lock(host):
            self._throttle(host)
            status, resp_headers, body = self.transport(url, headers, config.TIMEOUT)
        cap = max_bytes or config.MAX_BYTES
        if len(body) > cap:
            raise FetchError(f"response larger than {cap} bytes", status)
        return Result(status, url, resp_headers, body)

    def get(self, url, etag=None, last_modified=None, accept=None, max_bytes=None):
        headers = {"user-agent": config.USER_AGENT, "accept": accept or "*/*"}
        if etag:
            headers["if-none-match"] = etag
        if last_modified:
            headers["if-modified-since"] = last_modified
        start, hops, current = time.monotonic(), [], url
        for _ in range(config.MAX_REDIRECTS + 1):
            try:
                self.validate(current)
            except UnsafeURL as exc:
                raise FetchError(f"blocked URL: {exc}") from exc
            if not self.allowed(current):
                raise FetchError("disallowed by robots.txt")
            res = self._with_retries(current, headers, max_bytes)
            if res.status in (301, 302, 303, 307, 308) and res.headers.get("location"):
                hops.append(current)
                current = urljoin(current, res.headers["location"])
                continue
            res.redirects, res.elapsed_ms = hops, int((time.monotonic() - start) * 1000)
            if res.status == 304:
                return res
            if res.status >= 400:
                raise FetchError(f"HTTP {res.status}", res.status, retryable=res.status in (429, 500, 502, 503, 504))
            return res
        raise FetchError("too many redirects")

    def _with_retries(self, url, headers, max_bytes=None):
        delay = 1.0
        for attempt in range(1, config.RETRIES + 1):
            try:
                res = self._get_once(url, headers, max_bytes)
            except FetchError:
                raise
            except Exception as exc:  # network error, timeout, TLS
                if attempt == config.RETRIES:
                    raise FetchError(f"network error: {type(exc).__name__}", retryable=True) from exc
                self.sleep(delay + random.random() * 0.5)
                delay *= 2
                continue
            if res.status in (429, 500, 502, 503, 504) and attempt < config.RETRIES:
                retry_after = res.headers.get("retry-after", "")
                wait = min(60.0, float(retry_after)) if retry_after.isdigit() else delay + random.random() * 0.5
                log.info("retry %s after %.1fs (HTTP %s)", url, wait, res.status)
                self.sleep(wait)
                delay *= 2
                continue
            return res
        return res
