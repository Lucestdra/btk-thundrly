"""
Bütçe Agenti — satın almanın aylık ve kategori bütçesine etkisini ölçer.

Dil: TL bazlı, somut, yargılayıcı olmayan.

Skor 0–100; yüksek = bütçe açısından daha riskli.

TODO (PostgreSQL): Kullanıcı bütçesi ve harcama geçmişi DB'den gelmeli;
şu an istek payload'unda taşınıyor (MVP).
"""

from __future__ import annotations

from typing import List

from app.models.schemas import AgentFinding, AgentResult, AnalyzeRequest


def _pct(n: float, d: float) -> int:
    if d <= 0:
        return 100
    return int(round(n / d * 100))


def _category_score(pct_after: int) -> int:
    if pct_after >= 200:
        return 70
    if pct_after >= 150:
        return 55
    if pct_after >= 120:
        return 40
    if pct_after >= 100:
        return 28
    if pct_after >= 85:
        return 15
    return 0


def _monthly_score(pct_after: int) -> int:
    if pct_after >= 130:
        return 35
    if pct_after >= 110:
        return 25
    if pct_after >= 100:
        return 18
    if pct_after >= 90:
        return 8
    return 0


def run(req: AnalyzeRequest) -> AgentResult:
    if req.userBudget is None:
        # Orchestrator should always populate this, but if a caller goes
        # straight to the agent we still return a neutral result instead
        # of crashing on attribute access.
        return AgentResult(
            score=0,
            label="Bütçe Verisi Yok",
            findings=[AgentFinding(severity="info", message="Bu kullanıcı için bütçe verisi yok.")],
        )

    b = req.userBudget
    price = req.product.price
    findings: List[AgentFinding] = []

    cat_after = b.categorySpent + price
    cat_pct = _pct(cat_after, b.categoryLimit)
    monthly_spent = b.monthlySpent if b.monthlySpent is not None else b.categorySpent
    monthly_after = monthly_spent + price
    mon_pct = _pct(monthly_after, b.monthlyLimit)

    cat_score = _category_score(cat_pct)
    mon_score = _monthly_score(mon_pct)
    score = max(0, min(100, cat_score + mon_score))

    # Kategori bulguları
    if b.categorySpent >= b.categoryLimit:
        findings.append(
            AgentFinding(
                severity="risk",
                message=(
                    f"Bu ay {req.product.category.lower()} bütçesini zaten "
                    f"%{_pct(b.categorySpent, b.categoryLimit)} oranında aşmış durumdasın."
                ),
            )
        )
    elif cat_after > b.categoryLimit:
        over = cat_after - b.categoryLimit
        findings.append(
            AgentFinding(
                severity="risk",
                message=(
                    f"Bu satın alma sonrası {req.product.category.lower()} kategorisi "
                    f"limitin %{cat_pct}'sine çıkacak (₺{over:.0f} aşım)."
                ),
            )
        )
    elif cat_after > b.categoryLimit * 0.85:
        findings.append(
            AgentFinding(
                severity="warn",
                message=(
                    f"{req.product.category} kategorisinde limitin %{cat_pct}'sine yaklaşıyorsun."
                ),
            )
        )

    # Aylık bulgular
    if monthly_after > b.monthlyLimit:
        over = monthly_after - b.monthlyLimit
        findings.append(
            AgentFinding(
                severity="risk",
                message=f"Aylık bütçeyi %{mon_pct}'e taşıyacak; ₺{over:.0f} aşım.",
            )
        )
    elif monthly_after > b.monthlyLimit * 0.9:
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Aylık bütçenin %{mon_pct}'i kullanılmış olacak.",
            )
        )

    if score < 25:
        label = "Bütçe İçinde"
        if not findings:
            findings.append(
                AgentFinding(
                    severity="info",
                    message=(
                        f"{req.product.category} kategorisinde aylık limitin "
                        f"%{cat_pct}'sındasın; rahat aralıkta."
                    ),
                )
            )
    elif score < 50:
        label = "Sınırda"
    elif score < 75:
        label = "Bütçe Riski"
    else:
        label = "Bütçe Aşımı"

    return AgentResult(score=score, label=label, findings=findings)
