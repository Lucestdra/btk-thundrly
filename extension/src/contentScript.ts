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
import { buildAnalyzeRequest, extractCurrentObservation } from "./utils/productExtractor";
import { onUrlChange } from "./utils/urlWatcher";
import { buildSessionContext, markPurchase, trackButtonForClickSpeed } from "./utils/sessionTracker";
import { getInstallId } from "./utils/installId";
import { mountPanel } from "./panel/mount";

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
        // The user committed to a purchase — bump today's count.
        void markPurchase();
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
        ]);
        const request = buildAnalyzeRequest(host, { userId, session });

        mountPanel({
          request,
          onContinue: () => {
            btn.setAttribute(BYPASS_ATTR, "1");
            setTimeout(() => btn.click(), 0);
          },
          onPause: () => {
            console.log("[Tartı] kullanıcı 30 saniye düşünmeyi seçti.");
          },
          onClose: () => {
            console.log("[Tartı] panel kapatıldı.");
          },
        });
      })();
    },
    { capture: true },
  );
}

function attachAll() {
  const buttons = findBuyButtons(host);
  buttons.forEach(attachToButton);
}

// İlk pass
attachAll();

// SPA / lazy-render sayfalar için DOM değişikliklerini izle.
const observer = new MutationObserver(() => {
  attachAll();
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
    .catch((e) => console.warn("[Tartı] price observation gönderilemedi:", e));
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
  console.log(`[Tartı] SPA navigation: ${from} → ${to}`);
  scheduleObservation();
});

// Debug: konsola bir kez sinyal yaz.
console.log(`[Tartı] content script aktif — host: ${host}`);
