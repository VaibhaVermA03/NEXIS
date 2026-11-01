import httpx
import pytest

from app.core.config import get_settings
from app.tools import http_tools, ssrf
from app.tools.http_tools import HttpCall, ToolExecutionError


@pytest.mark.parametrize("url", [
    "http://example.com/x",                      # http disallowed by default
    "ftp://example.com/x", "file:///etc/passwd", "gopher://example.com",
    "https://user:pw@example.com/", "https://example.com@evil.example/", "https:///nohost",
    "https://localhost/", "https://LOCALHOST./", "https://foo.localhost/", "https://metadata.google.internal/",
    "https://db.internal/", "https://printer.local/", "https://127.0.0.1/", "https://127.1/",
    "https://0.0.0.0/", "https://10.0.0.5/", "https://172.16.5.4/", "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "https://[::ffff:127.0.0.1]/",
    "https://[fe80::1]/", "https://[fd00::1]/", "https://224.0.0.1/", "https://100.64.0.1/", "https://240.0.0.1/",
    "https://2130706433/", "https://0x7f000001/", "https://[::ffff:169.254.169.254]/",
    "https://example.com:99999/", "https://exa mple.com/",
])
def test_blocked_urls(url):
    with pytest.raises(ssrf.UrlValidationError):
        ssrf.validate_target(url)


def test_hostname_resolving_to_private_ip_is_blocked(monkeypatch):
    monkeypatch.setattr(ssrf, "resolve_host", lambda h, p: ["93.184.216.34", "10.0.0.7"])  # one bad IP is enough
    with pytest.raises(ssrf.UrlValidationError):
        ssrf.validate_target("https://rebind.example.com/")


def test_public_target_allowed(monkeypatch):
    monkeypatch.setattr(ssrf, "resolve_host", lambda h, p: ["93.184.216.34"])
    t = ssrf.validate_target("https://api.example.com:8443/v1/x?y=1")
    assert (t.host, t.port, t.path_query, t.ips) == ("api.example.com", 8443, "/v1/x?y=1", ["93.184.216.34"])


def test_http_allowed_only_when_enabled(monkeypatch):
    monkeypatch.setattr(ssrf, "resolve_host", lambda h, p: ["93.184.216.34"])
    with pytest.raises(ssrf.UrlValidationError):
        ssrf.validate_target("http://api.example.com/")
    monkeypatch.setattr(get_settings(), "tool_allow_http", True)
    assert ssrf.validate_target("http://api.example.com/").scheme == "http"


def test_outbound_allowlist(monkeypatch):
    monkeypatch.setattr(ssrf, "resolve_host", lambda h, p: ["93.184.216.34"])
    monkeypatch.setattr(get_settings(), "tool_outbound_allowlist", "api.example.com")
    assert ssrf.validate_target("https://api.example.com/").host == "api.example.com"
    assert ssrf.validate_target("https://v2.api.example.com/").host == "v2.api.example.com"
    with pytest.raises(ssrf.UrlValidationError):
        ssrf.validate_target("https://evil.example.org/")
    with pytest.raises(ssrf.UrlValidationError):
        ssrf.validate_target("https://notapi.example.com.evil.org/")


def test_forbidden_headers():
    for h in ("Host", "Authorization", "Cookie", "X-Forwarded-For"):
        with pytest.raises(ssrf.UrlValidationError):
            ssrf.sanitize_headers({h: "x"})
    with pytest.raises(ssrf.UrlValidationError):
        ssrf.sanitize_headers({"X-A": "a\r\nInjected: 1"})
    assert ssrf.sanitize_headers({"X-Trace": "1"}) == {"X-Trace": "1"}


@pytest.fixture
def public(monkeypatch):
    monkeypatch.setattr(ssrf, "resolve_host", lambda h, p: ["93.184.216.34"])


def _call(handler, **kw):
    base = dict(method="GET", url="https://api.example.com/items", args={"q": "a"}, timeout=2)
    base.update(kw)
    return http_tools.execute_http(HttpCall(**base), transport=httpx.MockTransport(handler))


def test_runner_pins_ip_sets_host_and_auth(public):
    seen = {}

    def handler(req: httpx.Request):
        seen.update(url=str(req.url), host=req.headers["host"], auth=req.headers.get("authorization"))
        return httpx.Response(200, json={"ok": True})
    out = _call(handler, auth_mode="bearer", secret="tok123")
    assert seen["url"].startswith("https://93.184.216.34/items") and "q=a" in seen["url"]
    assert seen["host"] == "api.example.com" and seen["auth"] == "Bearer tok123"
    assert out["json"] == {"ok": True} and out["status_code"] == 200


def test_runner_post_sends_json_body(public):
    def handler(req: httpx.Request):
        return httpx.Response(200, json={"echo": req.content.decode()})
    out = _call(handler, method="POST", args={"a": 1})
    assert '"a"' in out["json"]["echo"]


def test_redirects_not_followed(public):
    def handler(req):
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"})
    with pytest.raises(ToolExecutionError) as e:
        _call(handler)
    assert e.value.code == "redirect_blocked"


def test_response_size_limit_and_content_type(public, monkeypatch):
    monkeypatch.setattr(get_settings(), "tool_max_response_bytes", 100)
    out = _call(lambda r: httpx.Response(200, text="x" * 5000, headers={"content-type": "text/plain"}))
    assert out["truncated"] is True and len(out["text"]) <= 100
    with pytest.raises(ToolExecutionError) as e:
        _call(lambda r: httpx.Response(200, content=b"\x00\x01", headers={"content-type": "application/octet-stream"}))
    assert e.value.code == "unsupported_content_type"


def test_malformed_json_and_http_error(public):
    with pytest.raises(ToolExecutionError) as e:
        _call(lambda r: httpx.Response(200, text="{not json", headers={"content-type": "application/json"}))
    assert e.value.code == "malformed_json"
    out = _call(lambda r: httpx.Response(500, json={"err": 1}))
    assert out["status_code"] == 500 and "HTTP 500" in out["error"]


def test_timeout_mapped(public):
    def handler(req):
        raise httpx.ReadTimeout("slow")
    with pytest.raises(ToolExecutionError) as e:
        _call(handler)
    assert e.value.code == "timeout"


def test_runner_blocks_before_any_request():
    def handler(req):
        raise AssertionError("request must never be sent")
    with pytest.raises(ToolExecutionError) as e:
        _call(handler, url="https://169.254.169.254/latest")
    assert e.value.code == "url_blocked"
