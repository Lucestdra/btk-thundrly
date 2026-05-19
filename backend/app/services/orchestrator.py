"""
Orkestratör — DB'den fiyat geçmişini doldurur, ardından LangGraph state
makinesini çağırır.

Akış:
    1) `req.priceHistory` boşsa, ürün URL'sine ait son 90 günü DB'den çek
       ve req'i o veriyle güncelle. Body'de history geldiyse onu kullan
       (testler ve sentetik fixture'lar DB'den bağımsız çalışmaya devam eder).
    2) `services.graph.run(req)` çağrılır → 4 sinyal ajanı paralel,
       decision ajanı fan-in.

Bu modül artık ajan çağrılarını doğrudan yapmıyor; tüm orkestrasyon
LangGraph içindedir. Eski sıralı çağrı kodu kaldırıldı.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.schemas import AnalyzeRequest, AnalyzeResponse
from app.services import graph as analysis_graph
from app.services.category_classifier import classify as classify_category
from app.services.external_price_history import fetch_for_product as fetch_external_history
from app.services.price_history import get_recent
from app.services.user_budget import (
    get_effective_global,
    get_strict as get_budget_strict,
)

logger = logging.getLogger("thundrly.orchestrator")

# Classifier confidence at or above which we trust the normalized
# category enough to look it up in user_budgets. Below this threshold we
# fall back to the user's global envelope, which is always safe.
_CATEGORY_CONFIDENCE_THRESHOLD = 0.7


def analyze(
    req: AnalyzeRequest,
    *,
    db: Optional[Session] = None,
    force_refresh: bool = False,
) -> AnalyzeResponse:
    # Price history resolution, in priority order:
    #   1. Body-supplied `priceHistory` (tests + synthetic fixtures).
    #   2. Crowdsource DB (last 90d for this product URL).
    #   3. External source (Akakçe scrape, last 30d) — only when the
    #      first two miss, so we don't pay the network cost for products
    #      we already know about.
    price_source = "body" if req.priceHistory else "none"
    if not req.priceHistory and req.product.url and db is not None:
        fetched = get_recent(db, req.product.url, days=90)
        if fetched:
            req = req.model_copy(update={"priceHistory": fetched})
            price_source = "db"

    if not req.priceHistory and req.product.title:
        external = fetch_external_history(req.product.title)
        if external:
            req = req.model_copy(update={"priceHistory": external})
            price_source = "akakce"

    logger.info(
        "analyze.start",
        extra={
            "event": "analyze.start",
            "url": req.product.url[:120],
            "price_source": price_source,
            "history_points": len(req.priceHistory or []),
            "review_count": len(req.reviews or []),
            "has_legal_min": req.product.legalLowestPrice30d is not None,
            "has_original_price": req.product.originalPrice is not None,
            "category_raw": req.product.category[:40],
        },
    )

    # User budget resolution — hybrid model.
    #
    #   1. Classify the product (rule-based, no LLM) to normalize the
    #      extractor's category string against a fixed Turkish taxonomy.
    #   2. If classification is confident AND a matching per-category
    #      row exists, use it — that's the user's narrower preference.
    #   3. Otherwise fall back to the GLOBAL monthly envelope. This is
    #      the safety net that prevents "Bütçe Verisi Yok" whenever the
    #      extractor returns a label nobody configured (the original
    #      Section 1.3 bug).
    if req.userBudget is None and db is not None:
        chosen = _resolve_budget(db, req)
        if chosen is not None:
            req = req.model_copy(update={"userBudget": chosen})

    return analysis_graph.run(req, force_refresh=force_refresh)


def _resolve_budget(db: Session, req: AnalyzeRequest):
    """Apply the hybrid (per-category-then-global) resolution.

    Logging here is intentionally verbose — Bütçe Verisi Yok reports
    were historically hard to diagnose without seeing both the extractor
    string and the classifier's verdict in the same log line.

    Stale-row defense: a per-category row only wins over the global
    envelope when ALL of these hold:
        (a) the row's ``category_limit`` is **strictly tighter** than
            the global monthly cap — otherwise it adds no information
            and just risks shadowing the canonical envelope with stale
            ``category_spent`` from prior tests
        (b) the classifier is highly confident OR the user explicitly
            typed the same category string in the popup

    This fixes the "I set global=₺10000 but agent says 170% over" class
    of bugs caused by an unrelated leftover row.
    """
    user_id = req.userId
    raw_cat = req.product.category or ""
    classification = classify_category(
        title=req.product.title,
        extractor_category=raw_cat,
        breadcrumbs=None,
    )

    user_prefix = user_id[:12] + "…" if len(user_id) > 12 else user_id
    global_budget = get_effective_global(db, user_id)
    global_cap = global_budget.monthlyLimit if global_budget is not None else None

    def _tighter_than_global(per_cat) -> bool:
        if global_cap is None or global_cap <= 0:
            return True  # no global to compare against — per-cat wins trivially
        return per_cat.categoryLimit > 0 and per_cat.categoryLimit < global_cap

    # 1) Per-category lookup, gated by classification confidence + the
    # "tighter than global" rule above.
    if classification.confidence >= _CATEGORY_CONFIDENCE_THRESHOLD:
        per_cat = get_budget_strict(db, user_id, classification.category)
        if per_cat is not None:
            tighter = _tighter_than_global(per_cat)
            logger.info(
                "budget.candidate.category user=%s raw=%r normalized=%s confidence=%.2f "
                "category_limit=%.0f category_spent=%.0f global_cap=%s tighter_than_global=%s",
                user_prefix, raw_cat, classification.category, classification.confidence,
                per_cat.categoryLimit, per_cat.categorySpent or 0.0,
                global_cap, tighter,
            )
            if tighter:
                logger.info("budget.resolved.category → using per-category row")
                return per_cat
            else:
                logger.info(
                    "budget.skipped.category → per-category row is NOT tighter than global; "
                    "preferring global envelope to avoid stale-row shadowing"
                )

    # 2) Try the extractor's original string verbatim (power users who
    # configured a custom category name that doesn't map to our taxonomy).
    if raw_cat:
        verbatim = get_budget_strict(db, user_id, raw_cat)
        if verbatim is not None:
            tighter = _tighter_than_global(verbatim)
            logger.info(
                "budget.candidate.verbatim user=%s category=%r category_limit=%.0f "
                "category_spent=%.0f global_cap=%s tighter_than_global=%s",
                user_prefix, raw_cat, verbatim.categoryLimit, verbatim.categorySpent or 0.0,
                global_cap, tighter,
            )
            if tighter:
                logger.info("budget.resolved.verbatim → using verbatim per-category row")
                return verbatim

    # 3) GLOBAL envelope — always-available safety net.
    if global_budget is not None:
        logger.info(
            "budget.resolved.global user=%s raw=%r classified=%s/%.2f "
            "monthly_limit=%.0f monthly_spent=%.0f",
            user_prefix, raw_cat, classification.category, classification.confidence,
            global_budget.monthlyLimit, global_budget.monthlySpent or 0.0,
        )
        return global_budget

    logger.info(
        "budget.miss user=%s raw=%r classified=%s/%.2f — no rows for this user",
        user_prefix, raw_cat, classification.category, classification.confidence,
    )
    return None
