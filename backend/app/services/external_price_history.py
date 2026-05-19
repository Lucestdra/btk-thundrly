"""External price-history sourcing — Akakçe scrape with TTL cache.

The crowdsource ``price_observations`` table only has data for products
multiple extension users have visited. On a fresh deploy or a long-tail
product, that table is empty and the price_agent gives a neutral "fiyat
geçmişi yok" verdict — masking real price manipulation.

This module fetches a 30-day price-history approximation from Akakçe by:

1. Searching their listings for the product title (multiple selector patterns).
2. Following the first hit to a product page.
3. Parsing the embedded price-graph data (multiple parse paths).
4. Falling back to "today's current Akakçe price" as a single point when
   the full graph is missing — even one independent reference is better
   than zero for the suspicious-discount cross-check.

Hardening (reliability sprint):

* **Timeout** bumped to 10 s (env-tunable) — the user explicitly accepted
  longer latency for higher reliability.
* **Retry once** on transient network errors (timeouts, connection
  resets). Not on 4xx — those are deterministic.
* **Structured logging** at every checkpoint (search-attempt, product-URL
  found, graph-points-extracted, current-price-fallback). Previously
  failures were silent except for a single warning at the top level —
  impossible to diagnose without local repro.
* **Multiple parse paths** for both the search result link and the
  price-graph data, so a single layout change doesn't return ``[]``.

* **Cache hard.** Each title's lookup is cached for 24 hours in process
  memory.
* **Feature flag.** Disabled by default because Akakçe frequently returns
  bot challenges from server-side deployments. Set
  ``EXTERNAL_PRICE_HISTORY_ENABLED=1`` to re-enable.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx

from app.core.cache import TTLCache
from app.models.schemas import PriceHistoryPoint

logger = logging.getLogger("thundrly.akakce")

# ---------- Configuration ----------

ENABLED = os.environ.get("EXTERNAL_PRICE_HISTORY_ENABLED", "0") not in ("0", "false", "False")
TIMEOUT_SECONDS = float(os.environ.get("EXTERNAL_PRICE_HISTORY_TIMEOUT", "10.0"))
SEARCH_URL = "https://www.akakce.com/arama/"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# 24-hour TTL keyed by SHA-1 of the normalized title.
_cache = TTLCache(max_size=500, ttl_seconds=24 * 60 * 60, namespace="akakce")


# ---------- Public API ----------


def fetch_for_product(title: str) -> List[PriceHistoryPoint]:
    """Return up to 30 days of price-history points, or `[]` on any miss.

    Synchronous — uses httpx's sync client so the rest of the backend
    (sync FastAPI) can call it directly.
    """
    if not ENABLED:
        logger.debug("akakce.skip.disabled", extra={"event": "akakce.skip.disabled"})
        return []
    if not title or len(title.strip()) < 4:
        logger.debug(
            "akakce.skip.short_title",
            extra={"event": "akakce.skip.short_title", "title_len": len(title or "")},
        )
        return []

    key = _cache_key(title)
    cached = _cache.get(key)
    if cached is not None:
        logger.debug(
            "akakce.cache.hit",
            extra={"event": "akakce.cache.hit", "title": title[:80], "points": len(cached)},
        )
        return cached

    points: List[PriceHistoryPoint] = []
    try:
        points = _fetch_uncached(title)
    except httpx.TimeoutException as exc:
        logger.warning(
            "akakce.fetch.timeout",
            extra={
                "event": "akakce.fetch.timeout",
                "title": title[:80],
                "timeout_s": TIMEOUT_SECONDS,
                "error": str(exc)[:120],
            },
        )
    except httpx.HTTPError as exc:
        logger.warning(
            "akakce.fetch.http_error",
            extra={
                "event": "akakce.fetch.http_error",
                "title": title[:80],
                "error": str(exc)[:200],
            },
        )
    except Exception as exc:  # noqa: BLE001 — never let an external scrape break analysis
        logger.warning(
            "akakce.fetch.unexpected_error",
            extra={
                "event": "akakce.fetch.unexpected_error",
                "title": title[:80],
                "error_type": type(exc).__name__,
                "error": str(exc)[:200],
            },
        )

    _cache.set(key, points)
    logger.info(
        "akakce.fetch.done",
        extra={
            "event": "akakce.fetch.done",
            "title": title[:80],
            "points": len(points),
            "success": len(points) > 0,
        },
    )
    return points


def clear_cache() -> None:
    """Test helper — drop the in-process cache."""
    _cache.clear()


# ---------- Internals ----------


def _cache_key(title: str) -> str:
    h = hashlib.sha1(title.strip().lower().encode("utf-8")).hexdigest()
    return f"akakce:{h}"


def _fetch_uncached(title: str) -> List[PriceHistoryPoint]:
    """Run the full search → product → parse pipeline.

    One retry on transient network errors (timeouts, connection resets).
    Skipped on 4xx since those are deterministic and a retry won't help.
    """
    with httpx.Client(
        timeout=TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "tr-TR,tr;q=0.9"},
        follow_redirects=True,
    ) as client:
        product_url = _find_product_url_with_retry(client, title)
        if not product_url:
            return []
        return _fetch_product_history_with_retry(client, product_url)


def _find_product_url_with_retry(client: httpx.Client, title: str) -> Optional[str]:
    for attempt in (1, 2):
        try:
            url = _find_product_url(client, title)
            if url:
                return url
            # Empty result is not a transient error — don't retry.
            return None
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            logger.warning(
                "akakce.search.retry",
                extra={
                    "event": "akakce.search.retry",
                    "attempt": attempt,
                    "error": str(exc)[:120],
                },
            )
            if attempt == 2:
                raise
    return None


def _fetch_product_history_with_retry(
    client: httpx.Client, product_url: str
) -> List[PriceHistoryPoint]:
    for attempt in (1, 2):
        try:
            return _fetch_product_history(client, product_url)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            logger.warning(
                "akakce.product.retry",
                extra={
                    "event": "akakce.product.retry",
                    "attempt": attempt,
                    "url": product_url[:120],
                    "error": str(exc)[:120],
                },
            )
            if attempt == 2:
                raise
    return []


def _find_product_url(client: httpx.Client, title: str) -> Optional[str]:
    """Run the Akakçe search and return the first product page URL.

    Tries multiple link patterns in order of specificity so a single
    class rename doesn't kill the lookup.
    """
    resp = client.get(SEARCH_URL, params={"q": title[:100]})
    if resp.status_code != 200:
        logger.info(
            "akakce.search.non_200",
            extra={
                "event": "akakce.search.non_200",
                "status": resp.status_code,
                "title": title[:80],
            },
        )
        return None

    html = resp.text

    # Pattern 1: known product-card class (most reliable).
    m = re.search(
        r'<a[^>]+class="[^"]*pw_v8[^"]*"[^>]+href="(/[^"]+\.html)"',
        html,
    )
    # Pattern 2: any anchor under the product-id slug convention `,a-z<digits>.html`.
    if not m:
        m = re.search(r'<a[^>]+href="(/[^"#?]+,a-z\d+\.html)"', html)
    # Pattern 3: generic product href, ignoring query string + hash.
    if not m:
        m = re.search(r'<a[^>]+href="(/[a-z0-9\-,]+\.html)"', html)

    if not m:
        logger.info(
            "akakce.search.no_match",
            extra={
                "event": "akakce.search.no_match",
                "title": title[:80],
                "html_len": len(html),
            },
        )
        return None

    href = m.group(1)
    full = f"https://www.akakce.com{href}"
    logger.debug(
        "akakce.search.match",
        extra={"event": "akakce.search.match", "url": full[:120]},
    )
    return full


def _fetch_product_history(client: httpx.Client, product_url: str) -> List[PriceHistoryPoint]:
    resp = client.get(product_url)
    if resp.status_code != 200:
        logger.info(
            "akakce.product.non_200",
            extra={
                "event": "akakce.product.non_200",
                "status": resp.status_code,
                "url": product_url[:120],
            },
        )
        return []

    points = _parse_price_graph(resp.text)
    if points:
        return points

    # Graph missing — try to extract at least the current price as a
    # single point. Even one independent reference lets the multi-source
    # suspicious-discount check (Section 1.4) run with two sources
    # instead of one.
    current = _extract_current_price(resp.text)
    if current is not None:
        today = datetime.now(timezone.utc).date().isoformat()
        logger.info(
            "akakce.product.current_only",
            extra={
                "event": "akakce.product.current_only",
                "url": product_url[:120],
                "price": current,
            },
        )
        return [PriceHistoryPoint(date=today, price=current)]

    logger.info(
        "akakce.product.empty",
        extra={
            "event": "akakce.product.empty",
            "url": product_url[:120],
            "html_len": len(resp.text),
        },
    )
    return []


def _parse_price_graph(html: str) -> List[PriceHistoryPoint]:
    """Extract `[[unix_ms, price], ...]` sequences from an Akakçe product
    page and convert them to ``PriceHistoryPoint`` rows for the last 30
    days. Returns an empty list when nothing parseable is found.
    """
    matches: List[List[List[float]]] = []
    # Walk every JS-style `[[<ts>, <number>` opener and grab the balanced
    # outer array. Catches `var fc=`, `var pp=`, `window.priceHistory=`,
    # and any inline data attribute carrying the same shape.
    for arr_match in re.finditer(r"\[\s*\[\s*\d{10,13}\s*,\s*\d", html):
        start = arr_match.start()
        depth = 0
        end = start
        for i in range(start, min(start + 100_000, len(html))):
            c = html[i]
            if c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end <= start:
            continue
        candidate = html[start:end]
        try:
            data = json.loads(candidate)
            if isinstance(data, list) and len(data) > 0:
                matches.append(data)  # type: ignore[arg-type]
        except json.JSONDecodeError:
            continue

    if not matches:
        return []

    # Use the largest sane series as the price history.
    series = max(matches, key=len)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)

    points: List[PriceHistoryPoint] = []
    for pair in series:
        if not isinstance(pair, list) or len(pair) < 2:
            continue
        try:
            ts = float(pair[0])
            price = float(pair[1])
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        when = (
            datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
            if ts > 1e12
            else datetime.fromtimestamp(ts, tz=timezone.utc)
        )
        if when < cutoff:
            continue
        points.append(PriceHistoryPoint(date=when.date().isoformat(), price=price))

    by_date: dict[str, PriceHistoryPoint] = {}
    for p in points:
        by_date[p.date] = p
    return sorted(by_date.values(), key=lambda p: p.date)


def _extract_current_price(html: str) -> Optional[float]:
    """Best-effort current-price extraction when the time-series is gone.

    Tries, in order:
      1. JSON-LD `Product.offers.price` — most stable when present.
      2. Microdata `itemprop="price"` (`content` attr preferred).
      3. The first big "₺X" / "X TL" on the page (rejects values < ₺5
         and > ₺500k to filter out instalment teasers + page chrome).
    """
    # JSON-LD
    for blob in re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        flags=re.DOTALL,
    ):
        try:
            data = json.loads(blob)
        except json.JSONDecodeError:
            continue
        for item in data if isinstance(data, list) else [data]:
            if not isinstance(item, dict):
                continue
            offers = item.get("offers")
            offer_list = offers if isinstance(offers, list) else [offers] if offers else []
            for offer in offer_list:
                if not isinstance(offer, dict):
                    continue
                p = offer.get("price")
                try:
                    val = float(str(p).replace(",", "."))
                    if 1 < val < 10_000_000:
                        return val
                except (TypeError, ValueError):
                    continue

    # Microdata
    m = re.search(
        r'<[^>]+itemprop=["\']price["\'][^>]*?(?:content=["\']([^"\']+)["\']|>([^<]+)<)',
        html,
    )
    if m:
        raw = (m.group(1) or m.group(2) or "").strip()
        # Microdata `content` is usually canonical decimal ("299.00").
        # Visible-text fallback can be TR-formatted ("₺1.249,90"). Only
        # apply TR normalization when both separators are present, since
        # naïve dot-stripping mangles "299.00" → 29900.
        if "," in raw and "." in raw:
            raw = raw.replace(".", "").replace(",", ".")
        elif "," in raw:
            raw = raw.replace(",", ".")
        # Strip currency symbols and whitespace.
        raw = re.sub(r"[^\d.]", "", raw)
        try:
            val = float(raw)
            if 1 < val < 10_000_000:
                return val
        except ValueError:
            pass

    # Loose currency scan — bounded by sanity range so chrome doesn't dominate.
    candidates: list[float] = []
    for m in re.finditer(r"(?:₺|\bTL\b)\s*([\d.,]{3,12})|([\d.,]{3,12})\s*(?:₺|\bTL\b)", html):
        raw = (m.group(1) or m.group(2) or "").strip()
        # TR format normalize: "1.249,90" → "1249.90"
        if "," in raw and "." in raw:
            raw = raw.replace(".", "").replace(",", ".")
        elif "," in raw:
            raw = raw.replace(",", ".")
        elif raw.count(".") == 1 and len(raw.split(".")[1]) == 3:
            # "1.249" — thousands separator
            raw = raw.replace(".", "")
        try:
            val = float(raw)
            if 5 <= val <= 500_000:
                candidates.append(val)
        except ValueError:
            continue
    if candidates:
        # Most common big number on the page tends to be the current price.
        candidates.sort()
        return candidates[len(candidates) // 2]  # median for robustness
    return None
