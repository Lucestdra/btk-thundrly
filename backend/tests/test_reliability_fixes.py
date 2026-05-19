"""Regression tests for the May-2026 backend reliability sprint.

Covers the behaviors that landed together to make the panel meaningful
on real first-visit products (rather than showing a fake-confident
verdict against an empty evidence base):

* Impulse thresholds relaxed: real human clicks (100-200ms) no longer flag.
* Price agent emits "Tek Veri Noktası" (less alarming) when we know the
  current price but lack history.
* Decision agent damps to <=55 risk when ≥2 signal agents return
  "no data" labels.
* Akakçe `_extract_current_price` salvages a single point from JSON-LD
  / microdata / loose-scan when the time-series array is missing.
"""

from __future__ import annotations

from app.agents import decision_agent, impulse_agent, price_agent
from app.models.schemas import (
    AgentFinding,
    AgentResult,
    AnalyzeRequest,
)
from app.services import external_price_history


# ---------- impulse_agent: relaxed thresholds ----------


def _req_with_session(**session_overrides) -> AnalyzeRequest:
    session = {
        "timeOnPageSeconds": 60,
        "clickSpeedMs": 200,
        "currentHour": 14,
        "purchasesToday": 0,
        "searchedBefore": False,
        **session_overrides,
    }
    return AnalyzeRequest.model_validate(
        {
            "userId": "u",
            "platform": "trendyol",
            "product": {
                "title": "Test",
                "price": 100,
                "currency": "TRY",
                "category": "Giyim",
                "url": "https://example.com/p-1",
            },
            "reviews": [],
            "priceHistory": [],
            "session": session,
        }
    )


def test_impulse_does_not_flag_real_human_click_at_150ms():
    """100-250ms is the normal mousedown→click delta for an intentional click."""
    result = impulse_agent.run(_req_with_session(clickSpeedMs=150))
    msgs = " ".join(f.message for f in result.findings)
    assert "anormal hızlı" not in msgs
    # No click-speed bump → impulse score should be modest.
    assert result.score < 25


def test_impulse_still_flags_synthetic_30ms_click():
    """Sub-60ms click = programmatic / form-fill — keep flagging."""
    result = impulse_agent.run(_req_with_session(clickSpeedMs=30))
    msgs = " ".join(f.message for f in result.findings)
    assert "anormal hızlı" in msgs
    assert result.score >= 20


def test_impulse_flags_17s_dwell_as_light_signal():
    """17s should not be zero evidence, but it should stay a light signal."""
    result = impulse_agent.run(_req_with_session(timeOnPageSeconds=17))
    msgs = " ".join(f.message for f in result.findings)
    assert "karar süresi kısa" in msgs
    assert 0 < result.score < 25


def test_impulse_still_flags_under_8s_dwell():
    result = impulse_agent.run(_req_with_session(timeOnPageSeconds=5))
    msgs = " ".join(f.message for f in result.findings)
    assert "saniye" in msgs


def test_impulse_user_repro_17s_93ms_is_not_zero():
    result = impulse_agent.run(_req_with_session(timeOnPageSeconds=17, clickSpeedMs=93))
    assert result.score == 30
    assert result.label == "Karışık Sinyal"


# ---------- price_agent: single-data-point fallback ----------


def _price_req(price: float = 100.0, original=None, legal_min=None) -> AnalyzeRequest:
    return AnalyzeRequest.model_validate(
        {
            "userId": "u",
            "platform": "trendyol",
            "product": {
                "title": "Test",
                "price": price,
                "originalPrice": original,
                "currency": "TRY",
                "category": "Giyim",
                "url": "https://example.com/p-noh",
                "legalLowestPrice30d": legal_min,
            },
            "reviews": [],
            "priceHistory": [],
            "session": {
                "timeOnPageSeconds": 60,
                "clickSpeedMs": 200,
                "currentHour": 14,
                "purchasesToday": 0,
            },
        }
    )


def test_price_agent_single_point_label_when_no_history():
    """No history + no original-price claim + known displayed price →
    'Tek Veri Noktası' (neutral, accurate framing) rather than the more
    alarming 'Fiyat Geçmişi Yok'."""
    result = price_agent.run(_price_req(price=199.0))
    assert result.label == "Tek Veri Noktası"
    assert result.score == 0


def test_price_agent_fiyat_gecmisi_yok_only_when_truly_no_data():
    """If we have an original-price claim with no other source to
    cross-check, the existing 'Fiyat Geçmişi Yok' path is preserved
    when the price is 0 / unknown. Mostly defensive — extension
    guarantees a positive price."""
    result = price_agent.run(_price_req(price=0.0))
    assert result.label == "Fiyat Geçmişi Yok"


# ---------- decision_agent: low-data damping ----------


def _agent(score: int, label: str, *findings) -> AgentResult:
    return AgentResult(
        score=score,
        label=label,
        findings=list(findings) or [AgentFinding(severity="info", message="ok")],
    )


def test_decision_damps_to_yellow_when_two_agents_have_no_data():
    """Two of four agents return 'no data' labels. Even if one of the
    other two scored 90, the verdict should cap at 55 (yellow) rather
    than escalating to red — we don't have enough evidence."""
    decision, risk, _ = decision_agent._compute_decision(
        review=_agent(35, "Yorum Verisi Yok"),
        price=_agent(0, "Tek Veri Noktası"),
        budget=_agent(90, "Bütçe Aşımı"),
        impulse=_agent(20, "Planlı"),
    )
    assert risk <= 55
    assert decision in ("green", "yellow")


def test_decision_keeps_escalation_when_only_one_no_data():
    """One missing signal isn't enough to suppress escalation — the
    other three vote on real evidence."""
    decision, risk, _ = decision_agent._compute_decision(
        review=_agent(85, "Yüksek Manipülasyon Riski"),
        price=_agent(0, "Tek Veri Noktası"),
        budget=_agent(40, "Sınırda"),
        impulse=_agent(30, "Karışık Sinyal"),
    )
    # The single-agent escalation (review @ 85) should fire normally.
    assert risk >= 70
    assert decision == "red"


# ---------- Akakçe: current-price fallback ----------


def test_extract_current_price_from_json_ld():
    html = """
    <html><head>
      <script type="application/ld+json">
      {"@type": "Product", "offers": {"price": "1249.90", "priceCurrency": "TRY"}}
      </script>
    </head><body></body></html>
    """
    p = external_price_history._extract_current_price(html)
    assert p == 1249.90


def test_extract_current_price_from_microdata():
    html = """
    <span itemprop="price" content="299.00">₺299,00</span>
    """
    p = external_price_history._extract_current_price(html)
    assert p is not None
    assert abs(p - 299.0) < 0.01


def test_extract_current_price_returns_none_on_blank_page():
    assert external_price_history._extract_current_price("<html></html>") is None
