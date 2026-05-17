"""
Karar Agenti — 4 alt ajanın skorlarını ağırlıklandırıp tek bir karar verir.

Tasarım kararı: **karar rengi (yeşil/sarı/kırmızı) ve riskScore daima
deterministik heuristikten gelir; LLM yalnızca Türkçe doğal-dil özet,
gerekçeler ve önerilen aksiyon metnini yazar.** Bunun nedeni:

  - Karar rengi ürünün temel vaadi — açıklanabilir ve tekrarlanabilir
    olmak zorunda. LLM hallüsinasyonu burada kabul edilemez.
  - Doğal dil metin LLM'nin gerçekten parladığı yer. Heuristik çıktısı
    aynı şablona oturur, bağlamı kullanmaz; Gemini ile her karar için
    bağlamsal, doğal Türkçe üretebiliriz.

Ağırlıklar:
  Fiyat %30, Yorum %25, Bütçe %25, Dürtü %20.

Eşikler: 0-39 green, 40-69 yellow, 70-100 red. Tek bir ajan ≥ 80 ise
risk ≥ 70'e çekilir; ≥ 45 ise ≥ 42'ye (kullanıcıyı en az sarıya çıkar).
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import List, Literal, Tuple

from pydantic import BaseModel, Field

from app.agents._gemini_client import get_client, get_model_name
from app.core.cache import gemini_cache
from app.models.schemas import (
    AgentFinding,
    AgentResult,
    AgentResultMap,
    AnalyzeRequest,
    AnalyzeResponse,
    Decision,
)

logger = logging.getLogger(__name__)

WEIGHTS = {
    "price": 0.30,
    "review": 0.25,
    "budget": 0.25,
    "impulse": 0.20,
}

SEVERITY_RANK = {"risk": 3, "warn": 2, "info": 1}


# ---------- Deterministic decision (never LLM) ----------


def _compute_decision(
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> Tuple[Decision, int, str]:
    """Return (decision, risk_score, label) — pure heuristic, no LLM."""
    weighted = (
        WEIGHTS["price"] * price.score
        + WEIGHTS["review"] * review.score
        + WEIGHTS["budget"] * budget.score
        + WEIGHTS["impulse"] * impulse.score
    )
    risk_score = int(round(weighted))

    # Eskalasyon: tek bir boyut yeterince yüksekse, ağırlıklı toplam düşük
    # olsa bile kullanıcıyı en azından sarı/kırmızı seviyesinde uyar.
    single_max = max(review.score, price.score, budget.score, impulse.score)
    if single_max >= 80:
        risk_score = max(risk_score, 70)
    elif single_max >= 45:
        risk_score = max(risk_score, 42)

    risk_score = max(0, min(100, risk_score))

    if risk_score < 40:
        return ("green", risk_score, "Yeşil")
    if risk_score < 70:
        return ("yellow", risk_score, "Sarı")
    return ("red", risk_score, "Kırmızı")


# ---------- Public entry point ----------


def run(
    req: AnalyzeRequest,
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> AnalyzeResponse:
    decision, risk_score, label = _compute_decision(review, price, budget, impulse)

    client = get_client()
    if client is not None:
        try:
            return _build_with_gemini(
                client, req, decision, risk_score, label,
                review=review, price=price, budget=budget, impulse=impulse,
            )
        except Exception as exc:  # noqa: BLE001 - fall back on any Gemini error
            logger.warning("Gemini decision narration başarısız, heuristik fallback: %s", exc)

    return _build_heuristic(
        req, decision, risk_score, label,
        review=review, price=price, budget=budget, impulse=impulse,
    )


# ---------- Gemini narration ----------


class _GeminiNarration(BaseModel):
    summary: str = Field(min_length=8, max_length=160)
    reasons: List[str] = Field(min_length=2, max_length=4)
    recommendedAction: str = Field(min_length=4, max_length=80)


_SYSTEM_INSTRUCTION = (
    "Sen bir Türk e-ticaret alışveriş asistanısın. Karar rengi ve riskScore "
    "sana verilir; senin işin bunu Türkçe sade, bağlamsal bir metne dökmek. "
    "Asla yeni iddia uydurma; yalnızca aşağıda verilen ajan bulgularını sentezle. "
    "Reasons içinde tekrarlı kelimelerden ve klişelerden kaçın."
)


def _build_gemini_prompt(
    decision: Decision,
    risk_score: int,
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> str:
    def format_agent(name: str, agent: AgentResult) -> str:
        findings = "\n".join(f"  - {f.severity}: {f.message}" for f in agent.findings) or "  - (bulgu yok)"
        return f"{name} (skor {agent.score}, '{agent.label}'):\n{findings}"

    tone_hint = {
        "green": "Olumlu, 'devam edebilirsin' tonunda. Endişe yaratma.",
        "yellow": "Dengeli, 'dikkat et' tonunda. Birkaç somut noktayı vurgula.",
        "red": "Net, 'şu an alma' tonunda. Üç en güçlü riskli sinyali öne çıkar.",
    }[decision]

    return (
        f"Karar: {decision} (riskScore: {risk_score}/100)\n"
        f"Ton: {tone_hint}\n\n"
        f"{format_agent('Yorum Ajanı', review)}\n\n"
        f"{format_agent('Fiyat Ajanı', price)}\n\n"
        f"{format_agent('Bütçe Ajanı', budget)}\n\n"
        f"{format_agent('Dürtü Ajanı', impulse)}\n\n"
        "Çıktı kuralları:\n"
        "- summary: 1 cümle, ≤140 karakter. Karar rengini ima eder ama 'yeşil/sarı/kırmızı' "
        "kelimesini kullanma; verdiğin Tür eki ile durumu özetle.\n"
        "- reasons: 3 madde, her biri ≤120 karakter. Yukarıdaki ajan bulgularını sentezleyerek "
        "yaz; aynı sayıyı veya ifadeyi farklı kelimelerle iki kez kullanma.\n"
        "- recommendedAction: kısa Türkçe komut. Yeşilde 'Satın almaya devam edebilirsin', "
        "sarıda 'Birkaç noktayı tekrar gözden geçir', kırmızıda '30 saniye düşün' "
        "ifadelerine yakın ama doğal varyasyon olabilir."
    )


def _narration_cache_key(
    decision: Decision,
    risk_score: int,
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> str:
    """Stable fingerprint of the inputs that drive the narration.

    Two requests with the same decision color, riskScore, and agent
    fingerprints (score + label + findings) will produce identical
    narration prose — safe to share. Model name is part of the key so
    swapping the underlying model invalidates the cache automatically.
    """

    def fp(agent: AgentResult) -> list:
        return [
            agent.score,
            agent.label,
            [[f.severity, f.message] for f in agent.findings],
        ]

    blob = json.dumps(
        [
            get_model_name(),
            decision,
            risk_score,
            fp(review),
            fp(price),
            fp(budget),
            fp(impulse),
        ],
        ensure_ascii=False,
    ).encode("utf-8")
    return "dec:" + hashlib.sha256(blob).hexdigest()


def _build_with_gemini(
    client,
    req: AnalyzeRequest,
    decision: Decision,
    risk_score: int,
    label: str,
    *,
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> AnalyzeResponse:
    cache_key = _narration_cache_key(decision, risk_score, review, price, budget, impulse)
    narration = gemini_cache.get(cache_key)

    if narration is None:
        prompt = _build_gemini_prompt(decision, risk_score, review, price, budget, impulse)
        response = client.models.generate_content(
            model=get_model_name(),
            contents=prompt,
            config={
                "system_instruction": _SYSTEM_INSTRUCTION,
                "response_mime_type": "application/json",
                "response_schema": _GeminiNarration,
                "temperature": 0.35,
            },
        )

        parsed = getattr(response, "parsed", None) or _safe_parse(response)
        if isinstance(parsed, dict):
            narration = _GeminiNarration.model_validate(parsed)
        elif isinstance(parsed, _GeminiNarration):
            narration = parsed
        else:
            narration = _GeminiNarration.model_validate_json(response.text)

        gemini_cache.set(cache_key, narration)

    # Trim to exactly 3 reasons for the contract.
    reasons = list(narration.reasons)[:3]
    if len(reasons) < 1:
        reasons = ["Yeterli sinyal bulunamadı."]

    return AnalyzeResponse(
        decision=decision,
        riskScore=risk_score,
        summary=narration.summary.strip(),
        reasons=reasons,
        agents=_make_agent_map(decision, risk_score, label, review, price, budget, impulse),
        recommendedAction=narration.recommendedAction.strip(),
    )


def _safe_parse(response) -> dict | None:
    text = getattr(response, "text", None)
    if not text:
        return None
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


# ---------- Heuristic narration (fallback) ----------


def _build_heuristic(
    req: AnalyzeRequest,
    decision: Decision,
    risk_score: int,
    label: str,
    *,
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> AnalyzeResponse:
    summary = _summary_template(decision)
    reasons = _pick_top_reasons(review, price, budget, impulse) or ["Yeterli sinyal bulunamadı."]
    return AnalyzeResponse(
        decision=decision,
        riskScore=risk_score,
        summary=summary,
        reasons=reasons,
        agents=_make_agent_map(decision, risk_score, label, review, price, budget, impulse),
        recommendedAction=_recommended_action(decision),
    )


def _summary_template(decision: Decision) -> str:
    if decision == "green":
        return "Bu satın alma düşük riskli görünüyor."
    if decision == "yellow":
        return "Devam etmeden önce birkaç noktayı kontrol et."
    return "Bu satın alma yüksek riskli görünüyor."


def _recommended_action(decision: Decision) -> str:
    if decision == "green":
        return "Satın almaya devam edebilirsin"
    if decision == "yellow":
        return "Birkaç noktayı tekrar gözden geçir"
    return "30 saniye düşün"


def _pick_top_reasons(
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> List[str]:
    pool: List[Tuple[int, AgentFinding]] = []
    for agent in (price, review, budget, impulse):
        for f in agent.findings:
            pool.append((SEVERITY_RANK.get(f.severity, 0) * 100 + agent.score, f))
    pool.sort(key=lambda x: x[0], reverse=True)

    reasons: List[str] = []
    seen: set[str] = set()
    for _, f in pool:
        if f.message in seen:
            continue
        seen.add(f.message)
        reasons.append(f.message)
        if len(reasons) >= 3:
            break
    return reasons


# ---------- Shared: agent map assembly ----------


def _make_agent_map(
    decision: Decision,
    risk_score: int,
    label: str,
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> AgentResultMap:
    decision_severity: Literal["info", "warn", "risk"] = (
        "risk" if decision == "red" else "warn" if decision == "yellow" else "info"
    )
    decision_agent_result = AgentResult(
        score=risk_score,
        label=label,
        findings=[
            AgentFinding(
                severity=decision_severity,
                message=f"Ağırlıklı toplam {risk_score}; eşik {label.lower()}.",
            ),
        ],
    )
    return AgentResultMap(
        reviewAgent=review,
        priceAgent=price,
        budgetAgent=budget,
        impulseAgent=impulse,
        decisionAgent=decision_agent_result,
    )
