export const decisionLabel = {
  green: "Yeşil",
  yellow: "Sarı",
  red: "Kırmızı",
} as const;

export const decisionTone = {
  green: {
    text: "text-verdict-green",
    border: "border-verdict-green/40",
    bg: "bg-verdict-green/10",
    dot: "bg-verdict-green",
    soft: "text-verdict-green/80",
  },
  yellow: {
    text: "text-verdict-yellow",
    border: "border-verdict-yellow/45",
    bg: "bg-verdict-yellow/10",
    dot: "bg-verdict-yellow",
    soft: "text-verdict-yellow/80",
  },
  red: {
    text: "text-verdict-red",
    border: "border-verdict-red/45",
    bg: "bg-verdict-red/10",
    dot: "bg-verdict-red",
    soft: "text-verdict-red/80",
  },
} as const;

export type DecisionKey = keyof typeof decisionTone;
