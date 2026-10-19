import socket

import pytest

from pipeline import config
from pipeline.fetch import Fetch, FetchError, Result


@pytest.fixture(autouse=True)
def tmp_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STORE", tmp_path / "store")
    monkeypatch.setattr(config, "API", tmp_path / "api" / "v1")
    monkeypatch.setattr(config, "PER_HOST_DELAY", 0)
    return tmp_path


def public_resolver(host, port, proto=None):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]


class FakeFetch:
    """Maps URL -> bytes | (status, body, headers) | Exception. Records calls."""
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, **kw):
        self.calls.append(url)
        r = self.routes.get(url)
        if r is None:
            raise FetchError("HTTP 404", 404)
        if isinstance(r, Exception):
            raise r
        if isinstance(r, tuple):
            status, body, headers = r
            return Result(status, url, headers, body)
        return Result(200, url, {}, r if isinstance(r, bytes) else r.encode())


def make_fetch(transport, robots=False, sleep=lambda s: None):
    from pipeline.netsafe import validate_url
    return Fetch(transport=transport, sleep=sleep, validate=lambda u: validate_url(u, resolve=public_resolver), robots=robots)
