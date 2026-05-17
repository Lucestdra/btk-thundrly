import type { AgentName } from "@shared/types/agent";

export type DemoStage = {
  key: AgentName;
  label: string;
  status: "pending" | "running" | "done";
};

export const initialStages: DemoStage[] = [
  { key: "reviewAgent", label: "Yorumlar taranıyor...", status: "pending" },
  { key: "priceAgent", label: "Fiyat geçmişi inceleniyor...", status: "pending" },
  { key: "budgetAgent", label: "Bütçe etkisi hesaplanıyor...", status: "pending" },
  { key: "impulseAgent", label: "Dürtü riski ölçülüyor...", status: "pending" },
  { key: "decisionAgent", label: "Nihai karar hazırlanıyor...", status: "pending" },
];

export const stageDoneLabel: Record<AgentName, string> = {
  reviewAgent: "Yorum analizi tamamlandı",
  priceAgent: "Fiyat analizi tamamlandı",
  budgetAgent: "Bütçe analizi tamamlandı",
  impulseAgent: "Dürtü analizi tamamlandı",
  decisionAgent: "Karar hazır",
};

export interface RunDemoOptions {
  stageDurationMs?: number;
  onUpdate: (stages: DemoStage[]) => void;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

export async function runDemo({
  stageDurationMs = 900,
  onUpdate,
  signal,
}: RunDemoOptions): Promise<void> {
  const stages: DemoStage[] = initialStages.map((s) => ({ ...s }));
  onUpdate(stages.map((s) => ({ ...s })));

  for (let i = 0; i < stages.length; i++) {
    stages[i].status = "running";
    onUpdate(stages.map((s) => ({ ...s })));
    await sleep(stageDurationMs, signal);
    stages[i].status = "done";
    onUpdate(stages.map((s) => ({ ...s })));
    if (i < stages.length - 1) {
      await sleep(120, signal);
    }
  }
}
