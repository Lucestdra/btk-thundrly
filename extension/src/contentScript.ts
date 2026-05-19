/**
 * Content script — Türk e-ticaret sayfalarında "Sepete Ekle" / "Satın Al" tıklamasını yakalar,
 * paneli gömme (shadow DOM) içinde mount eder, kullanıcı kararına göre orijinal tıklamayı
 * yeniden gönderir veya iptal eder.
 *
 * Çalışma mantığı:
 *  1) `domDetector` ile host tespit edilir + butonlar bulunur.
 *  2) Her butona **capture-phase** listener bağlanır. İlk tıklama yakalanır;
 *     `preventDefault` + `stopImmediatePropagation`.
 *  3) `productExtractor` payload'u oluşturur.
 *  4) Panel mount edilir; `Devam Et` butonuna basılırsa orijinal tıklama bir
 *     bypass flag ile yeniden tetiklenir; `30 Saniye Düşün` veya `Analizi Kapat`
 *     basılırsa hiçbir şey yapılmaz.
 *
 * SPA navigasyonu: Trendyol/Hepsiburada/N11 ürün değişimini full reload
 * yapmadan `pushState` ile yapar. `urlWatcher` bunu yakalar; her yeni
 * ürün URL'sinde tekrar gözlem gönderilir (session içinde aynı URL bir
 * kez gönderilir, çoklu görüntülerde DB poison'u olmaz).
 *
 * Bilinen sınır: yeni ürünün fiyatı SPA tarafından geç yüklenebilir;
 * gözlemi 400 ms debounce'la geciktiriyoruz ki extractor yeni DOM'u görsün.
 */

import { detectHost, findBuyButtons, type Host } from "./utils/domDetector";
import { buildAnalyzeRequestAsync, extractCurrentObservation, isProductPage } from "./utils/productExtractor";
import { onUrlChange } from "./utils/urlWatcher";
import { buildSessionContext, markPurchase, trackButtonForClickSpeed } from "./utils/sessionTracker";
import { getInstallId } from "./utils/installId";
import { mountPanel, mountOnboarding } from "./panel/mount";
import {
  clearPendingPurchase,
  getPendingPurchase,
  isCheckoutSuccessPage,
  rememberPendingPurchase,
} from "./utils/purchaseTracker";

const BYPASS_ATTR = "data-kg-bypass";
const HANDLED_ATTR = "data-kg-handled";

const host: Host = detectHost(location.href);

function attachToButton(btn: HTMLElement) {
  if (btn.getAttribute(HANDLED_ATTR)) return;
  btn.setAttribute(HANDLED_ATTR, "1");

  // Capture mousedown so we can measure how fast the user clicked.
  trackButtonForClickSpeed(btn);

  btn.addEventListener(
    "click",
    (event) => {
      if (btn.getAttribute(BYPASS_ATTR) === "1") {
        // Bypass tek seferlik — kullanıcı "Devam Et" dedi, gerçek satın alma akışı çalışsın.
        btn.removeAttribute(BYPASS_ATTR);
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      // Building the request is async (we need installId + storage-backed
      // session telemetry). Do the work before mounting so the panel
      // receives a fully-shaped request from the get-go.
      (async () => {
        const [userId, session] = await Promise.all([
          getInstallId(),
          buildSessionContext(btn, location.href),
          // Small DOM-settle wait — Trendyol/Hepsiburada often re-render
          // the price area after the click. 120ms is short enough to be
          // invisible to the user but long enough for React commits to
          // flush.
          new Promise((r) => setTimeout(r, 120)),
        ]);

        // Pre-flight: fire the price observation AND wait briefly for
        // its ack BEFORE the analyze request goes out. Without this,
        // first-time visits land in the backend with an empty DB and
        // the price_agent reports "Fiyat Geçmişi Yok". The page-load
        // debounce can lose the race when the user clicks Sepete Ekle
        // within ~400ms of arriving. 1.5s is the upper bound; we
        // fire-and-forget if the network is slower than that.
        await Promise.race([
          sendObservationNow(),
          new Promise((r) => setTimeout(r, 1500)),
        ]);

        // Async build: scroll-triggers lazy review widgets and
        // background-fetches /yorumlar if PDP scraping comes back empty.
        const request = await buildAnalyzeRequestAsync(host, { userId, session });

        // Always print the outgoing payload so the user can verify what
        // we actually shipped — the most common bug reports ("price=0",
        // "no reviews", "no budget") all become trivial to diagnose when
        // this line is in the console. Tagged `[Thundrly]` so it's easy
        // to filter alongside the per-agent logs the backend emits.
        console.log("[Thundrly] AnalyzeRequest →", {
          userId: request.userId,
          platform: request.platform,
          url: request.product.url,
          title: request.product.title,
          price: request.product.price,
          originalPrice: request.product.originalPrice,
          legalLowestPrice30d: request.product.legalLowestPrice30d,
          category: request.product.category,
          rating: request.product.rating,
          reviewCount: request.product.reviewCount,
          reviewsAttached: (request.reviews ?? []).length,
          priceHistoryAttached: (request.priceHistory ?? []).length,
          session: request.session,
        });
        if (request.product.price <= 0) {
          console.warn(
            "[Thundrly] price extraction returned 0 — analyze sonucu güvenilir olmayabilir. " +
            "PDP'de değilsen panel zaten açılmamalıydı; PDP'desen platform selektörlerini güncellemek gerekebilir.",
          );
        }
        if ((request.reviews ?? []).length === 0) {
          console.warn(
            "[Thundrly] reviews boş çıktı — `/yorumlar` fetch'i de düştü demek. " +
            "Yorum ajanı 'Yorum Verisi Yok' diyecek.",
          );
        }

        mountPanel({
          request,
          onContinue: () => {
            btn.setAttribute(BYPASS_ATTR, "1");
            // The user only chose to continue. That may be "add to cart",
            // not a paid order, so keep a pending checkout and record spend
            // only after we later see an order-confirmation page.
            if (request.product.price > 0) {
              void rememberPendingPurchase({
                userId: request.userId,
                category: request.product.category,
                amount: request.product.price,
                currency: "TRY",
                productUrl: request.product.url,
                title: request.product.title,
                host,
              })
                .then((pending) => {
                  console.log("[Thundrly] pending checkout kaydedildi:", {
                    id: pending.id,
                    amount: pending.amount,
                    category: pending.category,
                  });
                })
                .catch((err) => console.warn("[Thundrly] pending checkout kaydedilemedi:", err));
            }
            setTimeout(() => btn.click(), 0);
          },
          onPause: () => {
            console.log("[Thundrly] kullanıcı 30 saniye düşünmeyi seçti.");
          },
          onClose: () => {
            console.log("[Thundrly] panel kapatıldı.");
          },
        });
      })();
    },
    { capture: true },
  );
}

function attachAll() {
  // Hard precondition: only intercept on a real PDP. Without this, the
  // homepage "Sepete Ekle" quick-buttons (Trendyol product cards) capture
  // a click whose extracted product is the page itself — i.e. price ₺0,
  // title="Online Alışveriş Sitesi … | Trendyol", no reviews, no budget.
  if (!isProductPage(host)) return;
  const buttons = findBuyButtons(host);
  buttons.forEach(attachToButton);
}

// ---------------------------------------------------------------
// First-run onboarding — runs once per install, in-panel (no new tab).
//
// Storage key `thundrly_onboarded` flips to true after the user clicks
// "Hazırım" on the final step. After that, the onboarding never shows
// again on this device.
// ---------------------------------------------------------------
const ONBOARD_KEY = "thundrly_onboarded";

async function maybeShowOnboarding() {
  // Don't show on top-of-tab demo or unknown hosts (we only want this on
  // a real shopping page where the user is about to use the product).
  if (host === "unknown") return;
  try {
    const stored = await chrome.storage.local.get(ONBOARD_KEY);
    if (stored?.[ONBOARD_KEY]) return;
    mountOnboarding({
      onFinish: () => {
        chrome.storage.local
          .set({ [ONBOARD_KEY]: true })
          .catch((e) => console.warn("[Thundrly] onboarding flag set edilemedi:", e));
        chrome.runtime
          .sendMessage({ type: "openBudgetSetup" })
          .catch((e) => console.warn("[Thundrly] budget setup sayfasi acilamadi:", e));
      },
    });
  } catch (e) {
    console.warn("[Thundrly] onboarding storage okunamadı:", e);
  }
}

// İlk pass
void maybeShowOnboarding();
attachAll();

// ---------------------------------------------------------------
// Debug helper — call `window.__THUNDRLY_DUMP()` in DevTools console
// on any Trendyol product page to print every signal we can read.
// Paste the output into a bug report; we use it to inform extractor
// tweaks when a price/review extraction goes sideways.
// ---------------------------------------------------------------
(window as unknown as Record<string, unknown>).__THUNDRLY_DUMP = () => {
  const nextDataNode = document.querySelector<HTMLScriptElement>("script#__NEXT_DATA__");
  const ldNodes = Array.from(document.querySelectorAll<HTMLScriptElement>("script[type='application/ld+json']"));
  const priceElements = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[class*='price' i], [class*='prc' i], [data-testid*='price' i], [data-test-id*='price' i], [itemprop='price']",
    ),
  )
    .slice(0, 20)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: el.className.slice(0, 80),
      text: (el.textContent || "").trim().slice(0, 60),
      content: el.getAttribute("content") || undefined,
    }));

  const dump = {
    host,
    url: location.href,
    title: document.title,
    ogTitle: document.querySelector<HTMLMetaElement>("meta[property='og:title']")?.content,
    nextDataLength: nextDataNode?.textContent?.length || 0,
    nextDataPreview: nextDataNode?.textContent?.slice(0, 800),
    jsonLdBlocks: ldNodes.map((n) => {
      try {
        return JSON.parse(n.textContent || "null");
      } catch {
        return { _error: "parse failed" };
      }
    }),
    priceElements,
  };

  console.log("[Thundrly/dump]", dump);
  return dump;
};
console.log("[Thundrly] debug helper: window.__THUNDRLY_DUMP() çıktıyı kopyala");

// SPA / lazy-render sayfalar için DOM değişikliklerini izle.
const observer = new MutationObserver(() => {
  attachAll();
  schedulePurchaseCompletionCheck();
});
observer.observe(document.body, { childList: true, subtree: true });

// ---------------------------------------------------------------
// Crowdsource fiyat gözlemleri.
//
// Aynı URL için session içinde tek bir gözlem gönder; yeni ürüne
// gidildiğinde (SPA navigation) tekrar gönder.
// ---------------------------------------------------------------

const observedUrlsThisSession = new Set<string>();
const OBSERVATION_DEBOUNCE_MS = 400;
let observationTimer: number | null = null;

function sendObservationIfNew() {
  const url = location.href;
  if (observedUrlsThisSession.has(url)) return;

  const payload = extractCurrentObservation(host);
  if (!payload) return; // page didn't expose a price yet

  observedUrlsThisSession.add(url);
  chrome.runtime
    .sendMessage({ type: "priceObservation", payload })
    .catch((e) => console.warn("[Thundrly] price observation gönderilemedi:", e));
}

/**
 * Synchronous-style observation send for the pre-flight path before
 * analyze fires. Returns a promise that resolves once the backend has
 * stored the observation (or immediately, if there's nothing to send).
 *
 * Unlike `sendObservationIfNew`, this awaits the round-trip — the
 * caller is expected to race it against a short timeout so a slow
 * network doesn't add unbounded latency to the panel.
 */
async function sendObservationNow(): Promise<void> {
  const url = location.href;
  const payload = extractCurrentObservation(host);
  if (!payload) return;

  // Mark sent even before the await so the page-load debounce doesn't
  // duplicate. Worst case the network call fails and we retry on the
  // next SPA-nav; never worse than today's behavior.
  observedUrlsThisSession.add(url);
  try {
    await chrome.runtime.sendMessage({ type: "priceObservation", payload });
  } catch (e) {
    console.warn("[Thundrly] pre-flight observation gönderilemedi:", e);
  }
}

function scheduleObservation() {
  if (observationTimer !== null) window.clearTimeout(observationTimer);
  observationTimer = window.setTimeout(() => {
    observationTimer = null;
    sendObservationIfNew();
  }, OBSERVATION_DEBOUNCE_MS);
}

// İlk açılışta hemen dene (SPA-değil sayfalar için tipik akış).
sendObservationIfNew();

// SPA navigasyonlarında: yeni ürün URL'si için yeniden gönder.
onUrlChange((to, from) => {
  console.log(`[Thundrly] SPA navigation: ${from} → ${to}`);
  scheduleObservation();
  schedulePurchaseCompletionCheck(800);
});

// Debug: konsola bir kez sinyal yaz.
console.log(
  `[Thundrly] content script aktif — host: ${host}. ` +
  "Sorun bildirimi için DevTools console'da çalıştır: " +
  "window.__THUNDRLY_DEBUG = true; ardından Sepete Ekle'ye bas.",
);

// ---------------------------------------------------------------
// Purchase completion tracking.
//
// Merchant/payment-provider APIs are not available to a browser extension.
// The browser-side signal we can observe is: user continued from our panel,
// then later landed on a supported shop's order-success page. Only then do
// we send /api/purchases and bump purchasesToday.
// ---------------------------------------------------------------

let completionTimer: number | null = null;
let completionInFlight = false;

function schedulePurchaseCompletionCheck(delayMs = 500) {
  if (completionTimer !== null) window.clearTimeout(completionTimer);
  completionTimer = window.setTimeout(() => {
    completionTimer = null;
    void maybeRecordCompletedPurchase();
  }, delayMs);
}

async function maybeRecordCompletedPurchase(): Promise<void> {
  if (completionInFlight) return;

  const pending = await getPendingPurchase();
  if (!pending) return;
  if (pending.host !== host) return;

  const text = document.body?.innerText || "";
  if (!isCheckoutSuccessPage(host, location.href, text)) return;

  completionInFlight = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "purchase",
      payload: {
        userId: pending.userId,
        category: pending.category,
        amount: pending.amount,
        currency: pending.currency,
      },
    }) as { ok?: boolean; error?: string };

    if (!response?.ok) {
      console.warn("[Thundrly] tamamlanan satin alma kaydedilemedi:", response?.error || response);
      return;
    }

    await markPurchase();
    await clearPendingPurchase(pending.id);
    console.log("[Thundrly] odeme tamamlandi, satin alma kaydedildi:", {
      amount: pending.amount,
      category: pending.category,
      orderPage: location.href,
    });
  } catch (e) {
    console.warn("[Thundrly] tamamlanan satin alma kaydedilemedi:", e);
  } finally {
    completionInFlight = false;
  }
}

schedulePurchaseCompletionCheck(800);
