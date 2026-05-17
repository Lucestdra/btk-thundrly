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

from datetime import date, datetime, timedelta
from statistics import median
from typing import List

from app.models.schemas import AgentFinding, AgentResult, AnalyzeRequest, PriceHistoryPoint


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


def run(req: AnalyzeRequest) -> AgentResult:
    price = req.product.price
    original = req.product.originalPrice
    findings: List[AgentFinding] = []

    # Referans tarih: geçmişteki en son nokta veya bugün.
    if req.priceHistory:
        parsed = [_parse_date(p.date) for p in req.priceHistory]
        ref = max([d for d in parsed if d is not None], default=date.today())
    else:
        ref = date.today()

    window_30 = _window_prices(req.priceHistory, 30, ref)
    window_90 = _window_prices(req.priceHistory, 90, ref)

    score = 0.0

    if not window_30:
        findings.append(
            AgentFinding(severity="warn", message="Yeterli fiyat geçmişi yok; indirim doğrulanamadı.")
        )
        score = 45
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

    return AgentResult(score=score, label=label, findings=findings)
