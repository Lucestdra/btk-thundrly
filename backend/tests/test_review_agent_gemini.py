"""Tests for the Gemini-backed `review_agent` dispatch.

We don't need a real Gemini API key — we mock `get_client` so the dispatch
goes through the LLM path, and stub `client.models.generate_content` to
return a canned response. This verifies:

  - When a client is available, `run()` uses the Gemini path and parses the
    structured response into an `AgentResult`.
  - When the Gemini call raises, `run()` silently falls back to heuristics
    (so production never errors out on an LLM hiccup).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional

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


class _FakeResponse:
    """Mimics the surface of `genai.GenerateContentResponse` we depend on."""

    def __init__(self, parsed=None, text: Optional[str] = None):
        self.parsed = parsed
        self.text = text or ""


class _FakeModels:
    def __init__(self, response: _FakeResponse):
        self._response = response
        self.last_call = None  # for assertions

    def generate_content(self, *, model, contents, config):
        self.last_call = SimpleNamespace(model=model, contents=contents, config=config)
        return self._response


class _FakeClient:
    def __init__(self, response: _FakeResponse):
        self.models = _FakeModels(response)


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
    fake_client = _FakeClient(_FakeResponse(parsed=parsed))
    monkeypatch.setattr(review_agent, "get_client", lambda: fake_client)

    result = review_agent.run(_build_req_with_reviews())

    assert result.score == 73
    assert result.label == "Şüpheli"
    assert [f.severity for f in result.findings] == ["risk", "warn"]
    assert "jenerik" in result.findings[0].message

    # The prompt was constructed and sent through.
    call = fake_client.models.last_call
    assert call.model.startswith("gemini-")
    assert "Aşağıdaki Türk e-ticaret yorumlarını" in call.contents
    assert call.config["response_mime_type"] == "application/json"


# ---------- Gemini path: JSON-string fallback parsing ----------


def test_run_parses_text_when_parsed_field_missing(monkeypatch):
    json_text = (
        '{"score": 22, "label": "Güvenilir", '
        '"findings": [{"severity": "info", "message": "Yorumlar detaylı ve dağınık tarihli."}]}'
    )
    fake_client = _FakeClient(_FakeResponse(parsed=None, text=json_text))
    monkeypatch.setattr(review_agent, "get_client", lambda: fake_client)

    result = review_agent.run(_build_req_with_reviews())

    assert result.score == 22
    assert result.label == "Güvenilir"
    assert result.findings[0].severity == "info"


# ---------- Fallback path: any Gemini error → heuristics ----------


def test_run_falls_back_to_heuristics_on_gemini_error(monkeypatch):
    class _ExplodingClient:
        @property
        def models(self):  # accessed by _run_with_gemini
            raise RuntimeError("simulated Gemini outage")

    monkeypatch.setattr(review_agent, "get_client", lambda: _ExplodingClient())

    result = review_agent.run(_build_req_with_reviews())

    # Heuristic path produces a real score; the important assertion is that
    # we did not raise and we got a sane result.
    assert 0 <= result.score <= 100
    assert result.label  # non-empty
    assert len(result.findings) >= 1


# ---------- Fallback path: empty reviews shortcut never calls Gemini ----------


def test_run_skips_gemini_when_no_reviews(monkeypatch):
    called = {"flag": False}

    class _MarkerClient:
        @property
        def models(self):
            called["flag"] = True
            raise AssertionError("should not be reached")

    monkeypatch.setattr(review_agent, "get_client", lambda: _MarkerClient())

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
