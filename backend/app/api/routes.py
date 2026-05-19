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

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Iterator, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.cache import (
    gemini_cache,
    invalidate_for_url,
    invalidate_for_user,
)
from app.core.limiter import limiter
from app.data.mock_data import EXAMPLES
from app.db.database import get_db
from app.models.schemas import (
    AgentResult,
    AnalyzeRequest,
    AnalyzeResponse,
    PriceObservationIn,
    PriceObservationOut,
    PurchaseIn,
    PurchaseOut,
    UserBudget,
    UserBudgetSummary,
)
from app.services.graph import _COMPILED as compiled_graph
from app.services.orchestrator import analyze
from app.services.price_history import get_recent, insert_observation
from app.services.url_normalizer import normalize
from app.services.user_budget import (
    DEFAULT_BUDGET,
    GLOBAL_CATEGORY,
    get_global as get_global_budget,
    get_or_default as get_budget_or_default,
    monthly_spent_for,
    record_purchase,
    summarize_for_user,
    upsert as upsert_budget,
    upsert_global as upsert_global_budget,
)


def _url_hash(url: str) -> str:
    return hashlib.sha1((url or "").encode("utf-8")).hexdigest()[:16]


def _require_admin(token_header: Optional[str]) -> None:
    """Guard for admin endpoints.

    Allowed when the request supplies the bearer-style token configured in
    ``THUNDRLY_ADMIN_TOKEN``. When the env var is unset the endpoints stay
    open — convenient for local dev, harmless in single-user mode, but
    every production deployment must set the token. The check is logged
    in either case so audits can see who poked the cache.
    """
    expected = os.environ.get("THUNDRLY_ADMIN_TOKEN", "").strip()
    if not expected:
        return
    if not token_header or token_header.strip() != expected:
        raise HTTPException(status_code=401, detail="admin token required")

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
    response: Response,
    payload: AnalyzeRequest = Body(
        ...,
        examples={
            "red": {"summary": "Şüpheli indirim + bütçe aşımı + dürtüsel", "value": EXAMPLES["red"]},
            "yellow": {"summary": "Kısmen manipüle fiyat + sınırda bütçe", "value": EXAMPLES["yellow"]},
            "green": {"summary": "Gerçek indirim + planlı + bütçe içinde", "value": EXAMPLES["green"]},
        },
    ),
    force_refresh: bool = Query(
        False,
        description=(
            "True olduğunda Gemini yanıt cache'i atlanır — kullanıcı "
            "panelden 'Yeniden analiz et' istediğinde gönder."
        ),
    ),
    db: Session = Depends(get_db),
) -> AnalyzeResponse:
    # Verdict reflects per-user, per-product state that changes whenever
    # the user edits their budget or new price observations land. Caching
    # it (proxy, CDN, browser) would mask those updates. Use the
    # in-process Gemini cache for legitimate replay protection instead.
    response.headers["Cache-Control"] = "no-store"

    user_prefix = (payload.userId[:12] + "…") if payload.userId and len(payload.userId) > 12 else (payload.userId or "?")
    logger.info(
        "analyze_purchase.request",
        extra={
            "event": "analyze_purchase.request",
            "user": user_prefix,
            "platform": payload.platform,
            "url": payload.product.url[:120],
            "title": (payload.product.title or "")[:80],
            "price": payload.product.price,
            "category_raw": (payload.product.category or "")[:40],
            "review_count_attached": len(payload.reviews or []),
            "price_history_attached": len(payload.priceHistory or []),
            "has_user_budget_in_body": payload.userBudget is not None,
            "force_refresh": force_refresh,
        },
    )
    result = analyze(payload, db=db, force_refresh=force_refresh)
    logger.info(
        "analyze_purchase.response",
        extra={
            "event": "analyze_purchase.response",
            "user": user_prefix,
            "decision": result.decision,
            "risk_score": result.riskScore,
        },
    )
    return result


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
    force_refresh: bool = Query(False),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    # Same priority chain as the non-streaming endpoint:
    # body > crowdsource DB > external (Akakçe).
    if not payload.priceHistory and payload.product.url:
        fetched = get_recent(db, payload.product.url, days=90)
        if fetched:
            payload = payload.model_copy(update={"priceHistory": fetched})

    if not payload.priceHistory and payload.product.title:
        from app.services.external_price_history import fetch_for_product

        external = fetch_for_product(payload.product.title)
        if external:
            payload = payload.model_copy(update={"priceHistory": external})

    def generate() -> Iterator[str]:
        try:
            for super_step in compiled_graph.stream(
                {"request": payload, "force_refresh": force_refresh},
                stream_mode="updates",
            ):
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
    # New observation makes any cached decision narration for this URL
    # stale — the price_agent's history snapshot has changed underneath.
    dropped = invalidate_for_url(_url_hash(canon.canonical))
    if dropped:
        logger.info(
            "cache.invalidate.price_observation",
            extra={"url_hash": _url_hash(canon.canonical), "dropped": dropped},
        )
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
def get_user_budget(
    userId: str = Query(..., min_length=1, max_length=64),
    category: str = Query(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
) -> UserBudget:
    return get_budget_or_default(db, userId, category)


@router.put(
    "/user-budget",
    response_model=UserBudget,
    summary="Kullanıcı bütçesini (kategori bazlı) kaydet/güncelle",
    description="(userId, category) için upsert. Aynı çiftte birden fazla satır olmaz.",
)
@limiter.limit("30/minute")
def put_user_budget(
    request: Request,
    userId: str = Query(..., min_length=1, max_length=64),
    category: str = Query(..., min_length=1, max_length=64),
    payload: UserBudget = Body(...),
    db: Session = Depends(get_db),
) -> UserBudget:
    upsert_budget(db, user_id=userId, category=category, budget=payload)
    dropped = invalidate_for_user(userId)
    if dropped:
        logger.info(
            "cache.invalidate.budget_write",
            extra={"user_id": userId[:12], "dropped": dropped},
        )
    return get_budget_or_default(db, userId, category)


@router.get(
    "/user-budgets",
    response_model=UserBudgetSummary,
    summary="Kullanıcının tüm bütçe özetini getir (popup için)",
    description=(
        "Tek kullanıcı için aylık limit + her kategori limiti ve "
        "mevcut ay harcaması döner. GLOBAL sentinel satırı listede "
        "yer almaz; aylık genel limit ayrı bir alanda döner. Hiç kayıt "
        "yoksa boş özet döner (categories=[], spent=0)."
    ),
)
def get_user_budgets_summary(
    userId: str = Query(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
) -> UserBudgetSummary:
    summary = summarize_for_user(db, userId)
    if summary is not None:
        return summary

    # Empty-state default — the popup needs a sensible monthly limit
    # to render the input field, even before the user has saved anything.
    from datetime import date

    period_start = date.today().replace(day=1).isoformat()
    return UserBudgetSummary(
        userId=userId,
        monthlyLimit=DEFAULT_BUDGET.monthlyLimit,
        monthlySpent=0.0,
        currency=DEFAULT_BUDGET.currency,
        periodStart=period_start,
        categories=[],
    )


@router.get(
    "/user-budget/global",
    response_model=UserBudget,
    summary="Kullanıcının genel aylık bütçesini getir",
    description=(
        "Hibrit bütçe modelinde **birincil** alan. Kullanıcı yalnızca "
        "bu değeri girerse de bütçe ajanı tüm satın almaları bu "
        "envelope'a karşı puanlar. Kayıt yoksa permissive bir varsayılan döner."
    ),
)
def get_user_budget_global(
    userId: str = Query(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
) -> UserBudget:
    stored = get_global_budget(db, userId)
    if stored is not None:
        return stored
    return DEFAULT_BUDGET


@router.put(
    "/user-budget/global",
    response_model=UserBudget,
    summary="Kullanıcının genel aylık bütçesini kaydet",
    description=(
        "GLOBAL sentinel satırını upsert eder. ``categoryLimit`` "
        "otomatik olarak ``monthlyLimit`` değerine eşitlenir. "
        "Per-category satırlar isteğe bağlı, ayrı uçla yönetilir."
    ),
)
@limiter.limit("30/minute")
def put_user_budget_global(
    request: Request,
    userId: str = Query(..., min_length=1, max_length=64),
    payload: UserBudget = Body(...),
    db: Session = Depends(get_db),
) -> UserBudget:
    upsert_global_budget(
        db,
        user_id=userId,
        monthly_limit=payload.monthlyLimit,
        currency=payload.currency,
    )
    invalidate_for_user(userId)
    return get_global_budget(db, userId) or DEFAULT_BUDGET


@router.post(
    "/purchases",
    response_model=PurchaseOut,
    summary="Kullanıcının taahhüt ettiği bir satın almayı kaydet",
    description=(
        "Eklenti `Yine de Devam Et` tıklandığında bu uca POST eder. "
        "(userId, category) için `category_spent` toplamına `amount` "
        "eklenir; gelecekteki analizler bu güncel toplamı kullanır. "
        "Ay sonunda satırlar lazily resetlenir."
    ),
)
@limiter.limit("60/minute")
def post_purchase(
    request: Request,
    payload: PurchaseIn,
    db: Session = Depends(get_db),
) -> PurchaseOut:
    row = record_purchase(
        db,
        user_id=payload.userId,
        category=payload.category,
        amount=payload.amount,
    )
    invalidate_for_user(payload.userId)
    monthly_total = monthly_spent_for(db, payload.userId)
    return PurchaseOut(
        userId=row.user_id,
        category=row.category,
        categorySpent=row.category_spent,
        monthlySpent=monthly_total,
        categoryLimit=row.category_limit,
        monthlyLimit=row.monthly_limit,
        periodStart=row.period_start.isoformat(),
    )


@router.get(
    "/health",
    summary="Liveness probe",
    description=(
        "Process is up. Cheap; always 200 if the FastAPI worker can handle "
        "a request at all. The `gemini` field signals whether the review +"
        " decision agents will actually call the LLM (true) or fall back to"
        " the deterministic heuristic (false) — the extension popup pings"
        " this so the user can verify their installation."
    ),
)
def health() -> dict:
    from app.agents._llm import get_provider_info

    info = get_provider_info()
    # Backwards-compat: callers (extension popup ≤0.2) read the
    # ``gemini`` boolean. We keep it true for any working LLM provider
    # so the popup's existing "Gemini açık" dot keeps the right color
    # regardless of which provider is actually serving the requests.
    return {
        "status": "ok",
        "service": "thundrly-backend",
        "llmProvider": info["provider"],
        "llmModel": info["model"],
        "llmReady": info["ready"],
        # Legacy fields:
        "gemini": info["ready"],
        "geminiModel": info["model"] if info["ready"] else None,
    }


@router.get(
    "/cache/stats",
    summary="Gemini cache hit/miss istatistikleri",
    description=(
        "Bellek içi Gemini response cache'inin sayaçlarını döner. "
        "Hit oranı, evictions ve invalidations metriklerini gözlemlemek "
        "için kullan. THUNDRLY_ADMIN_TOKEN tanımlıysa Authorization "
        "header'ında geçirilmesi gerekir; tanımlı değilse herkese açık."
    ),
)
def cache_stats(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> dict:
    _require_admin(authorization)
    return gemini_cache.stats()


@router.post(
    "/cache/purge",
    summary="Gemini cache içeriğini boşalt (admin)",
    description=(
        "Hedefli temizleme: ?userId=... verilirse o kullanıcıya ait, "
        "?url=... verilirse o URL'ye ait kayıtlar düşürülür. Hiçbiri "
        "verilmezse tüm cache temizlenir. THUNDRLY_ADMIN_TOKEN gerekli "
        "(tanımlı değilse açık)."
    ),
)
@limiter.limit("10/minute")
def cache_purge(
    request: Request,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    userId: Optional[str] = Query(default=None),
    url: Optional[str] = Query(default=None),
) -> dict:
    _require_admin(authorization)
    if userId is None and url is None:
        before = len(gemini_cache)
        gemini_cache.clear()
        return {"purged": before, "scope": "all"}
    removed = 0
    scope = []
    if userId:
        removed += invalidate_for_user(userId)
        scope.append("user")
    if url:
        removed += invalidate_for_url(_url_hash(normalize(url).canonical))
        scope.append("url")
    return {"purged": removed, "scope": "+".join(scope)}


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
