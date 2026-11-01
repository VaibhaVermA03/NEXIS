.PHONY: setup-backend setup-frontend migrate dev-backend dev-frontend test test-backend test-frontend lint build audit smoke

setup-backend:
	cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
setup-frontend:
	cd frontend && npm ci
migrate:
	cd backend && . .venv/bin/activate && python -m app.db.init_db
dev-backend:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload --port 8000
dev-frontend:
	cd frontend && npm run dev
test-backend:
	cd backend && . .venv/bin/activate && pytest -q
test-frontend:
	cd frontend && npm test
test: test-backend test-frontend
lint:
	cd backend && . .venv/bin/activate && ruff check .
	cd frontend && npm run lint
build:
	cd frontend && npm run build
audit:
	cd backend && . .venv/bin/activate && pip-audit -r requirements.txt
	cd frontend && npm audit --omit=dev
smoke:
	python3 backend/.venv/bin/python scripts/smoke_test.py http://localhost:8000 2>/dev/null || backend/.venv/bin/python scripts/smoke_test.py http://localhost:8000