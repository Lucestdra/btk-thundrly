"""Multi-source suspicious-discount detection in price_agent.

Exercises the new ``_suspicious_discount_check`` helper through the
agent's public ``run`` entry point so we also verify the score-bump
and finding-tagging flow downstream of it.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.agents import price_agent
from app.models.schemas import AnalyzeRequest, PriceHistoryPoint


def _req(
    *,
    price: float,
    original: float | None,
    legal_min: float | None,
    history: list[tuple[str, float]] | None = None,
    comparisons: list[tuple[str, float]] | None = None,
) -> AnalyzeRequest:
    return AnalyzeRequest.model_validate(
        {
            "userId": "test",
            "platform": "trendyol",
            "product": {
                "title": "Test ürünü",
                "price": price,
                "originalPrice": original,
                "currency": "TRY",
                "category": "Elektronik",
                "url": "https://example.com/p-disc",
                "legalLowestPrice30d": legal_min,
            },
            "reviews": [],
            "priceHistory": [
                {"date": d, "price": p} for d, p in (history or [])
            ],
            "priceComparisons": [
                {"source": source, "price": p, "title": "Test ürünü"}
                for source, p in (comparisons or [])
            ],
            "session": {
                "timeOnPageSeconds": 60,
                "clickSpeedMs": 1000,
                "currentHour": 14,
                "purchasesToday": 0,
            },
        }
    )


def _today_minus(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


# ---------- helper-level coverage ----------


def test_helper_returns_none_when_claim_within_believable_band():
    result = price_agent._suspicious_discount_check(
        displayed_price=200,
        claimed_original=220,
        sources={"yasal min": 210},
    )
    assert result is None  # claim only 4.7% above real_base — believable


def test_helper_flags_when_claim_exceeds_15pct_of_real_base():
    result = price_agent._suspicious_discount_check(
        displayed_price=200,
        claimed_original=400,
        sources={"yasal min": 220},
    )
    assert result is not None
    assert result.tag == "suspiciousDiscount"
    assert "ŞÜPHELİ İNDİRİM" in result.message
    assert "yasal min" in result.message


def test_helper_severity_lifts_to_risk_when_two_sources_agree():
    result = price_agent._suspicious_discount_check(
        displayed_price=200,
        claimed_original=500,
        sources={"yasal min": 230, "30 gün medyanı": 240},  # agree within 10%
    )
    assert result is not None
    assert result.severity == "risk"


def test_helper_falls_back_to_warn_when_sole_source():
    result = price_agent._suspicious_discount_check(
        displayed_price=200,
        claimed_original=500,
        sources={"yasal min": 230},
    )
    assert result is not None
    assert result.severity == "warn"


# ---------- end-to-end through run() ----------


def test_run_emits_chip_finding_when_legal_min_and_history_agree():
    """Trendyol shows ₺499 → ₺199 (60% off claim); legal says lowest was ₺210;
    our DB history median is ₺220. Both sources confirm inflated original.
    """
    req = _req(
        price=199,
        original=499,
        legal_min=210,
        history=[(_today_minus(i), 220) for i in range(30)],
    )
    result = price_agent.run(req)
    tagged = [f for f in result.findings if f.tag == "suspiciousDiscount"]
    assert len(tagged) == 1
    assert tagged[0].severity == "risk"  # two-source agreement
    assert result.score >= 30  # bumped by the cross-check


def test_run_emits_chip_when_only_legal_min_disagrees_with_claim():
    """No DB history at all, but the on-page disclosure reveals an
    inflated claim — still surfaces the chip + lifts the score."""
    req = _req(
        price=199,
        original=499,
        legal_min=210,
        history=None,
    )
    result = price_agent.run(req)
    tagged = [f for f in result.findings if f.tag == "suspiciousDiscount"]
    assert len(tagged) == 1
    assert tagged[0].severity == "warn"  # single source → warn tier
    assert result.score == 55  # the dedicated "Şüpheli İndirim" verdict for no-history path
    assert result.label == "Şüpheli İndirim"


def test_run_does_not_emit_chip_when_discount_is_real():
    """₺199 → real history was ₺220 (similar), claim says ₺230. Honest
    small discount — no chip, no penalty."""
    req = _req(
        price=199,
        original=230,
        legal_min=220,
        history=[(_today_minus(i), 220) for i in range(30)],
    )
    result = price_agent.run(req)
    tagged = [f for f in result.findings if f.tag == "suspiciousDiscount"]
    assert tagged == []


def test_run_handles_missing_legal_min_gracefully():
    """legalLowestPrice30d is optional — agent must not crash when None."""
    req = _req(price=199, original=230, legal_min=None,
               history=[(_today_minus(i), 220) for i in range(30)])
    result = price_agent.run(req)
    # No suspicious chip — claim is within believable band of history.
    assert not any(f.tag == "suspiciousDiscount" for f in result.findings)


def test_run_uses_current_market_comparisons_without_history():
    req = _req(
        price=260,
        original=None,
        legal_min=None,
        history=None,
        comparisons=[("Bing Shopping / A", 190), ("Bing Shopping / B", 200), ("Bing Shopping / C", 210)],
    )
    result = price_agent.run(req)
    assert result.score >= 25
    assert result.label in {"Piyasa Kontrolü", "Piyasa Üstü"}
    assert any("Piyasa karşılaştırması" in f.message for f in result.findings)
