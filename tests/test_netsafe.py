import socket

import pytest

from pipeline.netsafe import UnsafeURL, validate_url
from tests.conftest import public_resolver


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.com/x", "gopher://example.com", "javascript:alert(1)",
    "http://localhost/", "http://app.localhost/", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://172.16.0.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
    "http://2130706433/", "http://0x7f000001/", "http://user:pw@example.com/", "http://metadata.google.internal/",
    "http://example.com:22/", "http://printer.local/", "", "http:///nohost",
])
def test_rejects_unsafe(url):
    with pytest.raises(UnsafeURL):
        validate_url(url, resolve=public_resolver)


def test_rejects_hostname_resolving_to_private():
    private = lambda h, p, proto=None: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", p))]
    with pytest.raises(UnsafeURL):
        validate_url("https://evil.example.com/", resolve=private)


def test_rejects_when_any_resolved_address_is_private():
    mixed = lambda h, p, proto=None: [(socket.AF_INET, 1, 6, "", ("93.184.216.34", p)), (socket.AF_INET, 1, 6, "", ("127.0.0.1", p))]
    with pytest.raises(UnsafeURL):
        validate_url("https://rebind.example.com/", resolve=mixed)


def test_allows_public():
    assert validate_url("https://example.com/feed.xml", resolve=public_resolver)
