/**
 * `streamAnalyze` is the NDJSON consumer for the landing's live demo.
 * It has three failure modes that aren't visible from a happy-path
 * integration test:
 *
 *   1. Chunk boundaries can split a JSON line in half — the buffer logic
 *      must carry the partial line across `reader.read()` calls.
 *   2. The final verdict line may arrive without a trailing `\n` — the
 *      tail-flush path must catch it.
 *   3. A malformed line in the middle of the stream must NOT poison the
 *      rest; we skip it and keep reading.
 *
 * These tests pin all three plus the obvious happy / error / HTTP-fail
 * paths. Pure Node — no jsdom, no fetch polyfill (Node 18+ ships both
 * `fetch` and `ReadableStream` globally).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { streamAnalyze, type StreamEvent } from "@/lib/streamAnalyze";
import type { AnalyzeRequest } from "@shared/types";

// ---------- Helpers ----------

function emptyRequest(): AnalyzeRequest {
  // The mock fetch ignores the body, so a skeletal request is fine.
  return {
    userId: "test",
    platform: "trendyol",
    product: {
      title: "Test",
      price: 100,
      currency: "TRY",
      category: "Giyim",
      url: "https://example.com/test",
    },
    reviews: [],
    priceHistory: [],
    session: {
      timeOnPageSeconds: 10,
      clickSpeedMs: 1000,
      currentHour: 14,
      purchasesToday: 0,
    },
  };
}

function ndjson(...events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

/** Wrap a sequence of string chunks into a Response with a ReadableStream body. */
function mockStreamResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
    ...init,
  });
}

const VERDICT_EVENT = {
  event: "verdict",
  response: {
    decision: "red",
    riskScore: 85,
    summary: "yüksek riskli",
    reasons: ["a", "b", "c"],
    agents: {
      reviewAgent: { score: 1, label: "x", findings: [] },
      priceAgent: { score: 1, label: "x", findings: [] },
      budgetAgent: { score: 1, label: "x", findings: [] },
      impulseAgent: { score: 1, label: "x", findings: [] },
      decisionAgent: { score: 1, label: "x", findings: [] },
    },
    recommendedAction: "30 saniye düşün",
  },
};

const NODE_EVENT = (node: string) => ({
  event: "node_finished",
  node,
  result: { score: 50, label: "x", findings: [] },
});

const ALL_HAPPY_EVENTS = [
  NODE_EVENT("review"),
  NODE_EVENT("price"),
  NODE_EVENT("budget"),
  NODE_EVENT("impulse"),
  VERDICT_EVENT,
];

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- Happy path ----------

describe("streamAnalyze — happy path", () => {
  it("delivers every event to onEvent in order, resolves with final verdict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockStreamResponse([ndjson(...ALL_HAPPY_EVENTS)]),
    ));

    const seen: StreamEvent[] = [];
    const verdict = await streamAnalyze(emptyRequest(), (e) => seen.push(e));

    expect(seen).toHaveLength(5);
    expect(seen.slice(0, 4).map((e) => e.event === "node_finished" ? e.node : null))
      .toEqual(["review", "price", "budget", "impulse"]);
    expect(seen[4].event).toBe("verdict");
    expect(verdict.decision).toBe("red");
    expect(verdict.riskScore).toBe(85);
  });
});

// ---------- Chunk boundary handling ----------

describe("streamAnalyze — chunk boundaries", () => {
  it("reassembles a JSON line split across multiple reader.read() chunks", async () => {
    const full = ndjson(...ALL_HAPPY_EVENTS);
    // Slice mid-line to force the buffer to carry a partial line forward.
    const mid = Math.floor(full.length / 2);
    const chunks = [full.slice(0, mid), full.slice(mid)];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockStreamResponse(chunks)));

    const seen: StreamEvent[] = [];
    const verdict = await streamAnalyze(emptyRequest(), (e) => seen.push(e));

    expect(seen).toHaveLength(5);
    expect(verdict.decision).toBe("red");
  });

  it("handles single-character chunks (most pathological case)", async () => {
    // Every codepoint as its own enqueue — exercises the buffer line by line.
    const chunks = [...ndjson(...ALL_HAPPY_EVENTS)];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockStreamResponse(chunks)));

    const seen: StreamEvent[] = [];
    const verdict = await streamAnalyze(emptyRequest(), (e) => seen.push(e));

    expect(seen).toHaveLength(5);
    expect(verdict.decision).toBe("red");
  });

  it("flushes the trailing partial line when stream ends without final newline", async () => {
    // Drop the final \n so the verdict event lives entirely in the buffer
    // until the post-loop tail flush runs.
    const ndjsonNoTrailingNewline = ALL_HAPPY_EVENTS.map((e) => JSON.stringify(e)).join("\n");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockStreamResponse([ndjsonNoTrailingNewline]),
    ));

    const seen: StreamEvent[] = [];
    const verdict = await streamAnalyze(emptyRequest(), (e) => seen.push(e));

    expect(seen).toHaveLength(5);
    expect(verdict.decision).toBe("red");
  });
});

// ---------- Robustness ----------

describe("streamAnalyze — robustness", () => {
  it("skips malformed JSON lines silently and parses the rest", async () => {
    const body =
      JSON.stringify(NODE_EVENT("review")) + "\n" +
      "not json at all\n" +
      JSON.stringify(NODE_EVENT("price")) + "\n" +
      JSON.stringify(VERDICT_EVENT) + "\n";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockStreamResponse([body])));

    const seen: StreamEvent[] = [];
    const verdict = await streamAnalyze(emptyRequest(), (e) => seen.push(e));

    // 2 node events + verdict = 3 valid events; the malformed line is dropped.
    expect(seen).toHaveLength(3);
    expect(verdict.decision).toBe("red");
  });

  it("ignores blank lines between events", async () => {
    const body =
      JSON.stringify(NODE_EVENT("review")) + "\n\n\n" +
      JSON.stringify(VERDICT_EVENT) + "\n";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockStreamResponse([body])));

    const seen: StreamEvent[] = [];
    await streamAnalyze(emptyRequest(), (e) => seen.push(e));
    expect(seen).toHaveLength(2);
  });
});

// ---------- Failure modes ----------

describe("streamAnalyze — failures", () => {
  it("throws when the stream emits an `error` event", async () => {
    const body = ndjson(
      NODE_EVENT("review"),
      { event: "error", message: "simulated outage" },
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockStreamResponse([body])));

    await expect(streamAnalyze(emptyRequest(), () => {})).rejects.toThrow(
      /simulated outage/,
    );
  });

  it("throws when stream ends without a verdict event", async () => {
    const body = ndjson(
      NODE_EVENT("review"),
      NODE_EVENT("price"),
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockStreamResponse([body])));

    await expect(streamAnalyze(emptyRequest(), () => {})).rejects.toThrow(
      /verdict olmadan/,
    );
  });

  it("throws on HTTP non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("backend down", { status: 503 }),
    ));

    await expect(streamAnalyze(emptyRequest(), () => {})).rejects.toThrow(/HTTP 503/);
  });

  it("throws when response body is null", async () => {
    // Synthesize a Response whose body getter returns null. Real fetch
    // never does this in practice but defensive code shouldn't crash.
    const resp = new Response(null, { status: 200 });
    Object.defineProperty(resp, "body", { value: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp));

    await expect(streamAnalyze(emptyRequest(), () => {})).rejects.toThrow(
      /yanıtı boş/,
    );
  });

  it("propagates fetch rejection (e.g. backend unreachable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(streamAnalyze(emptyRequest(), () => {})).rejects.toThrow(
      /Failed to fetch/,
    );
  });
});
