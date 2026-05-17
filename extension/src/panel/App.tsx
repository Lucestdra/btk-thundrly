import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzeRequest, AnalyzeResponse, Decision } from "@shared/types/analysis";
import {
  analyzePurchase,
  analyzePurchaseWithProgress,
  type StreamEvent,
} from "@/api/client";
import "./Panel.css";

type Phase = "loading" | "result" | "error";

type StageKey = "review" | "price" | "budget" | "impulse" | "decision";
type StageStatus = "pending" | "running" | "done";

const STAGES: { key: StageKey; label: string }[] = [
  { key: "review", label: "Yorumlar taranıyor..." },
  { key: "price", label: "Fiyat geçmişi inceleniyor..." },
  { key: "budget", label: "Bütçe etkisi hesaplanıyor..." },
  { key: "impulse", label: "Dürtü riski ölçülüyor..." },
  { key: "decision", label: "Nihai karar hazırlanıyor..." },
];

const STAGE_DONE_LABEL: Record<StageKey, string> = {
  review: "Yorum analizi tamamlandı",
  price: "Fiyat analizi tamamlandı",
  budget: "Bütçe analizi tamamlandı",
  impulse: "Dürtü analizi tamamlandı",
  decision: "Karar hazır",
};

// Minimum time each stage stays "running" before transitioning to "done".
// Without this, fast backends (no Gemini → <50ms total) make the panel flash.
// With Gemini in play, real timing dominates and these floors are no-ops.
const STAGE_MIN_RUNNING_MS = 280;
// Minimum baseline duration before transitioning to result; ensures the panel
// always feels like "5 saniyelik" analiz even if every node completed instantly.
const MIN_TOTAL_MS = 1800;

const decisionToneClass: Record<Decision, string> = {
  green: "green",
  yellow: "yellow",
  red: "red",
};

const decisionLabel: Record<Decision, string> = {
  green: "Yeşil",
  yellow: "Sarı",
  red: "Kırmızı",
};

export interface PanelProps {
  request: AnalyzeRequest;
  onContinue: () => void;
  onPause: () => void;
  onClose: () => void;
}

export function App({ request, onContinue, onPause, onClose }: PanelProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [statuses, setStatuses] = useState<StageStatus[]>(() => STAGES.map((_, i) => (i === 0 ? "running" : "pending")));
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const startedAt = useRef<number>(Date.now());
  const runningSince = useRef<Record<StageKey, number | null>>({
    review: Date.now(),
    price: null,
    budget: null,
    impulse: null,
    decision: null,
  });
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const pendingTimers: number[] = [];

    // Advance stages on backend events, respecting STAGE_MIN_RUNNING_MS.
    const completeStage = (key: StageKey) => {
      if (cancelled.current) return;
      const i = STAGES.findIndex((s) => s.key === key);
      if (i < 0) return;

      const since = runningSince.current[key] ?? startedAt.current;
      const elapsed = Date.now() - since;
      const wait = Math.max(0, STAGE_MIN_RUNNING_MS - elapsed);

      const fire = () => {
        if (cancelled.current) return;
        setStatuses((prev) => {
          // If already done, no-op
          if (prev[i] === "done") return prev;
          const next = prev.slice();
          next[i] = "done";
          // Start the next pending stage running.
          if (i + 1 < next.length && next[i + 1] === "pending") {
            next[i + 1] = "running";
            const nextKey = STAGES[i + 1].key;
            runningSince.current[nextKey] = Date.now();
          }
          return next;
        });
      };

      if (wait === 0) fire();
      else pendingTimers.push(window.setTimeout(fire, wait));
    };

    const handleEvent = (event: StreamEvent) => {
      if (event.event === "node_finished") {
        completeStage(event.node);
      }
      // 'verdict' and 'error' are handled by the awaited promise.
    };

    const transitionToResult = (response: AnalyzeResponse) => {
      if (cancelled.current) return;

      // Make sure every stage shows "done" before we flip phases, including
      // the decision stage (the verdict event implicitly completes it).
      completeStage("decision");

      const totalElapsed = Date.now() - startedAt.current;
      const wait = Math.max(0, MIN_TOTAL_MS - totalElapsed);
      pendingTimers.push(
        window.setTimeout(() => {
          if (cancelled.current) return;
          setResult(response);
          setPhase("result");
        }, wait + 80), // small breathing room after last stage flips done
      );
    };

    (async () => {
      try {
        const { response } = await analyzePurchaseWithProgress(request, handleEvent);
        transitionToResult(response);
      } catch {
        // Final safety net — go straight to the legacy one-shot path with
        // its built-in fallback fixture.
        try {
          const response = await analyzePurchase(request);
          transitionToResult(response);
        } catch (e) {
          if (cancelled.current) return;
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled.current = true;
      pendingTimers.forEach((id) => window.clearTimeout(id));
    };
  }, [request]);

  const tone = useMemo(() => (result ? decisionToneClass[result.decision] : "red"), [result]);

  return (
    <div className="kg-panel" role="dialog" aria-live="polite" aria-label="Thundrly analiz paneli">
      <div className="kg-header">
        <div className="kg-brand">
          <div className="kg-logo">T</div>
          <div className="kg-brand-text">
            <small>Thundrly</small>
            <strong>5 saniyelik kontrol</strong>
          </div>
        </div>
        {phase === "result" && result && (
          <span className={`kg-chip ${tone} kg-${tone}`}>
            <span className="kg-chip-dot" />
            {decisionLabel[result.decision]} · {result.riskScore}
          </span>
        )}
      </div>

      {phase === "loading" && (
        <>
          <h3 className="kg-title" style={{ color: "#ccdbdc" }}>Ajanlar paralel çalışıyor...</h3>
          <ul className="kg-loading-list">
            {STAGES.map((s, i) => {
              const st = statuses[i];
              return (
                <li key={s.key} className={`kg-loading-item ${st}`}>
                  <span className="kg-step-icon">
                    {st === "done" && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {st === "running" && (
                      <svg className="kg-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                    )}
                    {st === "pending" && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    )}
                  </span>
                  <span>{st === "done" ? STAGE_DONE_LABEL[s.key] : s.label}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {phase === "result" && result && (
        <>
          <h3 className={`kg-title kg-${tone}`}>{result.summary}</h3>
          <ul className={`kg-reasons ${tone}`}>
            {result.reasons.map((r, i) => (
              <li key={i}>
                <span style={{ color: "rgba(204, 219, 220, 0.84)" }}>{r}</span>
              </li>
            ))}
          </ul>

          <div className="kg-divider" />

          <div className="kg-actions">
            <button className="kg-btn kg-btn-primary" onClick={onPause}>
              {result.recommendedAction}
            </button>
            <button className="kg-btn" onClick={onContinue}>
              Yine de Devam Et
            </button>
          </div>

          <button className="kg-close" onClick={onClose}>
            Analizi Kapat
          </button>
        </>
      )}

      {phase === "error" && (
        <>
          <h3 className="kg-title kg-red">Analiz tamamlanamadı</h3>
          <div className="kg-error">
            Sunucuya ulaşılamadı{errorMsg ? ` — ${errorMsg}` : ""}. Hata olsa da kararını sen veriyorsun.
          </div>
          <div className="kg-actions">
            <button className="kg-btn kg-btn-primary" onClick={onContinue}>
              Devam Et
            </button>
            <button className="kg-btn" onClick={onClose}>
              Analizi Kapat
            </button>
          </div>
        </>
      )}
    </div>
  );
}
