"""LLM provider — Google Gemini.

This is the only LLM we support. The abstraction (``LLMClient`` +
``get_llm_client``) is kept so agent code calls a single
``generate_json`` method instead of poking at the SDK directly. That
makes the cache-key, retry, and resilience wrappers shared logic, and
keeps the agent files clean of Google-SDK-specific knobs.

Why an abstraction for one provider? **Model-name resilience.** Google
rotates and retires Gemini model IDs every few months (the
``gemini-1.5-flash → 404 NOT_FOUND`` outage on the v1beta API is the
canonical example). The client below tries a fallback chain of model
IDs whenever the configured one 404s, so a single deprecation can no
longer take the whole backend down.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Optional, Type, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Default model. Override with the GEMINI_MODEL env var.
_DEFAULT_MODEL = "gemini-2.5-flash"

# When a 404 NOT_FOUND comes back from the API, walk this list looking
# for a model that's still available. Ordered newest → most-permissive.
# The configured model is always tried FIRST; this list is purely a
# safety net for retired model IDs.
_FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-002",
]


class LLMClient:
    """Provider-agnostic call surface (currently Gemini only).

    Caller invokes :meth:`generate_json` with a prompt + Pydantic schema;
    returns a validated instance of that schema. All retry / circuit-
    breaker logic lives in ``_gemini_resilience.gemini_call`` and wraps
    a no-arg lambda that calls this method.
    """

    provider: str = "gemini"

    def __init__(self, api_key: str, model: str) -> None:
        # Lazy import — keep the dependency on google-genai out of the
        # import graph for callers that never invoke the LLM (tests with
        # no API key, heuristic-only paths).
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self.model = model

    def generate_json(
        self,
        *,
        prompt: str,
        system_instruction: str,
        schema: Type[T],
        temperature: float = 0.3,
        model: Optional[str] = None,
    ) -> T:
        primary = model or self.model
        # Build the try-list. Configured model first, then non-duplicate
        # fallbacks. If a fallback succeeds, we DON'T promote it to the
        # client's default — the deploy/env intentionally picked the
        # primary name, and silently swapping it would hide misconfig.
        candidates = [primary] + [m for m in _FALLBACK_MODELS if m != primary]
        last_exc: Exception | None = None
        for candidate in candidates:
            try:
                return self._call(candidate, prompt, system_instruction, schema, temperature)
            except Exception as exc:  # noqa: BLE001 - inspect message
                last_exc = exc
                if not _is_model_not_found(exc):
                    raise
                logger.warning(
                    "llm.model_not_found.try_fallback",
                    extra={
                        "event": "llm.model_not_found.try_fallback",
                        "missing": candidate,
                        "error": str(exc)[:160],
                    },
                )
        # Every candidate 404'd. Re-raise so the resilience wrapper can
        # surface the issue and the agent falls back to heuristic.
        assert last_exc is not None
        raise last_exc

    def _call(
        self,
        model: str,
        prompt: str,
        system_instruction: str,
        schema: Type[T],
        temperature: float,
    ) -> T:
        response = self._client.models.generate_content(
            model=model,
            contents=prompt,
            config={
                "system_instruction": system_instruction,
                "response_mime_type": "application/json",
                "response_schema": schema,
                "temperature": temperature,
            },
        )
        return _parse_to_schema(response, schema)


def _is_model_not_found(exc: Exception) -> bool:
    """True when the exception is a 404 for the requested model name."""
    msg = str(exc)
    return "404" in msg and ("NOT_FOUND" in msg or "not found" in msg.lower())


def _parse_to_schema(response, schema: Type[T]) -> T:
    """Pull the parsed-JSON object off a Gemini response.

    The SDK exposes parsed text on ``.text``; some versions also expose
    a pre-parsed ``.parsed`` attribute (dict OR a schema instance).
    Strips a leading ```json code fence if present.
    """
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, schema):
        return parsed
    if isinstance(parsed, dict):
        return schema.model_validate(parsed)

    text = getattr(response, "text", None)
    if not text:
        raise RuntimeError("Gemini returned no text")

    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return schema.model_validate_json(cleaned)
    return schema.model_validate(data)


# --- Factory + cache ---------------------------------------------------

_lock = threading.Lock()
_cached_client: Optional[LLMClient] = None
_cached_key: Optional[str] = None


def get_llm_client() -> Optional[LLMClient]:
    """Return the active LLM client, or ``None`` when no API key is set.

    Cached per API key — env-var changes (tests, config reload) take
    effect on the next call without a restart.
    """
    global _cached_client, _cached_key
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    with _lock:
        if _cached_client is not None and _cached_key == api_key:
            return _cached_client

        model = os.environ.get("GEMINI_MODEL", "").strip() or _DEFAULT_MODEL
        try:
            client = LLMClient(api_key=api_key, model=model)
        except ImportError as exc:
            logger.warning(
                "llm.import_failed",
                extra={"event": "llm.import_failed", "error": str(exc)},
            )
            return None

        logger.info(
            "llm.client_initialized",
            extra={"event": "llm.client_initialized", "provider": client.provider, "model": client.model},
        )
        _cached_client = client
        _cached_key = api_key
        return _cached_client


def get_provider_info() -> dict:
    """Snapshot of the active provider for the /api/health endpoint."""
    client = get_llm_client()
    if client is None:
        return {"provider": None, "model": None, "ready": False}
    return {"provider": client.provider, "model": client.model, "ready": True}


def reset_cache() -> None:
    """Test helper — wipe the memoized client so env-var changes apply."""
    global _cached_client, _cached_key
    with _lock:
        _cached_client = None
        _cached_key = None
