# syntax=docker/dockerfile:1.7
# Multi-stage build: pip install in a builder image, copy the resulting
# site-packages into a slim runtime image. Keeps the final image small
# (~110 MB) and surface-area minimal (no gcc, no build deps at runtime).

# ---------- Builder ----------
FROM python:3.13-slim AS builder

WORKDIR /build

# `psycopg2-binary` ships its own libpq, so we don't need libpq-dev here.
# Installing to /install lets us copy a tidy tree into the runtime layer.
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---------- Runtime ----------
FROM python:3.13-slim

# Non-root user — defense in depth. UID 1000 is conventional.
RUN useradd --create-home --uid 1000 tarti

# Copy installed packages from the builder.
COPY --from=builder /install /usr/local

WORKDIR /app

# Only the parts the running server actually needs. tests/ and scripts/
# are dev tooling and stay out of the image.
COPY --chown=tarti:tarti app ./app
COPY --chown=tarti:tarti alembic ./alembic
COPY --chown=tarti:tarti alembic.ini ./alembic.ini

# Ensure the SQLite default path is writable in case DATABASE_URL is
# unset (e.g. first-run misconfiguration); production uses Postgres so
# this directory just sits empty.
RUN mkdir -p /app/app/data && chown -R tarti:tarti /app/app/data

USER tarti

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LOG_FORMAT=json \
    PORT=8000

EXPOSE 8000

# `--proxy-headers` makes uvicorn trust X-Forwarded-* from Fly's edge,
# so request.client.host shows the real remote IP in our access logs.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
