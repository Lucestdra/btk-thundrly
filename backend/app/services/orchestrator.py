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
from app.services.price_history import get_recent
from app.services.user_budget import get_or_default as get_budget_or_default


def analyze(req: AnalyzeRequest, *, db: Optional[Session] = None) -> AnalyzeResponse:
    # Price history: pull last 90 days from the crowdsource DB if the
    # caller didn't supply one in the body.
    if not req.priceHistory and db is not None and req.product.url:
        fetched = get_recent(db, req.product.url, days=90)
        if fetched:
            req = req.model_copy(update={"priceHistory": fetched})

    # User budget: load from `user_budgets` keyed on (userId, category)
    # if the caller didn't supply one. Falls back to a permissive default
    # when no row exists — budget_agent gets something to score against.
    if req.userBudget is None and db is not None:
        budget = get_budget_or_default(db, req.userId, req.product.category)
        req = req.model_copy(update={"userBudget": budget})

    return analysis_graph.run(req)
