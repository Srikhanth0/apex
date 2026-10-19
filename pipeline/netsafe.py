"""SSRF guard: every URL the pipeline fetches, including each redirect hop, passes through here."""
import ipaddress
import socket
from urllib.parse import urlsplit

BLOCKED_HOSTS = {"localhost", "metadata.google.internal", "metadata", "instance-data"}
ALLOWED_PORTS = {None, 80, 443, 8080, 8443}


class UnsafeURL(ValueError):
    pass


def _ip_ok(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not (addr.is_multicast or addr.is_reserved)


def validate_url(url: str, resolve=socket.getaddrinfo) -> str:
    """Return the URL if it is safe to fetch, else raise UnsafeURL."""
    if not isinstance(url, str) or len(url) > 2048:
        raise UnsafeURL("URL missing or too long")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise UnsafeURL(f"scheme not allowed: {parts.scheme or 'none'}")
    if parts.username or parts.password:
        raise UnsafeURL("credentials in URL are not allowed")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise UnsafeURL("no host")
    if host in BLOCKED_HOSTS or host.endswith(".localhost") or host.endswith(".internal") or host.endswith(".local"):
        raise UnsafeURL("host not allowed")
    try:
        port = parts.port
    except ValueError as exc:
        raise UnsafeURL("bad port") from exc
    if port not in ALLOWED_PORTS:
        raise UnsafeURL(f"port not allowed: {port}")
    try:  # literal IPs, including IPv6 and IPv4-mapped forms
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        if not _ip_ok(str(literal)):
            raise UnsafeURL("private or reserved address")
        return url
    if host.replace(".", "").isdigit() or host.startswith("0x"):
        raise UnsafeURL("numeric host not allowed")
    try:
        infos = resolve(host, port or (443 if parts.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeURL("host does not resolve") from exc
    ips = {info[4][0] for info in infos}
    if not ips or not all(_ip_ok(ip) for ip in ips):
        raise UnsafeURL("host resolves to a private or reserved address")
    return url
