"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, Circle } from "lucide-react";
import type { DemoStage } from "@/lib/runDemo";
import { stageDoneLabel } from "@/lib/runDemo";
import { cn } from "@/lib/cn";

export function AgentStepProgress({ stages }: { stages: DemoStage[] }) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {stages.map((s, i) => {
        const isDone = s.status === "done";
        const isRunning = s.status === "running";
        const label = isDone ? stageDoneLabel[s.key] : s.label;

        return (
          <li
            key={s.key}
            className={cn(
              "flex items-center gap-4 py-3.5 px-1 transition-colors",
              isRunning && "bg-bg-tertiary/40",
            )}
          >
            <div className="flex h-6 w-6 items-center justify-center shrink-0">
              <AnimatePresence mode="wait">
                {isDone && (
                  <motion.div
                    key="done"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  >
                    <Check className="h-4 w-4 text-ink" strokeWidth={2.5} />
                  </motion.div>
                )}
                {isRunning && (
                  <motion.div
                    key="running"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <Loader2 className="h-4 w-4 text-ink animate-spin" strokeWidth={1.5} />
                  </motion.div>
                )}
                {s.status === "pending" && (
                  <motion.div
                    key="pending"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <Circle className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.5} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex-1">
              <div
                className={cn(
                  "text-[14px] transition-colors",
                  isDone ? "text-ink" : isRunning ? "text-ink" : "text-ink-muted",
                )}
              >
                {label}
              </div>
            </div>

            <div className="font-mono text-[10px] text-ink-faint tracking-wider">
              {String(i + 1).padStart(2, "0")}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
