"""Tests for the LLM-backed `review_agent` dispatch.

We don't need a real Gemini API key — we mock `get_llm_client` so the
dispatch goes through the LLM path, and stub the returned client's
`generate_json` to hand back a canned Pydantic model. This verifies:

  - When a client is available, `run()` uses the LLM path and parses
    the structured response into an `AgentResult`.
  - When the LLM call raises, `run()` silently falls back to heuristics
    (so production never errors out on an LLM hiccup).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional, Type

from pydantic import BaseModel

from app.agents import review_agent
from app.models.schemas import AnalyzeRequest, Review


def _build_req_with_reviews() -> AnalyzeRequest:
    """Minimal AnalyzeRequest with enough reviews to exercise both paths."""
    return AnalyzeRequest.model_validate(
        {
            "userId": "test",
            "platform": "trendyol",
            "product": {
                "title": "Test ürünü",
                "price": 500,
                "currency": "TRY",
                "category": "Giyim",
                "url": "https://example.com/p-1",
            },
            "reviews": [
                {"rating": 5, "text": "Çok güzel ürün hızlı kargo", "date": "2026-05-10"},
                {"rating": 5, "text": "Hızlı kargo süper kalite", "date": "2026-05-10"},
                {"rating": 4, "text": "Beden olarak biraz büyük geldi.", "date": "2026-04-22"},
            ],
            "priceHistory": [],
            "userBudget": {
                "monthlyLimit": 5000,
                "categoryLimit": 2000,
                "categorySpent": 100,
                "monthlySpent": 200,
                "currency": "TRY",
            },
            "session": {
                "timeOnPageSeconds": 60,
                "clickSpeedMs": 1000,
                "currentHour": 14,
                "purchasesToday": 0,
            },
        }
    )


class _FakeClient:
    """Mimics the LLMClient surface used by review_agent.

    Captures the last call so tests can assert on the prompt + schema
    that flowed through. ``response_dict`` is what the LLM "returned" —
    we validate it against the requested schema, same as production.
    ``response_text`` is an alternative: a JSON string that hits the
    same code path as a model that didn't pre-parse.
    """

    provider = "gemini"
    model = "gemini-2.5-flash"

    def __init__(self, response_dict=None, response_text: Optional[str] = None):
        self._response_dict = response_dict
        self._response_text = response_text
        self.last_call = None  # for assertions

    def generate_json(self, *, prompt, system_instruction, schema: Type[BaseModel], temperature=0.3, model=None):
        self.last_call = SimpleNamespace(
            prompt=prompt,
            system_instruction=system_instruction,
            schema=schema,
            temperature=temperature,
            model=model or self.model,
        )
        if self._response_dict is not None:
            return schema.model_validate(self._response_dict)
        if self._response_text is not None:
            return schema.model_validate_json(self._response_text)
        raise AssertionError("FakeClient was not given a response")


# ---------- Gemini path: structured response is parsed correctly ----------


def test_run_uses_gemini_when_client_available(monkeypatch):
    parsed = {
        "score": 73,
        "label": "Şüpheli",
        "findings": [
            {"severity": "risk", "message": "Yorumların yarısı jenerik ifade içeriyor."},
            {"severity": "warn", "message": "5 yıldız + kısa metin yoğunluğu yüksek."},
        ],
    }
    fake_client = _FakeClient(response_dict=parsed)
    monkeypatch.setattr(review_agent, "get_llm_client", lambda: fake_client)

    result = review_agent.run(_build_req_with_reviews())

    assert result.score == 73
    assert result.label == "Şüpheli"
    # The two findings Gemini returned, plus an always-appended trust
    # headline so downstream UI / decision_agent has a stable summary line.
    severities = [f.severity for f in result.findings]
    assert severities[:2] == ["risk", "warn"]
    assert "jenerik" in result.findings[0].message
    assert "Güven skoru" in result.findings[-1].message

    # The prompt was constructed and sent through.
    call = fake_client.last_call
    assert call.model.startswith("gemini-")
    assert "Aşağıdaki Türk e-ticaret yorumlarını" in call.prompt
    assert call.schema is not None


# ---------- Gemini path: JSON-string fallback parsing ----------


def test_run_parses_text_when_parsed_field_missing(monkeypatch):
    json_text = (
        '{"score": 22, "label": "Güvenilir", '
        '"findings": [{"severity": "info", "message": "Yorumlar detaylı ve dağınık tarihli."}]}'
    )
    fake_client = _FakeClient(response_text=json_text)
    monkeypatch.setattr(review_agent, "get_llm_client", lambda: fake_client)

    result = review_agent.run(_build_req_with_reviews())

    assert result.score == 22
    assert result.label == "Güvenilir"
    assert result.findings[0].severity == "info"


# ---------- Fallback path: any Gemini error → heuristics ----------


def test_run_falls_back_to_heuristics_on_gemini_error(monkeypatch):
    class _ExplodingClient:
        provider = "gemini"
        model = "gemini-2.5-flash"

        def generate_json(self, **kwargs):
            raise RuntimeError("simulated Gemini outage")

    monkeypatch.setattr(review_agent, "get_llm_client", lambda: _ExplodingClient())

    result = review_agent.run(_build_req_with_reviews())

    # Heuristic path produces a real score; the important assertion is that
    # we did not raise and we got a sane result.
    assert 0 <= result.score <= 100
    assert result.label  # non-empty
    assert len(result.findings) >= 1


# ---------- Fallback path: empty reviews shortcut never calls LLM ----------


def test_run_skips_gemini_when_no_reviews(monkeypatch):
    called = {"flag": False}

    class _MarkerClient:
        provider = "gemini"
        model = "gemini-2.5-flash"

        def generate_json(self, **kwargs):
            called["flag"] = True
            raise AssertionError("should not be reached")

    monkeypatch.setattr(review_agent, "get_llm_client", lambda: _MarkerClient())

    req = _build_req_with_reviews().model_copy(update={"reviews": []})
    result = review_agent.run(req)

    assert called["flag"] is False
    assert result.label == "Yorum Verisi Yok"


# ---------- No API key: heuristics path is taken without any Gemini import ----------


def test_run_uses_heuristics_when_no_api_key(monkeypatch):
    # `get_client` already returns None in the test env (no GEMINI_API_KEY set
    # by conftest), but be explicit.
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    # Bypass the cached client just in case a previous test populated it.
    from app.agents._gemini_client import reset_cache
    reset_cache()

    result = review_agent.run(_build_req_with_reviews())
    # Heuristic-only outcome — anything in range is fine.
    assert 0 <= result.score <= 100
