# API notes

Interactive OpenAPI docs: `GET /api/docs` (Swagger) and `/api/redoc` on the backend. Base path: `/api/v1`.

## Authentication
* **Browser:** HttpOnly cookies set by `/auth/login|signup|refresh|google/callback`. Unsafe requests must send `X-CSRF-Token` (value returned in the JSON `csrf_token`). `/auth/refresh` and `/auth/logout` must send `X-Requested-With: nexis`.
* **API keys (execution API only):** `X-API-Key: nx_…` or `Authorization: Bearer nx_…`. Scopes `executions:read` / `executions:write`.

## Errors
`{"error": {"code": "<machine_code>", "message": "<human text>", "details": [{"field","message"}]|null}}` with status 401/403/404/409/422/429/503 as appropriate. Validation errors list fields.

## Endpoints
| Area | Endpoints |
|---|---|
| Auth | `GET /auth/config` · `POST /auth/signup` `/login` `/refresh` `/logout` `/forgot-password` `/reset-password` `/change-password` · `GET /auth/me` · `GET /auth/google/login` `/google/callback` |
| Users | `GET/PATCH /users/me` · `GET/DELETE /users/me/sessions` |
| Agents | `GET/POST /agents` · `GET/PATCH/DELETE /agents/{id}` · `POST /agents/{id}/duplicate` (`page`, `page_size≤100`, `q`, `enabled`) |
| Tools | `GET/POST /tools` · `GET/PATCH/DELETE /tools/{id}` · `POST /tools/{id}/test` |
| API keys | `GET/POST /api-keys` · `POST /api-keys/{id}/rotate` · `DELETE /api-keys/{id}` |
| Workflows | `GET/POST /workflows` · `GET/PATCH/DELETE /workflows/{id}` |
| Executions | `POST /executions` (202) · `GET /executions` (`status`, `agent_id`, `workflow_id`) · `GET /executions/{id}` · `GET /executions/{id}/events?after_id=` · `GET /executions/{id}/stream` (SSE) · `POST /executions/{id}/cancel` · `POST /executions/{id}/approval` (`{"approve": bool}`, session only) |
| Dashboard | `GET /dashboard/summary?days=` · `GET /dashboard/analytics?days=` |
| Health | `GET /health` (liveness) · `GET /ready` (DB) |

## Calling the execution API from another system
```bash
curl -X POST https://api.example.com/api/v1/executions \
  -H "X-API-Key: $NEXIS_API_KEY" -H "Content-Type: application/json" \
  -d '{"agent_id":"<AGENT_ID>","task":"Summarize open support tickets"}'      # 202 + {"id": ...}
curl -H "X-API-Key: $NEXIS_API_KEY" https://api.example.com/api/v1/executions/<ID>    # poll until status is terminal
```
Running a task needs `OPENAI_API_KEY` on the server (otherwise `409 openai_not_configured`). Statuses: `queued → running → (awaiting_approval) → completed | failed | cancelled`. Tools that need approval (custom tools using POST/PUT/PATCH/DELETE) pause the run until a signed-in user approves in the dashboard (API keys cannot approve); unattended runs time out the approval and skip the action.

## SSE event schema (v1)
Frames: `id: <int>` · `event: <type>` · `data: {"v":1,"id","execution_id","type","timestamp","payload"}`. The server first sends `retry: 2000`, replays persisted events after `Last-Event-ID` / `?last_event_id=`, then follows live, emits `event: heartbeat` every 15 s (no id), and finishes with `event: stream.end` `{"status"}` (or `stream.timeout` after 10 min — reconnect).
Types: `execution.accepted|started|completed|failed|cancelled` · `agent.planning` · `agent.step.started` · `tool.call.requested` · `approval.required|granted|denied|expired` · `tool.execution.started|completed|failed` · `agent.resumed` · `agent.response.started|delta` · `workflow.step.started|completed`. Payloads are sanitized: secrets redacted, strings truncated, no model reasoning or interim text.