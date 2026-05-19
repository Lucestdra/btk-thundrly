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

import httpx
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
]

_DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash"
_OPENROUTER_FALLBACK_MODELS = [
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
]
_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


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


class OpenRouterLLMClient:
    """OpenRouter-backed implementation of the same generate_json surface."""

    provider: str = "openrouter"

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model
        self._timeout = float(os.environ.get("OPENROUTER_TIMEOUT", "30.0"))

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
        candidates = [primary] + [m for m in _OPENROUTER_FALLBACK_MODELS if m != primary]
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
                        "provider": self.provider,
                        "missing": candidate,
                        "error": str(exc)[:160],
                    },
                )
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
        messages = [
            {"role": "system", "content": system_instruction},
            {
                "role": "user",
                "content": (
                    f"{prompt}\n\n"
                    "Return only a valid JSON object matching the requested schema."
                ),
            },
        ]
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": schema.__name__,
                    "strict": True,
                    "schema": schema.model_json_schema(),
                },
            },
        }
        data = self._post(payload)
        content = _openrouter_message_content(data)
        return _parse_text_to_schema(content, schema)

    def _post(self, payload: dict) -> dict:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        referer = os.environ.get("OPENROUTER_SITE_URL", "").strip()
        title = os.environ.get("OPENROUTER_APP_TITLE", "Thundrly").strip()
        if referer:
            headers["HTTP-Referer"] = referer
        if title:
            headers["X-OpenRouter-Title"] = title

        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(_OPENROUTER_URL, headers=headers, json=payload)
            if resp.status_code == 400 and "response_format" in resp.text:
                fallback = dict(payload)
                fallback["response_format"] = {"type": "json_object"}
                resp = client.post(_OPENROUTER_URL, headers=headers, json=fallback)
            if resp.status_code >= 400:
                raise RuntimeError(f"OpenRouter HTTP {resp.status_code}: {resp.text[:500]}")
            return resp.json()


def _is_model_not_found(exc: Exception) -> bool:
    """True when the exception is a 404 for the requested model name."""
    msg = str(exc)
    lower = msg.lower()
    return (
        ("404" in msg and ("NOT_FOUND" in msg or "not found" in lower))
        or "no endpoints found" in lower
        or "not a valid model" in lower
        or "model not found" in lower
    )


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


def _parse_text_to_schema(text: str, schema: Type[T]) -> T:
    if not text:
        raise RuntimeError("LLM returned no text")
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


def _openrouter_message_content(data: dict) -> str:
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"OpenRouter response missing message content: {str(data)[:300]}") from exc
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content)


# --- Factory + cache ---------------------------------------------------

_lock = threading.Lock()
_cached_client: Optional[object] = None
_cached_key: Optional[tuple[str, str, str]] = None


def get_llm_client():
    """Return the active LLM client, or ``None`` when no API key is set.

    Cached per API key — env-var changes (tests, config reload) take
    effect on the next call without a restart.
    """
    global _cached_client, _cached_key
    provider_pref = os.environ.get("LLM_PROVIDER", "auto").strip().lower() or "auto"
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()

    use_openrouter = provider_pref == "openrouter" or (provider_pref == "auto" and bool(openrouter_key))
    if use_openrouter:
        provider = "openrouter"
        api_key = openrouter_key
        model = os.environ.get("OPENROUTER_MODEL", "").strip() or _DEFAULT_OPENROUTER_MODEL
    else:
        provider = "gemini"
        api_key = gemini_key
        model = os.environ.get("GEMINI_MODEL", "").strip() or _DEFAULT_MODEL

    if not api_key:
        return None
    cache_key = (provider, api_key, model)

    with _lock:
        if _cached_client is not None and _cached_key == cache_key:
            return _cached_client

        try:
            if provider == "openrouter":
                client = OpenRouterLLMClient(api_key=api_key, model=model)
            else:
                client = LLMClient(api_key=api_key, model=model)
        except ImportError as exc:
            logger.warning(
                "llm.import_failed",
                extra={"event": "llm.import_failed", "provider": provider, "error": str(exc)},
            )
            return None

        logger.info(
            "llm.client_initialized",
            extra={"event": "llm.client_initialized", "provider": client.provider, "model": client.model},
        )
        _cached_client = client
        _cached_key = cache_key
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
