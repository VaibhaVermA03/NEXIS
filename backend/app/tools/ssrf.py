"""SSRF defenses for outbound HTTP made on behalf of custom/generic REST tools.

Layers: scheme allowlist, no embedded credentials, optional host allowlist, DNS resolution with validation of
EVERY resolved address (global unicast only), connection pinned to the validated IP (anti DNS-rebinding),
redirects disabled, timeouts, response-size cap. See SECURITY.md for residual limitations.
"""
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.core.config import get_settings

BLOCKED_HOSTNAMES = {"localhost", "localhost.localdomain", "ip6-localhost", "metadata", "metadata.google.internal",
                     "instance-data", "kubernetes.default", "kubernetes.default.svc"}
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".svc",
                    ".cluster.local")
FORBIDDEN_HEADERS = {"host", "content-length", "transfer-encoding", "connection", "cookie", "set-cookie",
                     "proxy-authorization", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded",
                     "upgrade", "te", "trailer", "authorization"}


class UrlValidationError(ValueError):
    pass


@dataclass
class ValidatedTarget:
    url: str
    scheme: str
    host: str
    port: int
    path_query: str
    ips: list[str]


def _check_ip(raw: str) -> None:
    ip = ipaddress.ip_address(raw.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        elif ip.sixtofour:
            ip = ip.sixtofour
        elif ip.teredo:
            ip = ip.teredo[1]
    if not ip.is_global or ip.is_multicast or ip.is_loopback or ip.is_link_local or ip.is_private \
            or ip.is_reserved or ip.is_unspecified:
        raise UrlValidationError("Destination resolves to a non-public network address, which is not allowed")


def validate_url_static(url: str) -> tuple[str, str, int, str]:
    """No network access. Returns (scheme, host, port, path_query)."""
    s = get_settings()
    if not url or len(url) > 2048 or any(c in url for c in "\r\n\t "):
        raise UrlValidationError("Invalid URL")
    parts = urlsplit(url)
    allowed = {"https", "http"} if s.tool_allow_http else {"https"}
    if parts.scheme not in allowed:
        raise UrlValidationError("Only https URLs are allowed" if not s.tool_allow_http
                                 else "Only http/https URLs are allowed")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise UrlValidationError("URLs with embedded credentials are not allowed")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise UrlValidationError("URL has no host")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise UrlValidationError("Invalid hostname") from exc
    if host in BLOCKED_HOSTNAMES or host.endswith(BLOCKED_SUFFIXES):
        raise UrlValidationError("Destination host is not allowed")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:
        raise UrlValidationError("Invalid port") from exc
    allow = s.outbound_allowlist
    if allow and not any(host == a or host.endswith("." + a) for a in allow):
        raise UrlValidationError("Host is not in the outbound allowlist")
    try:  # literal IPs are validated immediately
        _check_ip(host)
    except ValueError as exc:
        if isinstance(exc, UrlValidationError):
            raise
    path_query = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    return parts.scheme, host, port, path_query


def resolve_host(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UrlValidationError("Hostname could not be resolved") from exc
    ips = sorted({i[4][0] for i in infos})
    if not ips:
        raise UrlValidationError("Hostname could not be resolved")
    return ips


def validate_target(url: str) -> ValidatedTarget:
    scheme, host, port, path_query = validate_url_static(url)
    ips = resolve_host(host, port)
    for ip in ips:  # ALL addresses must be public, not just the first
        _check_ip(ip)
    return ValidatedTarget(url=url, scheme=scheme, host=host, port=port, path_query=path_query, ips=ips)


def sanitize_headers(headers: dict[str, str]) -> dict[str, str]:
    out = {}
    for k, v in headers.items():
        if k.lower() in FORBIDDEN_HEADERS:
            raise UrlValidationError(f"Header '{k}' is not allowed")
        if any(c in k + str(v) for c in "\r\n"):
            raise UrlValidationError("Invalid header value")
        out[k] = str(v)
    return out
