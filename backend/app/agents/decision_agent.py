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

from app.agents._decision_rules import evaluate as evaluate_rules
from app.agents._gemini_client import get_client, get_model_name
from app.agents._gemini_resilience import gemini_call
from app.core.cache import DECISION_CACHE_TTL, gemini_cache
from app.models.schemas import (
    AgentFinding,
    AgentResult,
    AgentResultMap,
    AnalyzeRequest,
    AnalyzeResponse,
    Decision,
    TriggeredRule,
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


# Labels emitted by signal agents when they don't have enough input to
# score honestly. The decision agent uses this set to detect "we're
# voting on too little evidence" situations and damps its escalation
# rule accordingly — better to land yellow with low confidence than red
# with no evidence.
_NO_DATA_LABELS = frozenset({
    "Yorum Verisi Yok",
    "Bütçe Verisi Yok",
    "Fiyat Geçmişi Yok",
    "Tek Veri Noktası",
})


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

    # Low-data confidence damping. When 2+ of the 4 signal agents report
    # "no data" (rather than a real score), the weighted sum is mostly
    # noise from whatever agents DID fire. In that case:
    #   - Skip the single-agent escalation entirely (one strong signal
    #     can't be trusted against a near-empty evidence base).
    #   - Cap the risk score at 55 (yellow band), since we genuinely
    #     don't have enough to justify a confident red.
    no_data_count = sum(
        1 for a in (review, price, budget, impulse) if a.label in _NO_DATA_LABELS
    )
    if no_data_count >= 2:
        risk_score = min(risk_score, 55)
    else:
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
    *,
    force_refresh: bool = False,
) -> AnalyzeResponse:
    decision, risk_score, label = _compute_decision(review, price, budget, impulse)

    # Section 6 — causal red-flag tree. Layers AND/OR rules over tagged
    # findings on top of the weighted-sum baseline. Triggered rules are
    # surfaced both as a structured response field and as additional
    # context for the narration prompt.
    agent_map = _agent_map_signals_only(review, price, budget, impulse)
    decision, risk_score, triggered = evaluate_rules(agent_map, decision, risk_score)
    label = _label_for(decision)

    logger.info(
        "decision_agent.computed",
        extra={
            "event": "decision_agent.computed",
            "decision": decision,
            "risk_score": risk_score,
            "review_score": review.score, "review_label": review.label,
            "price_score": price.score, "price_label": price.label,
            "budget_score": budget.score, "budget_label": budget.label,
            "impulse_score": impulse.score, "impulse_label": impulse.label,
            "triggered_rules": [r.name for r in triggered],
        },
    )

    client = get_client()
    if client is not None:
        try:
            response = _build_with_gemini(
                client, req, decision, risk_score, label,
                review=review, price=price, budget=budget, impulse=impulse,
                triggered_rules=triggered,
                force_refresh=force_refresh,
            )
            logger.info(
                "decision_agent.narration",
                extra={
                    "event": "decision_agent.narration",
                    "path": "gemini",
                    "model": get_model_name(),
                    "decision": decision,
                    "risk_score": risk_score,
                },
            )
            return response
        except Exception as exc:  # noqa: BLE001 - fall back on any Gemini error
            logger.warning("Gemini decision narration başarısız, heuristik fallback: %s", exc)

    logger.info(
        "decision_agent.narration",
        extra={
            "event": "decision_agent.narration",
            "path": "heuristic",
            "decision": decision,
            "risk_score": risk_score,
        },
    )
    return _build_heuristic(
        req, decision, risk_score, label,
        review=review, price=price, budget=budget, impulse=impulse,
        triggered_rules=triggered,
    )


def _label_for(decision: Decision) -> str:
    if decision == "green":
        return "Yeşil"
    if decision == "yellow":
        return "Sarı"
    return "Kırmızı"


def _agent_map_signals_only(
    review: AgentResult,
    price: AgentResult,
    budget: AgentResult,
    impulse: AgentResult,
) -> AgentResultMap:
    """Build an AgentResultMap for the rule engine.

    The rule engine only needs the four signal agents (the decision
    agent's result is what we're computing). Stub the decisionAgent
    field with an empty placeholder; the real one is filled in by
    ``_make_agent_map`` for the final response.
    """
    placeholder = AgentResult(score=0, label="", findings=[])
    return AgentResultMap(
        reviewAgent=review,
        priceAgent=price,
        budgetAgent=budget,
        impulseAgent=impulse,
        decisionAgent=placeholder,
    )


# ---------- Gemini narration ----------


class _GeminiNarration(BaseModel):
    # 1-2 sentence chain-of-thought BEFORE the user-facing narration.
    # The model explicitly weighs which agent findings dominate; we log
    # this for observability without surfacing it to the user. Optional
    # so cached responses from before the rollout still parse.
    reasoning: str | None = Field(default=None, max_length=400)
    summary: str = Field(min_length=8, max_length=160)
    reasons: List[str] = Field(min_length=2, max_length=4)
    recommendedAction: str = Field(min_length=4, max_length=80)


_SYSTEM_INSTRUCTION = (
    "Sen bir Türk e-ticaret alışveriş asistanısın. Karar rengi ve riskScore "
    "sana verilir; senin işin bunu Türkçe sade, bağlamsal bir metne dökmek. "
    "Asla yeni iddia uydurma; yalnızca aşağıda verilen ajan bulgularını sentezle. "
    "Reasons içinde tekrarlı kelimelerden ve klişelerden kaçın.\n\n"
    "KRİTİK KURALLAR (ihlal halinde çıktı atılır):\n"
    "1. Sayısal değer (%, ₺, gün, adet) ÜRETME. Yalnızca ajan bulgularında "
    "AÇIKÇA geçen sayıları aynen alıntıla. Bulgularda olmayan bir yüzde veya "
    "tutar yazmak yasaktır.\n"
    "2. Kategori adı SADECE bulgularda geçen kategoridir; başka kategori "
    "(giyim, elektronik, ev, vb.) uydurma.\n"
    "3. Bütçe ile ilgili cümleler kuracaksan, sadece bütçe ajanının "
    "bulgularını referans al — başka ajanın verisini bütçe gibi sunma."
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
        "- reasoning: 1-2 cümle. Hangi ajan bulgularının verdiği sürüklediğini ve hangilerinin "
        "ağırlık almadığını açıkla. Bu alan kullanıcıya gösterilmez; iç denetim/log içindir.\n"
        "- summary: 1 cümle, ≤140 karakter. Karar rengini ima eder ama 'yeşil/sarı/kırmızı' "
        "kelimesini kullanma; verdiğin Tür eki ile durumu özetle.\n"
        "- reasons: 3 madde, her biri ≤120 karakter. Yukarıdaki ajan bulgularını sentezleyerek "
        "yaz; aynı sayıyı veya ifadeyi farklı kelimelerle iki kez kullanma.\n"
        "- recommendedAction: kısa Türkçe komut. Yeşilde 'Satın almaya devam edebilirsin', "
        "sarıda 'Birkaç noktayı tekrar gözden geçir', kırmızıda '30 saniye düşün' "
        "ifadelerine yakın ama doğal varyasyon olabilir.\n\n"
        "ÖNEMLİ: önce reasoning'i doldur, oradaki düşünceyle tutarlı bir özet ve gerekçe üret."
    )


def _url_hash(url: str) -> str:
    """Short hash of a URL, used as a key segment for targeted invalidation."""
    return hashlib.sha1((url or "").encode("utf-8")).hexdigest()[:16]


def _narration_cache_key(
    req: AnalyzeRequest,
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

    The ``u=...`` and ``p=...`` segments scope the key to (user, url) so
    :func:`app.core.cache.invalidate_for_user` /
    :func:`app.core.cache.invalidate_for_url` can drop just the affected
    entries when a budget edit or new price observation lands.
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
    digest = hashlib.sha256(blob).hexdigest()
    return f"dec::u={req.userId}:p={_url_hash(req.product.url)}:{digest}"


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
    triggered_rules: List[TriggeredRule],
    force_refresh: bool = False,
) -> AnalyzeResponse:
    cache_key = _narration_cache_key(req, decision, risk_score, review, price, budget, impulse)
    narration = None if force_refresh else gemini_cache.get(cache_key)

    if narration is None:
        prompt = _build_gemini_prompt(decision, risk_score, review, price, budget, impulse)
        response = gemini_call(
            lambda: client.models.generate_content(
                model=get_model_name(),
                contents=prompt,
                config={
                    "system_instruction": _SYSTEM_INSTRUCTION,
                    "response_mime_type": "application/json",
                    "response_schema": _GeminiNarration,
                    "temperature": 0.35,
                },
            ),
            label="decision_agent",
        )

        parsed = getattr(response, "parsed", None) or _safe_parse(response)
        if isinstance(parsed, dict):
            narration = _GeminiNarration.model_validate(parsed)
        elif isinstance(parsed, _GeminiNarration):
            narration = parsed
        else:
            narration = _GeminiNarration.model_validate_json(response.text)

        if narration.reasoning:
            logger.info(
                "decision_agent.reasoning",
                extra={"event": "decision_agent.reasoning", "reasoning": narration.reasoning[:300]},
            )

        gemini_cache.set(cache_key, narration, ttl=DECISION_CACHE_TTL)

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
        triggeredRules=triggered_rules,
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
    triggered_rules: List[TriggeredRule],
) -> AnalyzeResponse:
    summary = _summary_template(decision)
    reasons = _pick_top_reasons(review, price, budget, impulse) or ["Yeterli sinyal bulunamadı."]
    # When the rule engine fired, surface the strongest rule's
    # explanation as the leading reason — it's almost always the most
    # actionable summary of why the verdict landed where it did.
    if triggered_rules:
        top_rule = max(triggered_rules, key=lambda r: 1 if r.severity == "risk" else 0)
        if top_rule.explanation not in reasons:
            reasons = [top_rule.explanation, *reasons][:3]
    return AnalyzeResponse(
        decision=decision,
        riskScore=risk_score,
        summary=summary,
        reasons=reasons,
        agents=_make_agent_map(decision, risk_score, label, review, price, budget, impulse),
        recommendedAction=_recommended_action(decision),
        triggeredRules=triggered_rules,
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
