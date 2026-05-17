"""Integration tests for the price-history pipeline.

Covers:
  - URL normalization across platforms.
  - POST /api/price-observation creates a row and returns canonical metadata.
  - Orchestrator falls back to DB-supplied history when the request body
    omits priceHistory.
  - Median-based daily collapse resists a single poisoned observation.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.db.database import SessionLocal
from app.db.models import PriceObservation
from app.services.price_history import get_recent, insert_observation
from app.services.url_normalizer import normalize


# ---------- URL normalizer ----------


@pytest.mark.parametrize(
    "url, expected_platform, expected_canonical",
    [
        (
            "https://www.trendyol.com/oversize-hoodie-p-12345678?boutiqueId=61",
            "trendyol",
            "trendyol://12345678",
        ),
        (
            "https://www.hepsiburada.com/marka-urun-p-HBV00000XYZ12?wt_mc=ads",
            "hepsiburada",
            "hepsiburada://HBV00000XYZ12",
        ),
        (
            "https://www.n11.com/urun/some-product-P98765432",
            "n11",
            "n11://P98765432",
        ),
        (
            "https://demo.local/product/hoodie",
            "other",
            "other://demo.local/product/hoodie",
        ),
    ],
)
def test_normalize_extracts_canonical_id(url, expected_platform, expected_canonical):
    out = normalize(url)
    assert out.platform == expected_platform
    assert out.canonical == expected_canonical


def test_normalize_handles_empty_and_garbage():
    assert normalize("").canonical == "other://"
    # Should not raise on weird input; falls back to generic form.
    out = normalize("not-a-url")
    assert out.canonical.startswith("other://")


# ---------- POST /api/price-observation ----------


def test_post_observation_stores_row(client, db):
    body = {
        "url": "https://www.trendyol.com/test-urun-p-99999999",
        "price": 1299.0,
        "currency": "TRY",
        "title": "Test ürünü",
    }
    r = client.post("/api/price-observation", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["canonicalUrl"] == "trendyol://99999999"
    assert data["platform"] == "trendyol"

    rows = db.query(PriceObservation).filter_by(url="trendyol://99999999").all()
    assert len(rows) == 1
    assert rows[0].price == 1299.0
    assert rows[0].title == "Test ürünü"
    assert rows[0].raw_url == body["url"]


def test_post_observation_rejects_non_positive_price(client):
    r = client.post(
        "/api/price-observation",
        json={"url": "https://example.com/product-p-1", "price": 0},
    )
    assert r.status_code == 422  # Pydantic validation


# ---------- DB-backed history feeds analyze when body has none ----------


def _payload_no_history(url: str) -> dict:
    """Minimal AnalyzeRequest body with the URL we want history looked up for."""
    return {
        "userId": "test",
        "platform": "trendyol",
        "product": {
            "title": "Test",
            "price": 100,
            "originalPrice": 200,
            "currency": "TRY",
            "category": "Giyim",
            "url": url,
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
            "timeOnPageSeconds": 120,
            "clickSpeedMs": 1500,
            "currentHour": 14,
            "purchasesToday": 0,
            "searchedBefore": True,
        },
    }


def test_analyze_falls_back_to_db_when_body_history_empty(client, db):
    url = "https://www.trendyol.com/seedless-urun-p-77777777"
    # Seed a flat 30-day history at 100 TRY so the agent has data to chew on.
    now = datetime.now(timezone.utc)
    for d in range(30, 0, -1):
        insert_observation(
            db,
            raw_url=url,
            price=100.0,
            observed_at=now - timedelta(days=d),
        )

    r = client.post("/api/analyze-purchase", json=_payload_no_history(url))
    assert r.status_code == 200, r.text
    body = r.json()
    # Current price 100 == 30-day median → no "fiyat ortalamanın üzerinde" risk.
    # The exact verdict can vary with budget/impulse weights; we just assert
    # the priceAgent observed our seeded data and didn't return the
    # "yeterli fiyat geçmişi yok" fallback (which would score 45).
    price_agent = body["agents"]["priceAgent"]
    assert price_agent["score"] < 30, body
    assert all("Yeterli fiyat geçmişi yok" not in f["message"] for f in price_agent["findings"])


def test_analyze_emits_no_history_warning_when_db_empty(client):
    r = client.post("/api/analyze-purchase", json=_payload_no_history("https://www.trendyol.com/unseen-p-1"))
    assert r.status_code == 200
    findings = r.json()["agents"]["priceAgent"]["findings"]
    assert any("Yeterli fiyat geçmişi yok" in f["message"] for f in findings)


# ---------- Median collapses daily duplicates and absorbs poison ----------


def test_get_recent_uses_median_per_day():
    """Same canonical URL gets three observations the same day at 100/100/9999;
    median per day is 100, so a single poisoned price doesn't move the result."""
    url = "https://www.trendyol.com/poison-p-22222222"
    with SessionLocal() as db:
        db.query(PriceObservation).delete()
        db.commit()
        now = datetime.now(timezone.utc)
        for price in (100.0, 100.0, 9999.0):
            insert_observation(db, raw_url=url, price=price, observed_at=now)

        points = get_recent(db, url, days=7)
        assert len(points) == 1
        assert points[0].price == 100.0

        # Cleanup so the next test sees an empty table.
        db.query(PriceObservation).delete()
        db.commit()
