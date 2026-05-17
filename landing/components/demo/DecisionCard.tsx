"use client";

import { motion } from "framer-motion";
import { ArrowRight, Clock } from "lucide-react";
import type { AnalyzeResponse } from "@shared/types/analysis";
import { decisionLabel, decisionTone } from "@/lib/palette";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export function DecisionCard({
  result,
  onContinue,
  onPause,
  onReset,
}: {
  result: AnalyzeResponse;
  onContinue?: () => void;
  onPause?: () => void;
  onReset?: () => void;
}) {
  const tone = decisionTone[result.decision];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="kicker mb-1.5">Nihai Karar</div>
          <div className={cn("font-display text-4xl font-light tracking-tight", tone.text)}>
            {decisionLabel[result.decision]}
          </div>
        </div>
        <div className="text-right">
          <div className="kicker mb-1.5">Risk</div>
          <div className="font-display text-3xl font-light text-ink tracking-tight">{result.riskScore}</div>
        </div>
      </div>

      <h3 className="font-display text-xl md:text-2xl font-normal text-ink leading-snug mb-6 text-balance">
        {result.summary}
      </h3>

      <ul className="space-y-3 mb-7">
        {result.reasons.map((reason, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.07 }}
            className="flex gap-3 text-[14px] leading-relaxed text-ink-soft"
          >
            <span className={cn("mt-2 h-1 w-1 shrink-0 rounded-full", tone.dot)} />
            <span>{reason}</span>
          </motion.li>
        ))}
      </ul>

      <div className="hairline mb-6" />

      <div className="flex flex-col sm:flex-row gap-2">
        <Button variant="quiet" className="flex-1" onClick={onContinue}>
          Yine de Devam Et
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="primary" className="flex-1" onClick={onPause}>
          <Clock className="h-3.5 w-3.5" />
          30 Saniye Düşün
        </Button>
      </div>

      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="mt-4 w-full text-center text-[12px] text-ink-muted hover:text-ink-soft transition-colors"
        >
          Demoyu tekrar oynat
        </button>
      )}
    </motion.div>
  );
}
