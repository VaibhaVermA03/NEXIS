import httpx
import pytest

from app.core.config import get_settings
from app.models import ApiKey, EncryptedToolSecret
from app.tools import ssrf

AGENT = {"name": "Support Bot", "description": "d", "system_instructions": "Be nice", "model": "gpt-4o-mini",
         "temperature": 0.3, "max_steps": 4, "enabled": True, "tool_keys": ["builtin:generate_report"]}
TOOL = {"name": "get_weather", "description": "Weather lookup", "method": "GET",
        "url": "https://api.weather.example.com/v1/current", "auth_mode": "bearer", "secret_value": "SUPER-SECRET-TOKEN",
        "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"],
                         "additionalProperties": False}}


# ---------- agents ----------
def test_agent_crud_and_validation(auth_client):
    r = auth_client.post("/api/v1/agents", json=AGENT)
    assert r.status_code == 201
    a = r.json()
    assert a["tool_keys"] == ["builtin:generate_report"] and a["execution_count"] == 0 and "is_demo" not in a
    assert auth_client.post("/api/v1/agents", json=AGENT).status_code == 409
    for bad in ({**AGENT, "name": " "}, {**AGENT, "name": "x2", "temperature": 5}, {**AGENT, "name": "x3", "max_steps": 99},
                {**AGENT, "name": "x4", "tool_keys": ["builtin:rm_rf"]}, {**AGENT, "name": "x4b", "tool_keys": ["builtin:order_lookup"]}, {**AGENT, "name": "x5", "tool_keys": ["custom:nope"]}):
        assert auth_client.post("/api/v1/agents", json=bad).status_code == 422
    r = auth_client.patch(f"/api/v1/agents/{a['id']}", json={"name": "Renamed", "enabled": False,
                                                             "tool_keys": ["builtin:http_request", "builtin:generate_report"]})
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert r.json()["tool_keys"] == ["builtin:generate_report", "builtin:http_request"]
    dup = auth_client.post(f"/api/v1/agents/{a['id']}/duplicate")
    assert dup.status_code == 201 and dup.json()["name"] == "Renamed (copy)"
    lst = auth_client.get("/api/v1/agents?page_size=1").json()
    assert lst["total"] == 2 and len(lst["items"]) == 1
    assert auth_client.get("/api/v1/agents?page_size=500").status_code == 422
    assert auth_client.get("/api/v1/agents?enabled=false").json()["total"] == 2  # duplicate keeps enabled flag
    assert auth_client.delete(f"/api/v1/agents/{a['id']}").status_code == 204
    assert auth_client.get(f"/api/v1/agents/{a['id']}").status_code == 404


def test_new_account_starts_empty_with_no_demo_content(client):
    from app.tests.conftest import signup
    signup(client)
    assert client.get("/api/v1/agents").json() == {"items": [], "total": 0, "page": 1, "page_size": 20}
    assert client.get("/api/v1/workflows").json()["total"] == 0 and client.get("/api/v1/executions").json()["total"] == 0
    d = client.get("/api/v1/dashboard/summary").json()
    assert d["total_agents"] == 0 and d["executions_in_period"] == 0 and d["recent_executions"] == []


def test_cross_user_isolation(auth_client, second_client):
    agent = auth_client.post("/api/v1/agents", json=AGENT).json()
    tool = auth_client.post("/api/v1/tools", json=TOOL).json()
    key = auth_client.post("/api/v1/api-keys", json={"name": "k"}).json()
    wf = auth_client.post("/api/v1/workflows", json={"name": "W", "steps": [{"agent_id": agent["id"],
                                                                            "instruction": "go"}]}).json()
    b = second_client
    for url in (f"/api/v1/agents/{agent['id']}", f"/api/v1/tools/{tool['id']}", f"/api/v1/workflows/{wf['id']}"):
        assert b.get(url).status_code == 404, url
        assert b.delete(url).status_code == 404, url
    assert b.patch(f"/api/v1/agents/{agent['id']}", json={"name": "hijack"}).status_code == 404
    assert b.patch(f"/api/v1/tools/{tool['id']}", json={"enabled": False}).status_code == 404
    assert b.post(f"/api/v1/tools/{tool['id']}/test", json={"arguments": {}}).status_code == 404
    assert b.post(f"/api/v1/agents/{agent['id']}/duplicate").status_code == 404
    assert b.post(f"/api/v1/api-keys/{key['id']}/rotate").status_code == 404
    assert b.delete(f"/api/v1/api-keys/{key['id']}").status_code == 404
    assert b.get("/api/v1/agents").json()["total"] == 0 and b.get("/api/v1/api-keys").json() == []
    assert all(t["kind"] == "builtin" for t in b.get("/api/v1/tools").json())
    # cannot attach another user's tool / agent
    assert b.post("/api/v1/agents", json={**AGENT, "tool_keys": [f"custom:{tool['id']}"]}).status_code == 422
    assert b.post("/api/v1/workflows", json={"name": "X", "steps": [{"agent_id": agent["id"],
                                                                    "instruction": "go"}]}).status_code == 422
    # still intact for the owner
    assert auth_client.get(f"/api/v1/agents/{agent['id']}").status_code == 200


def test_client_cannot_set_owner(auth_client, second_client):
    r = auth_client.post("/api/v1/agents", json={**AGENT, "owner_id": "someone-else"})
    assert r.status_code == 201
    assert second_client.get(f"/api/v1/agents/{r.json()['id']}").status_code == 404


# ---------- tools ----------
def test_tool_list_has_only_real_builtin_tools(auth_client):
    tools = {t["name"]: t for t in auth_client.get("/api/v1/tools").json()}
    assert set(tools) == {"generate_report", "http_request", "web_search"}            # no demo / mock / preview tools exist
    assert all("mock" not in t for t in tools.values()) and all(t["kind"] == "builtin" for t in tools.values())
    assert tools["web_search"]["available"] is False and "TAVILY_API_KEY" in tools["web_search"]["unavailable_reason"]
    assert tools["generate_report"]["available"] is True and tools["http_request"]["side_effect"] == "external"
    for gone in ("order_lookup", "shipping_status", "send_email"):
        assert gone not in tools


def test_tool_crud_masks_and_encrypts_secret(auth_client, db):
    r = auth_client.post("/api/v1/tools", json=TOOL)
    assert r.status_code == 201
    t = r.json()
    assert t["has_secret"] is True and "SUPER-SECRET" not in r.text and "secret_value" not in t
    stored = db.query(EncryptedToolSecret).one()
    assert "SUPER-SECRET" not in stored.ciphertext and stored.ciphertext.startswith("gAAAA")
    assert "SUPER-SECRET" not in auth_client.get(f"/api/v1/tools/{t['id']}").text
    assert "SUPER-SECRET" not in auth_client.get("/api/v1/tools").text
    r = auth_client.patch(f"/api/v1/tools/{t['id']}", json={"enabled": False, "description": "Updated desc"})
    assert r.json()["enabled"] is False and r.json()["has_secret"] is True  # secret untouched
    old_cipher = db.query(EncryptedToolSecret).one().ciphertext
    r = auth_client.patch(f"/api/v1/tools/{t['id']}", json={"secret_value": "NEW-SECRET"})
    assert r.status_code == 200
    db.expire_all()
    assert db.query(EncryptedToolSecret).one().ciphertext != old_cipher
    r = auth_client.patch(f"/api/v1/tools/{t['id']}", json={"clear_secret": True})
    assert r.status_code == 422  # bearer auth requires a secret
    assert auth_client.delete(f"/api/v1/tools/{t['id']}").status_code == 204
    assert db.query(EncryptedToolSecret).count() == 0


@pytest.mark.parametrize("patch,code", [
    ({"url": "https://169.254.169.254/latest"}, 422), ({"url": "https://localhost/x"}, 422),
    ({"url": "http://api.example.com/x"}, 422), ({"url": "https://u:p@api.example.com/"}, 422),
    ({"headers": {"Host": "evil"}}, 422), ({"headers": {"Authorization": "x"}}, 422),
    ({"name": "Bad Name"}, 422), ({"input_schema": {"type": "string"}}, 422),
    ({"input_schema": {"type": "object", "properties": {"a": {"type": "nonsense"}}}}, 422),
    ({"auth_mode": "bearer", "secret_value": None}, 422), ({"auth_mode": "header", "secret_value": "s"}, 422),
    ({"name": "generate_report"}, 409),
])
def test_tool_validation_rejects(auth_client, patch, code):
    body = {**TOOL, **patch}
    if body.get("secret_value") is None:
        body.pop("secret_value", None)
    assert auth_client.post("/api/v1/tools", json=body).status_code == code


def test_tool_secret_requires_encryption_key(auth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "tool_secret_encryption_key", None)
    r = auth_client.post("/api/v1/tools", json=TOOL)
    assert r.status_code == 503 and r.json()["error"]["code"] == "encryption_not_configured"


def test_tool_test_endpoint(auth_client, monkeypatch):
    monkeypatch.setattr(ssrf, "resolve_host", lambda h, p: ["93.184.216.34"])
    seen = {}

    def handler(req: httpx.Request):
        seen["auth"] = req.headers.get("authorization")
        return httpx.Response(200, json={"temp": 21})
    real = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kw: real(**{**kw, "transport": httpx.MockTransport(handler)}))
    t = auth_client.post("/api/v1/tools", json=TOOL).json()
    r = auth_client.post(f"/api/v1/tools/{t['id']}/test", json={"arguments": {"city": "Pune"}})
    assert r.status_code == 200 and r.json()["ok"] and r.json()["result"]["json"] == {"temp": 21}
    assert seen["auth"] == "Bearer SUPER-SECRET-TOKEN" and "SUPER-SECRET" not in r.text
    bad = auth_client.post(f"/api/v1/tools/{t['id']}/test", json={"arguments": {"city": 5}}).json()
    assert bad["ok"] is False and bad["error"]["code"] == "invalid_arguments"
    post_tool = auth_client.post("/api/v1/tools", json={**TOOL, "name": "make_thing", "method": "POST"}).json()
    r = auth_client.post(f"/api/v1/tools/{post_tool['id']}/test", json={"arguments": {"city": "x"}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "confirmation_required"


def test_tool_test_blocks_ssrf_at_runtime(auth_client, monkeypatch):
    monkeypatch.setattr(ssrf, "resolve_host", lambda h, p: ["10.1.2.3"])  # DNS says private
    t = auth_client.post("/api/v1/tools", json=TOOL).json()
    r = auth_client.post(f"/api/v1/tools/{t['id']}/test", json={"arguments": {"city": "x"}}).json()
    assert r["ok"] is False and r["error"]["code"] == "url_blocked"


# ---------- api keys ----------
def test_api_key_lifecycle(auth_client, db):
    r = auth_client.post("/api/v1/api-keys", json={"name": "CI key", "scopes": ["executions:write"]})
    assert r.status_code == 201
    k = r.json()
    assert k["key"].startswith("nx_") and k["key"].startswith(k["prefix"] + "_")
    row = db.query(ApiKey).one()
    assert row.key_hash != k["key"] and len(row.key_hash) == 64 and k["key"] not in str(row.__dict__)
    listed = auth_client.get("/api/v1/api-keys")
    assert "key" not in listed.json()[0] and k["key"] not in listed.text
    rot = auth_client.post(f"/api/v1/api-keys/{k['id']}/rotate").json()
    assert rot["key"] != k["key"] and rot["prefix"] != k["prefix"]
    assert auth_client.delete(f"/api/v1/api-keys/{k['id']}").status_code == 204
    assert auth_client.get("/api/v1/api-keys").json()[0]["revoked_at"] is not None
    assert auth_client.post(f"/api/v1/api-keys/{k['id']}/rotate").status_code == 409
    assert auth_client.post("/api/v1/api-keys", json={"name": "x", "scopes": ["admin:all"]}).status_code == 422


def test_api_key_auth_and_scopes_resolve(auth_client, db):
    from app.api.deps import api_key_principal
    from app.core.exceptions import Unauthorized
    k = auth_client.post("/api/v1/api-keys", json={"name": "k"}).json()
    p = api_key_principal(k["key"], db)
    assert p.via == "api_key" and p.user.email == "alice@example.com"
    db.expire_all()
    assert db.query(ApiKey).one().last_used_at is not None
    for bad in ("nx_deadbeef_" + "x" * 40, "garbage", k["key"] + "x", k["key"][:-1]):
        with pytest.raises(Unauthorized):
            api_key_principal(bad, db)
    auth_client.delete(f"/api/v1/api-keys/{k['id']}")
    db.expire_all()  # test session is long-lived; real requests use a fresh session each time
    with pytest.raises(Unauthorized):
        api_key_principal(k["key"], db)


# ---------- workflows / dashboard ----------
def test_workflow_crud(auth_client):
    a = auth_client.post("/api/v1/agents", json=AGENT).json()
    body = {"name": "Triage", "description": "d", "steps": [{"agent_id": a["id"], "instruction": "Step one {{input}}"},
                                                            {"agent_id": a["id"], "instruction": "Then {{previous}}"}]}
    r = auth_client.post("/api/v1/workflows", json=body)
    assert r.status_code == 201 and [s["position"] for s in r.json()["steps"]] == [0, 1]
    wid = r.json()["id"]
    assert auth_client.post("/api/v1/workflows", json=body).status_code == 409
    r = auth_client.patch(f"/api/v1/workflows/{wid}", json={"steps": [{"agent_id": a["id"], "instruction": "only"}]})
    assert r.status_code == 200 and len(r.json()["steps"]) == 1 and r.json()["steps"][0]["agent_name"] == "Support Bot"
    assert auth_client.post("/api/v1/workflows", json={"name": "E", "steps": []}).status_code == 422
    assert auth_client.delete(f"/api/v1/workflows/{wid}").status_code == 204


def test_empty_dashboard_and_analytics(auth_client):
    d = auth_client.get("/api/v1/dashboard/summary?days=7").json()
    assert d["total_agents"] == 0 and d["executions_in_period"] == 0 and d["recent_executions"] == []
    assert len(d["daily"]) == 7
    a = auth_client.get("/api/v1/dashboard/analytics?days=30").json()
    assert a["total"] == 0 and a["success_rate"] is None and a["tool_usage"] == []
    assert auth_client.get("/api/v1/dashboard/summary?days=1000").status_code == 422


def test_dashboard_requires_auth(client):
    for p in ("/api/v1/dashboard/summary", "/api/v1/agents", "/api/v1/tools", "/api/v1/api-keys", "/api/v1/workflows"):
        assert client.get(p).status_code == 401


def test_web_search_becomes_available_when_tavily_key_is_set(auth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "tavily_api_key", "tvly-0123456789abcdef")
    t = {x["name"]: x for x in auth_client.get("/api/v1/tools").json()}["web_search"]
    assert t["available"] is True and t["unavailable_reason"] is None and "Tavily" in t["description"]