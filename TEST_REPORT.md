# NEXIS test report (after demo removal)

Verified in the build working tree (Ubuntu 24.04, Python 3.12.3, Node 22, PostgreSQL 16.15 local cluster). Unlike the first
delivery, this round was **not** re-verified by extracting a fresh ZIP; it was run in the working tree with the pinned dependencies.

## Executed and passing
| Check | Result |
|---|---|
| Backend lint (`ruff check .`) | All checks passed |
| Backend tests — SQLite | **165 passed** |
| Backend tests — PostgreSQL 16 | **165 passed** |
| Migration `0002` on realistic data, SQLite **and** PostgreSQL | demo agents / mock runs / `sample_orders` / `is_demo` removed; real agents, grants, workflow steps and real runs kept; downgrade restores the empty schema |
| Upgrade of a *legacy* PostgreSQL DB (old schema + demo data) with `python -m app.db.init_db` | demo data gone, real data kept, `alembic check` reports no drift |
| `alembic check` at head (SQLite and PostgreSQL) | No new upgrade operations detected |
| Frontend lint | clean |
| Frontend tests | **103 passed** (9 files) |
| Frontend production build | built |
| Live smoke test, real server + PostgreSQL + **official OpenAI SDK against a local OpenAI-protocol server**, `--with-ai` | **27/27 checks**, 0 server errors |
| Live smoke test, server with **no** OpenAI key | 22/22 checks (refuses clearly, creates no run) |
| Request audit of what the OpenAI SDK actually sent | Bearer key, `function` tools with JSON-schema parameters, safety-policy system prompt, tool results wrapped as `untrusted` |
| `pip-audit` / `npm audit --omit=dev` | no known vulnerabilities / 0 vulnerabilities |
| Guards | backend and frontend tests fail if demo/mock/sample-order code or content returns, or if Brave code returns |
| Web search (Tavily), real server with Tavily unreachable | run completes; search recorded as a *failed* tool call (`search_unreachable`); API key absent from events and logs |

## NOT executed (do not assume these work)
* **Calls to the live Tavily service.** The sandbox cannot reach api.tavily.com. The request/response handling follows Tavily's documented API (POST /search, Bearer auth, `results[]`, error codes 401/429/432/433) and is tested with a mock transport only.
* **Calls to the real OpenAI service.** The official SDK was exercised end-to-end, but against a local server that only speaks the OpenAI protocol, not a real model.
* **Real Google OAuth**, **Docker/Compose builds**, **Render/Vercel deployments**, **Playwright e2e** (browser download blocked; specs updated but unverified).
* Visual/responsive review in a real browser, Safari/mobile, accessibility audit with assistive tech, load testing, penetration testing.
* `npm audit` including dev tooling still reports 3 moderate findings in Tailwind v3's build-time CSS toolchain (build-time only).

## Defects found by testing in this round and fixed
1. **SQLite migration data loss.** SQLite changes columns by re-creating the table; with foreign keys ON, dropping the parent table fired `ON DELETE CASCADE` and silently deleted every agent's tool grants and workflow steps. Migrations now run with foreign keys OFF on SQLite. (PostgreSQL was never affected.)
2. Dashboard/Analytics unmounted (and the period dropdown vanished) while a new period loaded → previous data is kept until the new data arrives.
3. Several failures during the rewrite were mistakes in the new tests themselves (for example a scripted model that counted calls across runs); they were corrected in the tests, not worked around in the app.