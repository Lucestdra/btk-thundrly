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

/**
 * Error thrown when the backend rejects or fails an analyze request.
 * The panel catches this and renders the actual server message instead
 * of silently substituting a demo fixture (which historically masked
 * every real bug — see Mayıs 2026 422 incident).
 */
export class AnalyzeBackendError extends Error {
  constructor(public readonly detail: string, public readonly httpStatus?: number) {
    super(`[Thundrly] backend ${httpStatus ?? "??"}: ${detail}`);
  }
}

// ----------------------- one-shot fetch (legacy) -----------------------

interface MessageOk { ok: true; data: AnalyzeResponse }
interface MessageErr { ok: false; error: string }
type Message = MessageOk | MessageErr;

export async function analyzePurchase(
  req: AnalyzeRequest,
  options: { forceRefresh?: boolean } = {},
): Promise<AnalyzeResponse> {
  const resp = await chrome.runtime.sendMessage<
    { type: "analyze"; payload: AnalyzeRequest; forceRefresh?: boolean },
    Message
  >({
    type: "analyze",
    payload: req,
    forceRefresh: options.forceRefresh,
  });
  if (resp && resp.ok) {
    logAnalyzeResponse(resp.data, "fetch");
    return resp.data;
  }
  // Hard fail. The previous behavior — silently substituting the demo
  // red-hoodie fixture — masked every real backend bug (CORS, schema
  // drift, 422, GEMINI_API_KEY missing) by rendering plausible-looking
  // fake numbers. The panel now surfaces the actual server error so the
  // user knows the verdict isn't real.
  const detail = (resp && !resp.ok ? resp.error : null) || "yanıt yok";
  console.error("[Thundrly] analyzePurchase FAILED:", detail, resp);
  throw new AnalyzeBackendError(detail);
}

/**
 * Pretty-print the agent verdicts that came back so it's obvious at a
 * glance whether each agent actually ran (and whether Gemini was on the
 * path for the two LLM-backed agents). The five lines collapse to a
 * single console.table call so they line up.
 */
function logAnalyzeResponse(r: AnalyzeResponse, via: "fetch" | "stream"): void {
  try {
    const rows: Record<string, { score: number; label: string }> = {
      review:   { score: r.agents.reviewAgent.score,   label: r.agents.reviewAgent.label },
      price:    { score: r.agents.priceAgent.score,    label: r.agents.priceAgent.label },
      budget:   { score: r.agents.budgetAgent.score,   label: r.agents.budgetAgent.label },
      impulse:  { score: r.agents.impulseAgent.score,  label: r.agents.impulseAgent.label },
      decision: { score: r.agents.decisionAgent.score, label: r.agents.decisionAgent.label },
    };
    console.log(`[Thundrly] AnalyzeResponse ← (${via}) decision=${r.decision} risk=${r.riskScore}/100`);
    console.table(rows);
  } catch {
    /* console.table can throw in odd Chrome states — never block the panel */
  }
}

export { logAnalyzeResponse };

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
  options: { forceRefresh?: boolean } = {},
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
        if (msg.event.event === "node_finished") {
          console.log(
            `[Thundrly] node_finished node=${msg.event.node} ` +
            `score=${msg.event.result.score} label=${msg.event.result.label}`,
          );
        }
        if (msg.event.event === "verdict") {
          final = msg.event.response;
          logAnalyzeResponse(final, "stream");
        } else if (msg.event.event === "error") {
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

    port.postMessage({ type: "start", payload: req, forceRefresh: options.forceRefresh });
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
  options: { forceRefresh?: boolean } = {},
): Promise<{ response: AnalyzeResponse; streamed: boolean }> {
  try {
    const response = await analyzePurchaseStream(req, onEvent, options);
    return { response, streamed: true };
  } catch (e) {
    console.warn("[Thundrly] streaming başarısız, tek seferlik fetch'e dönülüyor:", e);
    const response = await analyzePurchase(req, options);
    return { response, streamed: false };
  }
}
