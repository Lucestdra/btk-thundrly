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

import type { AnalyzeRequest, AnalyzeResponse } from "@shared/types/analysis";

const ANALYZE_URL = "http://127.0.0.1:8000/api/analyze-purchase";
const ANALYZE_STREAM_URL = "http://127.0.0.1:8000/api/analyze-purchase/stream";
const OBSERVATION_URL = "http://127.0.0.1:8000/api/price-observation";

type AnalyzeMessage = { type: "analyze"; payload: AnalyzeRequest };
type ObservationMessage = {
  type: "priceObservation";
  payload: { url: string; price: number; currency: "TRY"; title?: string };
};
type IncomingMessage = AnalyzeMessage | ObservationMessage;

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

  return false;
});

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
  console.log("[Tartı] eklenti yüklendi.");
});
