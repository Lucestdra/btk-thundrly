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

// ---------- Strategy 1: demo data-attributes ----------

function readFromDemo(): Partial<Product> | null {
  const el = document.querySelector<HTMLElement>("[data-kg-product]");
  if (!el) return null;
  return {
    title: el.dataset.kgTitle,
    price: parsePrice(el.dataset.kgPrice),
    originalPrice: parsePrice(el.dataset.kgOriginalPrice),
    category: el.dataset.kgCategory,
    rating: parsePrice(el.dataset.kgRating),
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
    rating: parsePrice(ld.aggregateRating?.ratingValue),
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
    rating: parsePrice(getMicroText("ratingValue")),
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
    category: readText(pack.category),
    rating: parsePrice(readText(pack.rating)),
    reviewCount: parseCount(readText(pack.reviewCount)),
    imageUrl: readImg(pack.imageUrl),
  };
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
    // Real product prices: > ₺5 (filters out shipping fees, rating numbers).
    // Cap at ₺500k to drop obvious junk (Trendyol shows campaign totals etc).
    if (parsed !== undefined && parsed >= 5 && parsed <= 500_000) {
      candidates.push(parsed);
    }
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

  const merged = mergeFields(
    readFromLD(),
    readFromMicrodata(),
    readFromPlatform(host),
    readFromOg(),
  );

  // Last resort: regex-scan for TL/₺ near the buy button when the
  // structured strategies all returned a missing/zero price.
  if (!merged.price || merged.price <= 0) {
    const sweep = regexSweepPrice();
    if (sweep !== undefined) merged.price = sweep;
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

function _allElements(
  scope: ParentNode,
  selectors: string[],
): HTMLElement[] {
  for (const sel of selectors) {
    try {
      const found = Array.from(scope.querySelectorAll<HTMLElement>(sel));
      if (found.length > 0) return found;
    } catch {
      // skip invalid selector
    }
  }
  return [];
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

  return { rating, text, date };
}

export function extractReviews(host: Host, root: ParentNode = document): Review[] {
  const sels: ReviewSelectors | undefined =
    host === "demo" ? DEMO_REVIEW_SELECTORS : PLATFORM_PACKS[host]?.reviews;
  if (!sels) return [];

  const containers = _allElements(root, sels.container);
  const cap = sels.maxItems ?? 25;
  const out: Review[] = [];
  for (const c of containers.slice(0, cap)) {
    const r = _extractOneReview(c, sels);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Async review extraction that scroll-triggers lazy widgets on Trendyol /
 * Hepsiburada / N11 before scraping.
 *
 * Strategy:
 *   1. Try a synchronous extract first — fast path for already-rendered widgets.
 *   2. If empty, scroll the most likely review section into view (heuristic
 *      anchors like "Yorumlar" headers or known review container classes),
 *      wait `lazyWaitMs` for the lazy loader to commit, then re-extract.
 *   3. If still empty, the caller can opt to background-fetch /yorumlar
 *      via `requestReviewsFromBackground`.
 *
 * Honors `cap` from the per-platform selector pack.
 */
export async function extractReviewsAsync(host: Host, lazyWaitMs = 800): Promise<Review[]> {
  // Fast path.
  let reviews = extractReviews(host);
  if (reviews.length > 0) return reviews;

  // Try to trigger lazy loading by scrolling a plausible review anchor
  // into view. Anchors are platform-agnostic so the same logic works
  // across our 21 hosts.
  const anchorCandidates = [
    // Headings whose text mentions reviews (most reliable).
    ...Array.from(document.querySelectorAll<HTMLElement>("h2, h3, h4")).filter((el) =>
      /yorum|değerlendirme|review/i.test(el.textContent || ""),
    ),
    // Known container ids/data hooks across TR retailers.
    document.querySelector<HTMLElement>("#reviews"),
    document.querySelector<HTMLElement>("[data-testid='reviews']"),
    document.querySelector<HTMLElement>(".reviews-section"),
    document.querySelector<HTMLElement>(".pr-rnr-w"),
    document.querySelector<HTMLElement>(".comments"),
  ].filter((el): el is HTMLElement => el != null);

  const anchor = anchorCandidates[0];
  if (anchor) {
    const prevY = window.scrollY;
    try {
      anchor.scrollIntoView({ block: "center", behavior: "auto" });
      await new Promise((r) => setTimeout(r, lazyWaitMs));
      reviews = extractReviews(host);
    } finally {
      // Restore scroll position so the user doesn't see the page jump.
      window.scrollTo({ top: prevY, behavior: "auto" });
    }
  }

  return reviews;
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
  if (!subpageUrl) return [];
  try {
    const resp = await chrome.runtime.sendMessage<
      { type: "fetchReviews"; payload: { url: string; host: Host } },
      { ok: true; reviews: Review[] } | { ok: false; error: string }
    >({ type: "fetchReviews", payload: { url: subpageUrl, host } });
    if (resp && resp.ok) return resp.reviews;
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

  const product: Product = {
    title: basics.title || "Ürün adı bulunamadı",
    price: basics.price ?? 0,
    originalPrice: basics.originalPrice,
    currency: "TRY",
    category: basics.category || "Genel",
    rating: basics.rating,
    reviewCount: basics.reviewCount,
    url: location.href,
    imageUrl: basics.imageUrl,
  };

  // Reviews: only what we scraped from the live page. Never substitute
  // the demo fixture — doing so causes the review agent to "discover"
  // the fixture's duplicate-pair patterns on every page where review
  // extraction misses (e.g. Trendyol's lazy-loaded review widget that
  // lives under /yorumlar), poisoning real verdicts with fake findings.
  const reviews: Review[] = extractReviews(host);
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
