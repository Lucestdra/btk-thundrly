"""External price-history sourcing — Akakçe scrape with TTL cache.

The crowdsource ``price_observations`` table only has data for products
multiple extension users have visited. On a fresh deploy or a long-tail
product, that table is empty and the price_agent gives a neutral "fiyat
geçmişi yok" verdict — masking real price manipulation.

This module fetches a 30-day price-history approximation from Akakçe
(a Turkish price-comparison aggregator) by:

1. Searching their listings for the product title.
2. Following the first hit to a product page.
3. Parsing the embedded price-graph data.

Notes:

* **Best-effort.** Akakçe HTML can change without notice; the regexes
  here are written defensively but will eventually drift. Any failure
  silently returns ``[]`` so the analysis path still completes — the
  price_agent then falls back to its standard "no history" verdict.

* **Cache hard.** Each title's lookup is cached for 24 hours in process
  memory (TTLCache from app.core.cache). At ~1 RPS per worker this keeps
  us well below polite scrape rates even with a busy backend.

* **Feature flag.** Set ``EXTERNAL_PRICE_HISTORY_ENABLED=0`` to disable
  entirely. Useful if Akakçe blocks us or returns garbage and we want
  the system to keep working off the crowdsource alone.
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

logger = logging.getLogger(__name__)

# ---------- Configuration ----------

ENABLED = os.environ.get("EXTERNAL_PRICE_HISTORY_ENABLED", "1") not in ("0", "false", "False")
TIMEOUT_SECONDS = float(os.environ.get("EXTERNAL_PRICE_HISTORY_TIMEOUT", "4.0"))
SEARCH_URL = "https://www.akakce.com/arama/"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# 24-hour TTL keyed by SHA-1 of the normalized title.
_cache = TTLCache(max_size=500, ttl_seconds=24 * 60 * 60)


# ---------- Public API ----------


def fetch_for_product(title: str) -> List[PriceHistoryPoint]:
    """Return up to 30 days of price-history points, or `[]` on any miss.

    Synchronous wrapper — uses httpx's sync client so the rest of the
    backend (which is sync FastAPI) can call it directly.
    """
    if not ENABLED or not title or len(title.strip()) < 4:
        return []

    key = _cache_key(title)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    try:
        points = _fetch_uncached(title)
    except Exception as exc:  # noqa: BLE001 — never let an external scrape break analysis
        logger.warning("Akakçe price-history fetch başarısız (%s): %s", title[:60], exc)
        points = []

    _cache.set(key, points)
    return points


def clear_cache() -> None:
    """Test helper — drop the in-process cache."""
    _cache.clear()


# ---------- Internals ----------


def _cache_key(title: str) -> str:
    h = hashlib.sha1(title.strip().lower().encode("utf-8")).hexdigest()
    return f"akakce:{h}"


def _fetch_uncached(title: str) -> List[PriceHistoryPoint]:
    """Run the full search → product → parse pipeline."""
    with httpx.Client(
        timeout=TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "tr-TR,tr;q=0.9"},
        follow_redirects=True,
    ) as client:
        product_url = _find_product_url(client, title)
        if not product_url:
            return []
        return _fetch_product_history(client, product_url)


def _find_product_url(client: httpx.Client, title: str) -> Optional[str]:
    """Run the Akakçe search and return the first product page URL."""
    resp = client.get(SEARCH_URL, params={"q": title[:100]})
    if resp.status_code != 200:
        logger.debug("Akakçe search HTTP %s", resp.status_code)
        return None

    html = resp.text
    # Akakçe product result links look like:
    #     <a href="/.../,a-z123456.html" class="pw_v8"...>
    # The trailing ",a-z<digits>.html" is the product id slug; we accept
    # anything ending in ".html" under the root domain.
    m = re.search(
        r'<a[^>]+class="[^"]*pw_v8[^"]*"[^>]+href="(/[^"]+\.html)"',
        html,
    )
    if not m:
        # Fallback to a less-specific anchor match.
        m = re.search(r'<a[^>]+href="(/[^"#?]+,a-z\d+\.html)"', html)
    if not m:
        return None
    href = m.group(1)
    return f"https://www.akakce.com{href}"


def _fetch_product_history(client: httpx.Client, product_url: str) -> List[PriceHistoryPoint]:
    resp = client.get(product_url)
    if resp.status_code != 200:
        return []
    return _parse_price_graph(resp.text)


def _parse_price_graph(html: str) -> List[PriceHistoryPoint]:
    """Extract `[[unix_ms, price], ...]` sequences from an Akakçe product
    page and convert them to ``PriceHistoryPoint`` rows for the last 30
    days. Returns an empty list when nothing parseable is found.
    """
    # Akakçe inlines chart data as a JS array of [timestamp_ms, price] pairs
    # somewhere on the product page. Several variable names have been seen
    # in the wild (``var fc=`` / ``var pp=`` / ``window.priceHistory=``);
    # we look for any JS-style array of 2-element numeric tuples.
    matches: List[List[List[float]]] = []
    for arr_match in re.finditer(r"\[\s*\[\s*\d{10,13}\s*,\s*\d", html):
        # Walk forward from the match start to balance brackets.
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
        # Heuristic for ms vs s timestamps.
        when = (
            datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
            if ts > 1e12
            else datetime.fromtimestamp(ts, tz=timezone.utc)
        )
        if when < cutoff:
            continue
        points.append(PriceHistoryPoint(date=when.date().isoformat(), price=price))

    # Deduplicate by date, keeping the last value of the day.
    by_date: dict[str, PriceHistoryPoint] = {}
    for p in points:
        by_date[p.date] = p
    return sorted(by_date.values(), key=lambda p: p.date)
