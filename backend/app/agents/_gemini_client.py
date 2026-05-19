"""Compatibility shim — defer to :mod:`app.agents._llm`.

The original module exposed a Gemini-only client. We've since added
OpenRouter as a first-class provider (see ``_llm.py``); this shim keeps
existing imports (tests, ``routes.py``, ``cache_key`` builders) working
without forcing every call site to migrate at once.

New code should import directly from ``app.agents._llm`` —
``get_llm_client()`` / ``get_provider_info()`` — for full provider
visibility.
"""

from __future__ import annotations

from app.agents._llm import get_llm_client, reset_cache as _llm_reset_cache


def get_client():
    """Backwards-compatible alias for ``get_llm_client()``.

    Returns either a Gemini-direct or OpenRouter-backed
    :class:`~app.agents._llm.LLMClient`, or ``None`` when no API key is
    configured. The returned object exposes ``.generate_json(...)`` —
    callers using the old ``client.models.generate_content(...)`` shape
    must migrate.
    """
    return get_llm_client()


def get_model_name() -> str:
    """Return the active LLM model id, or an empty string if no LLM is active.

    Used by older cache-key builders that fingerprint the model in the
    cache key so a model swap invalidates cached narrations cleanly.
    """
    client = get_llm_client()
    return client.model if client is not None else ""


def reset_cache() -> None:
    """Test helper. Wipes the cached LLM client."""
    _llm_reset_cache()
