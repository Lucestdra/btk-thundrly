"""Tests for the per-(userId, category) budget store.

Layers covered:

  1. Repository — `get_or_default` returns permissive default for unknown
     pairs; `upsert` round-trips correctly.
  2. HTTP — GET returns the stored budget; PUT upserts and the next GET
     reflects the change.
  3. Orchestrator — when `userBudget` is omitted from the request body,
     the analyze flow looks up the DB row by (userId, product.category)
     and feeds it to budget_agent. The verdict must therefore match what
     we get when we POST the same budget inline.
"""

from __future__ import annotations

import copy

from app.data.mock_data import EXAMPLES
from app.models.schemas import UserBudget
from app.services.user_budget import DEFAULT_BUDGET, get_or_default, upsert


# ---------- Repository ----------


def test_get_or_default_returns_default_when_no_row(db):
    out = get_or_default(db, "no-such-user", "Giyim")
    assert out == DEFAULT_BUDGET


def test_upsert_then_get(db):
    budget = UserBudget(
        monthlyLimit=3000,
        categoryLimit=1000,
        categorySpent=200,
        monthlySpent=900,
        currency="TRY",
    )
    upsert(db, user_id="demo-user", category="Giyim", budget=budget)

    out = get_or_default(db, "demo-user", "Giyim")
    assert out.monthlyLimit == 3000
    assert out.categoryLimit == 1000
    assert out.categorySpent == 200
    assert out.monthlySpent == 900


def test_upsert_is_idempotent_for_same_key(db):
    """Two upserts on the same (user_id, category) yield one row."""
    b1 = UserBudget(monthlyLimit=1000, categoryLimit=500, categorySpent=10, currency="TRY")
    b2 = UserBudget(monthlyLimit=2000, categoryLimit=800, categorySpent=20, currency="TRY")

    upsert(db, user_id="u", category="Giyim", budget=b1)
    upsert(db, user_id="u", category="Giyim", budget=b2)

    out = get_or_default(db, "u", "Giyim")
    assert out.monthlyLimit == 2000
    assert out.categoryLimit == 800
    # Only one row total — verified by querying the table directly.
    from app.db.models import UserBudgetRow
    count = db.query(UserBudgetRow).filter_by(user_id="u", category="Giyim").count()
    assert count == 1


# ---------- HTTP endpoints ----------


def test_get_user_budget_endpoint_default(client):
    r = client.get("/api/user-budget", params={"userId": "unknown", "category": "Anything"})
    assert r.status_code == 200
    body = r.json()
    assert body["monthlyLimit"] == DEFAULT_BUDGET.monthlyLimit
    assert body["categoryLimit"] == DEFAULT_BUDGET.categoryLimit


def test_put_user_budget_then_get_roundtrip(client):
    payload = {
        "monthlyLimit": 4000,
        "categoryLimit": 1200,
        "categorySpent": 300,
        "monthlySpent": 1500,
        "currency": "TRY",
    }
    r = client.put("/api/user-budget", params={"userId": "u2", "category": "Elektronik"}, json=payload)
    assert r.status_code == 200
    assert r.json()["categoryLimit"] == 1200

    r = client.get("/api/user-budget", params={"userId": "u2", "category": "Elektronik"})
    assert r.status_code == 200
    assert r.json() == {
        **payload,
        "monthlySpent": 1500,  # explicit echo for clarity
    }


# ---------- Orchestrator auto-load ----------


def test_analyze_loads_budget_from_db_when_body_omits_it(client, db):
    """The red fixture's verdict depends on a tight budget. Strip
    userBudget from the body but populate the DB row first — the verdict
    must remain `red` thanks to the DB-backed lookup."""
    red = copy.deepcopy(EXAMPLES["red"])
    expected_budget = red["userBudget"]

    # 1) Seed the DB with the same budget the body used to carry.
    upsert(
        db,
        user_id=red["userId"],
        category=red["product"]["category"],
        budget=UserBudget(**expected_budget),
    )

    # 2) Strip userBudget from the request body.
    red.pop("userBudget")

    # 3) The verdict must still be red — heuristic is unchanged because
    #    the same budget data was loaded server-side.
    r = client.post("/api/analyze-purchase", json=red)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] == "red"
    assert body["riskScore"] >= 70


def test_analyze_uses_permissive_default_when_no_db_row(client):
    """No DB row + no body budget → permissive default → budget agent
    produces a 'rahat aralıkta' score that doesn't poison the verdict."""
    red = copy.deepcopy(EXAMPLES["red"])
    red.pop("userBudget")

    r = client.post("/api/analyze-purchase", json=red)
    assert r.status_code == 200
    body = r.json()
    # Even without budget pressure, review + price scores are bad enough
    # to push the verdict above green; but the budget agent should not
    # produce a risk-level finding.
    budget_findings = body["agents"]["budgetAgent"]["findings"]
    risk_findings = [f for f in budget_findings if f["severity"] == "risk"]
    assert risk_findings == [], budget_findings
