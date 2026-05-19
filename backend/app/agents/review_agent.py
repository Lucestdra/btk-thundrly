"""
Yorum Agenti — yorumların güvenilirliğini ölçer.

İki yol:
  1) GEMINI_API_KEY set ise: Gemini'ye yorumları gönder, structured JSON
     döndürmesini iste, sonucu AgentResult'a dönüştür. LLM tarafında daha
     zengin doğal-dil gerekçeler üretilebilir; sınıflandırma daha iyi.
  2) API key yoksa veya Gemini çağrısı başarısızsa: deterministik
     heuristikler. Aynı çıktı şeması; demo verisi olmadan da çalışır.

Skorlama iki boyutlu:

  * **manipulation_score** (0-100, yüksek = daha şüpheli) — yorumların
    sahte/koordineli olma olasılığı. Bu, agent'ın headline `score` alanını
    sürer.
  * **trust_score** (0-100, yüksek = daha güvenilir) — yorum havuzunun
    karar verilebilirlik kalitesi. Düşük trust + yüksek manipülasyon =
    decision_agent için eskalasyon sinyali.

Sinyaller:
  - Tekrarlayan / neredeyse aynı yorumlar (kelime kümesi Jaccard ≥ 0.6)
  - Jenerik Türkçe ifadeler ("hızlı kargo", "çok güzel ürün"...)
  - 5 yıldız + çok kısa metin (< 24 karakter)
  - Yorumların kısa bir pencerede yığılması (burst)
  - Aynı yazarın birden fazla yorumu (sahte hesap kümesi)
  - Verified-purchase oranı düşükse (platform veriyorsa)
  - Helpful-vote'ları çok düşük yorumlar (platform veriyorsa)
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter
from datetime import date, datetime
from typing import List, Literal, Tuple

from pydantic import BaseModel, Field

from app.agents._gemini_resilience import gemini_call
from app.agents._llm import LLMClient, get_llm_client
from app.core.cache import REVIEW_CACHE_TTL, gemini_cache
from app.models.schemas import AgentFinding, AgentResult, AnalyzeRequest, Review

logger = logging.getLogger(__name__)

GENERIC_PHRASES = (
    "hızlı kargo",
    "çok güzel ürün",
    "çok güzel",
    "mükemmel kalite",
    "mükemmel ürün",
    "tavsiye ederim",
    "süper kalite",
    "kalite süper",
    "tam istediğim gibi",
)


# ---------- Public entry point ----------


def run(req: AnalyzeRequest, *, force_refresh: bool = False) -> AgentResult:
    """Dispatch to Gemini when available; fall back to heuristics on any error.

    ``force_refresh=True`` bypasses the response cache for this call —
    used by the ``?force_refresh=true`` query on the analyze endpoint
    when the user explicitly asks to re-analyze.
    """
    if not req.reviews:
        logger.info(
            "review_agent.no_reviews",
            extra={
                "event": "review_agent.no_reviews",
                "url": req.product.url[:120],
                "page_review_count": req.product.reviewCount,
            },
        )
        if req.product.reviewCount and req.product.reviewCount > 0:
            count = req.product.reviewCount
            rating = req.product.rating
            findings = [
                AgentFinding(
                    severity="info",
                    message=(
                        f"Sayfada {count} yorum/değerlendirme görünüyor; "
                        "metinler alınamadığı için manipülasyon analizi sınırlı."
                    ),
                )
            ]
            if rating is not None:
                findings.insert(
                    0,
                    AgentFinding(
                        severity="info",
                        message=f"Toplam puan {rating:.1f}/5 ve {count} yorum sinyali var.",
                    ),
                )
            # Aggregate count/rating is partial evidence, not "no data".
            # Keep score modest so it does not dominate text-level trust
            # analysis, but stop telling the user there are no comments.
            score = 18 if rating is not None and rating >= 4.0 and count >= 20 else 28
            return AgentResult(score=score, label="Yorum Özeti Var", findings=findings)
        return AgentResult(
            score=35,
            label="Yorum Verisi Yok",
            findings=[AgentFinding(severity="warn", message="Bu ürün için yeterli yorum verisi yok.")],
        )

    client = get_llm_client()
    if client is not None:
        try:
            result = _run_with_llm(client, req, force_refresh=force_refresh)
            logger.info(
                "review_agent.verdict",
                extra={
                    "event": "review_agent.verdict",
                    "path": client.provider,
                    "model": client.model,
                    "score": result.score,
                    "label": result.label,
                    "reviews_seen": len(req.reviews),
                },
            )
            return result
        except Exception as exc:  # noqa: BLE001 - fall back on any LLM error
            logger.warning("LLM çağrısı başarısız, heuristik fallback: %s", exc)

    result = _run_heuristic(req)
    logger.info(
        "review_agent.verdict",
        extra={
            "event": "review_agent.verdict",
            "path": "heuristic",
            "score": result.score,
            "label": result.label,
            "reviews_seen": len(req.reviews),
        },
    )
    return result


# ---------- Gemini path ----------


class _GeminiFinding(BaseModel):
    severity: Literal["info", "warn", "risk"]
    message: str


class _GeminiVerdict(BaseModel):
    # 1-2 sentence chain-of-thought BEFORE the verdict. The model is
    # asked to summarize the key signals it weighed; the field is
    # captured for observability (logged via _log_reasoning) but is
    # NOT propagated to the user — we want the prose to stay tight.
    # Optional so older cached responses parse without re-fetch.
    reasoning: str | None = Field(default=None, max_length=400)
    score: int = Field(ge=0, le=100)
    label: str = Field(min_length=1, max_length=60)
    findings: List[_GeminiFinding] = Field(min_length=1, max_length=5)


_SYSTEM_INSTRUCTION = (
    "Sen bir Türk e-ticaret yorum güvenilirlik analistisin. Yorumlardaki "
    "manipülasyon ve sahte review örüntülerini Türkçe değerlendirirsin. "
    "Cevapların kısa, somut ve veriye dayalı olmalı; uydurma istatistik üretme. "
    "Mümkün olduğunda 'verified purchase oranı', 'yazar tekrarı', 'metin "
    "benzerlik kümesi' gibi somut sinyallere atıf yap."
)


def _build_prompt(reviews: List[Review], trust_summary: dict) -> str:
    lines = [
        "Aşağıdaki Türk e-ticaret yorumlarını incele ve manipülasyon riskini puanla.",
        "",
        "Aranan sinyaller:",
        "- Neredeyse aynı tekrarlayan yorumlar (koordineli sahte review pattern)",
        '- Jenerik ifadeler ("hızlı kargo", "çok güzel ürün", "tavsiye ederim")',
        "- 5 yıldız + çok kısa metin (gerçek değerlendirme yok)",
        "- Yorumların kısa bir zaman penceresinde yığılması (burst)",
        "- Aynı yazarın birden fazla yorumu",
        "- Düşük verified-purchase oranı",
        "- Anormal yazım/dil örüntüleri",
        "",
        "Heuristik analizden ön-hesaplanan sinyaller:",
        f"- Tekrarlı yorum çifti sayısı: {trust_summary['duplicate_pairs']}",
        f"- Jenerik ifade oranı: %{int(trust_summary['generic_ratio'] * 100)}",
        f"- 5★+kısa metin sayısı: {trust_summary['short_five']}",
        f"- Son 4 günde yorum oranı: %{int(trust_summary['burst_ratio'] * 100)}",
        f"- Aynı yazar tekrarı: {trust_summary['author_repeats']}",
        f"- Verified-purchase oranı: {trust_summary['verified_ratio_str']}",
        f"- Trust skoru (heuristik): {trust_summary['trust_score']}/100",
        "",
        "Çıktı şeması:",
        '- reasoning: 1-2 cümle. Önce hangi sinyallere ağırlık verdiğini özetle. '
        "Bu alan kullanıcıya gösterilmez; sadece denetim/log için.",
        '- score: 0-100 tamsayı, yüksek = daha şüpheli',
        '- label: "Güvenilir" | "Büyük Ölçüde Güvenilir" | "Şüpheli" | "Yüksek Manipülasyon Riski"',
        "- findings: 1-5 adet {severity, message}. severity ∈ {info, warn, risk}.",
        "  message Türkçe, kısa (≤120 karakter), somut sayı/oran içerebilir.",
        "  En az bir bulgu trust skoruna veya verified-purchase oranına atıfta bulunsun.",
        "",
        "ÖNEMLİ: reasoning alanını mutlaka doldur ve verdiğin önce orada düşünüldüğünü göster.",
        "",
        f"Yorum sayısı: {len(reviews)}",
        "Yorumlar:",
    ]
    for i, r in enumerate(reviews, start=1):
        text = r.text.replace("\n", " ").strip()
        verified = " ✓" if r.verifiedPurchase else ""
        author = f" @{r.author}" if r.author else ""
        lines.append(f"{i}. [{r.rating}⭐ {r.date}{verified}{author}] {text}")
    return "\n".join(lines)


def _url_hash(url: str) -> str:
    """Short hash of a URL, used as a key segment for targeted invalidation."""
    return hashlib.sha1((url or "").encode("utf-8")).hexdigest()[:16]


def _active_model_tag() -> str:
    """Cache-key segment identifying the active LLM provider+model."""
    client = get_llm_client()
    if client is None:
        return "no-llm"
    return f"{client.provider}:{client.model}"


def _reviews_cache_key(req: AnalyzeRequest) -> str:
    """Stable fingerprint of the review set, scoped by (user, url).

    Order-insensitive (we sort first) so the same set in different orders
    hits the same cache slot. Includes the model name to invalidate the
    cache when ops change which Gemini model serves the agent. The
    ``u=...`` and ``p=...`` segments let
    :func:`app.core.cache.invalidate_for_user` /
    :func:`app.core.cache.invalidate_for_url` drop just the affected
    entries when a budget or price observation lands.
    """
    fingerprint = sorted(
        (
            r.rating,
            r.text.strip(),
            r.date,
            r.author or "",
            r.verifiedPurchase,
        )
        for r in req.reviews
    )
    blob = json.dumps([_active_model_tag(), fingerprint], ensure_ascii=False).encode("utf-8")
    digest = hashlib.sha256(blob).hexdigest()
    return f"rev::u={req.userId}:p={_url_hash(req.product.url)}:{digest}"


def _run_with_llm(client: LLMClient, req: AnalyzeRequest, *, force_refresh: bool = False) -> AgentResult:
    cache_key = _reviews_cache_key(req)
    if not force_refresh:
        cached = gemini_cache.get(cache_key)
        if cached is not None:
            return cached

    # Compute the trust summary first so the prompt can cite it; if the
    # LLM is unreachable we already have a fully-formed heuristic
    # verdict to fall back on.
    trust_summary = _compute_trust_summary(req.reviews)
    prompt = _build_prompt(req.reviews, trust_summary)
    verdict: _GeminiVerdict = gemini_call(
        lambda: client.generate_json(
            prompt=prompt,
            system_instruction=_SYSTEM_INSTRUCTION,
            schema=_GeminiVerdict,
            temperature=0.2,
        ),
        label="review_agent",
    )

    if verdict.reasoning:
        # Logged for observability — useful when a verdict surprises a
        # human reviewer. Not surfaced in the user-facing response.
        logger.info(
            "review_agent.reasoning",
            extra={"event": "review_agent.reasoning", "reasoning": verdict.reasoning[:300]},
        )

    findings = [AgentFinding(severity=f.severity, message=f.message) for f in verdict.findings]
    # Always append the headline trust signal even if Gemini missed it —
    # downstream UI / decision_agent rely on a deterministic trust line.
    # Tag it as `lowReviewTrust` when trust score < 30 so the decision
    # rule engine can pick it up for cross-agent escalations.
    trust_score = trust_summary["trust_score"]
    findings.append(
        AgentFinding(
            severity="info" if trust_score >= 60 else "warn",
            message=f"Güven skoru {trust_score}/100 — {trust_summary['trust_label']}.",
            tag="lowReviewTrust" if trust_score < 30 else None,
        )
    )

    result = AgentResult(
        score=verdict.score,
        label=verdict.label,
        findings=findings,
    )
    gemini_cache.set(cache_key, result, ttl=REVIEW_CACHE_TTL)
    return result


# ---------- Heuristic fallback ----------


def _tokens(text: str) -> set[str]:
    text = re.sub(r"[^\wçğıöşüÇĞİÖŞÜ\s]", " ", text.lower())
    return set(t for t in text.split() if len(t) >= 3)


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _parse_date(s: str) -> date | None:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _compute_trust_summary(reviews: List[Review]) -> dict:
    """Pre-compute the structured trust signals.

    The Gemini path cites these in the prompt; the heuristic fallback
    derives its score from the same numbers. Keeping the computation in
    one place avoids the two paths drifting apart.
    """
    n = len(reviews)
    token_sets = [_tokens(r.text) for r in reviews]

    duplicate_pairs = 0
    for i in range(n):
        for j in range(i + 1, n):
            if _jaccard(token_sets[i], token_sets[j]) >= 0.6:
                duplicate_pairs += 1

    generic_hits = sum(
        1 for r in reviews if any(p in r.text.lower() for p in GENERIC_PHRASES)
    )
    generic_ratio = generic_hits / n if n else 0.0

    short_five = sum(1 for r in reviews if r.rating >= 5 and len(r.text) < 24)

    dates = [d for d in (_parse_date(r.date) for r in reviews) if d is not None]
    burst_ratio = 0.0
    if dates:
        cnt = Counter(dates)
        latest = max(cnt)
        burst_ratio = sum(c for d, c in cnt.items() if (latest - d).days <= 3) / n

    # Author repetition: how many reviews come from authors that appear
    # more than once. Sock-puppet farms reuse the same handle across
    # products; on a single PDP this catches obvious bot clusters.
    authors_present = [r.author.strip() for r in reviews if r.author and r.author.strip()]
    author_repeats = 0
    if authors_present:
        c = Counter(authors_present)
        author_repeats = sum(cnt for cnt in c.values() if cnt > 1)

    # Verified-purchase ratio across reviews that report it. Absent flag
    # ≠ "unverified" — many platforms don't expose the badge, so we only
    # count reviews where the field was populated either way.
    verified_present = [r for r in reviews if r.verifiedPurchase is not None]
    if verified_present:
        verified_count = sum(1 for r in verified_present if r.verifiedPurchase)
        verified_ratio = verified_count / len(verified_present)
        verified_ratio_str = f"%{int(verified_ratio * 100)} ({verified_count}/{len(verified_present)})"
    else:
        verified_ratio = None  # unknown
        verified_ratio_str = "veri yok"

    # ----- Compose trust score (0-100, higher = more trustworthy) -----
    # Start at 70 (neutral-positive), subtract penalties.
    trust = 70.0
    penalties: List[Tuple[str, float]] = []
    if duplicate_pairs >= 3:
        p = min(35, duplicate_pairs * 6)
        penalties.append((f"tekrar çiftleri ({duplicate_pairs})", p))
        trust -= p
    if generic_ratio >= 0.4:
        p = min(20, generic_ratio * 30)
        penalties.append((f"jenerik dil oranı %{int(generic_ratio * 100)}", p))
        trust -= p
    if n and short_five / n >= 0.4:
        p = min(15, (short_five / n) * 25)
        penalties.append((f"5★+kısa metin oranı %{int(short_five / n * 100)}", p))
        trust -= p
    if burst_ratio >= 0.6:
        p = 15
        penalties.append((f"son 4 günde yığılma %{int(burst_ratio * 100)}", p))
        trust -= p
    if author_repeats >= 2:
        p = min(20, author_repeats * 4)
        penalties.append((f"yazar tekrarı ({author_repeats} yorum)", p))
        trust -= p
    if verified_ratio is not None:
        if verified_ratio < 0.3:
            p = (0.3 - verified_ratio) * 80
            penalties.append((f"düşük verified-purchase oranı %{int(verified_ratio * 100)}", p))
            trust -= p
        elif verified_ratio >= 0.7:
            # Bonus when the platform confirms most reviewers actually bought.
            trust += 10

    trust = max(0, min(100, int(round(trust))))

    if trust >= 70:
        trust_label = "yüksek"
    elif trust >= 45:
        trust_label = "orta"
    else:
        trust_label = "düşük"

    return {
        "duplicate_pairs": duplicate_pairs,
        "generic_ratio": generic_ratio,
        "short_five": short_five,
        "burst_ratio": burst_ratio,
        "author_repeats": author_repeats,
        "verified_ratio": verified_ratio,
        "verified_ratio_str": verified_ratio_str,
        "trust_score": trust,
        "trust_label": trust_label,
        "penalties": penalties,
    }


def _run_heuristic(req: AnalyzeRequest) -> AgentResult:
    reviews: List[Review] = req.reviews
    n = len(reviews)
    summary = _compute_trust_summary(reviews)
    findings: List[AgentFinding] = []

    # Manipulation score = inverted trust + a few targeted bumps that the
    # trust score by itself wouldn't capture.
    score = 100 - summary["trust_score"]

    if summary["duplicate_pairs"] >= 3:
        findings.append(
            AgentFinding(
                severity="risk",
                message=f"{summary['duplicate_pairs']} yorum çiftinde neredeyse aynı ifadeler tekrar ediyor.",
            )
        )

    if summary["generic_ratio"] >= 0.5:
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Yorumların %{int(summary['generic_ratio'] * 100)}'i jenerik ifadelerden oluşuyor.",
            )
        )

    if summary["short_five"] >= 3:
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"{summary['short_five']} adet 5 yıldız + çok kısa metin var; gerçek değerlendirme zayıf.",
            )
        )

    if summary["burst_ratio"] >= 0.6:
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Yorumların %{int(summary['burst_ratio'] * 100)}'i son 4 günde yazılmış.",
            )
        )

    if summary["author_repeats"] >= 2:
        findings.append(
            AgentFinding(
                severity="risk",
                message=f"{summary['author_repeats']} yorum aynı yazar(lar)dan; sahte hesap kümesi sinyali.",
            )
        )

    if summary["verified_ratio"] is not None and summary["verified_ratio"] < 0.3:
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Verified-purchase oranı %{int(summary['verified_ratio'] * 100)} — gerçek alıcı azlığı.",
            )
        )

    # Always end with the trust headline so downstream renderers + the
    # decision agent have a stable, parseable summary line. Below
    # trust_score=30 we also tag it so the rule engine can pick it up
    # for cross-agent escalations.
    trust_score = summary["trust_score"]
    findings.append(
        AgentFinding(
            severity="info" if trust_score >= 60 else "warn",
            message=f"Güven skoru {trust_score}/100 — {summary['trust_label']}.",
            tag="lowReviewTrust" if trust_score < 30 else None,
        )
    )

    score = max(0, min(100, int(round(score))))

    if score < 25:
        label = "Güvenilir"
    elif score < 55:
        label = "Büyük Ölçüde Güvenilir"
    elif score < 75:
        label = "Şüpheli"
    else:
        label = "Yüksek Manipülasyon Riski"

    return AgentResult(score=score, label=label, findings=findings)
