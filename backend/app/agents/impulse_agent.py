"""
Dürtü Agenti — kararın planlı mı yoksa dürtüsel mi olduğunu tahmin eder.

Sinyaller (toplam 100 üstü kapanır):
  - Ürün sayfasında çok az süre geçti (< 8s): +30
  - Tıklama anormal hızlı (< 60 ms, sentetik): +20
  - Geç saat (22–06): +20
  - Aynı gün içinde 2+ satın alma: +30
  - Ürünü daha önce aratmış → -25 (planlı sinyali)

Eşik notları (Mayıs 2026 ayarlamaları):
  - timeOnPage 30s → 8s: gerçek bir kullanıcı 30 saniye boyunca ürün
    incelemeden satın almıyor olabilir; ama "dürtüsel" çağrısı 30 sn
    eşiğinde abartılı oluyordu. 8 sn bilinçli düşünme için bile dar.
  - clickSpeedMs 800ms → 60ms: insanın mousedown→click süresi tipik
    olarak 80–250 ms; 800 ms eşiği her gerçek tıklamayı flagliyordu.
    60 ms = senkron/programatik tıklama (örn. otomatik form doldurma).
"""

from __future__ import annotations

import logging
from typing import List

from app.models.schemas import AgentFinding, AgentResult, AnalyzeRequest

logger = logging.getLogger(__name__)


def run(req: AnalyzeRequest) -> AgentResult:
    s = req.session
    findings: List[AgentFinding] = []
    score = 0

    if s.timeOnPageSeconds < 8:
        score += 35
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Ürün sayfasında yalnızca {int(s.timeOnPageSeconds)} saniye geçirildi.",
            )
        )

    elif s.timeOnPageSeconds < 20:
        score += 15
        findings.append(
            AgentFinding(
                severity="info",
                message=f"Ürün sayfasında {int(s.timeOnPageSeconds)} saniye geçirildi; karar süresi kısa.",
            )
        )

    if s.clickSpeedMs < 60:
        score += 25
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Tıklama anormal hızlı ({int(s.clickSpeedMs)} ms) — otomatik form sinyali olabilir.",
            )
        )

    elif s.clickSpeedMs < 120:
        score += 15
        findings.append(
            AgentFinding(
                severity="info",
                message=f"Tıklama çok hızlı ({int(s.clickSpeedMs)} ms); hafif dürtü sinyali.",
            )
        )

    if s.currentHour >= 22 or s.currentHour < 6:
        score += 20
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Saat {s.currentHour:02d}:00 — geç saatte verilen kararlar daha sık geri iade ediliyor.",
            )
        )

    if s.purchasesToday >= 2:
        score += 30
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Bugün zaten {s.purchasesToday} satın alma yapıldı.",
            )
        )

    if s.searchedBefore:
        score -= 25
        findings.append(
            AgentFinding(
                severity="info",
                message="Bu ürün daha önce aratılmış; planlı bir karar gibi görünüyor.",
            )
        )

    score = max(0, min(100, score))

    if score < 25:
        label = "Planlı"
        if not findings:
            findings.append(AgentFinding(severity="info", message="Dürtüsel sinyal yok."))
    elif score < 55:
        label = "Karışık Sinyal"
    elif score < 75:
        label = "Dürtüsel Risk"
    else:
        label = "Yüksek Dürtü Riski"

    # Tag the headline finding when impulse is in the elevated band — the
    # decision rule engine combines this with other tags (suspiciousDiscount,
    # lowReviewTrust) to trigger cross-agent escalations.
    if score >= 60 and findings:
        # Tag the first risk/warn finding so it's the user-facing one;
        # safer than mutating a possibly-info-only fallback line.
        for f in findings:
            if f.severity in ("warn", "risk"):
                # Pydantic models are immutable by default; rebuild with tag.
                findings[findings.index(f)] = AgentFinding(
                    severity=f.severity,
                    message=f.message,
                    tag="impulseHigh",
                )
                break

    logger.info(
        "impulse_agent.verdict",
        extra={
            "event": "impulse_agent.verdict",
            "score": score,
            "label": label,
            "time_on_page_s": s.timeOnPageSeconds,
            "click_speed_ms": s.clickSpeedMs,
            "time_of_day": getattr(s, "timeOfDay", None) or getattr(s, "hourOfDay", None),
            "purchases_today": getattr(s, "purchasesToday", None),
        },
    )
    return AgentResult(score=score, label=label, findings=findings)
