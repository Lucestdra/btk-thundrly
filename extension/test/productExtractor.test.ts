/**
 * Priority-chain tests for `extractProductBasics`.
 *
 * The extractor reads from five sources in order: demo data-attrs,
 * JSON-LD, microdata, platform selectors, og:meta. Each layer only fills
 * fields the previous one didn't provide. These tests verify the merge
 * order and that platform-specific quirks (Turkish prices, originalPrice
 * from strikethrough elements) come through cleanly.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { extractProductBasics } from "@/utils/productExtractor";

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

// ---------- JSON-LD ----------

describe("extractProductBasics — JSON-LD", () => {
  it("reads name, price, image from a Product schema", () => {
    document.head.innerHTML = `
      <script type="application/ld+json">
        ${JSON.stringify({
          "@type": "Product",
          name: "Test Hoodie",
          image: "https://cdn.example/h.jpg",
          offers: { price: "1249.90", priceCurrency: "TRY" },
          aggregateRating: { ratingValue: "4.5", reviewCount: 312 },
          category: "Giyim",
        })}
      </script>
    `;

    const out = extractProductBasics("trendyol");
    expect(out.title).toBe("Test Hoodie");
    expect(out.price).toBeCloseTo(1249.9);
    expect(out.rating).toBeCloseTo(4.5);
    expect(out.reviewCount).toBe(312);
    expect(out.imageUrl).toBe("https://cdn.example/h.jpg");
    expect(out.category).toBe("Giyim");
  });

  it("handles JSON-LD array of items, picking the Product entry", () => {
    document.head.innerHTML = `
      <script type="application/ld+json">
        ${JSON.stringify([
          { "@type": "BreadcrumbList", itemListElement: [] },
          { "@type": "Product", name: "Picked", offers: { price: 500 } },
        ])}
      </script>
    `;

    const out = extractProductBasics("trendyol");
    expect(out.title).toBe("Picked");
    expect(out.price).toBe(500);
  });

  it("handles offers as an array", () => {
    document.head.innerHTML = `
      <script type="application/ld+json">
        ${JSON.stringify({
          "@type": "Product",
          name: "Multi-offer",
          offers: [{ price: "199.99" }, { price: "250" }],
        })}
      </script>
    `;

    expect(extractProductBasics("trendyol").price).toBeCloseTo(199.99);
  });

  it("ignores malformed JSON-LD instead of throwing", () => {
    document.head.innerHTML = `
      <script type="application/ld+json">{not even json}</script>
      <script type="application/ld+json">
        ${JSON.stringify({ "@type": "Product", name: "Survives" })}
      </script>
    `;

    expect(extractProductBasics("trendyol").title).toBe("Survives");
  });
});

// ---------- Microdata ----------

describe("extractProductBasics — Microdata", () => {
  it("falls back to itemprop when JSON-LD is absent", () => {
    document.body.innerHTML = `
      <div itemscope itemtype="https://schema.org/Product">
        <h1 itemprop="name">Microdata Hoodie</h1>
        <meta itemprop="price" content="299.00" />
        <span itemprop="ratingValue">4.2</span>
        <span itemprop="reviewCount">88</span>
      </div>
    `;

    const out = extractProductBasics("trendyol");
    expect(out.title).toBe("Microdata Hoodie");
    expect(out.price).toBe(299);
    expect(out.rating).toBeCloseTo(4.2);
    expect(out.reviewCount).toBe(88);
  });

  it("prefers content attribute over textContent for itemprop", () => {
    document.body.innerHTML = `
      <span itemprop="price" content="1234.50">₺1.234,50 (görsel)</span>
    `;
    // Microdata `content` is locale-neutral; we should pick it over the
    // formatted display text.
    expect(extractProductBasics("trendyol").price).toBeCloseTo(1234.5);
  });
});

// ---------- Platform selectors ----------

describe("extractProductBasics — platform selectors", () => {
  it("Trendyol: reads strikethrough originalPrice that JSON-LD doesn't carry", () => {
    // Body has only the Trendyol-specific markup. JSON-LD typically
    // omits originalPrice; this is exactly the gap platform selectors fill.
    document.body.innerHTML = `
      <h1 data-testid="product-title">Trendyol Hoodie</h1>
      <div class="prc-dsc">990,00 TL</div>
      <div class="prc-org">1.650,00 TL</div>
    `;

    const out = extractProductBasics("trendyol");
    expect(out.title).toBe("Trendyol Hoodie");
    expect(out.price).toBe(990);
    expect(out.originalPrice).toBe(1650);
  });

  it("Hepsiburada: reads data-test-id current + previous price", () => {
    document.body.innerHTML = `
      <h1 data-test-id="title">Hepsi Headphones</h1>
      <span data-test-id="price-current-price">1.450,00 TL</span>
      <span data-test-id="price-prev-price">1.899,00 TL</span>
    `;

    const out = extractProductBasics("hepsiburada");
    expect(out.title).toBe("Hepsi Headphones");
    expect(out.price).toBe(1450);
    expect(out.originalPrice).toBe(1899);
  });

  it("N11: reads newPrice ins + oldPrice del", () => {
    document.body.innerHTML = `
      <h1 class="proName">N11 Book</h1>
      <div class="newPrice"><ins>145,00 TL</ins></div>
      <div class="oldPrice"><del>180,00 TL</del></div>
    `;

    const out = extractProductBasics("n11");
    expect(out.title).toBe("N11 Book");
    expect(out.price).toBe(145);
    expect(out.originalPrice).toBe(180);
  });
});

// ---------- Priority chain ----------

describe("extractProductBasics — priority chain", () => {
  it("JSON-LD price wins over platform selector when both present", () => {
    // Use realistic discount-shaped numbers (≤2.5× gap) so the
    // installment-guard heuristic does not fire here. The contract under
    // test is "JSON-LD priority", not "always pick the larger one".
    document.head.innerHTML = `
      <script type="application/ld+json">
        ${JSON.stringify({ "@type": "Product", name: "From LD", offers: { price: "600" } })}
      </script>
    `;
    document.body.innerHTML = `<div class="prc-dsc">999 TL</div>`;

    const out = extractProductBasics("trendyol");
    expect(out.price).toBe(600); // JSON-LD wins
  });

  it("installment guard: when JSON-LD price is ≥2.5× smaller than other layers, swap to the larger total", () => {
    // Real-world repro: Trendyol's JSON-LD has been observed reporting
    // the per-installment value (₺76.84) while the page DOM shows the
    // ₺307.36 total. The guard should detect the gap and swap.
    document.head.innerHTML = `
      <script type="application/ld+json">
        ${JSON.stringify({ "@type": "Product", name: "Şort", offers: { price: "76.84" } })}
      </script>
    `;
    document.body.innerHTML = `<div class="prc-dsc">307,36 TL</div>`;

    const out = extractProductBasics("trendyol");
    expect(out.price).toBe(307.36);
  });

  it("platform selector fills originalPrice that JSON-LD doesn't carry", () => {
    document.head.innerHTML = `
      <script type="application/ld+json">
        ${JSON.stringify({ "@type": "Product", name: "Combo", offers: { price: "990" } })}
      </script>
    `;
    document.body.innerHTML = `<div class="prc-org">1.650,00 TL</div>`;

    const out = extractProductBasics("trendyol");
    expect(out.price).toBe(990); // JSON-LD
    expect(out.originalPrice).toBe(1650); // platform
  });

  it("falls back to og:meta when nothing else matches", () => {
    document.head.innerHTML = `
      <meta property="og:title" content="Og Fallback" />
      <meta property="og:image" content="https://cdn.example/og.jpg" />
      <meta property="product:price:amount" content="49.99" />
    `;

    const out = extractProductBasics("unknown");
    expect(out.title).toBe("Og Fallback");
    expect(out.price).toBeCloseTo(49.99);
    expect(out.imageUrl).toBe("https://cdn.example/og.jpg");
  });
});

// ---------- Demo path ----------

describe("extractProductBasics — demo data-attrs", () => {
  it("short-circuits to data-kg-* when host=demo and element present", () => {
    document.body.innerHTML = `
      <div
        data-kg-product
        data-kg-title="Demo Hoodie"
        data-kg-price="990"
        data-kg-original-price="1650"
        data-kg-category="Giyim"
        data-kg-rating="4.7"
        data-kg-review-count="842"
        data-kg-image="https://cdn.example/d.jpg"
      ></div>
      <!-- Decoy: JSON-LD with conflicting values that must NOT win -->
      <script type="application/ld+json">
        ${JSON.stringify({ "@type": "Product", name: "WRONG", offers: { price: "1" } })}
      </script>
    `;

    const out = extractProductBasics("demo");
    expect(out.title).toBe("Demo Hoodie");
    expect(out.price).toBe(990);
    expect(out.originalPrice).toBe(1650);
    expect(out.category).toBe("Giyim");
    expect(out.rating).toBeCloseTo(4.7);
    expect(out.reviewCount).toBe(842);
  });
});
