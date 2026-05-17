"use client";

import { motion } from "framer-motion";
import {
  ChartNoAxesCombined,
  MessageSquareText,
  MousePointerClick,
  Scale,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

type Agent = {
  key: string;
  label: string;
  Icon: LucideIcon;
};

const signalAgents: Agent[] = [
  { key: "review", label: "Yorum", Icon: MessageSquareText },
  { key: "price", label: "Fiyat", Icon: ChartNoAxesCombined },
  { key: "budget", label: "Bütçe", Icon: WalletCards },
  { key: "impulse", label: "Dürtü", Icon: MousePointerClick },
];

const verdicts = [
  {
    key: "green",
    label: "Yeşil",
    tone: "bg-verdict-green/12 border-verdict-green/40 text-verdict-green",
    dot: "bg-verdict-green",
  },
  {
    key: "yellow",
    label: "Sarı",
    tone: "bg-verdict-yellow/12 border-verdict-yellow/45 text-verdict-yellow",
    dot: "bg-verdict-yellow",
  },
  {
    key: "red",
    label: "Kırmızı",
    tone: "bg-verdict-red/12 border-verdict-red/45 text-verdict-red",
    dot: "bg-verdict-red",
  },
];

export function AgentFlowDiagram() {
  return (
    <div className="relative w-full">
      <MobileLayout />
      <DesktopLayout />
    </div>
  );
}

function MobileLayout() {
  return (
    <div className="lg:hidden">
      <div className="space-y-2">
        {signalAgents.map((agent, i) => (
          <SignalCard key={agent.key} agent={agent} delay={i * 0.06} />
        ))}
      </div>
      <DownChevron />
      <DecisionCard />
      <DownChevron />
      <div className="grid grid-cols-3 gap-2">
        {verdicts.map((v, i) => (
          <motion.div
            key={v.key}
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 + i * 0.06 }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[12px] font-medium",
              v.tone,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", v.dot)} />
            {v.label}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function DesktopLayout() {
  return (
    <div className="hidden lg:flex lg:items-stretch">
      <div className="flex w-[220px] shrink-0 flex-col justify-between gap-3 py-2">
        {signalAgents.map((agent, i) => (
          <SignalCard key={agent.key} agent={agent} delay={i * 0.06} />
        ))}
      </div>

      <div className="relative w-[72px] self-stretch shrink-0">
        <ConnectorLeft />
      </div>

      <div className="flex items-center shrink-0">
        <DecisionCard />
      </div>

      <div className="relative w-[56px] self-stretch shrink-0">
        <ConnectorRight />
      </div>

      <div className="flex flex-col justify-center gap-2.5 min-w-[108px]">
        {verdicts.map((v, i) => (
          <motion.div
            key={v.key}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6 + i * 0.08 }}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium",
              v.tone,
            )}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", v.dot)} />
            {v.label}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SignalCard({ agent, delay }: { agent: Agent; delay: number }) {
  const Icon = agent.Icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay }}
      className="flex items-center gap-3 rounded-xl border border-line bg-bg-secondary/80 px-3.5 py-3 shadow-line"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-bg-primary/70">
        <Icon className="h-4 w-4 text-cerulean" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15px] font-normal leading-tight text-ink">
          {agent.label} Ajanı
        </div>
      </div>
    </motion.div>
  );
}

function DecisionCard() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay: 0.38, duration: 0.45 }}
      className="w-full lg:w-[180px] rounded-2xl border border-line-strong bg-bg-tertiary px-5 py-6 text-center shadow-soft"
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-line-strong bg-bg-primary/70">
        <Scale className="h-5 w-5 text-deep-space-blue" strokeWidth={1.8} />
      </div>
      <div className="font-display text-lg font-medium leading-tight tracking-tight text-ink">
        Karar Ajanı
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-ink-soft">
        Ağırlıklı toplam
      </div>
    </motion.div>
  );
}

function ConnectorLeft() {
  const ys = [10, 36.5, 63.5, 90];
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
    >
      {ys.map((y, i) => (
        <motion.path
          key={y}
          d={`M 0 ${y} C 45 ${y}, 55 50, 100 50`}
          stroke="#007ea7"
          strokeOpacity="0.34"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, delay: 0.18 + i * 0.07 }}
        />
      ))}
      <motion.circle
        cx="100"
        cy="50"
        r="3"
        className="fill-cerulean"
        initial={{ scale: 0, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.55, duration: 0.3 }}
      />
    </svg>
  );
}

function ConnectorRight() {
  const ys = [22, 50, 78];
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
    >
      {ys.map((y, i) => (
        <motion.path
          key={y}
          d={`M 0 50 C 45 50, 55 ${y}, 100 ${y}`}
          stroke="#007ea7"
          strokeOpacity="0.34"
          strokeWidth="1.5"
          strokeDasharray="4 6"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.6 + i * 0.07 }}
        />
      ))}
    </svg>
  );
}

function DownChevron() {
  return (
    <div className="flex justify-center py-3">
      <svg width="14" height="18" viewBox="0 0 14 18" fill="none">
        <path
          d="M 7 1 L 7 12 M 2.5 9 L 7 14 L 11.5 9"
          stroke="#007ea7"
          strokeOpacity="0.45"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
