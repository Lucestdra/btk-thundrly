"""HTTP routes.

POST /api/analyze-purchase         — full verdict (returns once).
POST /api/analyze-purchase/stream  — same input; NDJSON stream of per-node
                                     events followed by the final verdict.
POST /api/price-observation        — append-only price ingest from the
                                     extension.
GET  /api/health                   — liveness probe.

Note: we deliberately skip ``from __future__ import annotations`` here.
slowapi's `@limiter.limit` wraps the handler with `functools.wraps`, which
does **not** copy ``__globals__``; FastAPI then evaluates parameter
annotations against slowapi's namespace and can't resolve names like
``PriceObservationIn``. Concrete (non-string) annotations sidestep that.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Iterator

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.data.mock_data import EXAMPLES
from app.db.database import get_db
from app.models.schemas import (
    AgentResult,
    AnalyzeRequest,
    AnalyzeResponse,
    PriceObservationIn,
    PriceObservationOut,
    UserBudget,
)
from app.services.graph import _COMPILED as compiled_graph
from app.services.orchestrator import analyze
from app.services.price_history import get_recent, insert_observation
from app.services.url_normalizer import normalize
from app.services.user_budget import get_or_default as get_budget_or_default
from app.services.user_budget import upsert as upsert_budget

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/analyze-purchase",
    response_model=AnalyzeResponse,
    summary="Ürün satın alımını 5 ajanla analiz et",
    description=(
        "Ürün, yorum, fiyat geçmişi, bütçe ve oturum bilgisini alır; "
        "yeşil/sarı/kırmızı bir karar ve 3 gerekçe döner. `priceHistory` "
        "boş ise sunucu, ürün URL'sine ait crowdsource veritabanından son 90 "
        "günü çeker."
    ),
)
def analyze_purchase(
    payload: AnalyzeRequest = Body(
        ...,
        examples={
            "red": {"summary": "Şüpheli indirim + bütçe aşımı + dürtüsel", "value": EXAMPLES["red"]},
            "yellow": {"summary": "Kısmen manipüle fiyat + sınırda bütçe", "value": EXAMPLES["yellow"]},
            "green": {"summary": "Gerçek indirim + planlı + bütçe içinde", "value": EXAMPLES["green"]},
        },
    ),
    db: Session = Depends(get_db),
) -> AnalyzeResponse:
    return analyze(payload, db=db)


@router.post(
    "/analyze-purchase/stream",
    summary="Aynı analiz, ajan tamamlanma olaylarını NDJSON ile streamler",
    description=(
        "Her satır bağımsız bir JSON nesnesidir (`application/x-ndjson`). "
        "Sıra: 4 paralel sinyal ajanı için `node_finished`, ardından "
        "decision için `node_finished`, en sonda `verdict` (tam "
        "AnalyzeResponse). Hata olursa son satır `error` olur. "
        "Karar mantığı normal endpoint ile aynıdır; tek fark stream şeklidir."
    ),
    response_class=StreamingResponse,
)
def analyze_purchase_stream(
    payload: AnalyzeRequest = Body(...),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    # Same DB-history fallback as the non-streaming endpoint.
    if not payload.priceHistory and payload.product.url:
        fetched = get_recent(db, payload.product.url, days=90)
        if fetched:
            payload = payload.model_copy(update={"priceHistory": fetched})

    def generate() -> Iterator[str]:
        try:
            for super_step in compiled_graph.stream({"request": payload}, stream_mode="updates"):
                # super_step: {node_name: {state_key: value, ...}}
                for _node_name, state_delta in super_step.items():
                    for key, value in state_delta.items():
                        if key == "response" and isinstance(value, AnalyzeResponse):
                            yield _ndjson({"event": "verdict", "response": value.model_dump(mode="json")})
                        elif isinstance(value, AgentResult):
                            yield _ndjson({
                                "event": "node_finished",
                                "node": key,  # "review" | "price" | "budget" | "impulse"
                                "result": value.model_dump(mode="json"),
                            })
        except Exception as exc:  # noqa: BLE001
            logger.exception("Streaming analyze failed mid-flight")
            yield _ndjson({"event": "error", "message": str(exc)})

    # X-Accel-Buffering disables nginx buffering when the service is fronted
    # by a reverse proxy; harmless when running uvicorn directly.
    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _ndjson(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


@router.post(
    "/price-observation",
    response_model=PriceObservationOut,
    summary="Crowdsource fiyat gözlemi kaydet",
    description=(
        "Eklenti her ürün sayfası açılışında o anki fiyatı bu uca POST eder. "
        "Sunucu URL'yi normalize edip append-only saklar; aynı ürünün ileride "
        "yapılan analizleri bu geçmişten beslenir. Rate-limit: IP başına 60/dakika."
    ),
)
@limiter.limit("60/minute")
def post_price_observation(
    request: Request,
    payload: PriceObservationIn,
    db: Session = Depends(get_db),
) -> PriceObservationOut:
    row = insert_observation(
        db,
        raw_url=payload.url,
        price=payload.price,
        currency=payload.currency,
        title=payload.title,
    )
    canon = normalize(payload.url)
    stored_at = row.observed_at
    if stored_at.tzinfo is None:
        stored_at = stored_at.replace(tzinfo=timezone.utc)
    return PriceObservationOut(
        canonicalUrl=canon.canonical,
        platform=canon.platform,
        storedAt=stored_at.isoformat(),
    )


@router.get(
    "/user-budget",
    response_model=UserBudget,
    summary="Kullanıcı bütçesini (kategori bazlı) getir",
    description=(
        "(userId, category) çifti için saklanan bütçeyi döner. "
        "Eşleşen kayıt yoksa permissive bir varsayılan döner; budget_agent "
        "böylelikle her zaman skorlayacak bir veri bulur."
    ),
)
def get_user_budget(userId: str, category: str, db: Session = Depends(get_db)) -> UserBudget:
    return get_budget_or_default(db, userId, category)


@router.put(
    "/user-budget",
    response_model=UserBudget,
    summary="Kullanıcı bütçesini (kategori bazlı) kaydet/güncelle",
    description="(userId, category) için upsert. Aynı çiftte birden fazla satır olmaz.",
)
def put_user_budget(
    userId: str,
    category: str,
    payload: UserBudget,
    db: Session = Depends(get_db),
) -> UserBudget:
    upsert_budget(db, user_id=userId, category=category, budget=payload)
    return get_budget_or_default(db, userId, category)


@router.get(
    "/health",
    summary="Liveness probe",
    description=(
        "Process is up. Cheap; always 200 if the FastAPI worker can handle "
        "a request at all. Use for load-balancer health checks."
    ),
)
def health() -> dict:
    return {"status": "ok", "service": "thundrly-backend"}


@router.get(
    "/ready",
    summary="Readiness probe",
    description=(
        "Process is up AND the database is reachable. Returns 503 if the "
        "DB connection fails, so an orchestrator can hold traffic off "
        "until migrations finish on first boot."
    ),
)
def ready(db: Session = Depends(get_db)) -> dict:
    from sqlalchemy import text

    db.execute(text("SELECT 1"))
    return {"status": "ok", "service": "thundrly-backend", "db": "reachable"}
