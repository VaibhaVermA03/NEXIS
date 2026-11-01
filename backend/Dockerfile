FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
# Run as an unprivileged user
RUN useradd --create-home --uid 10001 nexis && chown -R nexis /srv
USER nexis
EXPOSE 8000
# Migrations are an EXPLICIT deploy step (python -m app.db.init_db / alembic upgrade head), never run on startup.
# --proxy-headers so client IPs (rate limiting) and https scheme are read from the platform's reverse proxy.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
