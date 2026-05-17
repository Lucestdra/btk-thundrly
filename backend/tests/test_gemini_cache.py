"""Cache-behavior tests for the Gemini response cache.

Two layers covered:

  1. `TTLCache` itself — get/set/expire/eviction semantics.
  2. End-to-end: calling `review_agent.run` / `decision_agent.run` twice
     with the same input must produce **one** Gemini call. A third call
     with different input must produce a second Gemini call.
"""

from __future__ import annotations

import time
from types import SimpleNamespace
from typing import Optional

from app.agents import decision_agent, review_agent
from app.core.cache import TTLCache
from app.models.schemas import (
    AgentFinding,
    AgentResult,
    AnalyzeRequest,
    Review,
)


# ---------- TTLCache unit semantics ----------


def test_ttl_cache_basic_get_set():
    c = TTLCache(max_size=4, ttl_seconds=60)
    c.set("a", 1)
    assert c.get("a") == 1
    assert c.get("missing") is None


def test_ttl_cache_expires():
    c = TTLCache(max_size=4, ttl_seconds=0.05)
    c.set("a", 1)
    assert c.get("a") == 1
    time.sleep(0.07)
    assert c.get("a") is None  # expired and pruned


def test_ttl_cache_lru_eviction():
    c = TTLCache(max_size=2, ttl_seconds=60)
    c.set("a", 1)
    c.set("b", 2)
    # touch 'a' so it becomes most-recently-used
    assert c.get("a") == 1
    c.set("c", 3)  # forces eviction of LRU which is now 'b'
    assert c.get("b") is None
    assert c.get("a") == 1
    assert c.get("c") == 3


# ---------- Shared fakes for agent-level tests ----------


def _req_with_reviews() -> AnalyzeRequest:
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


def _agent(score: int, label: str = "test", findings=None) -> AgentResult:
    return AgentResult(
        score=score,
        label=label,
        findings=findings or [AgentFinding(severity="warn", message=f"finding-{score}")],
    )


class _CountingResponse:
    def __init__(self, parsed=None, text: Optional[str] = None):
        self.parsed = parsed
        self.text = text or ""


class _CountingModels:
    def __init__(self, response: _CountingResponse):
        self._response = response
        self.call_count = 0

    def generate_content(self, *, model, contents, config):  # noqa: ARG002
        self.call_count += 1
        return self._response


class _CountingClient:
    def __init__(self, response: _CountingResponse):
        self.models = _CountingModels(response)


# ---------- review_agent: cache prevents second call ----------


def test_review_agent_caches_on_same_reviews(monkeypatch):
    parsed = {
        "score": 60,
        "label": "Şüpheli",
        "findings": [{"severity": "warn", "message": "tekrar oranı yüksek"}],
    }
    client = _CountingClient(_CountingResponse(parsed=parsed))
    monkeypatch.setattr(review_agent, "get_client", lambda: client)

    req = _req_with_reviews()

    first = review_agent.run(req)
    second = review_agent.run(req)

    assert first.score == 60
    assert second.score == 60
    # Single LLM round-trip across two calls — second was served from cache.
    assert client.models.call_count == 1


def test_review_agent_cache_misses_on_different_reviews(monkeypatch):
    parsed = {
        "score": 40,
        "label": "Büyük Ölçüde Güvenilir",
        "findings": [{"severity": "info", "message": "ok"}],
    }
    client = _CountingClient(_CountingResponse(parsed=parsed))
    monkeypatch.setattr(review_agent, "get_client", lambda: client)

    a = _req_with_reviews()
    b = a.model_copy(
        update={"reviews": [Review(rating=4, text="farklı yorum", date="2026-04-01")]},
    )

    review_agent.run(a)
    review_agent.run(b)
    assert client.models.call_count == 2


# ---------- decision_agent: cache prevents second narration call ----------


def test_decision_agent_caches_on_same_agent_fingerprint(monkeypatch):
    narration = {
        "summary": "Birkaç sinyal kontrol edilmeli ama acil değil.",
        "reasons": ["sebep 1", "sebep 2", "sebep 3"],
        "recommendedAction": "Birkaç noktayı tekrar gözden geçir",
    }
    client = _CountingClient(_CountingResponse(parsed=narration))
    monkeypatch.setattr(decision_agent, "get_client", lambda: client)

    req = _req_with_reviews()
    review_r = _agent(40)
    price_r = _agent(50)
    budget_r = _agent(45)
    impulse_r = _agent(40)

    decision_agent.run(req, review=review_r, price=price_r, budget=budget_r, impulse=impulse_r)
    decision_agent.run(req, review=review_r, price=price_r, budget=budget_r, impulse=impulse_r)

    assert client.models.call_count == 1


def test_decision_agent_cache_misses_on_different_agent_fingerprint(monkeypatch):
    narration = {
        "summary": "ok",
        "reasons": ["a", "b", "c"],
        "recommendedAction": "Birkaç noktayı tekrar gözden geçir",
    }
    client = _CountingClient(_CountingResponse(parsed=narration))
    monkeypatch.setattr(decision_agent, "get_client", lambda: client)

    req = _req_with_reviews()

    decision_agent.run(req, review=_agent(40), price=_agent(50), budget=_agent(45), impulse=_agent(40))
    # Bump price.score → fingerprint differs → cache miss.
    decision_agent.run(req, review=_agent(40), price=_agent(85), budget=_agent(45), impulse=_agent(40))

    assert client.models.call_count == 2
