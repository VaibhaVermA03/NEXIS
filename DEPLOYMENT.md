# Deployment guide

> **Nothing here has been deployed by the author.** Commands and settings follow each platform's documented behaviour
> but are unverified in practice. Docker builds and Render/Vercel deploys were not possible in the build sandbox.
> What *was* verified: the backend suite and migrations on PostgreSQL 16, the frontend production build, and a live
> smoke test (`scripts/smoke_test.py`) against a running server.

## 0. Choose a cookie topology first (this decides whether login works)

Auth uses HttpOnly cookies, so the browser must treat the API as **same-site** with the frontend.

| Topology | Frontend → API | Settings | Verdict |
|---|---|---|---|
| **A. Sibling subdomains (recommended)** | `https://app.example.com` → `https://api.example.com` | `COOKIE_SECURE=true`, `COOKIE_SAMESITE=lax`, `CORS_ORIGINS=https://app.example.com`, frontend `VITE_API_URL=https://api.example.com` | Works in all major browsers (same *site*, different origin). Needs a custom domain on both Vercel and Render |
| B. Reverse-proxy | Browser → `https://app.example.com/api/*` rewritten to Render | `COOKIE_SAMESITE=lax`, `VITE_API_URL` empty, add a Vercel rewrite `/api/:path*` → `https://<render-service>.onrender.com/api/:path*` | First-party cookies. **SSE through the Vercel proxy is unverified**; the UI automatically falls back to polling `/events` if streaming fails |
| C. Cross-site (e.g. `*.vercel.app` + `*.onrender.com`) | different registrable domains | `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, `VITE_API_URL=<render url>` | **Not recommended**: Safari and privacy modes block third-party cookies, so login silently fails there |

## 1. Database — managed PostgreSQL
Create a managed Postgres (Render, Neon, Supabase, RDS…). Use its connection string as `DATABASE_URL` (`postgresql://…`; `postgres://` is also accepted). Enable automated backups and TLS. SQLite is rejected in production.

## 2. Backend — Render (Docker)
* Use `render.yaml` (Blueprint) or create a **Web Service**: runtime *Docker*, root directory `backend`, Dockerfile `./Dockerfile`, health check path `/api/v1/health`.
* **Environment variables** (all in `.env.example`): `APP_ENV=production`, `DATABASE_URL`, `APP_SECRET_KEY` (≥32 random chars), `TOOL_SECRET_ENCRYPTION_KEY` (Fernet), `FRONTEND_URL`, `BACKEND_URL`, `CORS_ORIGINS`, `COOKIE_SECURE=true`, `COOKIE_SAMESITE`, optional `TAVILY_API_KEY` (web search), `OPENAI_API_KEY`, Google vars.
  The app **refuses to boot** with an invalid production config and prints which setting is wrong.
* **Migrations (explicit step; back up the database first — migration 0002 deletes old demo data):** `python -m app.db.init_db --migrate-only` (or `alembic upgrade head`). `render.yaml` sets it as `preDeployCommand` (a plan-dependent Render feature); otherwise run it once from a Render Shell/one-off job before first traffic, and on every release that adds a migration.
* Start command is baked into the Dockerfile (`uvicorn … --proxy-headers`); Render injects `$PORT`.
* No persistent disk, background worker or Redis is required. Runs execute inside the web process; see limitations below.

## 3. Frontend — Vercel
* Import the repo; **Root Directory `frontend`**, framework *Vite*, build `npm run build`, output `dist`, install `npm ci`.
* Env: `VITE_API_URL=https://api.example.com` (topology A/C) or empty (topology B).
* `frontend/vercel.json` provides SPA fallback + basic headers. For topology B add the `/api` rewrite **above** the SPA rule.
* Custom domain + HTTPS are automatic on Vercel/Render.

## 4. Google OAuth in production
Google Cloud Console → your Web OAuth client → add **Authorized redirect URI** `https://api.example.com/api/v1/auth/google/callback` (must equal `GOOGLE_REDIRECT_URI` exactly; topology B: use the app domain `https://app.example.com/api/v1/auth/google/callback`). Move the consent screen to *In production* when ready for non-test users. Set `FRONTEND_URL` correctly — the callback redirects to `${FRONTEND_URL}/auth/callback`.

## 5. Verify after deploy
```bash
curl https://api.example.com/api/v1/health        # {"status":"ok"}
curl https://api.example.com/api/v1/ready         # database true
python scripts/smoke_test.py https://api.example.com   # creates throwaway users; add --with-ai to also run one real task
```
(Run the smoke test against staging, not production, since it creates accounts.)

## 6. Operations
* **Logs:** JSON to stdout (secrets redacted); ship via the platform's log drain. Watch for audit action `session.reuse_detected` (possible token theft).
* **Backups:** managed-DB snapshots **plus** a separate secure copy of `TOOL_SECRET_ENCRYPTION_KEY` — without it stored tool credentials are unrecoverable.
* **Rollback:** redeploy the previous image on Render. If a release included a migration, take a DB snapshot *before* deploying; downgrade with `alembic downgrade -1` only if the migration is reversible and the old code needs it (the initial schema's downgrade drops all tables).
* **Key rotation:** `APP_SECRET_KEY` rotation signs everyone out and invalidates API-key hashes and refresh tokens (they are HMAC'd with it) — **API keys must be re-issued**. Fernet rotation: set the new key and re-enter tool secrets (no automatic re-encryption).

## 7. Platform limitations to know
* Free/spin-down instances drop in-flight runs; they are marked *failed (interrupted)* on restart.
* **Cold starts (Render free plan):** an idle backend sleeps and the first request can take up to a minute. The app handles this: it shows a "Waking up the server…" screen (after ~2.5 s), keeps retrying network errors and 5xx for about 90 s instead of showing the login page, and then offers a "Try again" button. Upgrading the Render instance type removes the cold start.
* Multi-instance: in-memory rate limits and in-process execution are per instance. A run is executed by the instance that accepted it, and any instance can *stream* it (events are in the DB), but only one instance should be scaled up until a queue/worker is added.
* Long SSE connections: some proxies cap idle/total time. The server heartbeats every 15 s, ends a connection after 10 min (client reconnects with `Last-Event-ID`), and the UI falls back to polling.