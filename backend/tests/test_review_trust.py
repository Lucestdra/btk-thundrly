"""Trust-score signals in the review_agent heuristic path.

Synthetic bot-pattern fixtures exercise each individual signal in
:func:`app.agents.review_agent._compute_trust_summary` and the headline
score it drives. These run without Gemini — pure heuristic behaviour.
"""

from __future__ import annotations

from app.agents import review_agent
from app.agents._gemini_client import reset_cache
from app.models.schemas import AnalyzeRequest, Review


def _req(reviews: list[dict]) -> AnalyzeRequest:
    return AnalyzeRequest.model_validate(
        {
            "userId": "test",
            "platform": "trendyol",
            "product": {
                "title": "Test ürünü",
                "price": 500,
                "currency": "TRY",
                "category": "Giyim",
                "url": "https://example.com/p-trust",
            },
            "reviews": reviews,
            "priceHistory": [],
            "session": {
                "timeOnPageSeconds": 60,
                "clickSpeedMs": 1000,
                "currentHour": 14,
                "purchasesToday": 0,
            },
        }
    )


def setup_function(_):
    # Make sure we never accidentally hit Gemini.
    reset_cache()


def test_aggregate_review_count_does_not_report_no_data():
    req = AnalyzeRequest.model_validate(
        {
            "userId": "u",
            "platform": "amazon",
            "product": {
                "title": "Stanley IceFlow",
                "price": 1590,
                "currency": "TRY",
                "category": "Spor",
                "url": "https://www.amazon.com.tr/dp/B0FLDJJ75H",
                "rating": 4.7,
                "reviewCount": 349,
            },
            "reviews": [],
            "priceHistory": [],
            "session": {
                "timeOnPageSeconds": 60,
                "clickSpeedMs": 150,
                "currentHour": 14,
                "purchasesToday": 0,
            },
        }
    )
    result = review_agent.run(req)
    assert result.label == "Yorum Özeti Var"
    assert result.score < 35
    assert any("349" in f.message for f in result.findings)


def test_duplicate_text_cluster_drops_trust_and_lifts_score():
    """Three near-identical 5★ reviews — classic dup cluster."""
    reviews = [
        {"rating": 5, "text": "Çok güzel ürün hızlı kargo tavsiye ederim", "date": "2026-05-10"},
        {"rating": 5, "text": "Çok güzel hızlı kargo tavsiye ederim", "date": "2026-05-10"},
        {"rating": 5, "text": "Süper hızlı kargo tavsiye ederim ürün güzel", "date": "2026-05-10"},
        {"rating": 4, "text": "Beklediğimden biraz farklı ama kullanılabilir bir ürün", "date": "2026-04-22"},
    ]
    result = review_agent._run_heuristic(_req(reviews))
    summary_msgs = " ".join(f.message for f in result.findings)
    assert "tekrar" in summary_msgs.lower()
    # Heavy duplicate signal → manipulation score should be elevated.
    assert result.score >= 45
    # Trust headline appended last.
    assert "Güven skoru" in result.findings[-1].message


def test_author_repetition_signals_sock_puppet():
    reviews = [
        {"rating": 5, "text": "Süper ürün hızlı kargo geldi gayet memnunum", "date": "2026-05-10", "author": "ahmet"},
        {"rating": 5, "text": "Çok güzel bir alışveriş oldu teşekkürler", "date": "2026-05-10", "author": "ahmet"},
        {"rating": 5, "text": "Tavsiye ederim mükemmel kalite", "date": "2026-05-10", "author": "ahmet"},
        {"rating": 4, "text": "Beklentimi karşıladı kalite gayet iyi", "date": "2026-04-22", "author": "mehmet"},
    ]
    result = review_agent._run_heuristic(_req(reviews))
    msgs = " ".join(f.message for f in result.findings)
    assert "yazar" in msgs.lower()
    assert result.score >= 50


def test_low_verified_purchase_ratio_lowers_trust():
    reviews = [
        {"rating": 5, "text": "Çok güzel ürün hızlı kargo tavsiye ederim", "date": "2026-05-10", "verifiedPurchase": False},
        {"rating": 5, "text": "Mükemmel kalite süper", "date": "2026-05-10", "verifiedPurchase": False},
        {"rating": 5, "text": "Tam istediğim gibi geldi", "date": "2026-05-10", "verifiedPurchase": False},
        {"rating": 5, "text": "Tavsiye ederim gerçekten kaliteli ürün", "date": "2026-05-10", "verifiedPurchase": False},
    ]
    summary = review_agent._compute_trust_summary(
        [Review.model_validate(r) for r in reviews]
    )
    assert summary["verified_ratio"] == 0.0
    # Trust score must be materially dropped vs the bonus path.
    assert summary["trust_score"] <= 35
    findings_msgs = " ".join(f.message for f in review_agent._run_heuristic(_req(reviews)).findings)
    assert "verified" in findings_msgs.lower()


def test_high_verified_purchase_ratio_grants_trust_bonus():
    reviews = [
        {"rating": 5, "text": "Aldım sevdim, kullanışlı, fiyatına göre çok iyi", "date": "2026-05-10", "verifiedPurchase": True},
        {"rating": 4, "text": "Beğendim ama plastiği biraz ince", "date": "2026-04-22", "verifiedPurchase": True},
        {"rating": 5, "text": "Çocuğum çok beğendi tavsiye ederim", "date": "2026-03-15", "verifiedPurchase": True},
    ]
    summary = review_agent._compute_trust_summary(
        [Review.model_validate(r) for r in reviews]
    )
    assert summary["verified_ratio"] == 1.0
    assert summary["trust_score"] >= 75  # base 70 + bonus 10 → clamped/clamped near 80


def test_healthy_diverse_reviews_yield_high_trust_low_score():
    """No duplicate text, varied dates, no obvious manipulation."""
    reviews = [
        {"rating": 5, "text": "Aldım sevdim, kullanışlı, fiyatına göre çok iyi", "date": "2026-05-10", "verifiedPurchase": True, "author": "ayse"},
        {"rating": 4, "text": "Beğendim ama plastiği biraz ince", "date": "2026-04-22", "verifiedPurchase": True, "author": "mehmet"},
        {"rating": 3, "text": "İdare eder, daha iyisini beklerdim", "date": "2026-03-15", "verifiedPurchase": True, "author": "fatma"},
        {"rating": 5, "text": "Çocuğum çok beğendi tavsiye ederim", "date": "2026-02-08", "verifiedPurchase": True, "author": "ali"},
    ]
    result = review_agent._run_heuristic(_req(reviews))
    assert result.score < 35
    assert result.label in ("Güvenilir", "Büyük Ölçüde Güvenilir")
    # Trust headline last; should be a high score.
    trust_line = result.findings[-1].message
    assert "Güven skoru" in trust_line
    # 100 - score; this should be a healthy number.
    assert "/100" in trust_line


def test_burst_signal_fires_when_most_reviews_in_same_window():
    reviews = [
        {"rating": 5, "text": "Çok güzel ürün hızlı kargo", "date": "2026-05-10"},
        {"rating": 5, "text": "Mükemmel kalite süper kargo", "date": "2026-05-10"},
        {"rating": 5, "text": "Tam istediğim gibi geldi", "date": "2026-05-09"},
        {"rating": 5, "text": "Tavsiye ederim gerçekten", "date": "2026-05-09"},
    ]
    summary = review_agent._compute_trust_summary(
        [Review.model_validate(r) for r in reviews]
    )
    assert summary["burst_ratio"] >= 0.6
