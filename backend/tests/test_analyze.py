"""
Üç kanonik fixture'ın doğru eşiğe düştüğünü doğrular.

Bu testler "ajanların kesin skorlarına" değil, **karar eşiğine** bağlıdır;
böylece heuristik ince ayarları geri tepmez ancak karar kontratı korunur.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.data.mock_data import EXAMPLES
from app.main import app

client = TestClient(app)


def _post(payload):
    r = client.post("/api/analyze-purchase", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_red_fixture_yields_red_decision():
    body = _post(EXAMPLES["red"])
    assert body["decision"] == "red"
    assert body["riskScore"] >= 70
    assert len(body["reasons"]) >= 1
    # Tüm reasons string olmalı, boş olmamalı
    for r in body["reasons"]:
        assert isinstance(r, str) and r.strip()
    # Türkçe karakter güvenliği
    assert any("ı" in r or "ğ" in r or "ö" in r or "ş" in r or "ç" in r or "ü" in r or "İ" in r for r in body["reasons"])


def test_yellow_fixture_yields_yellow_decision():
    body = _post(EXAMPLES["yellow"])
    assert body["decision"] == "yellow"
    assert 40 <= body["riskScore"] < 70


def test_green_fixture_yields_green_decision():
    body = _post(EXAMPLES["green"])
    assert body["decision"] == "green"
    assert body["riskScore"] < 40


def test_response_contract_includes_all_five_agents():
    body = _post(EXAMPLES["red"])
    for k in ("reviewAgent", "priceAgent", "budgetAgent", "impulseAgent", "decisionAgent"):
        assert k in body["agents"]
        assert "score" in body["agents"][k]
        assert "label" in body["agents"][k]
        assert "findings" in body["agents"][k]


def test_recommended_action_matches_decision():
    expected = {
        "red": "30 saniye düşün",
        "yellow": "Birkaç noktayı tekrar gözden geçir",
        "green": "Satın almaya devam edebilirsin",
    }
    for variant, payload in EXAMPLES.items():
        body = _post(payload)
        assert body["recommendedAction"] == expected[variant]


def test_health_endpoint():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
