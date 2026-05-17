/**
 * Buton yakalama: her host için Türk e-ticaret sitelerindeki "Sepete Ekle" /
 * "Satın Al" / "Hemen Al" düğmelerini bulan seçici tabloları.
 *
 * Gerçek seçiciler hızla değişir; bu yüzden MVP'de site-spesifik seçiciler
 * placeholder olarak bırakılmıştır. Üretimde uzaktan yapılandırılabilir bir
 * seçici paketi önerilir (örneğin GitHub'dan günde bir kez çekilen JSON).
 *
 * Sentetik demo (`public/demo-product.html`) bilinen `[data-kg-buy]` özniteliğini
 * kullanır; bu, yakalama akışını her zaman çalıştırmamızı sağlar.
 */

export type Host = "trendyol" | "hepsiburada" | "n11" | "demo" | "unknown";

export function detectHost(href: string): Host {
  try {
    const url = new URL(href);
    const h = url.hostname.toLowerCase();
    if (h.endsWith("trendyol.com")) return "trendyol";
    if (h.endsWith("hepsiburada.com")) return "hepsiburada";
    if (h.endsWith("n11.com")) return "n11";
    if (url.pathname.includes("demo-product.html") || h.endsWith("local")) return "demo";
    return "unknown";
  } catch {
    return "unknown";
  }
}

type SelectorPack = {
  buyButtons: string[];
  textMatchers: RegExp[];
};

const SELECTOR_PACKS: Record<Host, SelectorPack> = {
  trendyol: {
    // TODO: Trendyol'un gerçek "Sepete Ekle" seçicileri zamanla değişir.
    // Mevcut sınıflar: ".add-to-basket", ".product-button" gibi. Üretim için
    // uzaktan güncellenebilir bir liste önerilir.
    buyButtons: [
      "button[data-test-id='addToCartButton']",
      ".add-to-basket",
      "button.add-to-bs-tx",
    ],
    textMatchers: [/sepete ekle/i, /sepete at/i, /satın al/i, /hemen al/i],
  },
  hepsiburada: {
    // TODO: Hepsiburada — `[data-test-id='shop-...add-to-cart']` gibi seçiciler kullanılır.
    buyButtons: [
      "button[data-test-id='shopAddToCartButton']",
      "#addToCart",
      "button.add-to-cart",
    ],
    textMatchers: [/sepete ekle/i, /satın al/i, /hemen al/i],
  },
  n11: {
    // TODO: N11 — "btnAddBasket" / `.btnAddBasket` gibi seçiciler.
    buyButtons: [".btnAddBasket", "#addBasket", "button.add-basket"],
    textMatchers: [/sepete ekle/i, /satın al/i, /hemen al/i],
  },
  demo: {
    buyButtons: ["[data-kg-buy]"],
    textMatchers: [/sepete ekle/i, /satın al/i, /hemen al/i],
  },
  unknown: {
    buyButtons: [],
    textMatchers: [/sepete ekle/i, /satın al/i, /hemen al/i],
  },
};

export function findBuyButtons(host: Host, root: ParentNode = document): HTMLElement[] {
  const pack = SELECTOR_PACKS[host];
  const found = new Set<HTMLElement>();

  // 1) Bilinen seçiciler
  for (const sel of pack.buyButtons) {
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => found.add(el));
  }

  // 2) Metin tabanlı fallback — bilinen seçiciler kaçırırsa "Sepete Ekle"
  //    metnine sahip butonları yakalar. Demo + bilinmeyen siteler için güvenli.
  root.querySelectorAll<HTMLElement>("button, a[role='button'], [role='button']").forEach((el) => {
    const text = (el.textContent || "").trim();
    if (!text) return;
    if (pack.textMatchers.some((rx) => rx.test(text))) {
      found.add(el);
    }
  });

  return Array.from(found);
}
