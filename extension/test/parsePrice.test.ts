/**
 * `parsePrice` is the bit that decides whether a Trendyol price tag of
 * "1.249,90 TL" becomes 1249.90 (correct) or 1.249 (the old `parseFloat`
 * bug that would have poisoned the crowdsource DB with wildly wrong
 * observations). These tests pin every documented case + a few edges
 * that have bitten naive parsers before.
 */

import { describe, expect, it } from "vitest";

import { parsePrice } from "@/utils/productExtractor";

describe("parsePrice — Turkish formats", () => {
  it("dot-thousands + comma-decimal", () => {
    expect(parsePrice("1.249,90 TL")).toBe(1249.9);
    expect(parsePrice("₺1.249,90")).toBe(1249.9);
    expect(parsePrice("12.345,67 ₺")).toBe(12345.67);
  });

  it("comma-decimal only, no thousands", () => {
    expect(parsePrice("1249,90")).toBe(1249.9);
    expect(parsePrice("12,49")).toBe(12.49);
    expect(parsePrice("0,5")).toBe(0.5);
  });

  it("single dot with exactly three digits → thousands (1.249 == 1249)", () => {
    expect(parsePrice("1.249")).toBe(1249);
    expect(parsePrice("1.249 TL")).toBe(1249);
    expect(parsePrice("9.999")).toBe(9999);
  });

  it("multiple dots, no comma → all thousands separators", () => {
    expect(parsePrice("1.249.000")).toBe(1249000);
    expect(parsePrice("1.000.000")).toBe(1000000);
  });
});

describe("parsePrice — English formats", () => {
  it("comma-thousands + dot-decimal", () => {
    expect(parsePrice("1,249.90")).toBe(1249.9);
    expect(parsePrice("$1,249.90")).toBe(1249.9);
  });

  it("dot-decimal, 1-2 digits after dot", () => {
    expect(parsePrice("10.5")).toBe(10.5);
    expect(parsePrice("0.5 kg")).toBe(0.5);
    expect(parsePrice("4.7")).toBe(4.7);
  });
});

describe("parsePrice — number passthrough", () => {
  it("returns finite positive numbers as-is", () => {
    expect(parsePrice(990)).toBe(990);
    expect(parsePrice(4.7)).toBe(4.7);
  });

  it("rejects non-finite or non-positive numbers", () => {
    expect(parsePrice(0)).toBe(undefined);
    expect(parsePrice(-5)).toBe(undefined);
    expect(parsePrice(NaN)).toBe(undefined);
    expect(parsePrice(Infinity)).toBe(undefined);
  });
});

describe("parsePrice — empty / invalid / zero", () => {
  it("returns undefined for empty/null/undefined", () => {
    expect(parsePrice("")).toBe(undefined);
    expect(parsePrice("   ")).toBe(undefined);
    expect(parsePrice(null)).toBe(undefined);
    expect(parsePrice(undefined)).toBe(undefined);
  });

  it("returns undefined for non-numeric strings", () => {
    expect(parsePrice("abc")).toBe(undefined);
    expect(parsePrice("TL")).toBe(undefined);
    expect(parsePrice("---")).toBe(undefined);
  });

  it("returns undefined for zero-like strings (no signal)", () => {
    expect(parsePrice("0")).toBe(undefined);
    expect(parsePrice("0,00")).toBe(undefined);
    expect(parsePrice("0.00 TL")).toBe(undefined);
  });

  it("strips surrounding whitespace and currency symbols", () => {
    expect(parsePrice("  ₺ 1.249,90  TL ")).toBe(1249.9);
    expect(parsePrice("\t1.249,90\n")).toBe(1249.9);
  });
});

describe("parsePrice — regression coverage", () => {
  it("does NOT misread '1.249,90' as 1.249 (the old parseFloat bug)", () => {
    // The pre-refactor `parseNumber("1.249,90".replace(",", "."))` produced
    // 1.249. With locale-aware parsing, this is now correctly 1249.9.
    expect(parsePrice("1.249,90")).toBeGreaterThan(1000);
  });

  it("does NOT misread '1.50' as Turkish thousands (only 2 digits → decimal)", () => {
    expect(parsePrice("1.50")).toBe(1.5);
  });
});
