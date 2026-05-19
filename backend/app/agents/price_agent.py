"""
Fiyat Agenti — indirim iddiasının gerçekliğini ölçer.

Sinyaller:
  - Güncel fiyat son 30 günün ortalamasına göre nerede?
  - İndirim öncesi fiyatta sıçrama (raise-then-discount örüntüsü).
  - "Gerçek indirim" oranı (30 günün düşük tarafına göre).
  - Mock rakip aralığı (90 günün ±%15'i) — gerçek senaryoda harici fiyat servisleriyle değişir.

Skor 0–100; yüksek = manipülasyon riski yüksek.

TODO (Gerçek veri): Fiyat geçmişini harici bir kaynak (örn. fiyat takip servisi)
veya kullanıcı taraflı geçmiş veriden topla. Mock'ta payload'da gelen geçmiş kullanılır.
TODO (Gemini): "Gerçek indirim mi?" gerekçesini doğal Türkçe ile LLM özet üretsin.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from statistics import median
from typing import List, Optional

from app.models.schemas import (
    AgentFinding,
    AgentResult,
    AnalyzeRequest,
    PriceComparisonOffer,
    PriceHistoryPoint,
)

logger = logging.getLogger(__name__)

# Threshold above which a claimed original price is flagged as inflated
# relative to the lowest of our agreeing sources. 15% = a clear-cut
# inflation; smaller deltas often reflect honest day-to-day variance.
_SUSPICIOUS_DISCOUNT_RATIO = 1.15

# Two sources are "in agreement" when their values are within this
# percentage of each other. Keeps a single noisy outlier from collapsing
# our confidence ladder.
_SOURCE_AGREEMENT_TOLERANCE = 0.10

# Current-market comparison tolerance. Prices inside +/-8% of the market
# median are normal merchant spread; above that, the user should see it.
_MARKET_TOLERANCE = 0.08


def _parse_date(s: str) -> date | None:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _window_prices(history: List[PriceHistoryPoint], days: int, ref: date) -> List[float]:
    out: List[float] = []
    for p in history:
        d = _parse_date(p.date)
        if d and (ref - d).days <= days and d <= ref:
            out.append(p.price)
    return out


def _suspicious_discount_check(
    *,
    displayed_price: float,
    claimed_original: Optional[float],
    sources: dict[str, float],
) -> Optional[AgentFinding]:
    """Multi-source cross-check on the merchant's claimed discount.

    ``sources`` maps a human-friendly source name (used in the message)
    to that source's lowest-price reading. The caller may pass on-page
    legal minimum, our own history, and/or current market comparison
    values; the function works for any subset.

    Logic:
      * real_base = min of all source readings
      * if claimed_original > real_base * 1.15 → flag
      * confidence climbs with the number of sources that **agree**
        (within ±10% of each other), so a single noisy outlier doesn't
        artificially inflate the severity
    """
    if not claimed_original or claimed_original <= displayed_price:
        return None
    if not sources:
        return None

    values = list(sources.values())
    real_base = min(values)
    if claimed_original <= real_base * _SUSPICIOUS_DISCOUNT_RATIO:
        return None  # claim is in the believable band

    # Count how many sources cluster near the lowest reading — these are
    # the ones reinforcing the "the real base is much lower" verdict.
    agreeing_names = [
        name
        for name, val in sources.items()
        if val <= real_base * (1 + _SOURCE_AGREEMENT_TOLERANCE)
    ]
    agree_count = max(1, len(agreeing_names))

    if agree_count >= 3:
        severity = "risk"
    elif agree_count == 2:
        severity = "risk"
    else:
        severity = "warn"

    inflated_pct = int(round((claimed_original / real_base - 1) * 100))
    source_breakdown = ", ".join(f"{name} ₺{val:.0f}" for name, val in sources.items())
    message = (
        f"ŞÜPHELİ İNDİRİM: gösterilen orijinal fiyat ₺{claimed_original:.0f}, "
        f"gerçek taban ~₺{real_base:.0f} (%{inflated_pct} şişirilmiş). "
        f"Kaynaklar: {source_breakdown}."
    )
    return AgentFinding(severity=severity, message=message, tag="suspiciousDiscount")


def _usable_comparisons(req: AnalyzeRequest) -> list[PriceComparisonOffer]:
    """Deduplicate sane current-market offers."""
    out: list[PriceComparisonOffer] = []
    seen: set[tuple[str, float]] = set()
    for offer in req.priceComparisons or []:
        if offer.price <= 0:
            continue
        key = ((offer.title or offer.source).strip().casefold(), round(offer.price, 2))
        if key in seen:
            continue
        seen.add(key)
        out.append(offer)
    return out[:8]


def _market_comparison_findings(
    *,
    displayed_price: float,
    offers: list[PriceComparisonOffer],
) -> tuple[int, list[AgentFinding], dict[str, float]]:
    """Score current price against independent current offers.

    Returns (score_bump, findings, suspicious-discount-source-values).
    The third value lets the original-price inflation check use the
    market low as another source without mixing current offers into
    the historical 30-day window.
    """
    if displayed_price <= 0 or not offers:
        return 0, [], {}

    prices = [o.price for o in offers]
    market_median = median(prices)
    market_low = min(prices)
    source_values = {"piyasa min": market_low}
    source_names = ", ".join(_short_source(o.source) for o in offers[:3])
    findings: list[AgentFinding] = []
    score = 0

    if len(offers) >= 2 and displayed_price > market_median * (1 + _MARKET_TOLERANCE):
        over = int(round((displayed_price / market_median - 1) * 100))
        score += 25
        findings.append(
            AgentFinding(
                severity="warn",
                message=(
                    f"Piyasa karşılaştırması: ₺{displayed_price:.0f}, "
                    f"{len(offers)} teklif medyanı ₺{market_median:.0f}'in %{over} üzerinde."
                ),
            )
        )
    elif displayed_price <= market_low * 1.03:
        findings.append(
            AgentFinding(
                severity="info",
                message=(
                    f"Piyasa karşılaştırması: ₺{displayed_price:.0f}, "
                    f"{len(offers)} bağımsız teklif içinde en düşük banda yakın."
                ),
            )
        )
    else:
        findings.append(
            AgentFinding(
                severity="info",
                message=(
                    f"Piyasa karşılaştırması: {len(offers)} teklif bulundu "
                    f"(medyan ₺{market_median:.0f}; kaynaklar: {source_names})."
                ),
            )
        )

    if len(offers) >= 2 and displayed_price > market_low * 1.25:
        score += 10
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"En düşük bağımsız teklif ₺{market_low:.0f}; mevcut fiyat belirgin daha yüksek.",
            )
        )

    return score, findings, source_values


def _short_source(source: str) -> str:
    source = source.replace("Bing Shopping /", "").strip()
    return source[:32] if source else "kaynak"


def run(req: AnalyzeRequest) -> AgentResult:
    price = req.product.price
    original = req.product.originalPrice
    legal_min = req.product.legalLowestPrice30d
    findings: List[AgentFinding] = []

    # Referans tarih: geçmişteki en son nokta veya bugün.
    if req.priceHistory:
        parsed = [_parse_date(p.date) for p in req.priceHistory]
        ref = max([d for d in parsed if d is not None], default=date.today())
    else:
        ref = date.today()

    window_30 = _window_prices(req.priceHistory, 30, ref)
    window_90 = _window_prices(req.priceHistory, 90, ref)
    comparisons = _usable_comparisons(req)
    market_score, market_findings, market_sources = _market_comparison_findings(
        displayed_price=price,
        offers=comparisons,
    )

    score = 0.0

    if not window_30:
        # No price-history series for this URL. We may still have the
        # on-page legal disclosure, which is a single but reliable
        # cross-check source.
        if legal_min is not None and original is not None:
            sources = {"yasal min": legal_min, **market_sources}
            sus = _suspicious_discount_check(
                displayed_price=price,
                claimed_original=original,
                sources=sources,
            )
            if sus is not None:
                findings.append(sus)
                findings.extend(market_findings)
                # We have at least one strong signal — let it land at a
                # meaningful manipulation score so the verdict reflects it.
                final_score = max(55, min(100, 55 + market_score))
                return AgentResult(score=final_score, label="Şüpheli İndirim", findings=findings)

        if comparisons:
            findings.extend(market_findings)
            final_score = max(0, min(100, market_score))
            if final_score >= 55:
                label = "Piyasa Üstü"
            elif final_score >= 25:
                label = "Piyasa Kontrolü"
            else:
                label = "Piyasa Fiyatı Uygun"
            return AgentResult(score=final_score, label=label, findings=findings)

        # Be honest about no-history. Returning score=45 with a generic
        # "Kısmi Manipülasyon" label (score 25-54) reads as a soft accusation
        # when the truth is we just don't have data. Return a neutral 0 so
        # this dimension contributes nothing to the weighted decision.
        #
        # Two flavors of "no data":
        #  - Brand-new product, no comparison/history either → "Fiyat Geçmişi Yok"
        #  - We DO know the displayed price but have no comparison points →
        #    "Tek Veri Noktası" (less alarming, more accurate framing)
        if price > 0:
            logger.info(
                "price_agent.no_history.single_point",
                extra={"event": "price_agent.no_history", "price": price, "legal_min_30d": legal_min},
            )
            findings.append(
                AgentFinding(
                    severity="info",
                    message=(
                        f"Bu ürün için bağımsız fiyat geçmişi yok; gösterilen "
                        f"₺{price:.0f} tek referans noktası."
                    ),
                )
            )
            return AgentResult(score=0, label="Tek Veri Noktası", findings=findings)
        logger.warning(
            "price_agent.no_price",
            extra={"event": "price_agent.no_price", "price": price, "url": req.product.url[:120]},
        )
        findings.append(
            AgentFinding(severity="warn", message="Bu ürün için fiyat geçmişi bulunamadı; indirim doğrulanamadı.")
        )
        return AgentResult(score=0, label="Fiyat Geçmişi Yok", findings=findings)
    else:
        # Median (not mean) — resists poisoning from crowdsourced observations.
        avg_30 = median(window_30)
        avg_90 = median(window_90) if window_90 else avg_30
        min_30 = min(window_30)

        # Sinyal 1: indirim öncesi yükseliş
        recent_max = max(window_30)
        if recent_max > avg_30 * 1.15 and price < recent_max:
            jump = (recent_max - avg_30) / avg_30
            score += min(40, jump * 100)
            findings.append(
                AgentFinding(
                    severity="risk",
                    message=(
                        f"Fiyat son 30 gün ortalaması ₺{avg_30:.0f}'iken "
                        f"indirim öncesi ₺{recent_max:.0f}'a çıkarılmış."
                    ),
                )
            )

        # Sinyal 2: gerçek indirim oranı (30 günün düşük tarafına göre)
        if original and original > price:
            claimed = (original - price) / original
            real_base = min(avg_30, original)
            real = max(0.0, (real_base - price) / real_base) if real_base else 0.0
            if real < claimed * 0.5:
                score += 25
                findings.append(
                    AgentFinding(
                        severity="warn",
                        message=(
                            f"Etikette %{int(claimed * 100)} indirim görünüyor; gerçek 30 günlük "
                            f"ortalamaya göre yaklaşık %{int(real * 100)}."
                        ),
                    )
                )

        # Sinyal 3: güncel fiyat 30 günün üst tarafında mı?
        if price > avg_30:
            score += 15
            findings.append(
                AgentFinding(
                    severity="warn",
                    message=f"Güncel fiyat ₺{price:.0f}, son 30 günlük ortalamanın (₺{avg_30:.0f}) üzerinde.",
                )
            )
        elif price <= min_30:
            findings.append(
                AgentFinding(
                    severity="info",
                    message=f"₺{price:.0f} son 30 günün en düşük fiyatına eşit veya altında.",
                )
            )

        # Sinyal 4: rakip aralığı (mock — 90g ±%15)
        if window_90:
            low = avg_90 * 0.85
            high = avg_90 * 1.15
            if price > high:
                score += 10

        # Sinyal 5 — MULTI-SOURCE suspicious discount cross-check.
        # Combines the on-page "yasal 30 günün en düşük fiyatı" disclosure
        # (when scraped by the extension) with our own DB history and
        # current market comparison. Confidence rises with agreement: two sources confirming
        # an inflated "originalPrice" is a strong manipulation signal.
        if original and original > price:
            cross_sources: dict[str, float] = {}
            if legal_min is not None and legal_min > 0:
                cross_sources["yasal min"] = legal_min
            cross_sources["30 gün medyanı"] = min_30
            cross_sources.update(market_sources)
            sus = _suspicious_discount_check(
                displayed_price=price,
                claimed_original=original,
                sources=cross_sources,
            )
            if sus is not None:
                findings.append(sus)
                # Severity-tier the score bump: two-source agreement is a
                # strong signal worth a substantial bump.
                score += 30 if sus.severity == "risk" else 15

        if comparisons:
            score += market_score
            findings.extend(market_findings)

    score = max(0, min(100, int(round(score))))

    if score < 25:
        label = "Gerçek İndirim"
    elif score < 55:
        label = "Kısmi Manipülasyon"
    elif score < 75:
        label = "Şüpheli İndirim"
    else:
        label = "Manipülasyon Riski"

    if not findings and score < 25:
        findings.append(AgentFinding(severity="info", message="İndirim oranı geçmişle tutarlı."))

    logger.info(
        "price_agent.verdict",
        extra={
            "event": "price_agent.verdict",
            "score": score,
            "label": label,
            "price": price,
            "original": original,
            "legal_min_30d": legal_min,
            "history_30d_count": len(window_30),
            "history_90d_count": len(window_90),
            "comparison_count": len(comparisons),
        },
    )
    return AgentResult(score=score, label=label, findings=findings)
