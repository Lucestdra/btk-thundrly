"use client";

import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import type { AnalyzeResponse } from "@shared/types/analysis";
import { decisionLabel, decisionTone } from "@/lib/palette";
import { cn } from "@/lib/cn";

export function ExtensionPanelMock({
  result,
  floating = false,
  className,
}: {
  result: AnalyzeResponse;
  floating?: boolean;
  className?: string;
}) {
  const tone = decisionTone[result.decision];

  return (
    <motion.div
      initial={floating ? { y: 0 } : false}
      animate={floating ? { y: [0, -8, 0] } : undefined}
      transition={floating ? { duration: 8, repeat: Infinity, ease: "easeInOut" } : undefined}
      className={cn(
        "relative w-full max-w-[380px] rounded-2xl bg-bg-secondary border border-line-strong shadow-soft p-6",
        className,
      )}
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" />
          <div>
            <div className="kicker">Tartı</div>
            <div className="text-[13px] text-ink mt-0.5">5 saniyelik kontrol</div>
          </div>
        </div>
        <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", tone.border, tone.bg, tone.text)}>
          <span className={cn("h-1 w-1 rounded-full", tone.dot)} />
          {decisionLabel[result.decision]} · {result.riskScore}
        </div>
      </div>

      <h3 className={cn("font-display text-xl font-normal leading-snug mb-4 tracking-tight", tone.text)}>
        {result.summary}
      </h3>

      <ul className="space-y-2.5">
        {result.reasons.map((reason, i) => (
          <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-ink-soft">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
            <span>{reason}</span>
          </li>
        ))}
      </ul>

      <div className="hairline my-5" />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="flex h-11 items-center justify-center gap-2 rounded-md bg-ink text-bg-primary text-[13px] font-medium hover:bg-ink/90 transition-colors"
        >
          <Clock className="h-3.5 w-3.5" />
          {result.recommendedAction}
        </button>
        <button
          type="button"
          className="flex h-9 items-center justify-center text-[12px] text-ink-muted hover:text-ink-soft transition-colors"
        >
          Yine de devam et
        </button>
      </div>
    </motion.div>
  );
}
