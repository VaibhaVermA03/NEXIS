"""Live end-to-end smoke test against a RUNNING NEXIS backend (real HTTP, cookies, CSRF, SSE).

    python scripts/smoke_test.py [http://localhost:8000]            # no AI needed
    python scripts/smoke_test.py http://localhost:8000 --with-ai    # also runs ONE real task (needs OPENAI_API_KEY on the server)

Needs only `httpx` (already a backend dependency). Creates throwaway users with random emails; exits non-zero on the first
failed check. Run it against staging, not production, because it creates accounts."""
import secrets
import sys
import time

import httpx

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
WITH_AI = "--with-ai" in sys.argv
BASE = (ARGS[0] if ARGS else "http://localhost:8000").rstrip("/") + "/api/v1"
PW = "Sm0ke-Test-Passw0rd!"
passed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed
    if not cond:
        print(f"  FAIL  {name} {detail}")
        sys.exit(1)
    passed += 1
    print(f"  ok    {name}")


class Session:
    def __init__(self):
        self.c = httpx.Client(base_url=BASE, timeout=30, headers={"X-Requested-With": "nexis"})
        self.csrf = None

    def req(self, method, path, **kw):
        h = kw.pop("headers", {})
        if self.csrf and method not in ("GET", "HEAD"):
            h["X-CSRF-Token"] = self.csrf
        return self.c.request(method, path, headers=h, **kw)

    def signup(self, email):
        r = self.req("POST", "/auth/signup", json={"full_name": "Smoke Tester", "email": email, "password": PW, "password_confirm": PW})
        if r.status_code == 201:
            self.csrf = r.json()["csrf_token"]
        return r

    def wait(self, eid, states=("completed", "failed", "cancelled"), timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            e = self.req("GET", f"/executions/{eid}").json()
            if e["status"] in states:
                return e
            time.sleep(0.3)
        raise SystemExit(f"timeout waiting for {eid}: {e['status']}")


def main():
    tag = secrets.token_hex(4)
    print(f"NEXIS smoke test against {BASE}  (real AI run: {'yes' if WITH_AI else 'no'})")
    r = httpx.get(f"{BASE}/ready", timeout=10)
    check("readiness (database reachable)", r.status_code == 200 and r.json()["database"] is True, r.text)
    cfg = httpx.get(f"{BASE}/auth/config", timeout=10).json()
    ai_enabled = bool(cfg["openai_enabled"])

    a = Session()
    r = a.signup(f"smoke-{tag}-a@example.com")
    check("signup sets HttpOnly session cookies", r.status_code == 201 and "nx_access" in a.c.cookies and "nx_refresh" in a.c.cookies, r.text)
    check("signup response leaks no password hash", "password_hash" not in r.text and "argon2" not in r.text)
    check("unauthenticated request rejected", httpx.get(f"{BASE}/agents", timeout=10).status_code == 401)
    r = a.c.post("/agents", json={"name": "NoCsrf"}, headers={"X-Requested-With": "nexis"})
    check("CSRF enforced on cookie-authenticated writes", r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed", r.text)

    check("new account starts empty (no demo agents/data)", a.req("GET", "/agents").json()["total"] == 0 and a.req("GET", "/executions").json()["total"] == 0)
    tools = {t["name"]: t for t in a.req("GET", "/tools").json()}
    check("only real built-in tools exist", set(tools) == {"generate_report", "http_request", "web_search"}, str(set(tools)))

    r = a.req("POST", "/agents", json={"name": "Smoke Analyst", "system_instructions": "Use tools when helpful.", "tool_keys": ["builtin:generate_report"]})
    check("agent created and persisted", r.status_code == 201 and a.req("GET", "/agents").json()["total"] == 1, r.text)
    agent = r.json()
    r = a.req("POST", "/tools", json={"name": "ssrf_probe", "description": "probe", "url": "https://169.254.169.254/latest/meta-data"})
    check("SSRF: cloud-metadata URL rejected at creation", r.status_code == 422, r.text)

    if ai_enabled and WITH_AI:
        r = a.req("POST", "/executions", json={"agent_id": agent["id"], "task": "Call generate_report on rows [{\"region\":\"n\",\"amount\":10},{\"region\":\"s\",\"amount\":32.5}] then summarize."})
        check("execution accepted (202)", r.status_code == 202, r.text)
        e = a.wait(r.json()["id"])
        check("real AI run completed with a result", e["status"] == "completed" and e["result"], str(e))
        evs = a.req("GET", f"/executions/{e['id']}/events").json()["events"]
        types = [x["type"] for x in evs]
        check("events persisted in order", types[0] == "execution.accepted" and types[-1] == "execution.completed" and "agent.response.delta" in types)
        with a.c.stream("GET", f"/executions/{e['id']}/stream", headers={"Accept": "text/event-stream"}) as s:
            body = "".join(s.iter_text())
        ids = [int(ln.split(": ")[1]) for ln in body.splitlines() if ln.startswith("id: ")]
        check("SSE replays all events and ends with stream.end", len(ids) == len(evs) and "event: stream.end" in body)
        with a.c.stream("GET", f"/executions/{e['id']}/stream", headers={"Last-Event-ID": str(ids[3])}) as s:
            resumed = [int(ln.split(": ")[1]) for ln in "".join(s.iter_text()).splitlines() if ln.startswith("id: ")]
        check("SSE resumes after Last-Event-ID", resumed == ids[4:])
        d = a.req("GET", "/dashboard/summary?days=7").json()
        check("dashboard reflects the persisted run", d["executions_in_period"] == 1 and d["completed"] == 1)
    elif not ai_enabled:
        r = a.req("POST", "/executions", json={"agent_id": agent["id"], "task": "x"})
        check("without OPENAI_API_KEY the server refuses clearly and creates no run",
              r.status_code == 409 and r.json()["error"]["code"] == "openai_not_configured" and a.req("GET", "/executions").json()["total"] == 0, r.text)
    else:
        print("  skip  AI run (server has an OpenAI key; re-run with --with-ai to spend one real request)")

    r = a.req("POST", "/executions", json={"agent_id": agent["id"], "task": "x", "mode": "mock"})
    check("the old 'mock' mode is gone", r.status_code == 422, r.text)

    r = a.req("POST", "/api-keys", json={"name": "smoke"})
    key, key_id = r.json()["key"], r.json()["id"]
    check("API key shown once; list never returns it", key.startswith("nx_") and key not in a.req("GET", "/api-keys").text)
    ext = httpx.Client(base_url=BASE, timeout=30, headers={"X-API-Key": key})
    check("API key can read executions", ext.get("/executions").status_code == 200)
    check("API key cannot access non-execution resources", ext.get("/agents").status_code == 401)
    a.req("DELETE", f"/api-keys/{key_id}")
    check("revoked API key stops working", ext.get("/executions").status_code == 401)

    b = Session()
    b.signup(f"smoke-{tag}-b@example.com")
    check("cross-user isolation: foreign agent is 404", b.req("GET", f"/agents/{agent['id']}").status_code == 404)
    check("cross-user isolation: cannot run foreign agent", b.req("POST", "/executions", json={"agent_id": agent["id"], "task": "x"}).status_code in (404, 409))
    check("cross-user isolation: other user sees nothing", b.req("GET", "/agents").json()["total"] == 0)

    old = a.c.cookies.get("nx_refresh")
    r = a.req("POST", "/auth/refresh")
    check("refresh token rotates", r.status_code == 200 and a.c.cookies.get("nx_refresh") != old)
    a.csrf = r.json()["csrf_token"]
    stolen = httpx.Client(base_url=BASE, headers={"X-Requested-With": "nexis"})
    stolen.cookies.set("nx_refresh", old, path="/api/v1/auth")
    check("replayed (rotated) refresh token rejected", stolen.post("/auth/refresh").status_code == 401)
    check("reuse revokes the whole session family", a.req("POST", "/auth/refresh").status_code == 401)

    c = Session()
    c.signup(f"smoke-{tag}-c@example.com")
    check("logout revokes session", c.req("POST", "/auth/logout").status_code == 204 and c.req("POST", "/auth/refresh").status_code == 401)
    print(f"\nALL {passed} CHECKS PASSED")


if __name__ == "__main__":
    try:
        main()
    except httpx.ConnectError:
        print(f"Cannot connect to {BASE}. Start the backend first (see README).")
        sys.exit(2)