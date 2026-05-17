/**
 * Host detection + buy-button capture for Turkish e-commerce sites.
 *
 * The PLATFORMS registry below is the single source of truth for which
 * sites Thundrly engages with. The manifest's `content_scripts.matches`
 * mirrors it (see manifest.json) and the extractor consults it to pick a
 * per-platform selector pack from `platformSelectors.ts`.
 *
 * Strategy for the long tail: sites without a dedicated selector pack
 * fall back to the generic "Sepete Ekle / Satın Al" text matcher pack
 * (`GENERIC_TR_BUY_TEXT`) for buy-button capture, and to the JSON-LD /
 * microdata / og:meta priority chain in productExtractor for product
 * data. Most TR retailers publish at least a Product JSON-LD block, so
 * the fallback is reliable.
 *
 * Adding a new site:
 *   1. Append it to PLATFORMS with a unique `key` and the apex domain.
 *   2. (Optional) add a selector pack in platformSelectors.ts for higher
 *      accuracy on product fields and review extraction.
 *   3. (Optional) add a buy-button selector entry to SITE_BUY_SELECTORS.
 *   4. Append the matching `*://*.<domain>/*` line to manifest.json under
 *      content_scripts.matches AND host_permissions.
 */

export const PLATFORMS = {
  trendyol: { domain: "trendyol.com", label: "Trendyol" },
  hepsiburada: { domain: "hepsiburada.com", label: "Hepsiburada" },
  n11: { domain: "n11.com", label: "N11" },
  amazon: { domain: "amazon.com.tr", label: "Amazon" },
  ciceksepeti: { domain: "ciceksepeti.com", label: "Çiçeksepeti" },
  mediamarkt: { domain: "mediamarkt.com.tr", label: "MediaMarkt" },
  teknosa: { domain: "teknosa.com", label: "Teknosa" },
  vatan: { domain: "vatanbilgisayar.com", label: "Vatan Bilgisayar" },
  boyner: { domain: "boyner.com.tr", label: "Boyner" },
  lcwaikiki: { domain: "lcwaikiki.com", label: "LC Waikiki" },
  defacto: { domain: "defacto.com.tr", label: "DeFacto" },
  modanisa: { domain: "modanisa.com", label: "Modanisa" },
  a101: { domain: "a101.com.tr", label: "A101" },
  migros: { domain: "migros.com.tr", label: "Migros Sanal Market" },
  carrefoursa: { domain: "carrefoursa.com", label: "CarrefourSA" },
  beymen: { domain: "beymen.com", label: "Beymen" },
  pazarama: { domain: "pazarama.com", label: "Pazarama" },
  pttavm: { domain: "pttavm.com", label: "PTT AVM" },
  tchibo: { domain: "tchibo.com.tr", label: "Tchibo" },
  decathlon: { domain: "decathlon.com.tr", label: "Decathlon" },
  ikea: { domain: "ikea.com.tr", label: "IKEA" },
} as const;

export type Host = keyof typeof PLATFORMS | "demo" | "unknown";

export function platformLabel(host: Host): string {
  if (host === "demo") return "Demo";
  if (host === "unknown") return "Bilinmeyen";
  return PLATFORMS[host].label;
}

export function detectHost(href: string): Host {
  try {
    const url = new URL(href);
    const h = url.hostname.toLowerCase();
    for (const [key, { domain }] of Object.entries(PLATFORMS)) {
      if (h === domain || h.endsWith("." + domain)) return key as Host;
    }
    if (url.pathname.includes("demo-product.html") || h.endsWith("local")) return "demo";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Generic Turkish buy-button text matchers — used when site-specific selectors miss. */
const GENERIC_TR_BUY_TEXT: RegExp[] = [
  /sepete ekle/i,
  /sepete at/i,
  /satın al/i,
  /hemen al/i,
  /şimdi al/i,
  /sipariş ver/i,
];

/**
 * Site-specific buy-button selectors. Sites not listed here rely purely on
 * the generic text matcher above. Selectors are best-effort and listed in
 * priority order — first match wins.
 */
const SITE_BUY_SELECTORS: Partial<Record<Host, string[]>> = {
  trendyol: [
    "button[data-test-id='addToCartButton']",
    ".add-to-basket",
    "button.add-to-bs-tx",
  ],
  hepsiburada: [
    "button[data-test-id='shopAddToCartButton']",
    "#addToCart",
    "button.add-to-cart",
  ],
  n11: [".btnAddBasket", "#addBasket", "button.add-basket"],
  amazon: ["#add-to-cart-button", "#buy-now-button", "input[name='submit.add-to-cart']"],
  ciceksepeti: ["button.add-to-cart", "button[data-add-to-cart]"],
  mediamarkt: ["button[data-test='add-to-cart']", "button[data-test='mms-add-to-cart-button']"],
  teknosa: ["button.add-to-cart", "button[data-test='add-to-cart-button']"],
  vatan: ["#add-to-cart", "button.add-to-cart", "#addBasket"],
  boyner: ["button[data-testid='add-to-cart']", "button.add-to-cart"],
  lcwaikiki: ["button[data-testid='add-to-cart']", "button.add-to-cart"],
  defacto: ["button[data-testid='add-to-cart']", "button.btn-add-cart"],
  modanisa: ["button.add-to-cart", "#addToCart"],
  a101: ["button.add-to-basket", "button[data-test='add-to-cart']"],
  migros: ["button[data-test='product-add']", "button.product-add"],
  carrefoursa: ["button.add-to-cart", "#js-product-add"],
  beymen: ["button.o-productDetail__addToBasket", "button.btn-add-to-cart"],
  pazarama: ["button.add-to-cart", "button[data-test='add-to-cart']"],
  pttavm: ["#btnAddToBasket", "button.add-to-basket"],
  tchibo: ["button[data-tcid='add-to-basket']", "button.add-to-basket"],
  decathlon: ["button[data-testid='add-to-cart']", "button.add-to-cart"],
  ikea: ["button[data-testid='add-to-cart-button']", "button.add-to-cart"],
  demo: ["[data-kg-buy]"],
};

export function findBuyButtons(host: Host, root: ParentNode = document): HTMLElement[] {
  const found = new Set<HTMLElement>();

  for (const sel of SITE_BUY_SELECTORS[host] ?? []) {
    try {
      root.querySelectorAll<HTMLElement>(sel).forEach((el) => found.add(el));
    } catch {
      // skip invalid selector
    }
  }

  // Generic Turkish text fallback — catches site updates and uncovered platforms.
  root.querySelectorAll<HTMLElement>("button, a[role='button'], [role='button']").forEach((el) => {
    const text = (el.textContent || "").trim();
    if (!text || text.length > 60) return;
    if (GENERIC_TR_BUY_TEXT.some((rx) => rx.test(text))) {
      found.add(el);
    }
  });

  return Array.from(found);
}
