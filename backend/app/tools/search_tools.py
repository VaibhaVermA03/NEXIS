"""Real web search via the Tavily Search API (https://docs.tavily.com).

* The endpoint is FIXED (not user-controlled), so the API key can only ever be sent to api.tavily.com.
* Failures raise ToolExecutionError with a specific code, so the run records a *failed* tool call (never a fake success).
* Results are third-party content: they are flagged `untrusted_content` and wrapped as untrusted by the engine."""
import httpx

from app.core.config import get_settings
from app.core.logging import redact
from app.tools.http_tools import ToolExecutionError

TAVILY_URL = "https://api.tavily.com/search"
MAX_RESULTS = 10
MAX_SNIPPET = 1200


def search_configured() -> bool:
    return bool(get_settings().tavily_api_key)


def _provider_detail(resp: httpx.Response) -> str:
    try:
        detail = resp.json().get("detail")
        text = detail.get("error") if isinstance(detail, dict) else detail
        return redact(str(text))[:200] if text else ""
    except (ValueError, AttributeError):
        return ""


def _error_for(resp: httpx.Response) -> ToolExecutionError:
    s, detail = resp.status_code, _provider_detail(resp)
    if s == 401:
        return ToolExecutionError("search_auth_failed", "Tavily rejected the API key. Check TAVILY_API_KEY on the server.")
    if s == 403:
        return ToolExecutionError("search_forbidden", "Tavily refused this request." + (f" {detail}" if detail else ""))
    if s == 429:
        return ToolExecutionError("search_rate_limited", "Search rate limit reached. Try again in a moment.")
    if s in (432, 433):   # 432 = key/plan limit exceeded, 433 = pay-as-you-go limit exceeded
        return ToolExecutionError("search_quota_exceeded", "Tavily credits or plan limit reached. Check your Tavily plan/usage.")
    if s == 400:
        return ToolExecutionError("search_bad_request", "Tavily rejected the search request." + (f" {detail}" if detail else ""))
    if s >= 500:
        return ToolExecutionError("search_provider_error", "The search provider had a server error. Try again later.")
    return ToolExecutionError("search_error", f"The search provider returned HTTP {s}.")


def web_search(query: str, count: int = 5, transport: httpx.BaseTransport | None = None) -> dict:
    key = get_settings().tavily_api_key
    if not key:
        raise ToolExecutionError("search_not_configured", "web_search is not configured (TAVILY_API_KEY is missing on the server).")
    count = max(1, min(int(count), MAX_RESULTS))
    body = {"query": query.strip(), "max_results": count, "search_depth": "basic",
            "include_answer": False, "include_raw_content": False, "include_images": False}
    kwargs = {"transport": transport} if transport else {}
    try:
        with httpx.Client(timeout=httpx.Timeout(15, connect=5), trust_env=False, follow_redirects=False, **kwargs) as c:
            resp = c.post(TAVILY_URL, json=body, headers={"Authorization": f"Bearer {key}", "Accept": "application/json",
                                                           "User-Agent": "NEXIS-Search/1.0"})
    except httpx.TimeoutException as exc:
        raise ToolExecutionError("search_timeout", "The search provider timed out.") from exc
    except httpx.HTTPError as exc:
        raise ToolExecutionError("search_unreachable", "Could not reach the search provider.") from exc
    if resp.status_code != 200:
        raise _error_for(resp)
    try:
        data = resp.json()
    except ValueError as exc:
        raise ToolExecutionError("search_bad_response", "The search provider returned an unreadable response.") from exc
    raw = data.get("results") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        raise ToolExecutionError("search_bad_response", "The search provider returned an unexpected response.")
    results = []
    for item in raw[:count]:
        if not isinstance(item, dict) or not item.get("url"):
            continue
        score = item.get("score")
        results.append({"title": str(item.get("title") or "")[:300], "url": str(item["url"])[:500],
                        "snippet": str(item.get("content") or "")[:MAX_SNIPPET],
                        **({"score": round(float(score), 3)} if isinstance(score, (int, float)) and not isinstance(score, bool) else {})})
    return {"provider": "tavily", "query": query.strip(), "results": results, "untrusted_content": True}