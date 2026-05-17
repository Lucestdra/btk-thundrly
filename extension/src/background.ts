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

type AnalyzeMessage = { type: "analyze"; payload: AnalyzeRequest };
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

chrome.runtime.onMessage.addListener((msg: IncomingMessage, _sender, sendResponse) => {
  if (msg?.type === "analyze") {
    (async () => {
      try {
        const r = await fetch(ANALYZE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(msg.payload),
        });
        if (!r.ok) {
          sendResponse({ ok: false, error: `HTTP ${r.status}` });
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

async function fetchAndParseReviews(url: string, host: Host): Promise<Review[]> {
  const r = await fetch(url, {
    headers: {
      // Look like a real browser navigation so the server returns the
      // populated HTML rather than a minimal SPA skeleton.
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
      "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) return [];
  const html = await r.text();

  if (host === "trendyol") return parseTrendyolReviews(html);
  if (host === "hepsiburada") return parseHepsiburadaReviews(html);
  return [];
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
      if (found.length > 0) return found.slice(0, 25);
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
    if (out.length >= 25) break;
  }
  return out;
}

function collectTrendyolReviewsFromTree(node: unknown, out: Review[], depth = 0): void {
  if (depth > 12 || out.length >= 25) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTrendyolReviewsFromTree(item, out, depth + 1);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  // Trendyol's review objects look like { comment, rate, lastModifiedDate, ...}
  if (typeof obj.comment === "string" && typeof obj.rate === "number") {
    const text = String(obj.comment).trim();
    if (text) {
      const rating = Math.max(0, Math.min(5, Number(obj.rate)));
      const date = String(obj.lastModifiedDate ?? obj.commentDateISOtype ?? "").slice(0, 10);
      out.push({ rating, text, date });
    }
  }
  for (const v of Object.values(obj)) collectTrendyolReviewsFromTree(v, out, depth + 1);
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
      if (found.length > 0) return found.slice(0, 25);
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
    if (out.length >= 25) break;
  }
  return out;
}

function collectHepsiburadaReviewsFromTree(node: unknown, out: Review[], depth = 0): void {
  if (depth > 12 || out.length >= 25) return;
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
      out.push({ rating, text, date });
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

  port.onMessage.addListener(async (msg: { type: "start"; payload: AnalyzeRequest } | unknown) => {
    if (!isStartMessage(msg)) return;

    try {
      const resp = await fetch(ANALYZE_STREAM_URL, {
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

function isStartMessage(msg: unknown): msg is { type: "start"; payload: AnalyzeRequest } {
  return !!msg && typeof msg === "object" && (msg as { type?: unknown }).type === "start";
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Thundrly] eklenti yüklendi.");
});
