/**
 * Background service worker (MV3).
 *
 * Mesaj ve port türleri:
 *
 *  - `analyze` mesajı         → POST /api/analyze-purchase (tek seferlik)
 *  - `priceObservation` mesajı → POST /api/price-observation (fire-and-forget)
 *  - `analyze-stream` portu   → POST /api/analyze-purchase/stream, NDJSON
 *                               satırlarını portla content-script'e iletir.
 *
 * Backend yoksa: tek seferlik akış `{ ok: false }` döner, istemci fallback
 * fixture'a düşer. Stream yolu da hata olayını portla iletir; panel,
 * non-stream endpoint'e düşer.
 */

import type { AnalyzeRequest, AnalyzeResponse, Review } from "@shared/types";
import type { Host } from "@/utils/domDetector";
import { ANALYZE_STREAM_URL, ANALYZE_URL, OBSERVATION_URL, PURCHASE_URL } from "@/config";

// ----------------------------------------------------------------
// Sender allow-list — defense-in-depth on the message-passing layer.
//
// Chrome already restricts our content-scripts to the manifest's
// host-permission list, and we don't expose `externally_connectable`,
// so in theory only our own content-scripts/popup can reach this
// listener. We still validate `sender.id` and `sender.url` so that any
// future manifest change doesn't silently open us up to a hostile page
// sending messages with a forged AnalyzeRequest.
// ----------------------------------------------------------------

const ALLOWED_HOST_SUFFIXES = [
  "trendyol.com", "hepsiburada.com", "n11.com", "amazon.com.tr",
  "ciceksepeti.com", "mediamarkt.com.tr", "teknosa.com",
  "vatanbilgisayar.com", "boyner.com.tr", "lcwaikiki.com",
  "defacto.com.tr", "modanisa.com", "a101.com.tr", "migros.com.tr",
  "carrefoursa.com", "beymen.com", "pazarama.com", "pttavm.com",
  "tchibo.com.tr", "decathlon.com.tr", "ikea.com.tr",
];

function isAllowedSender(sender: chrome.runtime.MessageSender | undefined): boolean {
  if (!sender) return false;
  // Sender ID check: rejects messages from any other extension that
  // somehow got past externally_connectable (we don't set it, so this
  // should always pass for our own code).
  if (sender.id !== chrome.runtime.id) return false;
  const url = sender.url || sender.tab?.url || "";
  if (!url) return false;
  // Popup / options page — chrome-extension:// own origin.
  if (url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return true;
  // Content-script origin — must be one of our allow-listed hosts OR
  // the demo-product.html web-accessible page (any origin, but only
  // when the path matches).
  try {
    const u = new URL(url);
    if (u.protocol === "chrome-extension:") return true; // handled above; fallback
    if (u.pathname.endsWith("/demo-product.html") || u.pathname.endsWith("/public/demo-product.html")) {
      return true;
    }
    const host = u.hostname;
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

type AnalyzeMessage = { type: "analyze"; payload: AnalyzeRequest; forceRefresh?: boolean };
type ObservationMessage = {
  type: "priceObservation";
  payload: { url: string; price: number; currency: "TRY"; title?: string };
};
type PurchaseMessage = {
  type: "purchase";
  payload: { userId: string; category: string; amount: number; currency: "TRY" };
};
type FetchReviewsMessage = {
  type: "fetchReviews";
  payload: { url: string; host: Host };
};
type IncomingMessage = AnalyzeMessage | ObservationMessage | PurchaseMessage | FetchReviewsMessage;

chrome.runtime.onMessage.addListener((msg: IncomingMessage, sender, sendResponse) => {
  if (!isAllowedSender(sender)) {
    console.warn("[Thundrly] reddedildi: bilinmeyen gönderici", sender?.url);
    sendResponse({ ok: false, error: "unauthorized sender" });
    return false;
  }

  if (msg?.type === "analyze") {
    (async () => {
      try {
        const url = msg.forceRefresh ? `${ANALYZE_URL}?force_refresh=true` : ANALYZE_URL;
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(msg.payload),
        });
        if (!r.ok) {
          // Pull the server's error body so the panel can show *what*
          // was wrong (Pydantic field errors, etc.) instead of just a
          // bare HTTP status. Kept under 800 chars so a giant
          // stacktrace can't blow the message-passing channel.
          let detail = `HTTP ${r.status}`;
          try {
            const body = await r.text();
            if (body) detail = `HTTP ${r.status} — ${body.slice(0, 800)}`;
          } catch {
            /* response body unreadable, keep bare status */
          }
          console.warn("[Thundrly/bg] analyze failed:", detail);
          sendResponse({ ok: false, error: detail });
          return;
        }
        const data = (await r.json()) as AnalyzeResponse;
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "priceObservation") {
    (async () => {
      try {
        const r = await fetch(OBSERVATION_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(msg.payload),
        });
        if (!r.ok) {
          sendResponse({ ok: false, error: `HTTP ${r.status}` });
          return;
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "purchase") {
    (async () => {
      try {
        const r = await fetch(PURCHASE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(msg.payload),
        });
        if (!r.ok) {
          sendResponse({ ok: false, error: `HTTP ${r.status}` });
          return;
        }
        sendResponse({ ok: true, data: await r.json() });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "fetchReviews") {
    (async () => {
      try {
        const reviews = await fetchAndParseReviews(msg.payload.url, msg.payload.host);
        sendResponse({ ok: true, reviews });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  return false;
});

// ----------------------------------------------------------------
// Review subpage fetch + parse.
//
// Trendyol and Hepsiburada lazy-load reviews on the PDP — by the time
// the user clicks "Sepete Ekle" we usually have zero reviews to send
// to the agent. This fetches the /yorumlar (Trendyol) or /yorumlari
// (Hepsiburada) subpage in the background, runs a lightweight regex
// parse on the returned HTML, and ships up to 25 reviews back to the
// content script.
//
// We parse with regex (not DOMParser) for two reasons:
//   - DOMParser in a service worker doesn't execute embedded scripts,
//     and the modern Trendyol HTML hydrates reviews via __NEXT_DATA__
//     JSON anyway — regex on that JSON is faster + more reliable than
//     scraping the static skeleton.
//   - The HTML payload can be 200+ KB; regex avoids building a full DOM.
// ----------------------------------------------------------------

const REVIEW_PAGE_CAP = 100;       // hard cap on reviews per product
const REVIEW_PAGE_LIMIT = 5;       // hard cap on pagination depth
const REVIEW_FETCH_TIMEOUT_MS = 10_000; // per-page fetch timeout (was 3s implicit)

async function fetchWithRetry(url: string, attempts = 2): Promise<Response | null> {
  // One retry on transient failures (timeout, network error, 5xx).
  // Skips retry on 4xx — those are deterministic.
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REVIEW_FETCH_TIMEOUT_MS);
      const r = await fetch(url, {
        headers: {
          // Look like a real browser navigation so the server returns
          // the populated HTML rather than a minimal SPA skeleton.
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (r.ok) return r;
      // 4xx → deterministic, don't retry. 5xx → fall through to retry.
      if (r.status >= 400 && r.status < 500) return null;
    } catch (err) {
      if (attempt === attempts) {
        console.warn(`[Thundrly] review fetch failed after ${attempts} attempts:`, err);
        return null;
      }
      // Short backoff before the second attempt.
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  return null;
}

async function fetchAndParseReviews(url: string, host: Host): Promise<Review[]> {
  // Trendyol + Hepsiburada paginate their review subpages; walk them up
  // to REVIEW_PAGE_LIMIT or REVIEW_PAGE_CAP, whichever comes first.
  // Stop early on an empty page (end of stream) so we don't burn time
  // on dead requests.
  if (host !== "trendyol" && host !== "hepsiburada") {
    console.log(`[Thundrly/bg] /yorumlar fetch: unsupported host ${host}`);
    return [];
  }

  console.log(`[Thundrly/bg] /yorumlar fetch start: host=${host} url=${url}`);
  const all: Review[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= REVIEW_PAGE_LIMIT; page++) {
    const pageUrl = appendReviewPageParam(url, host, page);
    const pageStart = Date.now();
    const r = await fetchWithRetry(pageUrl);
    if (!r) {
      console.warn(`[Thundrly/bg] page ${page}: fetch failed after retries`);
      break;
    }
    const html = await r.text();
    console.log(
      `[Thundrly/bg] page ${page}: HTTP ${r.status}, ${html.length} bytes, ${Date.now() - pageStart}ms`,
    );
    const batch = host === "trendyol" ? parseTrendyolReviews(html) : parseHepsiburadaReviews(html);
    console.log(`[Thundrly/bg] page ${page}: parser yielded ${batch.length} reviews`);
    if (batch.length === 0) break;
    let added = 0;
    for (const rv of batch) {
      const key = `${rv.author || ""}|${rv.text}|${rv.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(rv);
      added++;
      if (all.length >= REVIEW_PAGE_CAP) break;
    }
    if (all.length >= REVIEW_PAGE_CAP || added === 0) break;
  }
  console.log(`[Thundrly/bg] /yorumlar fetch done: ${all.length} unique reviews`);
  return all;
}

function appendReviewPageParam(url: string, host: Host, page: number): string {
  if (page <= 1) return url; // first page is the canonical URL
  try {
    const u = new URL(url);
    const param = host === "trendyol" ? "page" : "sayfa";
    u.searchParams.set(param, String(page));
    return u.toString();
  } catch {
    return url;
  }
}

function parseTrendyolReviews(html: string): Review[] {
  const out: Review[] = [];

  // Trendyol embeds reviews in __NEXT_DATA__ as JSON. Try that first
  // since it's structured + reliable.
  const next = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next?.[1]) {
    try {
      const data = JSON.parse(next[1]);
      const found: Review[] = [];
      collectTrendyolReviewsFromTree(data, found);
      if (found.length > 0) return found.slice(0, REVIEW_PAGE_CAP);
    } catch {
      /* fall through to regex */
    }
  }

  // Fallback: regex-grep visible review cards from static HTML.
  const cardRe = /<div[^>]*class="[^"]*comment-text-w[^"]*"[^>]*>[\s\S]*?<\/div>/g;
  const textRe = /<p[^>]*class="[^"]*comment-text[^"]*"[^>]*>([\s\S]*?)<\/p>/;
  const rateRe = /data-rate="(\d(?:\.\d)?)"/;
  const dateRe = /<div[^>]*class="[^"]*comment-date[^"]*"[^>]*>([\s\S]*?)<\/div>/;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const card = m[0];
    const text = stripTags(card.match(textRe)?.[1] || "").trim();
    if (!text) continue;
    const rating = parseFloat(card.match(rateRe)?.[1] || "0");
    const date = stripTags(card.match(dateRe)?.[1] || "").trim();
    out.push({ rating: Number.isFinite(rating) ? rating : 5, text, date });
    if (out.length >= REVIEW_PAGE_CAP) break;
  }
  return out;
}

function collectTrendyolReviewsFromTree(node: unknown, out: Review[], depth = 0): void {
  if (depth > 14 || out.length >= REVIEW_PAGE_CAP) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTrendyolReviewsFromTree(item, out, depth + 1);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  // Trendyol's review payload has drifted across A/B variants. Accept any
  // object that carries both:
  //   - a textual review body in one of {comment, commentText, comment_text,
  //     text, reviewText, content, message, review}
  //   - a numeric rating in one of {rate, rating, ratingValue, star, stars,
  //     starCount, point, productRating}
  // The defensive list is the cheapest way to survive their next rename.
  const textCandidate =
    _firstString(obj, [
      "comment",
      "commentText",
      "comment_text",
      "text",
      "reviewText",
      "content",
      "message",
      "review",
    ]);
  const ratingCandidate = _firstNumber(obj, [
    "rate",
    "rating",
    "ratingValue",
    "star",
    "stars",
    "starCount",
    "point",
    "productRating",
  ]);
  if (textCandidate && ratingCandidate !== undefined) {
    const text = textCandidate.trim();
    if (text) {
      const rating = Math.max(0, Math.min(5, ratingCandidate));
      const date = String(
        obj.lastModifiedDate ?? obj.commentDateISOtype ?? obj.createdAt ?? obj.date ?? "",
      ).slice(0, 10);
      const author =
        _firstString(obj, [
          "userFullName",
          "commentOwnerName",
          "userName",
          "fullName",
          "customerName",
        ]) || undefined;
      const verifiedPurchase =
        Boolean(obj.commentOwnerSeller) ||
        Boolean(obj.isVerifiedPurchase) ||
        Boolean(obj.verifiedPurchase) ||
        Boolean(obj.purchased) ||
        undefined;
      const helpfulCount =
        _firstNumber(obj, ["likeCount", "helpfulCount", "usefulCount"]) ?? undefined;
      out.push({ rating, text, date, author, verifiedPurchase, helpfulCount: helpfulCount ?? undefined });
    }
  }
  for (const v of Object.values(obj)) collectTrendyolReviewsFromTree(v, out, depth + 1);
}

function _firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function _firstNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function parseHepsiburadaReviews(html: string): Review[] {
  const out: Review[] = [];
  // Hepsiburada's review payload also lives in a JSON blob (often
  // serialized into a `window.__INITIAL_STATE__ = {...};` script tag).
  const initial = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (initial?.[1]) {
    try {
      const data = JSON.parse(initial[1]);
      const found: Review[] = [];
      collectHepsiburadaReviewsFromTree(data, found);
      if (found.length > 0) return found.slice(0, REVIEW_PAGE_CAP);
    } catch {
      /* fall through */
    }
  }

  // Fallback: scrape static review cards if present.
  const cardRe = /<div[^>]*data-test-id="review-item"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g;
  const textRe = /<span[^>]*data-test-id="review-text"[^>]*>([\s\S]*?)<\/span>/;
  const rateRe = /<span[^>]*data-test-id="review-rating"[^>]*aria-label="([0-9.]+)/;
  const dateRe = /<span[^>]*data-test-id="review-date"[^>]*>([\s\S]*?)<\/span>/;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const card = m[0];
    const text = stripTags(card.match(textRe)?.[1] || "").trim();
    if (!text) continue;
    const rating = parseFloat(card.match(rateRe)?.[1] || "5");
    const date = stripTags(card.match(dateRe)?.[1] || "").trim();
    out.push({ rating: Number.isFinite(rating) ? rating : 5, text, date });
    if (out.length >= REVIEW_PAGE_CAP) break;
  }
  return out;
}

function collectHepsiburadaReviewsFromTree(node: unknown, out: Review[], depth = 0): void {
  if (depth > 12 || out.length >= REVIEW_PAGE_CAP) return;
  if (Array.isArray(node)) {
    for (const item of node) collectHepsiburadaReviewsFromTree(item, out, depth + 1);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  // Hepsiburada review objects look like { review, ratingPoint/star, createdAt }
  if (
    typeof obj.review === "string" &&
    (typeof obj.ratingPoint === "number" || typeof obj.star === "number")
  ) {
    const text = String(obj.review).trim();
    if (text) {
      const rating = Math.max(0, Math.min(5, Number(obj.ratingPoint ?? obj.star)));
      const date = String(obj.createdAt ?? obj.reviewDate ?? "").slice(0, 10);
      const author =
        (typeof obj.customerName === "string" && obj.customerName) ||
        (typeof obj.userName === "string" && obj.userName) ||
        undefined;
      const verifiedPurchase =
        Boolean(obj.isVerifiedPurchase) ||
        Boolean(obj.verifiedPurchase) ||
        Boolean(obj.purchased) ||
        undefined;
      const helpfulCount =
        typeof obj.helpfulCount === "number"
          ? Math.max(0, Math.floor(obj.helpfulCount))
          : typeof obj.likeCount === "number"
            ? Math.max(0, Math.floor(obj.likeCount))
            : undefined;
      out.push({ rating, text, date, author, verifiedPurchase, helpfulCount });
    }
  }
  for (const v of Object.values(obj)) collectHepsiburadaReviewsFromTree(v, out, depth + 1);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

// ----------------------------------------------------------------
// Streaming port: client connects, posts {type:"start", payload}, then
// receives a sequence of {type:"event", event} messages, finally {type:"end"}.
// On error, {type:"error", error} is sent and the port is closed.
// ----------------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "analyze-stream") return;
  if (!isAllowedSender(port.sender)) {
    console.warn("[Thundrly] stream-port reddedildi: bilinmeyen gönderici", port.sender?.url);
    try { port.disconnect(); } catch { /* already closed */ }
    return;
  }

  port.onMessage.addListener(async (msg: { type: "start"; payload: AnalyzeRequest; forceRefresh?: boolean } | unknown) => {
    if (!isStartMessage(msg)) return;

    try {
      const url = msg.forceRefresh ? `${ANALYZE_STREAM_URL}?force_refresh=true` : ANALYZE_STREAM_URL;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(msg.payload),
      });
      if (!resp.ok || !resp.body) {
        port.postMessage({ type: "error", error: `HTTP ${resp.status}` });
        try { port.disconnect(); } catch {}
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Split on newlines; keep the trailing partial line in the buffer.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            port.postMessage({ type: "event", event });
          } catch {
            // Skip malformed NDJSON line — usually a partial during transport.
          }
        }
      }

      // Flush any final buffered line.
      const tail = buffer.trim();
      if (tail) {
        try {
          port.postMessage({ type: "event", event: JSON.parse(tail) });
        } catch {
          /* swallow */
        }
      }

      port.postMessage({ type: "end" });
      try { port.disconnect(); } catch {}
    } catch (e) {
      port.postMessage({ type: "error", error: e instanceof Error ? e.message : String(e) });
      try { port.disconnect(); } catch {}
    }
  });
});

function isStartMessage(msg: unknown): msg is { type: "start"; payload: AnalyzeRequest; forceRefresh?: boolean } {
  return !!msg && typeof msg === "object" && (msg as { type?: unknown }).type === "start";
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Thundrly] eklenti yüklendi.", details.reason);
  // First-install onboarding now runs **inside the page panel** the first
  // time the user lands on a supported e-commerce site (see contentScript
  // `maybeShowOnboarding`). We don't open a new tab anymore — opening a
  // welcome tab from the service worker was disorienting and forced the
  // user out of their browsing flow.
});
