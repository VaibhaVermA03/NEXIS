"""web_search via Tavily: exact request format, result mapping, error handling, key safety. No network is used."""
import json
import re
from pathlib import Path

import httpx
import pytest

from app.core.config import get_settings
from app.core.logging import redact
from app.tools import search_tools
from app.tools.http_tools import ToolExecutionError

KEY = "tvly-test-key-0123456789abcdef"


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr(get_settings(), "tavily_api_key", KEY)


def call(handler, query="latest ai news", **kw):
    return search_tools.web_search(query, transport=httpx.MockTransport(handler), **kw)


def respond(results, status=200):
    return lambda req: httpx.Response(status, json={"query": "q", "results": results, "response_time": 0.4})


def test_request_matches_the_tavily_api():
    seen = []

    def handler(req: httpx.Request):
        seen.append(req)
        return httpx.Response(200, json={"results": []})
    call(handler, count=3)
    req = seen[0]
    assert req.method == "POST" and str(req.url) == "https://api.tavily.com/search"
    assert req.headers["authorization"] == f"Bearer {KEY}" and req.headers["content-type"] == "application/json"
    body = json.loads(req.content)
    assert body == {"query": "latest ai news", "max_results": 3, "search_depth": "basic",
                    "include_answer": False, "include_raw_content": False, "include_images": False}
    assert "api_key" not in body and KEY not in req.content.decode()          # key only travels in the Authorization header


def test_results_are_mapped_cleaned_and_flagged_untrusted():
    out = call(respond([
        {"title": "A", "url": "https://a.example/x", "content": "alpha " * 400, "score": 0.91234, "raw_content": "ignored"},
        {"title": "no url -> dropped", "content": "x"},
        "garbage",
        {"title": None, "url": "https://b.example", "content": None, "score": True},
    ]))
    assert out["provider"] == "tavily" and out["untrusted_content"] is True
    assert [r["url"] for r in out["results"]] == ["https://a.example/x", "https://b.example"]
    first, second = out["results"]
    assert first["score"] == 0.912 and len(first["snippet"]) == search_tools.MAX_SNIPPET and "raw_content" not in first
    assert second["title"] == "" and second["snippet"] == "" and "score" not in second   # bool is not a score


@pytest.mark.parametrize("asked,sent", [(0, 1), (-5, 1), (3, 3), (10, 10), (99, 10)])
def test_result_count_is_clamped(asked, sent):
    seen = []

    def handler(req):
        seen.append(json.loads(req.content)["max_results"])
        return httpx.Response(200, json={"results": []})
    call(handler, count=asked)
    assert seen == [sent]


def test_not_configured_makes_no_request(monkeypatch):
    monkeypatch.setattr(get_settings(), "tavily_api_key", None)
    assert search_tools.search_configured() is False

    def handler(req):
        raise AssertionError("no request may be sent without a key")
    with pytest.raises(ToolExecutionError) as e:
        call(handler)
    assert e.value.code == "search_not_configured" and "TAVILY_API_KEY" in e.value.message
    monkeypatch.setattr(get_settings(), "tavily_api_key", "")      # blank value in .env counts as not configured
    assert search_tools.search_configured() is False


@pytest.mark.parametrize("status,code", [(400, "search_bad_request"), (401, "search_auth_failed"), (403, "search_forbidden"),
                                          (429, "search_rate_limited"), (432, "search_quota_exceeded"), (433, "search_quota_exceeded"),
                                          (500, "search_provider_error"), (503, "search_provider_error"), (418, "search_error")])
def test_http_errors_map_to_specific_codes(status, code):
    with pytest.raises(ToolExecutionError) as e:
        call(lambda r: httpx.Response(status, json={"detail": {"error": "provider says no"}}))
    assert e.value.code == code and KEY not in e.value.message


def test_credit_limit_message_is_actionable():
    with pytest.raises(ToolExecutionError) as e:
        call(lambda r: httpx.Response(432, json={"detail": {"error": "This request exceeds your plan's set usage limit."}}))
    assert "credits" in e.value.message.lower() and "plan" in e.value.message.lower()


def test_provider_detail_is_truncated_and_secrets_in_it_are_redacted():
    leaky = "bad request for tvly-abcdefghijklmnop1234 " + "x" * 500
    with pytest.raises(ToolExecutionError) as e:
        call(lambda r: httpx.Response(400, json={"detail": {"error": leaky}}))
    assert "tvly-abcdefghijklmnop1234" not in e.value.message and len(e.value.message) < 300


def test_network_failures_are_clean_errors():
    def timeout(req):
        raise httpx.ReadTimeout("slow")

    def down(req):
        raise httpx.ConnectError("refused")
    with pytest.raises(ToolExecutionError) as e1:
        call(timeout)
    with pytest.raises(ToolExecutionError) as e2:
        call(down)
    assert (e1.value.code, e2.value.code) == ("search_timeout", "search_unreachable")


@pytest.mark.parametrize("payload", ["<html>nope</html>", {"unexpected": True}, {"results": "not a list"}, [1, 2]])
def test_malformed_responses_are_rejected(payload):
    def handler(req):
        return httpx.Response(200, content=payload.encode()) if isinstance(payload, str) else httpx.Response(200, json=payload)
    with pytest.raises(ToolExecutionError) as e:
        call(handler)
    assert e.value.code == "search_bad_response"


def test_redirects_are_never_followed():
    with pytest.raises(ToolExecutionError) as e:
        call(lambda r: httpx.Response(302, headers={"location": "https://evil.example/steal"}))
    assert e.value.code == "search_error"


def test_tavily_keys_are_redacted_from_logs():
    assert "tvly-abcdefghijklmnop1234" not in redact("calling with tvly-abcdefghijklmnop1234 now")


def test_brave_is_fully_gone():
    root = Path(__file__).resolve().parents[1]
    hits = [f"{f.relative_to(root)}:{n}" for f in root.rglob("*.py") if "tests" not in f.parts
            for n, line in enumerate(f.read_text().splitlines(), 1) if re.search(r"brave", line, re.I)]
    assert hits == [] and not hasattr(get_settings(), "brave_search_api_key")