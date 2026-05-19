"""Tests for the Bing Shopping current-price comparison fallback."""

from __future__ import annotations

import httpx
import pytest

from app.services import external_price_comparison as epc


BING_HTML = """
<html><body>
  <div class="br-offInfo">
    <span title="Stanley The IceFlow Twist Flip Termos Su Şişesi">Stanley IceFlow</span>
    <div class="br-price">₺1.499,00</div>
    <span class="br-offSlrTxt">Seller A</span>
  </div>
  <div class="br-offInfo">
    <span title="Unrelated Classic Mug">Other</span>
    <div class="br-price">₺999,00</div>
    <span class="br-offSlrTxt">Seller B</span>
  </div>
  <div class="br-offInfo">
    <span title="Stanley IceFlow 0.89L Termos Bardak">Stanley IceFlow 0.89L</span>
    <div class="br-price">₺1.650,50</div>
    <span class="br-offSlrTxt">Seller C</span>
  </div>
</body></html>
"""


@pytest.fixture(autouse=True)
def _patch_client(monkeypatch):
    handler = {"fn": lambda req: httpx.Response(404)}
    real_init = httpx.Client.__init__

    def fake_init(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler["fn"])
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "__init__", fake_init)
    monkeypatch.setattr(epc, "ENABLED", True)
    epc.clear_cache()
    yield handler
    epc.clear_cache()


def test_parse_bing_offers_filters_relevant_products():
    offers = epc._parse_bing_offers(BING_HTML, query_title="Stanley IceFlow termos")
    assert len(offers) == 2
    assert offers[0].price == 1499.0
    assert offers[1].price == 1650.5
    assert all("Bing Shopping" in o.source for o in offers)


def test_fetch_for_product_uses_bing_and_cache(_patch_client):
    calls = {"count": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(200, text=BING_HTML)

    _patch_client["fn"] = handler
    first = epc.fetch_for_product("Stanley IceFlow termos")
    second = epc.fetch_for_product("Stanley IceFlow termos")
    assert first == second
    assert len(first) == 2
    assert calls["count"] == 1


def test_blocked_page_returns_empty(_patch_client):
    _patch_client["fn"] = lambda _: httpx.Response(200, text="<title>Just a moment...</title>")
    assert epc.fetch_for_product("Stanley IceFlow termos") == []
