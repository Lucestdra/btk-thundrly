/**
 * Streaming client for the backend's NDJSON analyze endpoint.
 *
 * Unlike the extension (which has to hop through a service worker for
 * CORS reasons), the landing page can `fetch` the backend directly. The
 * backend's CORS middleware allows `http://localhost:3000` and
 * `http://127.0.0.1:3000` so both addresses work.
 *
 * If the backend is unreachable (developer not running uvicorn, build-time
 * preview, etc.) callers should catch and fall back to a synthetic
 * animation — the landing page must always look demo-able.
 */

import type {
  AgentResult,
  AnalyzeRequest,
  AnalyzeResponse,
} from "@shared/types";

export type StreamEvent =
  | {
      event: "node_finished";
      node: "review" | "price" | "budget" | "impulse" | "decision";
      result: AgentResult;
    }
  | { event: "verdict"; response: AnalyzeResponse }
  | { event: "error"; message: string };

const DEFAULT_API_BASE = "http://localhost:8000";

function apiBase(): string {
  // `NEXT_PUBLIC_*` env vars are inlined at build time so they work in the
  // browser. Falls back to localhost for the standard dev setup.
  const fromEnv = process.env.NEXT_PUBLIC_THUNDRLY_API_BASE;
  return (fromEnv && fromEnv.trim()) || DEFAULT_API_BASE;
}

export async function streamAnalyze(
  request: AnalyzeRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<AnalyzeResponse> {
  const resp = await fetch(`${apiBase()}/api/analyze-purchase/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  if (!resp.body) throw new Error("Stream yanıtı boş geldi.");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AnalyzeResponse | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(trimmed) as StreamEvent;
      } catch {
        continue;
      }
      onEvent(event);
      if (event.event === "verdict") final = event.response;
      else if (event.event === "error") throw new Error(event.message);
    }
  }

  // Flush a final partial line if the stream ended without a trailing newline.
  const tail = buffer.trim();
  if (tail) {
    try {
      const event = JSON.parse(tail) as StreamEvent;
      onEvent(event);
      if (event.event === "verdict") final = event.response;
    } catch {
      // swallow — partial line at end of stream
    }
  }

  if (!final) throw new Error("Akış verdict olmadan tamamlandı.");
  return final;
}
