"""
Yorum Agenti — yorumların güvenilirliğini ölçer.

İki yol:
  1) GEMINI_API_KEY set ise: Gemini'ye yorumları gönder, structured JSON
     döndürmesini iste, sonucu AgentResult'a dönüştür. LLM tarafında daha
     zengin doğal-dil gerekçeler üretilebilir; sınıflandırma daha iyi.
  2) API key yoksa veya Gemini çağrısı başarısızsa: deterministik
     heuristikler. Aynı çıktı şeması; demo verisi olmadan da çalışır.

Heuristik sinyalleri (fallback):
  - Tekrarlayan / neredeyse aynı yorumlar (kelime kümesi Jaccard ≥ 0.6).
  - Jenerik Türkçe ifadeler ("hızlı kargo", "çok güzel ürün"...).
  - 5 yıldız + çok kısa metin (< 20 karakter).
  - Yorumların kısa bir pencerede yığılması (burst).

Skor 0-100; yüksek = daha şüpheli.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter
from datetime import date, datetime
from typing import List, Literal

from pydantic import BaseModel, Field

from app.agents._gemini_client import get_client, get_model_name
from app.core.cache import gemini_cache
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


def run(req: AnalyzeRequest) -> AgentResult:
    """Dispatch to Gemini when available; fall back to heuristics on any error."""
    if not req.reviews:
        return AgentResult(
            score=35,
            label="Yorum Verisi Yok",
            findings=[AgentFinding(severity="warn", message="Bu ürün için yeterli yorum verisi yok.")],
        )

    client = get_client()
    if client is not None:
        try:
            return _run_with_gemini(client, req)
        except Exception as exc:  # noqa: BLE001 - fall back on any Gemini error
            logger.warning("Gemini çağrısı başarısız, heuristik fallback: %s", exc)

    return _run_heuristic(req)


# ---------- Gemini path ----------


class _GeminiFinding(BaseModel):
    severity: Literal["info", "warn", "risk"]
    message: str


class _GeminiVerdict(BaseModel):
    score: int = Field(ge=0, le=100)
    label: str = Field(min_length=1, max_length=60)
    findings: List[_GeminiFinding] = Field(min_length=1, max_length=5)


_SYSTEM_INSTRUCTION = (
    "Sen bir Türk e-ticaret yorum güvenilirlik analistisin. Yorumlardaki "
    "manipülasyon ve sahte review örüntülerini Türkçe değerlendirirsin. "
    "Cevapların kısa, somut ve veriye dayalı olmalı; uydurma istatistik üretme."
)


def _build_prompt(reviews: List[Review]) -> str:
    lines = [
        "Aşağıdaki Türk e-ticaret yorumlarını incele ve manipülasyon riskini puanla.",
        "",
        "Aranan sinyaller:",
        "- Neredeyse aynı tekrarlayan yorumlar (koordineli sahte review pattern)",
        '- Jenerik ifadeler ("hızlı kargo", "çok güzel ürün", "tavsiye ederim")',
        "- 5 yıldız + çok kısa metin (gerçek değerlendirme yok)",
        "- Yorumların kısa bir zaman penceresinde yığılması (burst)",
        "- Anormal yazım/dil örüntüleri",
        "",
        "Çıktı şeması:",
        '- score: 0-100 tamsayı, yüksek = daha şüpheli',
        '- label: "Güvenilir" | "Büyük Ölçüde Güvenilir" | "Şüpheli" | "Yüksek Manipülasyon Riski"',
        "- findings: 1-5 adet {severity, message}. severity ∈ {info, warn, risk}.",
        "  message Türkçe, kısa (≤120 karakter), somut sayı/oran içerebilir.",
        "",
        f"Yorum sayısı: {len(reviews)}",
        "Yorumlar:",
    ]
    for i, r in enumerate(reviews, start=1):
        text = r.text.replace("\n", " ").strip()
        lines.append(f"{i}. [{r.rating}⭐ {r.date}] {text}")
    return "\n".join(lines)


def _reviews_cache_key(reviews: List[Review]) -> str:
    """Stable fingerprint of the review set.

    Order-insensitive (we sort first) so the same set in different orders
    hits the same cache slot. Includes the model name to invalidate the
    cache when ops change which Gemini model serves the agent.
    """
    fingerprint = sorted(
        (r.rating, r.text.strip(), r.date) for r in reviews
    )
    blob = json.dumps([get_model_name(), fingerprint], ensure_ascii=False).encode("utf-8")
    return "rev:" + hashlib.sha256(blob).hexdigest()


def _run_with_gemini(client, req: AnalyzeRequest) -> AgentResult:
    cache_key = _reviews_cache_key(req.reviews)
    cached = gemini_cache.get(cache_key)
    if cached is not None:
        return cached

    prompt = _build_prompt(req.reviews)
    response = client.models.generate_content(
        model=get_model_name(),
        contents=prompt,
        config={
            "system_instruction": _SYSTEM_INSTRUCTION,
            "response_mime_type": "application/json",
            "response_schema": _GeminiVerdict,
            "temperature": 0.2,
        },
    )

    # The SDK exposes parsed text via .text; some versions also expose .parsed.
    raw = getattr(response, "parsed", None) or _safe_parse(response)
    if isinstance(raw, dict):
        verdict = _GeminiVerdict.model_validate(raw)
    elif isinstance(raw, _GeminiVerdict):
        verdict = raw
    else:
        verdict = _GeminiVerdict.model_validate_json(response.text)

    result = AgentResult(
        score=verdict.score,
        label=verdict.label,
        findings=[AgentFinding(severity=f.severity, message=f.message) for f in verdict.findings],
    )
    gemini_cache.set(cache_key, result)
    return result


def _safe_parse(response) -> dict | None:
    """Best-effort: hand back a dict if the SDK gave us JSON text."""
    text = getattr(response, "text", None)
    if not text:
        return None
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


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


def _run_heuristic(req: AnalyzeRequest) -> AgentResult:
    reviews: List[Review] = req.reviews
    findings: List[AgentFinding] = []
    n = len(reviews)
    score = 0.0

    # 1) Pairwise jaccard — tekrar tespiti.
    token_sets = [_tokens(r.text) for r in reviews]
    duplicate_pairs = 0
    for i in range(n):
        for j in range(i + 1, n):
            if _jaccard(token_sets[i], token_sets[j]) >= 0.6:
                duplicate_pairs += 1
    duplicate_ratio = duplicate_pairs / max(1, (n * (n - 1)) / 2)
    score += min(45, duplicate_ratio * 120)
    if duplicate_pairs >= 3:
        findings.append(
            AgentFinding(
                severity="risk",
                message=f"{duplicate_pairs} yorum çiftinde neredeyse aynı ifadeler tekrar ediyor.",
            )
        )

    # 2) Jenerik ifade yoğunluğu.
    generic_hits = sum(
        1
        for r in reviews
        if any(phrase in r.text.lower() for phrase in GENERIC_PHRASES)
    )
    generic_ratio = generic_hits / n
    score += min(20, generic_ratio * 35)
    if generic_ratio >= 0.5:
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"Yorumların %{int(generic_ratio * 100)}'si jenerik ifadelerden oluşuyor.",
            )
        )

    # 3) 5 yıldız + kısa metin.
    short_five = sum(1 for r in reviews if r.rating >= 5 and len(r.text) < 24)
    short_ratio = short_five / n
    score += min(15, short_ratio * 25)
    if short_five >= 3:
        findings.append(
            AgentFinding(
                severity="warn",
                message=f"{short_five} adet 5 yıldız + çok kısa metin var; gerçek değerlendirme zayıf.",
            )
        )

    # 4) Burst — son 72 saatte yorum yığılması.
    dates = [d for d in (_parse_date(r.date) for r in reviews) if d is not None]
    if dates:
        cnt = Counter(dates)
        latest = max(cnt)
        recent_window = {d: c for d, c in cnt.items() if (latest - d).days <= 3}
        recent_ratio = sum(recent_window.values()) / n
        if recent_ratio >= 0.6:
            score += 20
            findings.append(
                AgentFinding(
                    severity="warn",
                    message=f"Yorumların %{int(recent_ratio * 100)}'i son 4 günde yazılmış.",
                )
            )

    score = max(0, min(100, int(round(score))))

    if score < 25:
        label = "Güvenilir"
        if not findings:
            findings.append(AgentFinding(severity="info", message="Yorumlar farklı yazarlar tarafından ve detaylı."))
    elif score < 55:
        label = "Büyük Ölçüde Güvenilir"
    elif score < 75:
        label = "Şüpheli"
    else:
        label = "Yüksek Manipülasyon Riski"

    return AgentResult(score=score, label=label, findings=findings)
