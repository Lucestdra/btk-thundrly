/**
 * Backend istemcisi.
 *
 * Üç yol:
 *  1) `analyzePurchase(req)`        → background message-based fetch, tek seferlik
 *                                     yanıt. Hata olursa fallback fixture.
 *  2) `analyzePurchaseStream(req,
 *      onEvent)`                    → background port üzerinden NDJSON akışı.
 *                                     onEvent her ajan tamamlanmasında çağrılır,
 *                                     Promise final verdict ile resolve olur.
 *  3) `analyzePurchaseWithProgress` → 2'yi dener, başarısız olursa 1'e düşer.
 *                                     Panel için varsayılan giriş noktası.
 *
 * Bu strateji ekstansiyonu **backend olmadan da çalışır** kılar (fallback)
 * ve **streaming yoksa da çalışır** kılar (graceful degradation).
 */

import type {
  AgentResult,
  AnalyzeRequest,
  AnalyzeResponse,
} from "@shared/types";
import { redHoodieResponse } from "@shared/demo/demoPayloads";

// ----------------------- one-shot fetch (legacy) -----------------------

interface MessageOk { ok: true; data: AnalyzeResponse }
interface MessageErr { ok: false; error: string }
type Message = MessageOk | MessageErr;

export async function analyzePurchase(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  try {
    const resp = await chrome.runtime.sendMessage<{ type: "analyze"; payload: AnalyzeRequest }, Message>({
      type: "analyze",
      payload: req,
    });
    if (resp && resp.ok) {
      return resp.data;
    }
    console.warn("[Thundrly] backend yanıtı yok, fallback fixture kullanılıyor:", resp);
    return redHoodieResponse;
  } catch (e) {
    console.warn("[Thundrly] backend istisnası, fallback fixture:", e);
    return redHoodieResponse;
  }
}

// ----------------------- streaming ------------------------

/** NDJSON event from the streaming endpoint. */
export type StreamEvent =
  | { event: "node_finished"; node: "review" | "price" | "budget" | "impulse" | "decision"; result: AgentResult }
  | { event: "verdict"; response: AnalyzeResponse }
  | { event: "error"; message: string };

/**
 * Streams analysis. Resolves with the final verdict when the backend emits
 * the `verdict` event. Rejects on stream error or if no verdict arrives.
 * `onEvent` is fired for every parsed NDJSON event (including verdict).
 */
export function analyzePurchaseStream(
  req: AnalyzeRequest,
  onEvent: (event: StreamEvent) => void,
): Promise<AnalyzeResponse> {
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: "analyze-stream" });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    let final: AnalyzeResponse | null = null;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      try { port.disconnect(); } catch { /* port may already be closed */ }
    };

    port.onMessage.addListener((msg: { type: string; event?: StreamEvent; error?: string }) => {
      if (msg.type === "event" && msg.event) {
        onEvent(msg.event);
        if (msg.event.event === "verdict") final = msg.event.response;
        else if (msg.event.event === "error") {
          settle(() => reject(new Error(msg.event!.event === "error" ? msg.event!.message : "stream error")));
        }
      } else if (msg.type === "end") {
        if (final) settle(() => resolve(final!));
        else settle(() => reject(new Error("Akış bitti ama verdict gelmedi.")));
      } else if (msg.type === "error") {
        settle(() => reject(new Error(msg.error || "stream error")));
      }
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        if (final) settle(() => resolve(final!));
        else settle(() => reject(new Error("Port koptu, verdict alınamadı.")));
      }
    });

    port.postMessage({ type: "start", payload: req });
  });
}

/**
 * Streaming first, message-based one-shot as fallback. If the stream
 * endpoint is missing (older backend) or fails before producing a verdict,
 * we silently retry the legacy path. `onEvent` only fires while streaming;
 * fallback path completes without per-node events.
 */
export async function analyzePurchaseWithProgress(
  req: AnalyzeRequest,
  onEvent: (event: StreamEvent) => void,
): Promise<{ response: AnalyzeResponse; streamed: boolean }> {
  try {
    const response = await analyzePurchaseStream(req, onEvent);
    return { response, streamed: true };
  } catch (e) {
    console.warn("[Thundrly] streaming başarısız, tek seferlik fetch'e dönülüyor:", e);
    const response = await analyzePurchase(req);
    return { response, streamed: false };
  }
}
