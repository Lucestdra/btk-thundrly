"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, RotateCcw } from "lucide-react";
import { Container } from "@/components/shell/Container";
import { AgentStepProgress } from "@/components/demo/AgentStepProgress";
import { DecisionCard } from "@/components/demo/DecisionCard";
import { ProductPageMock } from "@/components/demo/ProductPageMock";
import { runDemo, initialStages, type DemoStage } from "@/lib/runDemo";
import { streamAnalyze, type StreamEvent } from "@/lib/streamAnalyze";
import {
  redHoodieRequest,
  redHoodieResponse,
} from "@shared/demo/demoPayloads";
import type { AnalyzeResponse } from "@shared/types";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

type Phase = "idle" | "running" | "done";

// Backend node names → DemoStage keys.
type NodeName = Extract<StreamEvent, { node: string }>["node"];
const NODE_TO_STAGE: Record<NodeName, DemoStage["key"]> = {
  review: "reviewAgent",
  price: "priceAgent",
  budget: "budgetAgent",
  impulse: "impulseAgent",
  decision: "decisionAgent",
};

const STAGE_ORDER: DemoStage["key"][] = [
  "reviewAgent",
  "priceAgent",
  "budgetAgent",
  "impulseAgent",
  "decisionAgent",
];

// Visual pacing: real backend without Gemini completes in <100ms. We pace
// stage transitions so the panel still feels like "5 saniyelik kontrol".
// With Gemini enabled, real timing dominates and these floors become no-ops.
const STAGE_MIN_MS = 720;
const MIN_TOTAL_MS = 4500;

export function LiveDemoSection() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stages, setStages] = useState<DemoStage[]>(initialStages);
  const [result, setResult] = useState<AnalyzeResponse>(redHoodieResponse);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase("running");
    setStages(initialStages.map((s) => ({ ...s, status: "pending" })));
    setResult(redHoodieResponse);

    const pendingTimers: number[] = [];
    const cleanup = () => pendingTimers.forEach((id) => window.clearTimeout(id));
    ctrl.signal.addEventListener("abort", cleanup);

    const startedAt = Date.now();
    const stageStartedAt: Record<DemoStage["key"], number | null> = {
      reviewAgent: startedAt,
      priceAgent: null,
      budgetAgent: null,
      impulseAgent: null,
      decisionAgent: null,
    };

    // Kick off with stage 0 in running state.
    setStages((prev) => {
      const next = prev.map((s) => ({ ...s }));
      next[0].status = "running";
      return next;
    });

    const completeStage = (key: DemoStage["key"]) => {
      if (ctrl.signal.aborted) return;
      const i = STAGE_ORDER.indexOf(key);
      if (i < 0) return;
      const since = stageStartedAt[key] ?? startedAt;
      const elapsed = Date.now() - since;
      const wait = Math.max(0, STAGE_MIN_MS - elapsed);

      pendingTimers.push(
        window.setTimeout(() => {
          if (ctrl.signal.aborted) return;
          setStages((prev) => {
            if (prev[i].status === "done") return prev;
            const next = prev.map((s) => ({ ...s }));
            next[i].status = "done";
            if (i + 1 < next.length && next[i + 1].status === "pending") {
              next[i + 1].status = "running";
              stageStartedAt[STAGE_ORDER[i + 1]] = Date.now();
            }
            return next;
          });
        }, wait),
      );
    };

    const handleEvent = (event: StreamEvent) => {
      if (event.event !== "node_finished") return;
      const stageKey = NODE_TO_STAGE[event.node];
      if (stageKey) completeStage(stageKey);
    };

    try {
      const verdict = await streamAnalyze(redHoodieRequest, handleEvent, ctrl.signal);
      if (ctrl.signal.aborted) return;

      // Verdict event implicitly completes the decision stage.
      completeStage("decisionAgent");
      setResult(verdict);

      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, MIN_TOTAL_MS - elapsed);
      pendingTimers.push(
        window.setTimeout(() => {
          if (ctrl.signal.aborted) return;
          setPhase("done");
        }, wait + 200),
      );
    } catch (err) {
      if (ctrl.signal.aborted) return;
      // Backend not running or stream errored — fall back to the synthetic
      // simulator + canned response so the marketing page still demos cleanly.
      console.warn("[Tartı] streaming başarısız, sentetik simülatör çalışıyor:", err);
      try {
        await runDemo({
          onUpdate: setStages,
          signal: ctrl.signal,
          stageDurationMs: 900,
        });
        if (!ctrl.signal.aborted) {
          setResult(redHoodieResponse);
          setPhase("done");
        }
      } catch {
        // aborted
      }
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setPhase("idle");
    setStages(initialStages.map((s) => ({ ...s })));
    setResult(redHoodieResponse);
  };

  return (
    <section id="demo" className="fullscreen border-t border-line">
      <Container className="relative">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="max-w-3xl mb-14 md:mb-20"
        >
          <motion.h2
            variants={fadeUp}
            className="font-display text-3xl md:text-5xl lg:text-6xl font-light leading-[1.05] tracking-tighter text-ink text-balance"
          >
            5 saniyede <span className="italic">karar</span>.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 lead max-w-2xl">
            Aşağıdaki demoda canlı backend'i çağırırız — beş ajan paralel
            çalışır, kararı ve gerekçelerini Türkçe gösterir. Backend
            erişilemezse sentetik fixture ile gösterim devam eder.
          </motion.p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
          {/* Left: simulated product page */}
          <div className="relative">
            <ProductPageMock />
            <AnimatePresence>
              {phase === "running" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 rounded-2xl bg-bg-primary/50 backdrop-blur-[1px] flex items-center justify-center pointer-events-none"
                >
                  <div className="text-[11px] text-ink-soft font-mono tracking-wider uppercase">analiz devam ediyor</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right: control panel */}
          <div className="card-elevated p-8 md:p-10">
            <AnimatePresence mode="wait">
              {phase === "idle" && (
                <motion.button
                  key="idle"
                  type="button"
                  onClick={start}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="group min-h-[420px] w-full flex flex-col justify-center items-center text-center cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/60 rounded-lg"
                >
                  <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full border border-line-strong transition-colors group-hover:border-accent/60 group-hover:bg-accent/5">
                    <Play className="h-5 w-5 text-ink ml-0.5 transition-colors group-hover:text-accent" fill="currentColor" />
                  </div>
                  <h3 className="font-display text-3xl font-light text-ink mb-3 tracking-tight transition-colors group-hover:text-accent">
                    Analizi Başlat
                  </h3>
                  <p className="text-[15px] text-ink-soft max-w-sm mb-8 leading-relaxed">
                    Soldaki ürün için beş ajanın paralel çalıştığını gerçek zamanlı izle.
                    Sentetik veriyle çalışır; her zaman aynı sonucu üretir.
                  </p>
                  <span className="inline-flex items-center gap-2 rounded-md bg-accent px-6 h-12 text-[15px] font-medium text-alabaster-grey transition-colors group-hover:bg-deep-space-blue">
                    <Play className="h-3.5 w-3.5" fill="currentColor" />
                    Analizi Başlat
                  </span>
                </motion.button>
              )}

              {phase === "running" && (
                <motion.div
                  key="running"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="min-h-[420px]"
                >
                  <div className="mb-6">
                    <div className="kicker mb-2">Süreç</div>
                    <h3 className="font-display text-2xl font-light text-ink tracking-tight">
                      Ajanlar paralel çalışıyor
                    </h3>
                  </div>
                  <AgentStepProgress stages={stages} />
                </motion.div>
              )}

              {phase === "done" && (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <DecisionCard
                    result={result}
                    onContinue={start}
                    onPause={reset}
                    onReset={reset}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {phase === "done" && (
              <button
                type="button"
                onClick={start}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 text-[12px] text-ink-muted hover:text-ink-soft transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Demoyu tekrar oynat
              </button>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
