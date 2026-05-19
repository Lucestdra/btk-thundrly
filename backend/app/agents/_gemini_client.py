"""Lazy Gemini client + model name resolution.

The client is constructed on first use; reads `GEMINI_API_KEY` and
`GEMINI_MODEL` from the environment at that moment, so tests can set them
before any module-level imports without re-importing this module.

Returns `None` when no key is present — callers should fall back.
"""

from __future__ import annotations

import os
import threading
from typing import Optional

# Default model: Gemini 2.5 Flash. Released Q1 2026 with substantially
# better Turkish-language summarization and structured-output adherence
# than the 1.5 generation, at similar latency and cost. Override via the
# GEMINI_MODEL env var when you need a different tier (e.g. `gemini-2.5-pro`
# for higher-stakes scoring runs).
_DEFAULT_MODEL = "gemini-2.5-flash"

_lock = threading.Lock()
_cached_client = None
_cached_key: Optional[str] = None


def get_model_name() -> str:
    return os.environ.get("GEMINI_MODEL", _DEFAULT_MODEL).strip() or _DEFAULT_MODEL


def get_client():
    """Return a `genai.Client` if `GEMINI_API_KEY` is set, else `None`.

    The client is cached per API key — if the key changes between calls
    (rare outside tests) we rebuild. Import of `google.genai` is deferred
    so the package becoming unavailable doesn't break the heuristic path.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    global _cached_client, _cached_key
    with _lock:
        if _cached_client is not None and _cached_key == api_key:
            return _cached_client
        try:
            from google import genai
        except ImportError:
            return None
        _cached_client = genai.Client(api_key=api_key)
        _cached_key = api_key
        return _cached_client


def reset_cache() -> None:
    """For tests — wipe the memoized client so env-var changes take effect."""
    global _cached_client, _cached_key
    with _lock:
        _cached_client = None
        _cached_key = None
