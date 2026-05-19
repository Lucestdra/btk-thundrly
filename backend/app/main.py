"""FastAPI uygulama girişi."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.routes import router as api_router
from app.core.limiter import limiter
from app.core.logging import (
    RequestLoggingMiddleware,
    attach_request_id_header,
    configure_logging,
)
from app.db.database import SessionLocal
from app.db.migrations import run_migrations
from app.db.seed import seed_if_empty

configure_logging()
logger = logging.getLogger("thundrly")

DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def _allowed_origins() -> list[str]:
    raw = os.environ.get("ALLOWED_ORIGINS")
    if not raw:
        return DEFAULT_ORIGINS
    return [o.strip() for o in raw.split(",") if o.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bring schema to head via Alembic. Fresh DBs get migrated; databases
    # that were originally bootstrapped via `create_all` get stamped at
    # head so future `alembic revision` work is clean.
    status = run_migrations()
    logger.info("DB migrations: %s.", status)

    with SessionLocal() as db:
        inserted = seed_if_empty(db)
        if inserted:
            logger.info("Seeded %d canonical price observations.", inserted)

    yield


app = FastAPI(
    title="Thundrly — Backend",
    description=(
        "Türk e-ticaret için 5 ajanlı satın alma analiz servisi. "
        "Fiyat geçmişi crowdsource veritabanından beslenir."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# Rate limiter wiring — state, middleware, and the 429 JSON handler.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(RequestLoggingMiddleware)
attach_request_id_header(app)


@app.exception_handler(RequestValidationError)
async def _log_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Surface 422 details in the structured log instead of swallowing them.

    Without this handler, a malformed analyze-purchase payload returns
    422 but the log only records `POST /api/analyze-purchase -> 422`,
    making it impossible to tell which field failed validation. We now
    log the per-field error list plus a short body excerpt so the
    extension <-> backend contract drift is debuggable from the server
    side alone.
    """
    try:
        raw_body = (await request.body()).decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        raw_body = "<unreadable>"

    logger.warning(
        "request.validation_error",
        extra={
            "event": "request.validation_error",
            "path": request.url.path,
            "method": request.method,
            "errors": exc.errors(),
            "body_excerpt": raw_body[:2000],
        },
    )
    # Keep the 422 response shape stable for clients.
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/", include_in_schema=False)
def root() -> dict:
    return {
        "service": "thundrly-backend",
        "version": "0.1.0",
        "docs": "/docs",
    }
