/**
 * DOM'dan ürün bilgisi çıkarma.
 *
 * Strateji (öncelik sırasıyla):
 *   1. demo sayfası `[data-kg-*]` data-attribute'ları (kesin)
 *   2. JSON-LD `Product` şeması — çoğu Türk pazaryeri yayınlar
 *   3. Microdata `[itemprop=...]` — bazı sayfalarda JSON-LD eksik kalır
 *   4. Platform-spesifik selector paketleri (`platformSelectors.ts`)
 *   5. `og:meta` + `<title>` fallback
 *
 * Her katmandan dönen kısmi Product, soldakini override etmez —
 * `mergeFields` yalnızca BOŞ alanları doldurur. Böylece JSON-LD'nin verdiği
 * canonical değerler korunur, alt katmanlar yalnızca eksikleri tamamlar.
 *
 * Sayı ayrıştırma TÜRKÇE-aware: "1.249,90 TL", "₺1.249,90", "1249,90",
 * "1.249" (binlik) hepsi doğru parse edilir.
 */

import type { Host } from "./domDetector";
import type {
  AnalyzeRequest,
  PriceHistoryPoint,
  Product,
  Review,
  SessionContext,
} from "@shared/types";
import {
  DEMO_REVIEW_SELECTORS,
  PLATFORM_PACKS,
  type ReviewSelectors,
} from "./platformSelectors";

// ---------- Turkish-aware price parsing ----------

/**
 * Parses prices in Turkish, English, or mixed formats.
 *
 *   "1.249,90 TL"  → 1249.90   (TR: dot=thousands, comma=decimal)
 *   "₺1.249,90"    → 1249.90
 *   "1249,90"      → 1249.90   (TR decimal only)
 *   "1.249"        → 1249      (TR thousands, single dot + 3 digits)
 *   "1,249.90"     → 1249.90   (EN format)
 *   "12,49"        → 12.49     (TR decimal)
 *   "0.5"          → 0.5
 *
 * Returns `undefined` for non-numeric / empty / zero. Zero is treated as
 * "no signal" so empty price tags don't poison the DB.
 */
export function parsePrice(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (value === null || value === undefined) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  // Strip everything but digits, commas, and dots.
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return undefined;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator appears later is the decimal separator.
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    // Only comma — treat as TR decimal ("1249,90" or "12,49").
    s = s.replace(",", ".");
  } else if (lastDot > -1) {
    const afterDot = s.length - lastDot - 1;
    const dotCount = (s.match(/\./g) || []).length;
    if (dotCount > 1) {
      // Multiple dots, no comma → must be thousands separators (TR pattern).
      s = s.replace(/\./g, "");
    } else if (afterDot === 3) {
      // Single "X.YYY" with exactly 3 digits → Turkish thousands (1.249 == 1249).
      // For English decimals "1.249" with 3 places, this misreads, but in a
      // price context that's extraordinarily rare.
      s = s.replace(".", "");
    }
    // else: single dot with 1-2 digits → decimal, leave as-is.
  }

  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseCount(value: unknown): number | undefined {
  const n = parsePrice(value);
  return n !== undefined ? Math.round(n) : undefined;
}

/**
 * Rating-specific parser. Cannot use `parsePrice` for ratings — it
 * strips non-numerics and concatenates digits, so Amazon's
 * "5 üzerinden 4,7" or "4.6 out of 5 stars" become 54.7 / 465 and
 * blow past the backend's 0..5 schema (real bug, Mayıs 2026).
 *
 * Strategy: find every decimal number in the text, prefer the FIRST
 * one whose value is in [0, 5]. Anything outside that range is
 * discarded — including the "5" from "5 üzerinden …", which appears
 * before the actual rating but with a value equal to the upper bound.
 *
 * Returns `undefined` when nothing in range — better to omit `rating`
 * from the payload than to ship a wrong number.
 */
export function parseRating(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 && value <= 5 ? value : undefined;
  }
  if (value === null || value === undefined) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  // 1. Explicit "out-of-N" patterns first — they unambiguously name
  //    the rating value vs the scale.
  //
  //    "5 üzerinden 4,7"   → 4.7
  //    "4.6 out of 5"      → 4.6
  //    "4,2 / 5"           → 4.2
  const patterns = [
    /\büzerinden\s+(\d+(?:[.,]\d+)?)/i,        // TR: "X üzerinden Y" — Y is rating
    /(\d+(?:[.,]\d+)?)\s*\/\s*5\b/,            // "Y / 5"
    /(\d+(?:[.,]\d+)?)\s*out of\s*5\b/i,       // "Y out of 5"
    /(\d+(?:[.,]\d+)?)\s*yıldız/i,             // "Y yıldız"
    /(\d+(?:[.,]\d+)?)\s*puan/i,               // "Y puan"
  ];
  for (const re of patterns) {
    const hit = raw.match(re);
    if (hit) {
      const n = parseFloat(hit[1].replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && n <= 5) return n;
    }
  }

  // 2. Fallback: collect every in-range numeric token. Prefer a
  //    fractional value (< 5) over the boundary value 5 — when both
  //    appear, "5" is almost always the scale, not the rating.
  const numRe = /(\d+(?:[.,]\d+)?)/g;
  const candidates: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(raw)) !== null) {
    const n = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 5) candidates.push(n);
  }
  if (candidates.length === 0) return undefined;
  // Prefer the first sub-5 candidate; fall back to whatever we have.
  const subFive = candidates.find((n) => n < 5);
  return subFive !== undefined ? subFive : candidates[0];
}

// ---------- Strategy 1: demo data-attributes ----------

function readFromDemo(): Partial<Product> | null {
  const el = document.querySelector<HTMLElement>("[data-kg-product]");
  if (!el) return null;
  return {
    title: el.dataset.kgTitle,
    price: parsePrice(el.dataset.kgPrice),
    originalPrice: parsePrice(el.dataset.kgOriginalPrice),
    category: el.dataset.kgCategory,
    rating: parseRating(el.dataset.kgRating),
    reviewCount: parseCount(el.dataset.kgReviewCount),
    imageUrl: el.dataset.kgImage,
  };
}

// ---------- Strategy 2: JSON-LD ----------

type LDJson = Record<string, unknown> & {
  "@type"?: string | string[];
  name?: string;
  image?: string | string[] | { url?: string };
  category?: string | { name?: string };
  offers?:
    | {
        price?: string | number;
        priceCurrency?: string;
        availability?: string;
        priceSpecification?: { price?: string | number };
      }
    | Array<{ price?: string | number }>;
  aggregateRating?: {
    ratingValue?: string | number;
    reviewCount?: string | number;
    ratingCount?: string | number;
  };
};

function readJsonLd(): LDJson | null {
  const nodes = document.querySelectorAll<HTMLScriptElement>("script[type='application/ld+json']");
  for (const node of nodes) {
    try {
      const data = JSON.parse(node.textContent || "{}");
      const items: LDJson[] = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const t = item["@type"];
        if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) {
          return item;
        }
      }
    } catch {
      // skip malformed
    }
  }
  return null;
}

/**
 * True only when the current page looks like a real Product Detail Page,
 * not a homepage / listing / category. We use this as a hard precondition
 * before intercepting any "Sepete Ekle" click — without it, the script
 * fires on homepage product-card quick-buy buttons and reports nonsense
 * like "₺0 — Trendyol homepage og:title" as the product.
 *
 * Strategy (any one is sufficient):
 *   1. JSON-LD @type === "Product" present.
 *   2. Microdata `itemtype` ends with `/Product`.
 *   3. og:type === "product".
 *   4. URL pattern matches a known PDP shape (Trendyol/Hepsi: `-p-<id>`).
 *   5. Platform-specific product-title element is in DOM.
 */
const PLATFORM_PDP_MARKERS: Partial<Record<Host, string>> = {
  trendyol: "h1[data-testid='product-title'], h1.pr-new-br, .product-detail-name",
  hepsiburada: "h1[data-test-id='title'], h1[itemprop='name']",
  n11: "h1.proName, .unf-p-summary-info h1",
  amazon: "#productTitle",
  ciceksepeti: "h1.product-name, h1[data-test='product-title']",
  mediamarkt: "h1[data-test='mms-product-title']",
  teknosa: "h1.pdp-title",
  vatan: "h1.product-list__product-name",
  boyner: "h1[data-testid='product-name']",
  lcwaikiki: "h1.product-detail__product-name",
  defacto: "h1.product-title",
  modanisa: "h1.product-name",
  a101: "h1.product-name",
  migros: "h1.pdp-title, h1[data-test='product-title']",
  carrefoursa: "h1.product-title",
  beymen: "h1.o-productDetail__title",
  pazarama: "h1.product-title",
  pttavm: "h1.product-title",
  tchibo: "h1[data-tcid='product-name']",
  decathlon: "h1[data-testid='product-name']",
  ikea: "h1.pip-header-section__title--big, h1.product-pip__title",
};

export function isProductPage(host: Host): boolean {
  // Demo fixture is always considered a product page.
  if (host === "demo") return document.querySelector("[data-kg-product]") !== null;

  // 1. JSON-LD @type Product wins outright.
  if (readJsonLd()) return true;

  // 2. Microdata Product type.
  const itemtype = document.querySelector<HTMLElement>("[itemtype]");
  if (itemtype) {
    const v = itemtype.getAttribute("itemtype") || "";
    if (/\/Product\b/i.test(v)) return true;
  }

  // 3. og:type meta.
  const ogType = document
    .querySelector<HTMLMetaElement>("meta[property='og:type']")
    ?.content?.toLowerCase();
  if (ogType === "product" || ogType === "og:product") return true;

  // 4. Known PDP URL shape.
  const path = location.pathname;
  if (host === "trendyol" && /-p-\d+/.test(path)) return true;
  if (host === "hepsiburada" && /-p-[A-Z0-9]+/i.test(path)) return true;
  if (host === "n11" && /-P\d+/.test(path)) return true;
  if (host === "amazon" && /\/(dp|gp\/product)\/[A-Z0-9]+/i.test(path)) return true;

  // 5. Platform-specific product-title element.
  const marker = PLATFORM_PDP_MARKERS[host];
  if (marker) {
    try {
      if (document.querySelector(marker)) return true;
    } catch {
      /* invalid selector — fall through */
    }
  }

  return false;
}

function readFromLD(): Partial<Product> {
  const ld = readJsonLd();
  if (!ld) return {};

  const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  const ldPrice = offer && "price" in offer ? offer.price : undefined;

  let category: string | undefined;
  if (typeof ld.category === "string") category = ld.category;
  else if (ld.category && typeof ld.category === "object" && "name" in ld.category) {
    category = ld.category.name;
  }

  let imageUrl: string | undefined;
  if (typeof ld.image === "string") imageUrl = ld.image;
  else if (Array.isArray(ld.image)) imageUrl = ld.image[0];
  else if (ld.image && typeof ld.image === "object" && "url" in ld.image) imageUrl = ld.image.url;

  const reviewCount = ld.aggregateRating?.reviewCount ?? ld.aggregateRating?.ratingCount;

  return {
    title: ld.name,
    price: parsePrice(ldPrice),
    category,
    rating: parseRating(ld.aggregateRating?.ratingValue),
    reviewCount: parseCount(reviewCount),
    imageUrl,
  };
}

// ---------- Strategy 3: Microdata ----------

function readFromMicrodata(): Partial<Product> {
  const getMicroText = (prop: string): string | undefined => {
    const el = document.querySelector<HTMLElement>(`[itemprop='${prop}']`);
    if (!el) return undefined;
    // Microdata often uses `content` for numeric values to avoid locale formatting.
    return el.getAttribute("content") || el.textContent?.trim() || undefined;
  };
  const getMicroImage = (): string | undefined => {
    const el = document.querySelector<HTMLImageElement | HTMLMetaElement>("[itemprop='image']");
    if (!el) return undefined;
    if (el instanceof HTMLImageElement) return el.src;
    return el.getAttribute("content") || el.getAttribute("href") || undefined;
  };

  return {
    title: getMicroText("name"),
    price: parsePrice(getMicroText("price")),
    rating: parseRating(getMicroText("ratingValue")),
    reviewCount: parseCount(getMicroText("reviewCount") || getMicroText("ratingCount")),
    imageUrl: getMicroImage(),
  };
}

// ---------- Strategy 4: Platform-specific selectors ----------

function readFromPlatform(host: Host): Partial<Product> {
  const pack = PLATFORM_PACKS[host];
  if (!pack) return {};

  const readText = (sels: string[]): string | undefined => {
    for (const sel of sels) {
      try {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          const text = (el.getAttribute("content") || el.textContent || "").trim();
          if (text) return text;
        }
      } catch {
        // skip invalid selector
      }
    }
    return undefined;
  };
  const readImg = (sels: string[]): string | undefined => {
    for (const sel of sels) {
      try {
        const el = document.querySelector<HTMLImageElement>(sel);
        if (el) {
          const src = el.currentSrc || el.src || el.getAttribute("data-src") || "";
          if (src) return src;
        }
      } catch {
        // skip
      }
    }
    return undefined;
  };

  return {
    title: readText(pack.title),
    price: parsePrice(readText(pack.price)),
    originalPrice: parsePrice(readText(pack.originalPrice)),
    category: extractTopLevelCategory() ?? readText(pack.category),
    rating: parseRating(readText(pack.rating)),
    reviewCount: parseCount(readText(pack.reviewCount)),
    imageUrl: readImg(pack.imageUrl),
  };
}

/**
 * Return the top-level breadcrumb category (e.g. "Elektronik") rather
 * than the deepest leaf (e.g. "Aynasız Fotoğraf Makinesi").
 *
 * Why: users set budgets at the broad category level
 * ("Elektronik ₺5000/ay") in the popup. If we pass the leaf category
 * to the backend, the (userId, category) lookup misses and the budget
 * agent silently degrades to "Bütçe Verisi Yok".
 *
 * Strategy: walk breadcrumb anchors, skip the home node ("Anasayfa" /
 * "Home" / "Trendyol"), return the first remaining text.
 */
function extractTopLevelCategory(): string | undefined {
  const containers = document.querySelectorAll<HTMLElement>(
    ".breadcrumb, .breadcrumb-content, .breadcrumb-list, [class*='breadcrumb'], [data-testid*='breadcrumb'], nav[aria-label='breadcrumb']",
  );
  const skip = /^(anasayfa|home|trendyol|hepsiburada|n11|migros|teknosa|mediamarkt|boyner|lc waikiki|amazon)$/i;

  for (const container of Array.from(containers)) {
    const anchors = container.querySelectorAll<HTMLElement>("a, span[itemprop='name'], li");
    for (const a of Array.from(anchors)) {
      const text = (a.textContent || "").trim().replace(/\s+/g, " ");
      if (!text || text.length > 40) continue;
      if (skip.test(text)) continue;
      // Skip arrow separators or non-text artifacts.
      if (/^[›>»→»<-]+$/.test(text)) continue;
      return text;
    }
  }
  return undefined;
}

// ---------- Strategy 5: og:meta + <title> ----------

function readMetaContent(name: string): string | undefined {
  const sel = `meta[property='${name}'], meta[name='${name}']`;
  const el = document.querySelector<HTMLMetaElement>(sel);
  return el?.content || undefined;
}

function readFromOg(): Partial<Product> {
  return {
    title: readMetaContent("og:title") || document.title,
    price: parsePrice(readMetaContent("product:price:amount") || readMetaContent("og:price:amount")),
    imageUrl: readMetaContent("og:image"),
  };
}

// ---------- Legal disclosure: 30 günün en düşük fiyatı ----------

/**
 * Parses the merchant's legally-required 30-day-low disclosure from the
 * product page. Turkish consumer-protection regulation (Ticari Reklam
 * Yön. m. 14/b) mandates this text near the discount badge whenever an
 * "indirim öncesi" price is shown — Trendyol, Hepsiburada, N11, and
 * most others now render it consistently.
 *
 * Returns the numeric value on success, `undefined` when no match.
 * The backend cross-checks this against our own price-history and
 * Akakçe to flag inflated original-price claims.
 *
 * Match patterns (case-insensitive):
 *   - "Son 30 gün içinde uygulanan en düşük fiyat: ₺X"
 *   - "30 günün en düşük fiyatı: ₺X"
 *   - "Geçen 30 günün en düşük fiyatı X TL"
 */
export function extractLegalLowestPrice30d(root: ParentNode = document): number | undefined {
  // Pull a snippet of text from likely containers first to keep the
  // regex window small. The disclosure usually lives in the price area.
  const containers = root.querySelectorAll<HTMLElement>(
    "[class*='price'], [class*='Price'], [data-test-id*='price'], [data-testid*='price'], .product-info, .product-detail",
  );
  for (const el of Array.from(containers)) {
    const txt = (el.textContent || "").replace(/\s+/g, " ");
    if (!/30\s*g[uü]n/i.test(txt)) continue;
    const hit = txt.match(/(?:son\s+|ge[çc]en\s+)?30\s*g[uü]n(?:[uü]n|\s*i[çc]inde)?(?:[^₺TL\d]*?)([\d.,]{3,12})\s*(?:₺|TL)?/i);
    if (hit) {
      const n = parsePrice(hit[1]);
      if (n !== undefined) return n;
    }
  }

  // Fallback: scan the document text once for the same pattern. Bounded
  // to a small slice so we don't pay for parsing the whole page text.
  const body = (document.body?.textContent || "").replace(/\s+/g, " ").slice(0, 40_000);
  const hit = body.match(/(?:son\s+|ge[çc]en\s+)?30\s*g[uü]n(?:[uü]n|\s*i[çc]inde)?(?:[^₺TL\d]*?)([\d.,]{3,12})\s*(?:₺|TL)?/i);
  if (hit) {
    const n = parsePrice(hit[1]);
    if (n !== undefined) return n;
  }
  return undefined;
}

// ---------- Strategy 5.5: Trendyol __NEXT_DATA__ canonical price ----------

/**
 * Walk Trendyol's `__NEXT_DATA__` JSON tree for the canonical product
 * price. This is the most reliable source for Trendyol — the page renders
 * from this exact JSON, so whatever number we pull from here is what the
 * customer actually sees on the buy button.
 *
 * Why we need it: Trendyol's CSS-rendered "₺ 76,84" on the page is often
 * the monthly installment (e.g. "4 x ₺ 76,84"), not the total. The
 * regex sweep can confuse the two. The `__NEXT_DATA__` blob exposes the
 * total separately, named one of {`discountedPrice`, `sellingPrice`,
 * `price`} on a Product object.
 *
 * Returns { price, originalPrice } from the first product node we hit
 * with at least a `discountedPrice` or `sellingPrice` field. Either may
 * be undefined if absent.
 */
function readTrendyolNextDataPrice(): {
  price?: number;
  originalPrice?: number;
  /** All price-shaped numeric values we found, keyed by their JSON path. */
  allCandidates: Array<{ path: string; value: number }>;
} {
  const node = document.querySelector<HTMLScriptElement>("script#__NEXT_DATA__");
  if (!node?.textContent) return { allCandidates: [] };
  try {
    const data = JSON.parse(node.textContent);
    const sellingLike: Array<{ path: string; value: number }> = [];
    const originalLike: Array<{ path: string; value: number }> = [];
    const genericPriceLike: Array<{ path: string; value: number }> = [];

    _walkTrendyolPrices(data, "", 0, (path, key, value) => {
      const lk = key.toLowerCase();
      // Skip values that are clearly NOT a product total. Filter out
      // installment-y fields by name.
      if (/installment|taksit|monthly|perpiece|pieceprice|unitprice|cargo|kargo|shipping|tax/i.test(path)) {
        return;
      }
      // Sanity: anything outside ₺5..₺500_000 isn't a Turkish product price.
      if (value < 5 || value > 500_000) return;

      if (/sellingprice|discountedprice|salesprice|finalprice|currentprice/.test(lk)) {
        sellingLike.push({ path, value });
      } else if (/originalprice|listprice|previousprice|prevprice|baseprice/.test(lk)) {
        originalLike.push({ path, value });
      } else if (lk === "price" || lk.endsWith(".price") || /^\w*price$/.test(lk)) {
        genericPriceLike.push({ path, value });
      }
    });

    const all = [...sellingLike, ...originalLike, ...genericPriceLike];
    // Prefer the most-specific match for the displayed total. We pick the
    // MAXIMUM value, because:
    //   - Genuine discount: discountedPrice (smaller) and originalPrice
    //     (larger) — we want discountedPrice as the price the user pays.
    //   - BUT: installment / per-piece values are *also* smaller than the
    //     total. We can't tell them apart from a real discount by name.
    //   - The displayed total on the buy button is always ≥ any
    //     installment value, so MAX across "selling-like" + "original-like"
    //     fields is a safe upper bound. If no discount applies it equals
    //     the listed price; if a real discount applies we'll still surface
    //     the original via `originalPrice`.
    const sellingMax = sellingLike.reduce((m, c) => Math.max(m, c.value), 0);
    const originalMax = originalLike.reduce((m, c) => Math.max(m, c.value), 0);

    // Always-on candidate dump so the user can paste it back when the
    // result is wrong. Bounded to 12 entries so it doesn't spam.
    console.log("[Thundrly/extract] __NEXT_DATA__ price candidates:", {
      selling: sellingLike.slice(0, 8),
      original: originalLike.slice(0, 8),
      generic: genericPriceLike.slice(0, 4),
    });

    // Strategy: if a selling-shaped value exists, pick the largest such
    // value (defeats per-installment / per-piece duplicates). Otherwise
    // fall back to the largest generic price.
    const price =
      sellingMax > 0
        ? sellingMax
        : genericPriceLike.reduce((m, c) => Math.max(m, c.value), 0) || undefined;
    const originalPrice = originalMax > 0 ? originalMax : undefined;

    // Final installment sanity: if originalPrice exists and price is
    // less than 1/2 of it, that's a deeper-than-50% discount which is
    // suspicious on Trendyol. Replace `price` with the closest selling-
    // -like candidate that's at least originalPrice / 2.
    let finalPrice = price;
    if (price && originalPrice && price < originalPrice / 2) {
      const plausible = sellingLike
        .map((c) => c.value)
        .filter((v) => v >= originalPrice / 2)
        .sort((a, b) => a - b)[0];
      if (plausible) finalPrice = plausible;
    }

    return {
      price: finalPrice,
      originalPrice: originalPrice && finalPrice && originalPrice <= finalPrice ? undefined : originalPrice,
      allCandidates: all,
    };
  } catch (e) {
    console.warn("[Thundrly/extract] __NEXT_DATA__ parse failed:", e);
    return { allCandidates: [] };
  }
}

/** Recursive walker that invokes `visit(path, key, numericValue)` for every
 *  leaf numeric (or numeric-string) value in the tree. Skips obviously
 *  non-product subtrees by path heuristic to keep the work bounded. */
function _walkTrendyolPrices(
  node: unknown,
  path: string,
  depth: number,
  visit: (path: string, key: string, value: number) => void,
): void {
  if (depth > 16) return;
  // Skip subtrees we know are noise.
  if (/(recommendations|relatedProducts|crossProducts|similarProducts|seoData|breadcrumb)/i.test(path)) {
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < Math.min(node.length, 200); i++) {
      _walkTrendyolPrices(node[i], `${path}[${i}]`, depth + 1, visit);
    }
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    const nextPath = path ? `${path}.${k}` : k;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      visit(nextPath, k, v);
    } else if (typeof v === "string") {
      const parsed = parsePrice(v);
      if (parsed !== undefined) visit(nextPath, k, parsed);
    } else if (v && typeof v === "object") {
      // Special-case the { value: N, currency: "TRY" } wrapper.
      const inner = v as Record<string, unknown>;
      if (typeof inner.value === "number" && Number.isFinite(inner.value)) {
        visit(nextPath, k, inner.value);
      } else {
        _walkTrendyolPrices(v, nextPath, depth + 1, visit);
      }
    }
  }
}

// ---------- Strategy 6: last-resort regex sweep ----------

/**
 * When all structured strategies miss (typical on Trendyol after a React
 * re-render with new class names), scan the DOM near the "Sepete Ekle"
 * button for ₺/TL currency patterns and pick the largest plausible
 * price.
 *
 * Why largest: pages often show monthly-installment offers like
 * "12 x ₺83" alongside the real "₺990" total; the real total is almost
 * always the largest figure in the buy-button area.
 *
 * Installment filter: matches preceded by `<n> x ` or followed by `/ay`
 * are dropped — Trendyol's PDP renders "4 x ₺76,84" prominently which
 * the old sweep was mistaking for the actual price.
 *
 * The search container is the buy button's nearest ancestor with at
 * least 4 children — typically the product-info column. Falls back to
 * the whole document only as a last-last resort.
 */
function regexSweepPrice(): number | undefined {
  // Build a scope that includes the price area near a buy button.
  const buyish = document.querySelector<HTMLElement>(
    "button[data-test-id*='add'], button[data-testid*='add'], button[class*='add-to'], #addToCart, #addBasket",
  );
  let scope: Element = document.body;
  if (buyish) {
    let walker: Element | null = buyish;
    for (let i = 0; i < 6 && walker?.parentElement; i++) {
      walker = walker.parentElement;
      if (walker.children.length >= 4) {
        scope = walker;
        break;
      }
    }
  }

  const text = (scope.textContent || "").replace(/\s+/g, " ");
  // Match "₺1.249,90", "1.249,90 TL", "1249 TL", "TL 1.249", in either order.
  const pattern = /(?:₺|\bTL\b)\s*([\d.,]{3,12})|\b([\d.,]{3,12})\s*(?:₺|\bTL\b)/g;

  const candidates: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const raw = m[1] || m[2];
    const parsed = parsePrice(raw);
    if (parsed === undefined || parsed < 5 || parsed > 500_000) continue;

    // Installment guards: drop matches that the context says are per-
    // installment, not totals.
    const start = m.index;
    const end = start + m[0].length;
    const before = text.slice(Math.max(0, start - 14), start).toLowerCase();
    const after = text.slice(end, Math.min(text.length, end + 14)).toLowerCase();
    const installmentBefore = /\b\d+\s*x\s*$/i.test(before) || /taksit/i.test(before);
    const installmentAfter = /^\s*\/\s*ay\b/.test(after) || /^\s*ay\b/.test(after);
    if (installmentBefore || installmentAfter) continue;

    candidates.push(parsed);
  }
  if (candidates.length === 0) return undefined;

  // Largest tends to be the total (installments are per-month, smaller).
  candidates.sort((a, b) => b - a);
  return candidates[0];
}

// ---------- Priority merge ----------

function mergeFields(...sources: Partial<Product>[]): Partial<Product> {
  const out: Partial<Product> = {};
  for (const src of sources) {
    for (const [key, value] of Object.entries(src) as [keyof Product, unknown][]) {
      if (value === undefined || value === null || value === "" || value === 0) continue;
      if (out[key] === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (out as any)[key] = value;
      }
    }
  }
  return out;
}

export function extractProductBasics(host: Host): Partial<Product> {
  // Demo: explicit data-attrs short-circuit everything else.
  if (host === "demo") {
    const demo = readFromDemo();
    if (demo) return demo;
  }

  const ld = readFromLD();
  const micro = readFromMicrodata();
  const plat = readFromPlatform(host);
  const og = readFromOg();

  // Trendyol-specific canonical price probe — pulls from __NEXT_DATA__
  // which is what the page itself renders from. Inserted between
  // JSON-LD and the platform-selector layer so it can correct
  // installment values that occasionally show up in JSON-LD/microdata.
  const next: Partial<Product> = {};
  if (host === "trendyol") {
    const tn = readTrendyolNextDataPrice();
    if (tn.price !== undefined) next.price = tn.price;
    if (tn.originalPrice !== undefined) next.originalPrice = tn.originalPrice;
  }

  // ALWAYS log each layer's price so the next bad screenshot is trivial
  // to diagnose. console.warn so it stands out against page chatter.
  console.warn("[Thundrly/extract] per-layer prices:", {
    jsonLd: ld.price,
    microdata: micro.price,
    nextData: next.price,
    platformSelector: plat.price,
    ogMeta: og.price,
  });

  // Priority: JSON-LD → __NEXT_DATA__ → microdata → platform → og.
  // Note JSON-LD wins over __NEXT_DATA__ because schema.org is usually
  // the cleanest signal. We *override* JSON-LD only when JSON-LD is
  // suspicious (see installment guard below).
  let merged = mergeFields(ld, next, micro, plat, og);

  // Installment guard: if the chosen `price` is suspiciously small
  // compared to OTHER layers' candidates, the smaller one is likely
  // an installment-per-month and we should swap to the larger total.
  //
  // Threshold 2.5× = caller is claiming a 60% discount, which is beyond
  // the typical clearance range (5–50%) and well within typical
  // installment-vs-total ratios (4×, 12×). Below 2.5× we trust the
  // priority chain.
  const allPrices = [ld.price, next.price, micro.price, plat.price, og.price]
    .filter((p): p is number => typeof p === "number" && p > 0);
  if (merged.price && allPrices.length >= 2) {
    const maxCandidate = Math.max(...allPrices);
    if (maxCandidate >= merged.price * 2.5) {
      const oldPrice = merged.price;
      merged = { ...merged, price: maxCandidate };
      console.warn(
        `[Thundrly/extract] installment guard: chose ₺${maxCandidate} over ₺${oldPrice} ` +
        `(gap ${(maxCandidate / oldPrice).toFixed(1)}×). Layers: ${JSON.stringify(allPrices)}`,
      );
    }
  }

  // Last resort: regex-scan for TL/₺ near the buy button when the
  // structured strategies all returned a missing/zero price.
  if (!merged.price || merged.price <= 0) {
    const sweep = regexSweepPrice();
    if (sweep !== undefined) {
      merged.price = sweep;
      console.log(`[Thundrly/extract] regex-sweep fallback found ₺${sweep}`);
    }
  } else {
    const source =
      ld.price === merged.price ? "JSON-LD" :
      next.price === merged.price ? "__NEXT_DATA__" :
      micro.price === merged.price ? "microdata" :
      plat.price === merged.price ? "platform-selectors" :
      og.price === merged.price ? "og:meta" : "merged/installment-guard";
    console.log(`[Thundrly/extract] price ₺${merged.price} via ${source}`);
  }

  return merged;
}

// ---------- Reviews extraction ----------

function _parseRatingFromElement(el: HTMLElement): number | undefined {
  // Try common attributes first; the demo page uses `data-kg-rating`,
  // microdata uses `content`, some sites use `value` or `data-rating`.
  for (const attr of ["data-kg-rating", "data-rating", "content", "value"]) {
    const raw = el.getAttribute(attr);
    if (raw) {
      const n = parseFloat(raw.replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && n <= 5) return n;
    }
  }
  const text = el.textContent?.trim() ?? "";
  // Numeric in text: "4.5", "5/5", "5 puan"
  const numMatch = text.match(/(\d+([.,]\d+)?)/);
  if (numMatch) {
    const n = parseFloat(numMatch[1].replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 5) return n;
  }
  // Star-character fallback: "★★★★★" → 5, "⭐⭐" → 2
  const stars = (text.match(/★|⭐/g) || []).length;
  if (stars > 0 && stars <= 5) return stars;
  return undefined;
}

function _firstElement(
  scope: ParentNode,
  selectors: string[] | undefined,
): HTMLElement | null {
  if (!selectors) return null;
  for (const sel of selectors) {
    try {
      const el = scope.querySelector<HTMLElement>(sel);
      if (el) return el;
    } catch {
      // skip invalid selector
    }
  }
  return null;
}


function _extractOneReview(container: HTMLElement, sels: ReviewSelectors): Review | null {
  const ratingEl = _firstElement(container, sels.rating);
  const rating = ratingEl ? _parseRatingFromElement(ratingEl) : undefined;
  if (rating === undefined) return null;

  const textEl = _firstElement(container, sels.text);
  const text = textEl?.textContent?.trim() ?? "";
  if (!text) return null;

  const dateEl = _firstElement(container, sels.date);
  const date = dateEl?.textContent?.trim() ?? "";

  // Optional trust signals — leave the field unset (null) when the page
  // doesn't expose it. The backend distinguishes null (unknown) from
  // false (explicitly unverified) when computing verified-purchase ratio.
  const authorEl = _firstElement(container, sels.author);
  const author = authorEl?.textContent?.trim() || undefined;

  let verifiedPurchase: boolean | null = null;
  if (sels.verified && sels.verified.length > 0) {
    const verifiedEl = _firstElement(container, sels.verified);
    if (verifiedEl) {
      // Presence alone is the badge for most platforms; some pages
      // toggle by class so accept "true"/"verified" textContent too.
      const txt = (verifiedEl.textContent || "").trim().toLowerCase();
      verifiedPurchase = txt === "" || /verified|onaylı|onayli|true|yes/.test(txt) ? true : false;
    }
  }

  let helpfulCount: number | undefined;
  if (sels.helpful && sels.helpful.length > 0) {
    const helpfulEl = _firstElement(container, sels.helpful);
    const raw = helpfulEl?.textContent?.trim();
    const n = raw ? parseInt(raw.replace(/\D/g, ""), 10) : NaN;
    if (Number.isFinite(n) && n >= 0) helpfulCount = n;
  }

  return {
    rating,
    text,
    date,
    author,
    verifiedPurchase: verifiedPurchase ?? undefined,
    helpfulCount,
  };
}

/**
 * Verbose logging for review extraction. Set to true via DevTools console
 * (`window.__THUNDRLY_DEBUG = true`) to see exactly which selectors matched
 * and why each container was accepted or rejected. Off by default to keep
 * the user's console quiet in production.
 *
 * The debug helper is exposed on the global so users can flip it without
 * a rebuild. Diagnostic output uses a distinctive [Thundrly/reviews] tag
 * so it's easy to filter in DevTools.
 */
function _debugEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as Record<string, unknown>).__THUNDRLY_DEBUG)
  );
}
function _dlog(...args: unknown[]): void {
  if (_debugEnabled()) {
    // eslint-disable-next-line no-console
    console.log("[Thundrly/reviews]", ...args);
  }
}

export function extractReviews(host: Host, root: ParentNode = document): Review[] {
  const sels: ReviewSelectors | undefined =
    host === "demo" ? DEMO_REVIEW_SELECTORS : PLATFORM_PACKS[host]?.reviews;
  if (!sels) {
    _dlog(`host=${host}: no review selector pack configured`);
    return [];
  }

  // Walk the container selectors and report which one(s) matched.
  let matchedSelector: string | null = null;
  let containers: HTMLElement[] = [];
  for (const sel of sels.container) {
    try {
      const found = Array.from(root.querySelectorAll<HTMLElement>(sel));
      if (found.length > 0) {
        matchedSelector = sel;
        containers = found;
        _dlog(`container selector matched: ${sel} → ${found.length} elements`);
        break;
      }
    } catch {
      _dlog(`container selector invalid (skipped): ${sel}`);
    }
  }
  if (containers.length === 0) {
    _dlog(
      `no container selector matched. tried ${sels.container.length} selectors. ` +
      `DOM might use a new class name; inspect manually.`,
    );
    return [];
  }

  const cap = sels.maxItems ?? 25;
  const out: Review[] = [];
  let rejected = 0;
  for (const c of containers.slice(0, cap)) {
    const r = _extractOneReview(c, sels);
    if (r) {
      out.push(r);
    } else {
      rejected++;
    }
  }
  _dlog(
    `final: ${out.length} reviews extracted (${rejected} containers rejected — ` +
    `likely missing rating or text). selector used: ${matchedSelector}`,
  );
  return out;
}

/**
 * Async review extraction that scroll-triggers lazy widgets on Trendyol /
 * Hepsiburada / N11 before scraping.
 *
 * Strategy (May-2026 hardening):
 *   1. Synchronous extract — fast path for already-rendered widgets.
 *   2. If empty: scroll the most likely review section into view, also
 *      dispatch a synthetic wheel event (Trendyol's lazy loader gates
 *      on IntersectionObserver + scroll-velocity, not just visibility).
 *   3. Use a MutationObserver to **resolve as soon as review nodes appear**
 *      under the platform's review container — typically 200–800ms when
 *      the widget loads, but we wait up to `maxWaitMs` (default 3500ms)
 *      before giving up. Fast on responsive pages, patient on slow ones.
 *   4. Second pass: if still empty after the first settle, scroll the
 *      anchor again and wait once more — some loaders need two ticks.
 *   5. Always restore the scroll position so the user doesn't see jump.
 *
 * The change from "fixed 800ms sleep" to "observer-with-deadline" is the
 * biggest reliability win on this path: we no longer give up early when
 * a slow lazy loader needs ~1500ms, and we no longer wait the full 800ms
 * unnecessarily on a page that loaded reviews in 200ms.
 *
 * Honors `cap` from the per-platform selector pack.
 */
export async function extractReviewsAsync(
  host: Host,
  maxWaitMs = 3500,
): Promise<Review[]> {
  // Fast path.
  let reviews = extractReviews(host);
  if (reviews.length > 0) {
    _dlog(`fast-path: ${reviews.length} reviews already in DOM`);
    return reviews;
  }
  _dlog("fast-path empty; trying scroll-trigger");

  const anchor = _findReviewAnchor();
  if (!anchor) {
    _dlog("no review-section anchor found in DOM — giving up at fast-path");
    return reviews;
  }
  _dlog(`scrolling anchor into view: <${anchor.tagName.toLowerCase()}>`, anchor.textContent?.slice(0, 60));

  const prevY = window.scrollY;
  try {
    // First settle pass.
    const start1 = Date.now();
    reviews = await _scrollSettleAndExtract(host, anchor, maxWaitMs);
    _dlog(`pass-1 settle: ${reviews.length} reviews in ${Date.now() - start1}ms`);
    if (reviews.length > 0) return reviews;

    // Second pass — some lazy loaders need a second scroll tick.
    const start2 = Date.now();
    reviews = await _scrollSettleAndExtract(host, anchor, maxWaitMs);
    _dlog(`pass-2 settle: ${reviews.length} reviews in ${Date.now() - start2}ms`);
  } finally {
    window.scrollTo({ top: prevY, behavior: "auto" });
  }
  if (reviews.length === 0) {
    _dlog("both passes empty — content script will fall through to background /yorumlar fetch");
  }
  return reviews;
}

function _findReviewAnchor(): HTMLElement | null {
  const candidates: (HTMLElement | null)[] = [
    // Headings whose text mentions reviews (most reliable across hosts).
    ...Array.from(document.querySelectorAll<HTMLElement>("h2, h3, h4")).filter((el) =>
      /yorum|değerlendirme|review/i.test(el.textContent || ""),
    ),
    // Known container ids/data hooks across TR retailers.
    document.querySelector<HTMLElement>("#reviews"),
    document.querySelector<HTMLElement>("[data-testid='reviews']"),
    document.querySelector<HTMLElement>(".reviews-section"),
    document.querySelector<HTMLElement>(".pr-rnr-w"),
    document.querySelector<HTMLElement>(".comments"),
    document.querySelector<HTMLElement>(".product-detail-review"),
  ].filter((el): el is HTMLElement => el != null);
  return candidates[0] ?? null;
}

async function _scrollSettleAndExtract(
  host: Host,
  anchor: HTMLElement,
  maxWaitMs: number,
): Promise<Review[]> {
  // Trigger the lazy loader: scroll the anchor + dispatch a synthetic
  // wheel event so IntersectionObserver + velocity-gated loaders both fire.
  anchor.scrollIntoView({ block: "center", behavior: "auto" });
  anchor.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 200 }));

  // Resolve as soon as ANY review container shows up.
  return new Promise<Review[]>((resolve) => {
    const tryExtract = () => extractReviews(host);

    // Maybe it loaded synchronously between scroll and observer setup.
    let reviews = tryExtract();
    if (reviews.length > 0) {
      resolve(reviews);
      return;
    }

    let done = false;
    const finish = (r: Review[]) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(r);
    };

    const observer = new MutationObserver(() => {
      reviews = tryExtract();
      if (reviews.length > 0) finish(reviews);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    const timer = window.setTimeout(() => finish(tryExtract()), maxWaitMs);
  });
}

/**
 * Background fetch of the platform's review subpage. Asks the service
 * worker to GET the URL (CORS-friendly via host_permissions) and parse
 * the returned HTML for reviews using the platform's selector pack.
 *
 * Returns ``[]`` on any error or when the platform has no known subpage
 * route. Currently supports trendyol + hepsiburada.
 */
export async function requestReviewsFromBackground(host: Host): Promise<Review[]> {
  const subpageUrl = reviewSubpageUrl(host, location.href);
  if (!subpageUrl) {
    _dlog(`no /yorumlar subpage URL pattern for host=${host}`);
    return [];
  }
  _dlog(`background fetch: GET ${subpageUrl}`);
  const start = Date.now();
  try {
    const resp = await chrome.runtime.sendMessage<
      { type: "fetchReviews"; payload: { url: string; host: Host } },
      { ok: true; reviews: Review[] } | { ok: false; error: string }
    >({ type: "fetchReviews", payload: { url: subpageUrl, host } });
    if (resp && resp.ok) {
      _dlog(`background fetch: got ${resp.reviews.length} reviews in ${Date.now() - start}ms`);
      return resp.reviews;
    }
    _dlog(`background fetch failed:`, resp);
  } catch (e) {
    console.warn("[Thundrly] yorumlar arka plan fetch'i başarısız:", e);
  }
  return [];
}

/** Resolve the platform's "all reviews" subpage URL. */
function reviewSubpageUrl(host: Host, pdpUrl: string): string | null {
  try {
    const u = new URL(pdpUrl);
    if (host === "trendyol") {
      // Trendyol: <product-slug>-p-<id>/yorumlar
      // Strategy: append "/yorumlar" to the pathname if not already there.
      if (!u.pathname.endsWith("/yorumlar")) {
        u.pathname = u.pathname.replace(/\/$/, "") + "/yorumlar";
      }
      return u.toString();
    }
    if (host === "hepsiburada") {
      // Hepsiburada: <slug>-p-<id>/yorumlari
      if (!u.pathname.endsWith("/yorumlari")) {
        u.pathname = u.pathname.replace(/\/$/, "") + "/yorumlari";
      }
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  return null;
}

// ---------- Public API ----------

/**
 * Builds an AnalyzeRequest from the current page.
 *
 *   - product:      DOM extraction (priority chain in `extractProductBasics`)
 *   - reviews:      DOM extraction via per-platform review selectors. Falls
 *                   back to the canonical fixture only when nothing matches
 *                   (e.g. a page with no review widget at all).
 *   - priceHistory: empty; resolved server-side from crowdsource DB.
 *   - userBudget:   omitted; resolved server-side by (userId, category).
 *   - session:      best-effort live measurements (see content script).
 */
export interface BuildAnalyzeRequestOptions {
  /** Measured session telemetry from sessionTracker.buildSessionContext. */
  session: SessionContext;
  /** Stable per-install identifier; defaults to "demo-user" for backwards compat. */
  userId?: string;
}

export function buildAnalyzeRequest(
  host: Host,
  opts: BuildAnalyzeRequestOptions,
): AnalyzeRequest {
  const basics = extractProductBasics(host);

  const product: Product = sanitizeProduct({
    title: basics.title || "Ürün adı bulunamadı",
    price: basics.price ?? 0,
    originalPrice: basics.originalPrice,
    currency: "TRY",
    category: basics.category || "Genel",
    rating: basics.rating,
    reviewCount: basics.reviewCount,
    url: location.href,
    imageUrl: basics.imageUrl,
    legalLowestPrice30d: extractLegalLowestPrice30d(),
  });

  // Reviews: only what we scraped from the live page. Never substitute
  // the demo fixture — doing so causes the review agent to "discover"
  // the fixture's duplicate-pair patterns on every page where review
  // extraction misses (e.g. Trendyol's lazy-loaded review widget that
  // lives under /yorumlar), poisoning real verdicts with fake findings.
  const reviews: Review[] = sanitizeReviews(extractReviews(host));
  const priceHistory: PriceHistoryPoint[] = [];

  return {
    userId: opts.userId ?? "demo-user",
    platform: host,
    product,
    reviews,
    priceHistory,
    session: opts.session,
  };
}

/**
 * Defense-in-depth sanitizer. Even with the per-field parsers tuned,
 * a future site change can produce an out-of-range value (rating > 5,
 * negative reviewCount, NaN, ±Infinity) that the backend rejects with
 * a 422. Rather than asking the user to interpret an HTTP error, drop
 * or clamp anything that wouldn't pass the Pydantic schema BEFORE we
 * ship it. The Mayıs 2026 incident (parsePrice on Amazon's
 * "5 üzerinden 4,7" → rating=54.7 → 422 → demo fixture rendered as
 * "real") was the motivating bug.
 */
function sanitizeProduct(p: Product): Product {
  const clean: Product = { ...p };

  // Numbers must be finite. Drop anything else.
  const finiteOrUndef = (
    n: number | null | undefined,
    lo: number,
    hi: number,
  ): number | undefined => {
    if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
    if (n < lo || n > hi) return undefined;
    return n;
  };

  // Required price: schema is ge=0, lt=10_000_000. Clamp to 0 (never undefined).
  const safePrice = finiteOrUndef(clean.price, 0, 9_999_999);
  clean.price = safePrice ?? 0;

  // Optional numeric fields — drop if out of range so the field is omitted.
  clean.originalPrice = finiteOrUndef(clean.originalPrice, 0, 9_999_999);
  // Schema clamps rating to [0,5]. If a parser misbehaved, drop rather
  // than guess a meaningless value.
  clean.rating = finiteOrUndef(clean.rating, 0, 5);
  // reviewCount must be an integer in [0, 10_000_000).
  const rc = finiteOrUndef(clean.reviewCount, 0, 9_999_999);
  clean.reviewCount = rc !== undefined ? Math.round(rc) : undefined;
  clean.legalLowestPrice30d = finiteOrUndef(clean.legalLowestPrice30d, 0, 9_999_999);

  // String length caps — title 1..512, category 1..128, url 8..2048, imageUrl ≤2048.
  if (!clean.title || clean.title.length === 0) clean.title = "Ürün adı bulunamadı";
  if (clean.title.length > 512) clean.title = clean.title.slice(0, 512);
  if (!clean.category || clean.category.length === 0) clean.category = "Genel";
  if (clean.category.length > 128) clean.category = clean.category.slice(0, 128);
  if (clean.imageUrl && clean.imageUrl.length > 2048) clean.imageUrl = undefined;
  // URL is required min-length 8; if extraction somehow returned a short
  // string, swap to location.href which is always a full URL.
  if (!clean.url || clean.url.length < 8) clean.url = location.href;
  if (clean.url.length > 2048) clean.url = clean.url.slice(0, 2048);

  return clean;
}

function sanitizeReviews(reviews: Review[]): Review[] {
  return reviews
    .map((r) => {
      const rating = typeof r.rating === "number" && Number.isFinite(r.rating)
        ? Math.max(0, Math.min(5, r.rating))
        : NaN;
      const text = typeof r.text === "string" ? r.text.slice(0, 2048) : "";
      if (!Number.isFinite(rating) || text.length === 0) return null;
      const helpfulCount =
        typeof r.helpfulCount === "number" && Number.isFinite(r.helpfulCount)
          ? Math.max(0, Math.round(r.helpfulCount))
          : undefined;
      return {
        ...r,
        rating,
        text,
        date: (r.date || "").slice(0, 32),
        author: r.author ? r.author.slice(0, 128) : undefined,
        helpfulCount,
      } as Review;
    })
    .filter((r): r is Review => r !== null);
}

/**
 * Async variant that tries harder for reviews:
 *   1. Synchronous extract (current DOM).
 *   2. Scroll-trigger lazy widget + wait + re-extract.
 *   3. Background-fetch the /yorumlar subpage (Trendyol + Hepsiburada).
 *
 * Use this from the content script when the user clicks a buy button —
 * the extra latency (~1s worst case) is acceptable because the panel
 * shows a loading state while agents run.
 */
export async function buildAnalyzeRequestAsync(
  host: Host,
  opts: BuildAnalyzeRequestOptions,
): Promise<AnalyzeRequest> {
  const base = buildAnalyzeRequest(host, opts);
  if (base.reviews && base.reviews.length > 0) return base;

  // Try scroll-trigger first — cheap.
  let reviews = await extractReviewsAsync(host);
  if (reviews.length === 0) {
    // Last resort: subpage fetch via background.
    reviews = await requestReviewsFromBackground(host);
  }

  return { ...base, reviews };
}

/**
 * Subset used by the crowdsource observation endpoint. Returns `null`
 * when the page doesn't expose enough to be useful (no price / zero) —
 * we'd rather skip a write than pollute the DB with garbage.
 */
export interface PriceObservationPayload {
  url: string;
  price: number;
  currency: "TRY";
  title?: string;
}

export function extractCurrentObservation(host: Host): PriceObservationPayload | null {
  const basics = extractProductBasics(host);
  if (!basics.price || basics.price <= 0) return null;
  return {
    url: location.href,
    price: basics.price,
    currency: "TRY",
    title: basics.title,
  };
}
