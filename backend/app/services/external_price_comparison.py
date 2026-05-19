"""Best-effort current-price comparison via Bing Shopping.

Akakce/Cimri pages are frequently protected by bot challenges from a
server-side backend, which makes them a weak production dependency.
Bing Shopping still returns server-rendered offer cards in our deploy
environment, so we use it as a lightweight current-market comparison.

This is not a price-history source. It returns current offers only, and
the price agent treats them separately from the 30/90-day history.
"""

from __future__ import annotations

import hashlib
import html
import logging
import os
import re
from typing import List

import httpx

from app.core.cache import TTLCache
from app.models.schemas import PriceComparisonOffer

logger = logging.getLogger("thundrly.price_compare")

ENABLED = os.environ.get("EXTERNAL_PRICE_COMPARISON_ENABLED", "1") not in ("0", "false", "False")
TIMEOUT_SECONDS = float(os.environ.get("EXTERNAL_PRICE_COMPARISON_TIMEOUT", "6.0"))
MAX_OFFERS = int(os.environ.get("EXTERNAL_PRICE_COMPARISON_MAX_OFFERS", "8"))
SEARCH_URL = "https://www.bing.com/shop"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_cache = TTLCache(max_size=500, ttl_seconds=6 * 60 * 60, namespace="price_compare")


def fetch_for_product(title: str) -> List[PriceComparisonOffer]:
    if not ENABLED:
        return []
    if not title or len(title.strip()) < 4:
        return []

    key = _cache_key(title)
    cached = _cache.get(key)
    if cached is not None:
        logger.debug(
            "price_compare.cache.hit",
            extra={"event": "price_compare.cache.hit", "title": title[:80], "offers": len(cached)},
        )
        return cached

    offers: List[PriceComparisonOffer] = []
    try:
        offers = _fetch_uncached(title)
    except httpx.TimeoutException as exc:
        logger.warning(
            "price_compare.fetch.timeout",
            extra={"event": "price_compare.fetch.timeout", "title": title[:80], "error": str(exc)[:120]},
        )
    except httpx.HTTPError as exc:
        logger.warning(
            "price_compare.fetch.http_error",
            extra={"event": "price_compare.fetch.http_error", "title": title[:80], "error": str(exc)[:160]},
        )
    except Exception as exc:  # noqa: BLE001 - external comparison must never break analysis
        logger.warning(
            "price_compare.fetch.unexpected_error",
            extra={
                "event": "price_compare.fetch.unexpected_error",
                "title": title[:80],
                "error_type": type(exc).__name__,
                "error": str(exc)[:160],
            },
        )

    _cache.set(key, offers)
    logger.info(
        "price_compare.fetch.done",
        extra={
            "event": "price_compare.fetch.done",
            "title": title[:80],
            "offers": len(offers),
            "success": len(offers) > 0,
        },
    )
    return offers


def clear_cache() -> None:
    _cache.clear()


def _cache_key(title: str) -> str:
    digest = hashlib.sha1(title.strip().lower().encode("utf-8")).hexdigest()
    return f"price_compare:{digest}"


def _fetch_uncached(title: str) -> List[PriceComparisonOffer]:
    with httpx.Client(
        timeout=TIMEOUT_SECONDS,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
            "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
        },
        follow_redirects=True,
    ) as client:
        resp = client.get(SEARCH_URL, params={"q": title, "cc": "tr", "setlang": "tr"})
        if resp.status_code != 200:
            logger.info(
                "price_compare.search.non_200",
                extra={"event": "price_compare.search.non_200", "status": resp.status_code},
            )
            return []
        if _looks_blocked(resp.text):
            logger.info("price_compare.search.blocked", extra={"event": "price_compare.search.blocked"})
            return []
        return _parse_bing_offers(resp.text, query_title=title)[:MAX_OFFERS]


def _looks_blocked(body: str) -> bool:
    text = body[:20_000].lower()
    return (
        "just a moment" in text
        or "captcha" in text
        or "robot" in text and "review" not in text
        or "güvenlik" in text
    )


def _parse_bing_offers(html_text: str, *, query_title: str) -> List[PriceComparisonOffer]:
    offers: list[PriceComparisonOffer] = []
    seen: set[tuple[str, float, str]] = set()
    pattern = re.compile(
        r'<span\s+title="(?P<title>[^"]{3,240})"[^>]*>.*?'
        r'<div\s+class="br-price">(?P<price>[^<]{2,40})</div>.*?'
        r'<span\s+class="br-offSlrTxt">(?P<seller>[^<]{1,120})</span>',
        flags=re.DOTALL | re.IGNORECASE,
    )
    for match in pattern.finditer(html_text):
        title = _clean(match.group("title"))
        seller = _clean(match.group("seller")) or "Bing Shopping"
        price = _parse_price(match.group("price"))
        if not title or price is None:
            continue
        if not _relevant(query_title, title):
            continue
        key = (title.casefold(), round(price, 2), seller.casefold())
        if key in seen:
            continue
        seen.add(key)
        offers.append(
            PriceComparisonOffer(
                source=f"Bing Shopping / {seller}",
                title=title,
                price=price,
            )
        )
        if len(offers) >= MAX_OFFERS:
            break
    return offers


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def _parse_price(value: str) -> float | None:
    raw = _clean(value)
    s = re.sub(r"[^\d.,]", "", raw)
    if not s:
        return None
    last_comma = s.rfind(",")
    last_dot = s.rfind(".")
    if last_comma > -1 and last_dot > -1:
        if last_comma > last_dot:
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif last_comma > -1:
        s = s.replace(",", ".")
    elif last_dot > -1:
        parts = s.split(".")
        if len(parts) > 2 or len(parts[-1]) == 3:
            s = s.replace(".", "")
    try:
        price = float(s)
    except ValueError:
        return None
    if 1 <= price <= 10_000_000:
        return price
    return None


_STOPWORDS = {
    "the",
    "ve",
    "ile",
    "icin",
    "için",
    "termos",
    "sise",
    "şişe",
    "sisesi",
    "şişesi",
    "su",
    "lt",
    "l",
    "ml",
    "adet",
    "renk",
    "siyah",
    "beyaz",
    "mavi",
    "yesil",
    "yeşil",
}


def _tokens(value: str) -> set[str]:
    lowered = value.lower()
    lowered = lowered.translate(str.maketrans("çğıöşü", "cgiosu"))
    return {t for t in re.findall(r"[a-z0-9]{3,}", lowered) if t not in _STOPWORDS}


def _relevant(query_title: str, offer_title: str) -> bool:
    query = _tokens(query_title)
    offer = _tokens(offer_title)
    if not query or not offer:
        return False
    overlap = query & offer
    if len(overlap) >= 2:
        return True
    return len(overlap) >= 1 and (len(overlap) / max(1, len(query))) >= 0.35
