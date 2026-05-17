"""Tests for the Akakçe price-history scraper.

Strategy:
  - All HTTP calls go through httpx, which we replace with a transport
    that returns fixture HTML. No real network is touched.
  - We verify both happy-path (search → product → parsed series) and
    every failure mode (search 404, search no match, product 404, no
    parseable graph) returns ``[]`` so the analysis path never crashes.
  - The 24h cache is exercised by counting transport calls across two
    invocations with the same title.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx
import pytest

from app.services import external_price_history as eph


SEARCH_HTML = """
<html><body>
  <a href="/some-brand-x-y,a-z123456.html" class="pw_v8">Brand X</a>
  <a href="/other-product,a-z999.html" class="pw_v8">Other</a>
</body></html>
"""

SEARCH_HTML_NO_MATCH = "<html><body>arama sonuç bulunamadı.</body></html>"


def _product_html_with_series(series_iso_dates: list[tuple[str, float]]) -> str:
    """Build a fake Akakçe product page whose JS embeds a price-history array."""
    pairs = []
    for iso_date, price in series_iso_dates:
        ts_ms = int(
            datetime.fromisoformat(iso_date).replace(tzinfo=timezone.utc).timestamp() * 1000
        )
        pairs.append(f"[{ts_ms},{price}]")
    arr = "[" + ",".join(pairs) + "]"
    return f"""
<html><body>
  <h1>Brand X Product</h1>
  <script>var fc = {arr};</script>
</body></html>
"""


def _fixed_transport(handler):
    return httpx.MockTransport(handler)


@pytest.fixture(autouse=True)
def _patch_client(monkeypatch):
    """Replace httpx.Client globally with one that uses a per-test handler."""
    handler = {"fn": lambda req: httpx.Response(404)}

    real_init = httpx.Client.__init__

    def fake_init(self, *args, **kwargs):
        kwargs["transport"] = _fixed_transport(handler["fn"])
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "__init__", fake_init)
    eph.clear_cache()
    yield handler
    eph.clear_cache()


def _today_minus(days: int) -> str:
    from datetime import date, timedelta
    return (date.today() - timedelta(days=days)).isoformat()


def test_happy_path_parses_recent_history(_patch_client):
    """Search returns a product link; product page embeds a series of
    14 daily prices — all of them should come through."""
    series = [(_today_minus(d), 100.0 + d) for d in range(0, 14)]
    product_html = _product_html_with_series(series)

    def handler(request: httpx.Request) -> httpx.Response:
        if "/arama/" in str(request.url):
            return httpx.Response(200, text=SEARCH_HTML)
        return httpx.Response(200, text=product_html)

    _patch_client["fn"] = handler

    points = eph.fetch_for_product("Brand X Test Product")
    assert len(points) == 14
    assert points[0].date < points[-1].date  # sorted ascending
    assert all(p.price > 0 for p in points)


def test_drops_points_older_than_30_days(_patch_client):
    series = [
        (_today_minus(45), 200.0),  # outside window
        (_today_minus(20), 220.0),
        (_today_minus(5), 250.0),
    ]
    product_html = _product_html_with_series(series)

    _patch_client["fn"] = lambda r: (
        httpx.Response(200, text=SEARCH_HTML)
        if "/arama/" in str(r.url)
        else httpx.Response(200, text=product_html)
    )

    points = eph.fetch_for_product("Brand X Test Product")
    assert len(points) == 2
    assert all(int(p.price) in (220, 250) for p in points)


def test_search_no_result_returns_empty(_patch_client):
    _patch_client["fn"] = lambda r: httpx.Response(200, text=SEARCH_HTML_NO_MATCH)
    assert eph.fetch_for_product("xyz nonexistent product") == []


def test_search_http_error_returns_empty(_patch_client):
    _patch_client["fn"] = lambda r: httpx.Response(503)
    assert eph.fetch_for_product("Anything") == []


def test_product_page_with_no_graph_returns_empty(_patch_client):
    def handler(r: httpx.Request) -> httpx.Response:
        if "/arama/" in str(r.url):
            return httpx.Response(200, text=SEARCH_HTML)
        return httpx.Response(200, text="<html><body><h1>No data</h1></body></html>")

    _patch_client["fn"] = handler
    assert eph.fetch_for_product("Brand X") == []


def test_results_are_cached(_patch_client):
    """Second call with the same title should not hit the network."""
    series = [(_today_minus(d), 50.0 + d) for d in range(0, 5)]
    product_html = _product_html_with_series(series)
    calls = {"count": 0}

    def handler(r: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if "/arama/" in str(r.url):
            return httpx.Response(200, text=SEARCH_HTML)
        return httpx.Response(200, text=product_html)

    _patch_client["fn"] = handler

    first = eph.fetch_for_product("Cached Product Name")
    second = eph.fetch_for_product("Cached Product Name")
    assert first == second
    assert calls["count"] == 2  # only the first call went out (search + product)


def test_disabled_flag_short_circuits(monkeypatch, _patch_client):
    """When EXTERNAL_PRICE_HISTORY_ENABLED=0 we never touch the network."""
    monkeypatch.setattr(eph, "ENABLED", False)
    _patch_client["fn"] = lambda r: pytest.fail("should never be called")
    assert eph.fetch_for_product("Anything") == []
