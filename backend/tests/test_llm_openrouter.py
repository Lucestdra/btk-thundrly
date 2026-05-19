"""OpenRouter provider wiring for the shared LLM client."""

from __future__ import annotations

import json

import httpx
from pydantic import BaseModel

from app.agents import _llm


class _Out(BaseModel):
    ok: bool
    message: str


def test_openrouter_key_takes_precedence_over_direct_gemini(monkeypatch):
    calls: list[httpx.Request] = []
    real_init = httpx.Client.__init__

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps({"ok": True, "message": "done"})}}
                ]
            },
        )

    def fake_init(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "__init__", fake_init)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test")
    monkeypatch.setenv("OPENROUTER_MODEL", "google/gemini-2.5-flash")
    monkeypatch.setenv("GEMINI_API_KEY", "stale-direct-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-1.5-flash")
    _llm.reset_cache()

    client = _llm.get_llm_client()
    assert client is not None
    assert client.provider == "openrouter"
    assert client.model == "google/gemini-2.5-flash"

    out = client.generate_json(prompt="x", system_instruction="y", schema=_Out)
    assert out == _Out(ok=True, message="done")
    assert calls
    assert calls[0].headers["authorization"] == "Bearer or-test"

    _llm.reset_cache()
