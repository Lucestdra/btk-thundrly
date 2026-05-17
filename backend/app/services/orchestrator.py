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

from typing import Optional

from sqlalchemy.orm import Session

from app.models.schemas import AnalyzeRequest, AnalyzeResponse
from app.services import graph as analysis_graph
from app.services.external_price_history import fetch_for_product as fetch_external_history
from app.services.price_history import get_recent
from app.services.user_budget import get as get_budget


def analyze(req: AnalyzeRequest, *, db: Optional[Session] = None) -> AnalyzeResponse:
    # Price history resolution, in priority order:
    #   1. Body-supplied `priceHistory` (tests + synthetic fixtures).
    #   2. Crowdsource DB (last 90d for this product URL).
    #   3. External source (Akakçe scrape, last 30d) — only when the
    #      first two miss, so we don't pay the network cost for products
    #      we already know about.
    if not req.priceHistory and req.product.url and db is not None:
        fetched = get_recent(db, req.product.url, days=90)
        if fetched:
            req = req.model_copy(update={"priceHistory": fetched})

    if not req.priceHistory and req.product.title:
        external = fetch_external_history(req.product.title)
        if external:
            req = req.model_copy(update={"priceHistory": external})

    # User budget: load from `user_budgets` keyed on (userId, category)
    # if the caller didn't supply one. If no row exists we leave it as
    # ``None`` — budget_agent reports "Bütçe Verisi Yok" honestly rather
    # than scoring against a fabricated default.
    if req.userBudget is None and db is not None:
        stored = get_budget(db, req.userId, req.product.category)
        if stored is not None:
            req = req.model_copy(update={"userBudget": stored})

    return analysis_graph.run(req)
