# NEXIS — From Intent to Execution.

Autonomous AI agent & workflow automation SaaS. Create agents, authorize the tools they may use, run multi-step tasks,
watch every step stream live, chain agents into workflows, and call it all from your own systems with API keys.

> **Status:** a complete, locally runnable application with 165 backend tests, 90 frontend tests and a 27-check live
> smoke test passing (see `TEST_REPORT.md` for exactly what was and was **not** verified). It is **not certified
> production-ready** — read *Known limitations* and `SECURITY.md` before exposing it to the internet.

## 1. What works, and what needs your credentials

| Capability | Works immediately | Needs your credentials | Notes |
|---|---|---|---|
| Email/password signup, login, logout, refresh rotation, password change, reset | ✅ | — | Reset links are shown **only in development** (no email provider exists) |
| Dashboard, analytics, agents, tools, API keys, workflows, history | ✅ | — | Backed by real DB rows; empty accounts show empty states |
| **AI runs** (real OpenAI tool-calling) | — | `OPENAI_API_KEY` | Without it the Run button is disabled and the server answers with a clear "not configured" error |
| **Continue with Google** | — | `GOOGLE_CLIENT_ID` / `SECRET` | Without them the button reports "not configured" — never fake success |
| Custom REST tools with secrets | — | `TOOL_SECRET_ENCRYPTION_KEY` | Without it, saving a tool secret returns a clear error |
| `web_search` tool | — | `TAVILY_API_KEY` | Otherwise shown as *unavailable* and never offered to the model |
| Email verification / password-reset emails | ❌ not implemented | — | Documented limitation |

## 2. Architecture

```
 Browser (React SPA)                          FastAPI backend                         Data / external
┌──────────────────────┐   HttpOnly cookies  ┌───────────────────────────────┐     ┌──────────────────┐
│ React + Vite + TW v3 │ ──────────────────► │ /api/v1  (auth, CRUD, runs)   │ ──► │ PostgreSQL        │
│ React Router 7       │   CSRF header       │  deps: session | API key      │     │ (SQLite for dev)  │
│ TanStack Query       │ ◄─ SSE (fetch) ──── │  rate limit · security headers│     └──────────────────┘
└──────────────────────┘   events replay     │                               │
                                              │ Executor (thread pool, cap N) │ ──► OpenAI API (live mode)
                                              │   └─ LangGraph graph:         │
                                              │      model ─► tools ─► model  │ ──► Google OIDC (login)
                                              │      └► finalize (bounded)    │
                                              │ Tool registry + policies      │ ──► Custom REST tools
                                              │   approval gate · SSRF guard  │     (SSRF-protected runner)
                                              └───────────────────────────────┘
```

* **Sessions:** short-lived access JWT + rotating refresh token (only its HMAC hash is stored), both HttpOnly cookies. CSRF via double-submit token. Nothing sensitive is in `localStorage` (only the theme preference).
* **Executions:** persisted row + persisted ordered events. SSE streams events from the DB, so a refresh/reconnect replays everything (`Last-Event-ID`).
* **Agent engine:** LangGraph, bounded by max steps and a wall-clock limit; tool permissions are enforced by the backend, never by the model.

## 3. Technology stack (tested versions)

Backend: Python 3.12.3 · FastAPI 0.161.1 · Uvicorn 0.54.0 · Pydantic 2.14.1 · SQLAlchemy 2.1.6 · Alembic 1.20.1 · LangGraph 1.2.16 · OpenAI SDK 3.37.0 · Argon2id (argon2-cffi 25.1.0) · PyJWT 2.15.1 · pytest 9.1.1 · Ruff 0.17.2.
Frontend: Node 22 · React 18.3.1 · Vite 6.4.5 · **Tailwind CSS v3.4.17** (classic JS config; v4 is *not* used) · React Router 7.18.4 · TanStack Query 5.62.0 · React Hook Form 7.91.0 + Zod 4.6.7 · Recharts 2.15.0 · Lucide · Vitest 5.0.5 + Testing Library.
Database: PostgreSQL 16 (verified) · SQLite (dev only).
All versions are pinned (`requirements.txt`, `package.json` + `package-lock.json`).

## 4. Prerequisites

Python 3.12, Node.js 20+ (22 tested), Git optional. PostgreSQL is optional locally (SQLite is the default). Docker is optional.

## 5. Folder structure

```
nexis/
  backend/   app/{api/v1,core,db,models,schemas,services,agents,tools,middleware,tests}  migrations/  Dockerfile
  frontend/  src/{app,components/{ui,layout,agents,executions,tools},hooks,lib,pages,routes,services,styles,test}  public/brand/
  e2e/       Playwright specs (NOT executed by the author)
  scripts/   smoke_test.py (live end-to-end check against a running backend)
  docker-compose.yml  render.yaml  .github/workflows/ci.yml  Makefile
  README.md SECURITY.md DEPLOYMENT.md TESTING.md TEST_REPORT.md MANIFEST.md docs/API.md
```

## 6. Local setup — Windows PowerShell

```powershell
# 1) Backend
cd nexis\backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements-dev.txt
Copy-Item .env.example .env           # then edit .env (see section 8)
python -m app.db.init_db              # applies database migrations
uvicorn app.main:app --reload --port 8000

# 2) Frontend (new PowerShell window)
cd nexis\frontend
npm ci
npm run dev                           # http://localhost:5173
```

## 7. Local setup — macOS / Linux

```bash
cd nexis/backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                  # then edit .env (see section 8)
python -m app.db.init_db
uvicorn app.main:app --reload --port 8000

# new terminal
cd nexis/frontend && npm ci && npm run dev     # http://localhost:5173
```
(`make setup-backend setup-frontend migrate dev-backend dev-frontend` does the same.)
Open **http://localhost:5173**, sign up, create an agent, and — with `OPENAI_API_KEY` set — run a task.

## 8. Environment variables (backend/.env)

Full annotated list: `.env.example`. Essentials:

| Variable | Purpose |
|---|---|
| `APP_ENV` | `development` \| `test` \| `production`. Production **fails to start** on weak/missing secrets, SQLite, insecure cookies, non-HTTPS frontend URL |
| `APP_SECRET_KEY` | Signs JWTs and hashes tokens. Generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. If left blank in development a temporary random one is used (sessions reset on restart) |
| `DATABASE_URL` | `sqlite:///./nexis_dev.db` (default) or `postgresql://user:pass@host:5432/nexis` |
| `TOOL_SECRET_ENCRYPTION_KEY` | Fernet key for custom-tool credentials. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Enable live AI runs |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | Enable Google login |
| `FRONTEND_URL`, `BACKEND_URL`, `CORS_ORIGINS` | Redirects and CORS allow-list (no wildcard in production) |
| `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN` | Cookie attributes — see `DEPLOYMENT.md` for each topology |
| `AGENT_MAX_STEPS`, `EXECUTION_MAX_SECONDS`, `EXECUTION_MAX_CONCURRENCY` | Run limits |
| `TOOL_OUTBOUND_ALLOWLIST`, `TOOL_ALLOW_HTTP` | Restrict/relax custom-tool destinations (HTTP only for dev) |
| `RATE_LIMIT_AUTH`, `RATE_LIMIT_API` | `count/seconds` per client IP |
| `TAVILY_API_KEY` | Enables `web_search` (Tavily) |

Frontend (`frontend/.env`): `VITE_API_URL` (leave empty in dev — Vite proxies `/api` to `:8000`).

## 9. Google OAuth setup

1. Google Cloud Console → *APIs & Services* → **OAuth consent screen** (External, add yourself as a test user) → **Credentials → Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URI (local, exact):** `http://localhost:8000/api/v1/auth/google/callback`
   (Docker Compose: `http://localhost:8080/api/v1/auth/google/callback`; production: `https://<your-api-domain>/api/v1/auth/google/callback`.)
3. Put the client id/secret in `backend/.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; keep `GOOGLE_REDIRECT_URI` identical to step 2. Restart the backend.

Implementation: authorization-code flow with **PKCE (S256)**, signed short-lived state/nonce/verifier cookie, ID-token signature verified against Google's JWKS, `iss`/`aud`/`exp`/`nonce` checked, unverified emails rejected.
**Account policy:** a Google identity whose email already belongs to a *password* account is **refused** (prevents pre-registration takeover); sign in with the password instead. There is no account-linking UI yet.
*Not verified against live Google* (no credentials in the build environment): the callback logic and ID-token validation are tested with mocked exchange and a locally generated RSA key.

## 10. OpenAI

Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4o-mini`). Live mode then uses real tool-calling. Provider errors (bad key, rate limit, timeout) are mapped to safe messages and persisted on the execution. *The live OpenAI path is tested with a scripted fake model only; it has not been run against the real API.*

### Web search (Tavily) — optional
The `web_search` tool uses [Tavily](https://tavily.com). Create a key at https://app.tavily.com (the free plan includes monthly credits and needs no credit card), put it in `backend/.env` as `TAVILY_API_KEY=tvly-...`, and restart the backend. Without it the tool is shown as *unavailable* and is never offered to the model.
When Tavily's credits or plan limit run out it answers HTTP 432/433, which NEXIS records as a **failed tool call** ("Tavily credits or plan limit reached"); the run itself carries on. *Not tested against the live Tavily service (no network access in the build environment): the request/response handling follows Tavily's documented API and is covered by tests with a mock transport.*

## 11. Database & migrations

`python -m app.db.init_db` runs `alembic upgrade head`. Migrations are **never** run on startup — run them as an explicit deploy step (`--migrate-only` is accepted as an alias).

## 12. No demo data
A fresh database is empty: there are no sample orders, no pre-made agents and no mock mode, and every new account starts blank.
**Upgrading an existing database:** migration `0002` deletes the old demo agent(s), mock-mode runs and the `sample_orders` table, and removes grants to the retired demo tools. It keeps your own agents and real runs. **Take a database backup first.**

## 13. Running tests
```bash
cd backend && pytest -q                       # 165 tests (SQLite); TEST_DATABASE_URL=postgresql://... to run on Postgres
cd frontend && npm run lint && npm test && npm run build
python scripts/smoke_test.py http://localhost:8000              # with the backend running (add --with-ai for one real task)
```
See `TESTING.md`.

## 14. Troubleshooting
| Symptom | Fix |
|---|---|
| `Cannot reach the server` in the UI | Backend not running on :8000; check `uvicorn` output |
| Login works then immediately logs out | Cookies blocked, or frontend/backends on different sites without `COOKIE_SAMESITE=none`+`COOKIE_SECURE=true` (see `DEPLOYMENT.md`) |
| `CSRF validation failed` | Stale tab after server restart — reload |
| `AI execution is disabled` / "AI is not configured" | Set `OPENAI_API_KEY` in the backend environment and restart it |
| Saving a tool secret fails (503) | Set `TOOL_SECRET_ENCRYPTION_KEY` |
| `no such table` / startup warning about migrations | Run `python -m app.db.init_db` |
| `database is locked` (SQLite) | Use PostgreSQL for concurrent runs |
| Google button returns to login with an error | Read the message: not configured / redirect URI mismatch / cancelled |
| PowerShell blocks venv activation | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

## 15. Docker
```bash
cp .env.example .env     # set APP_SECRET_KEY and TOOL_SECRET_ENCRYPTION_KEY
docker compose up --build        # http://localhost:8080  (nginx serves the SPA and proxies /api)
```
Runs Postgres → one-shot migration job → API → frontend. **The Docker/Compose files have not been built or run by the author** (no Docker in the build sandbox); YAML was syntax-checked only.

## 16. Production deployment
See `DEPLOYMENT.md` (Vercel + Render + managed PostgreSQL, cookie topologies, Google redirect URIs, migrations, rollback). Nothing has been deployed by the author.

## 17. Security notes
See `SECURITY.md`. Highlights: Argon2id, hashed rotating refresh tokens with reuse detection, CSRF, rate limits, security headers, per-owner scoping on every query, SSRF-hardened tool runner with IP pinning, encrypted tool secrets (never returned), hashed API keys shown once, approval gates, prompt-injection framing, secret-redacted logs.

## 18. Known limitations
* **Durability:** runs execute in an in-process thread pool. Persisted state/events survive restarts; in-flight runs are marked *failed* ("interrupted") on restart. Use a queue (e.g. Redis + worker) before scaling horizontally.
* **Rate limiting is per process** (in-memory). Behind multiple instances add a gateway/Redis limiter.
* "Streaming" of the final answer is **chunked after generation**, not token-by-token.
* Email delivery and email verification are **not implemented** (password-reset emails are never sent).
* Single personal workspace per account (no teams/roles). Workflows are **sequential steps** (no visual graph editor, no branching).
* Google accounts are not auto-linked to existing password accounts.
* Tool-secret rotation requires re-entering secrets (single Fernet key, no MultiFernet migration tool yet).
* Dashboard aggregations read up to 20 000 rows per request in application code — fine for modest volumes, not for very large tenants.
* Refresh rotation is single-flight per browser tab; two tabs refreshing at the *same instant* can trigger reuse detection and sign you out (safe failure).
* Unverified here: Docker build, Render/Vercel deploys, Playwright e2e, real OpenAI & Google calls, Safari/mobile browsers, visual design review in a real browser, load/performance.

## 19. Future enhancements
Durable job queue + workers, Redis rate limiting, real email provider (verification/reset/notifications), teams & roles, workflow branching & visual editor, account linking, token-level streaming, MultiFernet key rotation, OpenTelemetry tracing.

## 20. Branding
Drop your official logo at `frontend/public/brand/nexis-logo.svg`. Until then the app shows a plain "NEXIS" text wordmark (no invented logo). Colors/spacing/radii/shadows live as CSS variables in `frontend/src/styles/index.css` (light + dark themes).