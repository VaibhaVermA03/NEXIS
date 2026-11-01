# NEXIS Security

Reporting: open a private security advisory with the repository owner. Do not file public issues for vulnerabilities.

## Implemented controls
| Area | Control |
|---|---|
| Passwords | Argon2id; timing equalised for unknown accounts; generic login error; rehash on login; policy ≥10 chars with upper/lower/digit |
| Sessions | HttpOnly cookies: access JWT (15 min), refresh token (14 d, path-scoped to `/api/v1/auth`), CSRF token. Refresh tokens are random, stored only as HMAC-SHA256, **rotated on every use**; reuse of a rotated token revokes the entire token family. Logout, password change/reset revoke sessions |
| CSRF | Double-submit (`X-CSRF-Token` must equal the HttpOnly cookie) on all cookie-authenticated unsafe requests; `X-Requested-With` required on refresh/logout; SameSite per deployment |
| Google OIDC | Auth-code + PKCE(S256); signed 10-min flow cookie (state, nonce, verifier); ID token verified (JWKS signature, iss, aud, exp, nonce); email must be verified; existing password accounts are never silently linked |
| Authorization | Every tenant row has `owner_id`; every lookup is `get_owned(...)`; foreign ids return 404 (indistinguishable from missing). Owner is never taken from client input. Cross-user tests cover agents, tools, keys, workflows, executions, events, streams, approvals, dashboards |
| API keys | `nx_<prefix>_<secret>`; only an HMAC hash is stored; shown once; scoped (`executions:read|write`); revocable/rotatable; usable **only** on the execution API; cannot approve actions; per-key rate limit; never logged |
| Tool secrets | Fernet (authenticated encryption), key from env; never returned by the API (only `has_secret`); replaced via explicit write-only field |
| Agent safety | Per-agent tool grants enforced server-side; schema validation of every call; max steps + wall-clock timeout; approval gate for side-effect tools (denied/expired = tool not run); tool output wrapped as `untrusted`; platform policy outranks agent instructions; interim model text and reasoning are never surfaced; secrets redacted from events and logs |
| SSRF (custom/generic REST tools) | https-only (http opt-in for dev); no embedded credentials; blocked internal hostnames/suffixes; DNS resolved and **every** address must be global unicast (blocks loopback, RFC1918, link-local/metadata, CGNAT, multicast, reserved, IPv4-mapped/6to4 forms, decimal/hex IPv4); connection **pinned to the validated IP** with Host+SNI preserved (anti DNS-rebinding); redirects not followed; connect/read timeouts; response size cap; content-type + JSON validation; forbidden/CRLF headers rejected; optional host allow-list |
| Transport/headers | CORS allow-list (no wildcard in prod), `nosniff`, `X-Frame-Options: DENY`, strict API CSP, `Referrer-Policy`, HSTS in production, `Cache-Control: no-store` on API |
| Config | Production refuses to start with a weak/default secret, SQLite, missing Fernet key, insecure cookies, non-HTTPS frontend, HTTP tools enabled, or wildcard CORS |
| Logging | JSON logs with redaction of `sk-…`, `nx_…`, bearer tokens, password/token/secret fields; stack traces never returned to clients |
| Supply chain | Pinned deps; `pip-audit`: none known. `npm audit --omit=dev`: none known (see TEST_REPORT.md for dev-tool notes) |

## Residual risks / limitations (read these)
* **SSRF:** IP pinning defeats DNS rebinding for the connection we make, but egress should *also* be restricted at the network layer (firewall/egress proxy) in production, and `TOOL_OUTBOUND_ALLOWLIST` should be set where tools target known hosts. Outbound requests to *public* hosts on any port are permitted.
* **Rate limiting** is in-memory, per process and keyed by client IP (uses `X-Forwarded-For` only via uvicorn proxy headers — configure your proxy to set it and restrict `--forwarded-allow-ips` in production).
* **No email verification / MFA.** Password reset links are never emailed; in production without an email provider the reset flow cannot complete.
* **Encryption key loss = tool secrets unrecoverable.** Back up `TOOL_SECRET_ENCRYPTION_KEY` separately from the database. Rotation = deploy new key, re-enter secrets (no re-encryption tool yet).
* **Multi-tab refresh race** can trigger reuse detection (user is signed out; fail-safe).
* Prompt-injection mitigations reduce but cannot eliminate risk; the approval gate and per-agent tool grants are the hard boundary.
* Not independently pen-tested. No WAF/DDoS protection included.

## Hardening checklist before going live
1. `APP_ENV=production`; strong `APP_SECRET_KEY`; Fernet key stored in a secrets manager; HTTPS everywhere.
2. Same-site frontend/API domains (see DEPLOYMENT.md) rather than third-party cookies.
3. Set `CORS_ORIGINS` to the exact frontend origin; set `TOOL_OUTBOUND_ALLOWLIST`; add network egress rules.
4. Managed Postgres with backups and TLS; run migrations as a pipeline step.
5. Replace in-memory rate limiting with an edge/Redis limiter if running >1 instance.
6. Add an email provider before relying on password reset; consider MFA.
7. Monitor logs for `session.reuse_detected` audit events.