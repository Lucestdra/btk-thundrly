"""Shared `slowapi` Limiter.

V1 uses the in-memory backend keyed by remote IP — enough for a single
uvicorn instance. To scale horizontally, set `RATELIMIT_STORAGE_URI`
(e.g. `redis://...`); slowapi reads it from the env without code changes.

Lives in its own module so both `main.py` (registers the middleware) and
`api/routes.py` (decorates handlers) can import without circularity.
"""

from __future__ import annotations

import os

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=os.environ.get("RATELIMIT_STORAGE_URI", "memory://"),
    default_limits=[],
)
