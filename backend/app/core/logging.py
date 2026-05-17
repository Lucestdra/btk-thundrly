"""Structured JSON logging + per-request middleware.

Production hosts (Fly.io, Railway, Cloud Run, anything pipe-to-stdout)
parse JSON log lines into structured records. This module configures
Python's stdlib logger to emit one JSON object per record and registers
a FastAPI middleware that wraps each request with method/path/status/
duration fields, all under a single request_id (X-Request-ID echoed on
the response).

`Console` mode (default in dev) keeps the human-readable uvicorn output;
set `LOG_FORMAT=json` for production. Single env flag, no other knobs.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import uuid
from typing import Any

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

_LOGGER = logging.getLogger("thundrly")
_REQUEST_LOGGER = logging.getLogger("thundrly.request")


class _JsonFormatter(logging.Formatter):
    """One JSON object per record; ensures keys are stable for log shippers."""

    _STD_FIELDS = {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "taskName",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Surface any extra=... fields passed at logging time.
        for key, value in record.__dict__.items():
            if key in self._STD_FIELDS or key.startswith("_"):
                continue
            try:
                json.dumps(value)
            except (TypeError, ValueError):
                value = repr(value)
            payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    """Install the JSON formatter on the root logger when LOG_FORMAT=json."""
    if os.environ.get("LOG_FORMAT", "").lower() != "json":
        return

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(_JsonFormatter())

    # Replace handlers on root so uvicorn's default text handler doesn't
    # double-emit. Uvicorn loggers ("uvicorn", "uvicorn.access") inherit.
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Emit a single structured record per HTTP request.

    Adds (or echoes) `X-Request-ID` on the response so client logs can be
    correlated with server logs.
    """

    async def dispatch(self, request: Request, call_next):  # noqa: ANN001 - Starlette signature
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        started = time.perf_counter()
        # Stash on the request state for downstream handlers that may
        # want to include it in their own logs.
        request.state.request_id = request_id

        status_code: int = 500
        try:
            response: Response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            _REQUEST_LOGGER.info(
                "%s %s -> %d",
                request.method,
                request.url.path,
                status_code,
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": status_code,
                    "duration_ms": round(duration_ms, 2),
                    "remote": request.client.host if request.client else None,
                },
            )


def attach_request_id_header(app: FastAPI) -> None:
    """Echo the request_id from middleware onto every response."""

    @app.middleware("http")
    async def _add_header(request: Request, call_next):  # noqa: ANN001
        response: Response = await call_next(request)
        rid = getattr(request.state, "request_id", None)
        if rid and "x-request-id" not in response.headers:
            response.headers["x-request-id"] = rid
        return response
