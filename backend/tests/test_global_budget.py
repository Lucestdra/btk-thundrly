"""Hybrid global-budget resolution.

Covers:

* ``upsert_global`` + ``get_global`` round-trip via the new
  ``/api/user-budget/global`` endpoints.
* The orchestrator's three-step resolution: per-category strict hit →
  verbatim hit → effective-global (explicit or synthesized).
* The summary endpoint hides the GLOBAL sentinel from the
  ``categories`` list.
"""

from __future__ import annotations

import copy
import json

from app.data.mock_data import EXAMPLES
from app.models.schemas import UserBudget
from app.services.user_budget import (
    GLOBAL_CATEGORY,
    get_effective_global,
    get_global,
    get_strict,
    upsert,
    upsert_global,
)


# ---------- DB-level helpers ----------


def test_upsert_global_and_get_global_round_trip(db):
    upsert_global(db, user_id="alice", monthly_limit=5000.0)
    g = get_global(db, "alice")
    assert g is not None
    assert g.monthlyLimit == 5000.0
    # GLOBAL row's category_limit is set equal to its monthly_limit so
    # the budget agent's category cap degrades to the monthly cap.
    assert g.categoryLimit == 5000.0


def test_get_strict_does_not_fall_back_to_global(db):
    upsert_global(db, user_id="alice", monthly_limit=5000.0)
    # Strict lookup for an unconfigured category must return None even
    # though a GLOBAL row exists.
    assert get_strict(db, "alice", "Giyim") is None
    # GLOBAL row is still retrievable by name.
    assert get_strict(db, "alice", GLOBAL_CATEGORY) is not None


def test_effective_global_prefers_explicit_global_over_synthesized(db):
    upsert(
        db,
        user_id="alice",
        category="Elektronik",
        budget=UserBudget(monthlyLimit=8000, categoryLimit=3000, categorySpent=0),
    )
    upsert_global(db, user_id="alice", monthly_limit=5000.0)
    effective = get_effective_global(db, "alice")
    # Explicit GLOBAL row wins — its monthly_limit, not the synthesized 8000.
    assert effective is not None
    assert effective.monthlyLimit == 5000.0


def test_effective_global_synthesizes_when_only_per_category_rows_exist(db):
    upsert(
        db,
        user_id="bob",
        category="Elektronik",
        budget=UserBudget(monthlyLimit=8000, categoryLimit=3000, categorySpent=0),
    )
    effective = get_effective_global(db, "bob")
    assert effective is not None
    assert effective.monthlyLimit == 8000
    # Synthesized envelope: cap degrades to monthly cap.
    assert effective.categoryLimit == 8000


def test_effective_global_none_when_user_has_nothing(db):
    assert get_effective_global(db, "stranger") is None


# ---------- HTTP endpoints ----------


def test_get_user_budget_global_endpoint_returns_default_for_new_user(client):
    r = client.get("/api/user-budget/global", params={"userId": "new"})
    assert r.status_code == 200
    body = r.json()
    assert body["monthlyLimit"] > 0  # permissive default
    assert body["categoryLimit"] > 0


def test_put_user_budget_global_persists_and_invalidates_cache(client):
    from app.core import cache as cache_mod

    cache_mod.gemini_cache.set("dec::u=alice:p=h:x", "stale")

    r = client.put(
        "/api/user-budget/global",
        params={"userId": "alice"},
        json={
            "monthlyLimit": 7500,
            "categoryLimit": 7500,
            "categorySpent": 0,
            "monthlySpent": 0,
            "currency": "TRY",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["monthlyLimit"] == 7500
    # Write through the global endpoint should also invalidate the user's
    # cached decision narrations — same write-hook contract as the
    # per-category PUT.
    assert cache_mod.gemini_cache.get("dec::u=alice:p=h:x") is None


def test_summary_endpoint_hides_global_sentinel_from_categories(client, db):
    upsert_global(db, user_id="alice", monthly_limit=5000.0)
    upsert(
        db,
        user_id="alice",
        category="Giyim",
        budget=UserBudget(monthlyLimit=5000, categoryLimit=1500, categorySpent=0),
    )

    r = client.get("/api/user-budgets", params={"userId": "alice"})
    assert r.status_code == 200
    body = r.json()
    cat_names = [c["category"] for c in body["categories"]]
    assert GLOBAL_CATEGORY not in cat_names
    assert "Giyim" in cat_names
    assert body["monthlyLimit"] == 5000


# ---------- Orchestrator end-to-end ----------


def test_analyze_uses_global_when_extractor_category_is_unknown(client, db):
    """User configured only a GLOBAL envelope; visits a product whose
    extractor category doesn't match anything they configured.

    The original Section 1.3 bug: this case would land "Bütçe Verisi Yok".
    With the global fallback in place we expect a real verdict against
    the monthly cap.
    """
    upsert_global(db, user_id="globe-user", monthly_limit=5000.0)

    payload = copy.deepcopy(EXAMPLES["red"])
    payload["userId"] = "globe-user"
    payload["product"]["category"] = "Akıllı Telefon Aksesuarı"  # unknown verbatim
    payload.pop("userBudget")

    r = client.post("/api/analyze-purchase", json=payload)
    assert r.status_code == 200
    body = r.json()
    budget_agent = body["agents"]["budgetAgent"]
    assert budget_agent["label"] != "Bütçe Verisi Yok"


def test_stream_uses_global_budget_too(client, db):
    upsert_global(db, user_id="stream-globe", monthly_limit=5000.0)

    payload = copy.deepcopy(EXAMPLES["red"])
    payload["userId"] = "stream-globe"
    payload["product"]["category"] = "Spor ve Outdoor"
    payload.pop("userBudget")

    with client.stream("POST", "/api/analyze-purchase/stream", json=payload) as r:
        assert r.status_code == 200, r.text
        events = [json.loads(line) for line in r.read().decode("utf-8").splitlines() if line.strip()]

    verdict = next(e for e in events if e["event"] == "verdict")["response"]
    budget_agent = verdict["agents"]["budgetAgent"]
    assert budget_agent["label"] != "Bütçe Verisi Yok"


def test_analyze_prefers_explicit_category_over_global(client, db):
    """When a confident classification matches a configured category,
    that category's limits take precedence over the global envelope.
    """
    upsert_global(db, user_id="cat-user", monthly_limit=50_000.0)
    upsert(
        db,
        user_id="cat-user",
        category="elektronik",  # taxonomy bucket — classifier alias hits this
        budget=UserBudget(monthlyLimit=50_000, categoryLimit=100, categorySpent=99),
    )

    payload = copy.deepcopy(EXAMPLES["red"])
    payload["userId"] = "cat-user"
    payload["product"]["category"] = "Telefon ve Aksesuarları"  # → elektronik (0.9)
    payload["product"]["price"] = 5000  # blows past the ₺100 category cap
    payload.pop("userBudget")

    r = client.post("/api/analyze-purchase", json=payload)
    body = r.json()
    budget_agent = body["agents"]["budgetAgent"]
    # The narrow per-category limit must drive the verdict.
    assert budget_agent["score"] >= 50
    assert "Bütçe Verisi Yok" not in budget_agent["label"]
