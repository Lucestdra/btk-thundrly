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

import pytest

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


class _CountingClient:
    """LLMClient stub with a call counter for cache-hit assertions.

    Validates ``response_dict`` against the requested schema on every
    call (same path production takes), and bumps ``call_count`` so the
    test can assert cached calls don't re-invoke ``generate_json``.
    """

    provider = "gemini"
    model = "gemini-2.5-flash"

    def __init__(self, response_dict):
        self._response_dict = response_dict
        self.call_count = 0

    def generate_json(self, *, prompt, system_instruction, schema, temperature=0.3, model=None):  # noqa: ARG002
        self.call_count += 1
        return schema.model_validate(self._response_dict)


# ---------- review_agent: cache prevents second call ----------


def test_review_agent_caches_on_same_reviews(monkeypatch):
    parsed = {
        "score": 60,
        "label": "Şüpheli",
        "findings": [{"severity": "warn", "message": "tekrar oranı yüksek"}],
    }
    client = _CountingClient(response_dict=parsed)
    monkeypatch.setattr(review_agent, "get_llm_client", lambda: client)

    req = _req_with_reviews()

    first = review_agent.run(req)
    second = review_agent.run(req)

    assert first.score == 60
    assert second.score == 60
    # Single LLM round-trip across two calls — second was served from cache.
    assert client.call_count == 1


def test_review_agent_cache_misses_on_different_reviews(monkeypatch):
    parsed = {
        "score": 40,
        "label": "Büyük Ölçüde Güvenilir",
        "findings": [{"severity": "info", "message": "ok"}],
    }
    client = _CountingClient(response_dict=parsed)
    monkeypatch.setattr(review_agent, "get_llm_client", lambda: client)

    a = _req_with_reviews()
    b = a.model_copy(
        update={"reviews": [Review(rating=4, text="farklı yorum", date="2026-04-01")]},
    )

    review_agent.run(a)
    review_agent.run(b)
    assert client.call_count == 2


# ---------- decision_agent: cache prevents second narration call ----------


def test_decision_agent_caches_on_same_agent_fingerprint(monkeypatch):
    narration = {
        "summary": "Birkaç sinyal kontrol edilmeli ama acil değil.",
        "reasons": ["sebep 1", "sebep 2", "sebep 3"],
        "recommendedAction": "Birkaç noktayı tekrar gözden geçir",
    }
    client = _CountingClient(response_dict=narration)
    monkeypatch.setattr(decision_agent, "get_llm_client", lambda: client)

    req = _req_with_reviews()
    review_r = _agent(40)
    price_r = _agent(50)
    budget_r = _agent(45)
    impulse_r = _agent(40)

    decision_agent.run(req, review=review_r, price=price_r, budget=budget_r, impulse=impulse_r)
    decision_agent.run(req, review=review_r, price=price_r, budget=budget_r, impulse=impulse_r)

    assert client.call_count == 1


def test_decision_agent_cache_misses_on_different_agent_fingerprint(monkeypatch):
    narration = {
        "summary": "ok",
        "reasons": ["a", "b", "c"],
        "recommendedAction": "Birkaç noktayı tekrar gözden geçir",
    }
    client = _CountingClient(response_dict=narration)
    monkeypatch.setattr(decision_agent, "get_llm_client", lambda: client)

    req = _req_with_reviews()

    decision_agent.run(req, review=_agent(40), price=_agent(50), budget=_agent(45), impulse=_agent(40))
    # Bump price.score → fingerprint differs → cache miss.
    decision_agent.run(req, review=_agent(40), price=_agent(85), budget=_agent(45), impulse=_agent(40))

    assert client.call_count == 2


# ---------- TTLCache: counters, prefix/predicate invalidation, per-call TTL ----------


def test_ttl_cache_counts_hits_and_misses():
    c = TTLCache(max_size=4, ttl_seconds=60, namespace="t")
    c.set("a", 1)
    c.get("a")  # hit
    c.get("a")  # hit
    c.get("missing")  # miss
    stats = c.stats()
    assert stats["hits"] == 2
    assert stats["misses"] == 1
    assert stats["sets"] == 1
    assert stats["size"] == 1
    assert stats["hit_rate"] == pytest.approx(2 / 3, abs=1e-3)


def test_ttl_cache_expired_get_counts_as_miss():
    c = TTLCache(max_size=4, ttl_seconds=0.02)
    c.set("a", 1)
    time.sleep(0.04)
    assert c.get("a") is None
    assert c.stats()["misses"] == 1
    assert c.stats()["hits"] == 0


def test_ttl_cache_per_call_ttl_overrides_default():
    c = TTLCache(max_size=4, ttl_seconds=60)
    c.set("short", 1, ttl=0.02)
    c.set("long", 2)  # uses default 60s
    time.sleep(0.04)
    assert c.get("short") is None
    assert c.get("long") == 2


def test_ttl_cache_invalidate_prefix():
    c = TTLCache(max_size=10, ttl_seconds=60)
    c.set("dec::u=alice:p=h1:x", 1)
    c.set("dec::u=alice:p=h2:y", 2)
    c.set("dec::u=bob:p=h1:z", 3)
    removed = c.invalidate_prefix("dec::u=alice:")
    assert removed == 2
    assert c.get("dec::u=alice:p=h1:x") is None
    assert c.get("dec::u=bob:p=h1:z") == 3
    assert c.stats()["invalidations"] == 2


def test_ttl_cache_invalidate_predicate():
    c = TTLCache(max_size=10, ttl_seconds=60)
    c.set("dec::u=alice:p=h1:x", 1)
    c.set("dec::u=alice:p=h2:y", 2)
    c.set("dec::u=bob:p=h2:z", 3)
    removed = c.invalidate_predicate(lambda k: isinstance(k, str) and ":p=h2:" in k)
    assert removed == 2
    assert c.get("dec::u=alice:p=h1:x") == 1


# ---------- Cross-cutting invalidation helpers ----------


def test_invalidate_for_user_only_drops_target_user(monkeypatch):
    from app.core import cache as cache_mod

    # Two users, each with one cached decision narration.
    cache_mod.gemini_cache.set("dec::u=alice:p=h1:digest", "alice-narration")
    cache_mod.gemini_cache.set("dec::u=bob:p=h1:digest", "bob-narration")

    dropped = cache_mod.invalidate_for_user("alice")
    assert dropped == 1
    assert cache_mod.gemini_cache.get("dec::u=alice:p=h1:digest") is None
    assert cache_mod.gemini_cache.get("dec::u=bob:p=h1:digest") == "bob-narration"


def test_invalidate_for_url_only_drops_target_url():
    from app.core import cache as cache_mod

    cache_mod.gemini_cache.set("dec::u=alice:p=hA:1", "a-on-hA")
    cache_mod.gemini_cache.set("dec::u=alice:p=hB:2", "a-on-hB")
    cache_mod.gemini_cache.set("rev::u=alice:p=hA:3", "rev-on-hA")

    dropped = cache_mod.invalidate_for_url("hA")
    assert dropped == 2  # dec + rev for hA
    assert cache_mod.gemini_cache.get("dec::u=alice:p=hB:2") == "a-on-hB"


# ---------- force_refresh bypasses the cache ----------


def test_review_agent_force_refresh_bypasses_cache(monkeypatch):
    parsed = {
        "score": 50,
        "label": "Şüpheli",
        "findings": [{"severity": "warn", "message": "tekrar"}],
    }
    client = _CountingClient(response_dict=parsed)
    monkeypatch.setattr(review_agent, "get_llm_client", lambda: client)

    req = _req_with_reviews()
    review_agent.run(req)
    review_agent.run(req)  # cache hit
    assert client.call_count == 1

    review_agent.run(req, force_refresh=True)
    assert client.call_count == 2


def test_decision_agent_force_refresh_bypasses_cache(monkeypatch):
    narration = {
        "summary": "Birkaç sinyal kontrol edilmeli.",
        "reasons": ["a", "b", "c"],
        "recommendedAction": "Birkaç noktayı tekrar gözden geçir",
    }
    client = _CountingClient(response_dict=narration)
    monkeypatch.setattr(decision_agent, "get_llm_client", lambda: client)

    req = _req_with_reviews()
    decision_agent.run(req, review=_agent(40), price=_agent(50), budget=_agent(45), impulse=_agent(40))
    decision_agent.run(req, review=_agent(40), price=_agent(50), budget=_agent(45), impulse=_agent(40))
    assert client.call_count == 1

    decision_agent.run(
        req,
        review=_agent(40),
        price=_agent(50),
        budget=_agent(45),
        impulse=_agent(40),
        force_refresh=True,
    )
    assert client.call_count == 2
