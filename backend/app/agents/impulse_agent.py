"""
Dürtü Agenti — kararın planlı mı yoksa dürtüsel mi olduğunu tahmin eder.

Sinyaller (toplam 100 üstü kapanır):
  - Ürün sayfasında çok az süre geçti (< 30s): +30
  - Tıklama çok hızlı (< 800 ms): +20
  - Geç saat (22–06): +20
  - Aynı gün içinde 2+ satın alma: +30
  - Ürünü daha önce aratmış → -25 (planlı sinyali)

TODO (Gemini + davranışsal model): Klikstream + ürün gezinti geçmişi
ile gerçek dürtü skorlaması yap. LangGraph node: `impulse_node`.
"""

from __future__ import annotations

from typing import List

from app.models.schemas import AgentFinding, AgentResult, AnalyzeRequest


def run(req: AnalyzeRequest) -> AgentResult:
    s = req.session
    findings: List[AgentFinding] = []
    score = 0

    if s.timeOnPageSeconds < 30:
        score += 30
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Ürün sayfasında yalnızca {int(s.timeOnPageSeconds)} saniye geçirildi.",
            )
        )

    if s.clickSpeedMs < 800:
        score += 20
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Sepete ekleme tıklaması çok hızlı ({int(s.clickSpeedMs)} ms).",
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

    return AgentResult(score=score, label=label, findings=findings)
