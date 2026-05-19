"""Tests for the Gemini narration path in `decision_agent`.

Key invariant: **decision color and riskScore are always heuristic.** The
LLM only writes summary/reasons/recommendedAction. These tests verify
that invariant — a misbehaving LLM that returns the "wrong" color in its
text never affects `response.decision` because the field comes from
`_compute_decision`, not from the LLM.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional, Type

from pydantic import BaseModel

from app.agents import decision_agent
from app.models.schemas import (
    AgentFinding,
    AgentResult,
    AnalyzeRequest,
)


def _req() -> AnalyzeRequest:
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
            "reviews": [],
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


class _FakeClient:
    """LLMClient stub — see test_review_agent_gemini for the same shape."""

    provider = "gemini"
    model = "gemini-2.5-flash"

    def __init__(self, response_dict=None, response_text: Optional[str] = None):
        self._response_dict = response_dict
        self._response_text = response_text
        self.last_call = None

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


# ---------- Gemini path: narration is used, decision is heuristic ----------


def test_uses_gemini_narration_but_keeps_heuristic_decision(monkeypatch):
    narration = {
        "summary": "Reklam fiyat geçmişiyle örtüşmüyor; bütçenin sınırına yakınsın.",
        "reasons": [
            "Yorumlarda jenerik dil oranı yüksek.",
            "Etiketteki indirim 30 günlük ortalamayla uyumsuz.",
            "Bu satın alma kategori limitini aşırı zorluyor.",
        ],
        "recommendedAction": "30 saniye düşünüp tekrar bak.",
    }
    fake_client = _FakeClient(response_dict=narration)
    monkeypatch.setattr(decision_agent, "get_llm_client", lambda: fake_client)

    # Heuristic with these scores yields red (price=80 alone triggers ≥70 floor).
    resp = decision_agent.run(
        _req(),
        review=_agent(70),
        price=_agent(85),
        budget=_agent(60),
        impulse=_agent(50),
    )

    assert resp.decision == "red"  # comes from _compute_decision, NOT from LLM
    assert resp.riskScore >= 70
    assert resp.summary == "Reklam fiyat geçmişiyle örtüşmüyor; bütçenin sınırına yakınsın."
    assert resp.reasons == narration["reasons"]
    assert resp.recommendedAction == "30 saniye düşünüp tekrar bak."

    # decisionAgent in the agent map is also heuristic (not from LLM).
    assert resp.agents.decisionAgent.label == "Kırmızı"
    assert resp.agents.decisionAgent.score == resp.riskScore


def test_llm_color_word_in_text_does_not_override_real_decision(monkeypatch):
    """Even if Gemini's text says 'yeşil', the decision field stays red."""
    rogue = {
        "summary": "Bu satın alma bence yeşildir, gönül rahatlığıyla al!",
        "reasons": ["a" * 10, "b" * 10],
        "recommendedAction": "Satın al",
    }
    monkeypatch.setattr(decision_agent, "get_llm_client", lambda: _FakeClient(response_dict=rogue))

    resp = decision_agent.run(
        _req(),
        review=_agent(90),
        price=_agent(90),
        budget=_agent(95),
        impulse=_agent(80),
    )
    assert resp.decision == "red"


# ---------- Gemini path: extra reasons get trimmed to 3 ----------


def test_trims_excess_reasons_to_three(monkeypatch):
    narration = {
        "summary": "Dengeli görünüyor ama birkaç şey kontrol edilebilir.",
        "reasons": ["sebep 1", "sebep 2", "sebep 3", "sebep 4"],
        "recommendedAction": "Birkaç noktayı tekrar gözden geçir",
    }
    monkeypatch.setattr(decision_agent, "get_llm_client", lambda: _FakeClient(response_dict=narration))

    resp = decision_agent.run(
        _req(),
        review=_agent(40),
        price=_agent(50),
        budget=_agent(45),
        impulse=_agent(40),
    )
    assert resp.decision == "yellow"
    assert len(resp.reasons) == 3
    assert resp.reasons[-1] == "sebep 3"


# ---------- Fallback path: Gemini error → heuristic narration ----------


def test_falls_back_to_heuristic_narration_on_gemini_error(monkeypatch):
    class _ExplodingClient:
        provider = "gemini"
        model = "gemini-2.5-flash"

        def generate_json(self, **kwargs):
            raise RuntimeError("simulated outage")

    monkeypatch.setattr(decision_agent, "get_llm_client", lambda: _ExplodingClient())

    resp = decision_agent.run(
        _req(),
        review=_agent(10),
        price=_agent(15),
        budget=_agent(5),
        impulse=_agent(10),
    )

    # Green decision (low scores) — heuristic summary text matches the template.
    assert resp.decision == "green"
    assert resp.summary == "Bu satın alma düşük riskli görünüyor."
    assert resp.recommendedAction == "Satın almaya devam edebilirsin"


# ---------- Fallback path: bad JSON in text → heuristic ----------


def test_falls_back_when_response_unparseable(monkeypatch):
    # FakeClient with neither dict nor text → raises ValidationError-equivalent
    # in the production path, which the agent catches and falls back to
    # heuristic narration.
    monkeypatch.setattr(
        decision_agent, "get_llm_client", lambda: _FakeClient(response_text="not even json {{{")
    )

    resp = decision_agent.run(
        _req(),
        review=_agent(60),
        price=_agent(55),
        budget=_agent(50),
        impulse=_agent(55),
    )

    # Heuristic yellow path produces the templated summary.
    assert resp.decision == "yellow"
    assert resp.summary == "Devam etmeden önce birkaç noktayı kontrol et."


# ---------- No API key path runs heuristic narration ----------


def test_no_key_runs_heuristic_path(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    from app.agents._gemini_client import reset_cache
    reset_cache()

    resp = decision_agent.run(
        _req(),
        review=_agent(10),
        price=_agent(15),
        budget=_agent(20),
        impulse=_agent(10),
    )
    assert resp.decision == "green"
    assert resp.summary  # heuristic template, non-empty
