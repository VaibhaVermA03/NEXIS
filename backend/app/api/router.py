from fastapi import APIRouter

from app.api.v1 import agents, api_keys, auth, dashboard, executions, health, tools, users, workflows

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(agents.router)
api_router.include_router(tools.router)
api_router.include_router(api_keys.router)
api_router.include_router(workflows.router)
api_router.include_router(dashboard.router)
api_router.include_router(executions.router)
