"""Small thread-safe TTL + LRU cache.

Purpose: skip Gemini calls when the same input was just answered.
Aggressively small surface — no async, no decorators, no metrics — so it
stays understandable. For multi-instance prod, swap for Redis-backed
behind the same `get`/`set` interface; callers don't need to change.

Defaults come from env vars so ops can tune without code changes:

    GEMINI_CACHE_MAX_SIZE    (default 256)
    GEMINI_CACHE_TTL_SECONDS (default 900 = 15 min)

The cache is in-memory per uvicorn worker. With one worker (dev /
single-instance prod) all callers share it; with multiple workers each
gets its own — which is fine since hit-rate matters more than perfect
coordination.
"""

from __future__ import annotations

import os
from collections import OrderedDict
from threading import Lock
from time import monotonic
from typing import Any, Hashable, Optional


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


class TTLCache:
    """Bounded LRU with per-entry TTL.

    Order semantics: most-recently-used at the right end of the OrderedDict;
    evictions pop from the left. Reads bump the entry to the right edge.
    """

    def __init__(self, max_size: int = 256, ttl_seconds: float = 900.0) -> None:
        self._max = max_size
        self._ttl = ttl_seconds
        self._data: "OrderedDict[Hashable, tuple[float, Any]]" = OrderedDict()
        self._lock = Lock()

    def get(self, key: Hashable) -> Optional[Any]:
        now = monotonic()
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if now >= expires_at:
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key: Hashable, value: Any) -> None:
        with self._lock:
            self._data[key] = (monotonic() + self._ttl, value)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


# Shared instance used by Gemini callers (review_agent, decision_agent).
gemini_cache = TTLCache(
    max_size=_int_env("GEMINI_CACHE_MAX_SIZE", 256),
    ttl_seconds=_float_env("GEMINI_CACHE_TTL_SECONDS", 900.0),
)
