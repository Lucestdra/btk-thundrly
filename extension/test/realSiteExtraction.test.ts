/**
 * End-to-end extraction against realistic Trendyol/Hepsiburada/N11
 * HTML snapshots.
 *
 * Fixture values match the canonical backend EXAMPLES (`red`, `yellow`,
 * `green`) so a successful extraction here implies the analyze pipeline
 * would produce the same verdict for the same input from a real page.
 *
 * If a platform changes its DOM and one of these tests starts failing,
 * the fix is to update [src/utils/platformSelectors.ts](../src/utils/platformSelectors.ts)
 * — the test pins the contract between selectors and real markup.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { extractCurrentObservation, extractProductBasics } from "@/utils/productExtractor";

import trendyolHtml from "./fixtures/trendyol-hoodie.html?raw";
import hepsiburadaHtml from "./fixtures/hepsiburada-headphones.html?raw";
import n11Html from "./fixtures/n11-book.html?raw";

function loadFixture(html: string): void {
  // jsdom parses <head> + <body> when set on documentElement.innerHTML;
  // the fixtures intentionally omit the outer <html> wrapper.
  document.documentElement.innerHTML = html;
}

describe("Real-site extraction — Trendyol hoodie", () => {
  beforeEach(() => loadFixture(trendyolHtml));

  it("extracts all six product fields cleanly", () => {
    const out = extractProductBasics("trendyol");
    expect(out.title).toBe("Oversize Siyah Hoodie");
    expect(out.price).toBe(990);
    expect(out.originalPrice).toBe(1650);
    expect(out.category).toBe("Giyim");
    expect(out.rating).toBeCloseTo(4.7);
    expect(out.reviewCount).toBe(842);
  });

  it("observation payload uses the discounted price, not the strikethrough", () => {
    const obs = extractCurrentObservation("trendyol");
    expect(obs).not.toBeNull();
    expect(obs!.price).toBe(990);
    expect(obs!.title).toBe("Oversize Siyah Hoodie");
  });
});

describe("Real-site extraction — Hepsiburada headphones", () => {
  beforeEach(() => loadFixture(hepsiburadaHtml));

  it("extracts all six product fields cleanly", () => {
    const out = extractProductBasics("hepsiburada");
    expect(out.title).toBe("Kablosuz Kulaklık");
    expect(out.price).toBe(1450);
    expect(out.originalPrice).toBe(1899);
    expect(out.category).toBe("Elektronik");
    expect(out.rating).toBeCloseTo(4.4);
    expect(out.reviewCount).toBe(312);
  });

  it("observation payload reflects the current price", () => {
    const obs = extractCurrentObservation("hepsiburada");
    expect(obs).not.toBeNull();
    expect(obs!.price).toBe(1450);
  });
});

describe("Real-site extraction — N11 book", () => {
  beforeEach(() => loadFixture(n11Html));

  it("extracts all six product fields cleanly", () => {
    const out = extractProductBasics("n11");
    expect(out.title).toBe("Sapiens: Hayvanlardan Tanrılara");
    expect(out.price).toBe(145);
    expect(out.originalPrice).toBe(180);
    expect(out.category).toBe("Kitap");
    expect(out.rating).toBeCloseTo(4.8);
    expect(out.reviewCount).toBe(5230);
  });

  it("observation payload reflects the current price", () => {
    const obs = extractCurrentObservation("n11");
    expect(obs).not.toBeNull();
    expect(obs!.price).toBe(145);
  });
});

describe("Real-site extraction — sanity across platforms", () => {
  it("each fixture's price ≤ its originalPrice", () => {
    for (const [html, host] of [
      [trendyolHtml, "trendyol"] as const,
      [hepsiburadaHtml, "hepsiburada"] as const,
      [n11Html, "n11"] as const,
    ]) {
      loadFixture(html);
      const out = extractProductBasics(host);
      // A fixture where price > originalPrice would be nonsensical and the
      // price_agent would treat the "discount" as a 0% real reduction. Easy
      // mistake to make when hand-editing fixtures — pin it.
      expect(out.price).toBeDefined();
      expect(out.originalPrice).toBeDefined();
      expect(out.price!).toBeLessThanOrEqual(out.originalPrice!);
    }
  });
});
