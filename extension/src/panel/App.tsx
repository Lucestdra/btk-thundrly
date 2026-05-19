import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzeRequest, AnalyzeResponse, Decision } from "@shared/types/analysis";
import {
  analyzePurchaseWithProgress,
  type StreamEvent,
} from "@/api/client";
import { detectHost, platformLabel } from "@/utils/domDetector";
import { TaggedChips } from "./TaggedChips";
import { TriggeredRulesList } from "./TriggeredRulesList";
import { LogoMark } from "@/components/LogoMark";
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
// Was 280ms (artificial). Reliability sprint: dropped to 60ms — just
// enough to avoid the panel flickering when nodes complete in <16ms
// (single React-paint), without inventing fake work. If reviews take
// 4 seconds to actually fetch, the user sees 4 real seconds of progress.
const STAGE_MIN_RUNNING_MS = 60;
// Minimum baseline duration before transitioning to result. Was 1800ms
// artificial pacing to feel like "5 saniyelik kontrol". Reliability
// sprint: 0 — show honest progress. The extension's real review
// extraction now takes 2-5s on first-visit products, so the analysis
// naturally fills the same perceived duration without lying.
const MIN_TOTAL_MS = 0;

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

const AGENT_LABELS: { key: keyof AnalyzeResponse["agents"]; short: string }[] = [
  { key: "reviewAgent", short: "Yorum" },
  { key: "priceAgent", short: "Fiyat" },
  { key: "budgetAgent", short: "Bütçe" },
  { key: "impulseAgent", short: "Dürtü" },
];

function scoreTone(score: number): "green" | "yellow" | "red" {
  if (score < 40) return "green";
  if (score < 70) return "yellow";
  return "red";
}

/**
 * Map a raw backend error string to a clean Turkish message pair we can
 * show in the panel. Power users still see the raw cause via the
 * console.error in the analyze catch — the panel never surfaces HTTP
 * status codes or JSON to end users.
 */
function categorizeError(raw: string | null): { title: string; body: string } {
  const msg = (raw || "").toLowerCase();
  // Schema mismatch — usually the extractor produced an out-of-range
  // value the backend couldn't accept. From the user's POV this means
  // "we couldn't read the product page correctly".
  if (msg.includes("422") || msg.includes("validation")) {
    return {
      title: "Ürün bilgisi okunamadı",
      body: "Bu sayfanın yapısı tanımadığımız bir şekilde değişmiş. Karar sende.",
    };
  }
  // Server-side failure.
  if (/\bhttp 5\d{2}\b/.test(msg) || msg.includes("internal server")) {
    return {
      title: "Sunucu geçici olarak yanıt vermiyor",
      body: "Birkaç dakika sonra tekrar dene. Karar sende.",
    };
  }
  // Rate limit.
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many")) {
    return {
      title: "Çok hızlı gidiyoruz",
      body: "Kısa bir mola verdik. Birkaç dakika sonra tekrar dene.",
    };
  }
  // Network / unreachable.
  if (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("yanıt yok") ||
    msg.includes("disconnected") ||
    msg.includes("port") ||
    msg.includes("timeout")
  ) {
    return {
      title: "Bağlantı kurulamadı",
      body: "İnternet bağlantını kontrol et. Karar sende.",
    };
  }
  // Fallback — keep it human; never leak the raw HTTP detail.
  return {
    title: "Analiz tamamlanamadı",
    body: "Bu ürün için sinyalleri toplayamadık. Karar sende.",
  };
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: currency || "TRY",
      maximumFractionDigits: 0,
    }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

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
          if (prev[i] === "done") return prev;
          const next = prev.slice();
          next[i] = "done";
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
    };

    const transitionToResult = (response: AnalyzeResponse) => {
      if (cancelled.current) return;
      completeStage("decision");

      const totalElapsed = Date.now() - startedAt.current;
      const wait = Math.max(0, MIN_TOTAL_MS - totalElapsed);
      pendingTimers.push(
        window.setTimeout(() => {
          if (cancelled.current) return;
          setResult(response);
          setPhase("result");
        }, wait + 80),
      );
    };

    (async () => {
      try {
        const { response } = await analyzePurchaseWithProgress(request, handleEvent);
        transitionToResult(response);
      } catch (e) {
        if (cancelled.current) return;
        // Keep the raw detail in the console for power users; the panel
        // shows a clean Turkish message via categorizeError() below.
        console.error("[Thundrly] analyze failed:", e);
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();

    return () => {
      cancelled.current = true;
      pendingTimers.forEach((id) => window.clearTimeout(id));
    };
  }, [request]);

  const tone = useMemo(() => (result ? decisionToneClass[result.decision] : "red"), [result]);
  // location.href is stable for the panel's lifetime — the SPA-nav
  // detector teardowns the panel before pushing a new URL. So we can
  // compute the platform label once at mount and reuse it forever.
  const platform = useMemo(() => platformLabel(detectHost(location.href)), []);  // eslint-disable-line react-hooks/exhaustive-deps
  const product = request.product;

  return (
    <div className="kg-panel" role="dialog" aria-live="polite" aria-label="Thundrly analiz paneli">
      <div className="kg-header">
        <div className="kg-brand">
          <span className="kg-logo">
            <LogoMark size={22} />
          </span>
          <div className="kg-brand-text">
            <small>Thundrly</small>
            <strong>5 saniyelik kontrol</strong>
          </div>
        </div>
        <button className="kg-x" aria-label="Kapat" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Product preview — always visible */}
      <div className="kg-product">
        {product.imageUrl ? (
          <img className="kg-product-img" src={product.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="kg-product-img kg-product-img-placeholder" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
        <div className="kg-product-body">
          <div className="kg-product-title" title={product.title}>{product.title}</div>
          <div className="kg-product-meta">
            <span className="kg-product-price">
              {formatPrice(product.price, product.currency)}
            </span>
            <span className="kg-product-dot">·</span>
            <span className="kg-product-platform">{platform}</span>
          </div>
        </div>
      </div>

      {phase === "loading" && (
        <>
          <ul className="kg-loading-list">
            {STAGES.map((s, i) => {
              const st = statuses[i];
              return (
                <li key={s.key} className={`kg-loading-item ${st}`}>
                  <span className="kg-step-icon">
                    {st === "done" && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {st === "running" && (
                      <svg className="kg-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                    )}
                    {st === "pending" && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          {/* Big verdict banner */}
          <div className={`kg-verdict kg-verdict-${tone}`}>
            <div className="kg-verdict-left">
              <span className="kg-verdict-dot" />
              <span className="kg-verdict-label">{decisionLabel[result.decision]}</span>
            </div>
            <div className="kg-verdict-score">
              <span className="kg-verdict-score-num">{result.riskScore}</span>
              <span className="kg-verdict-score-suf">/100</span>
            </div>
          </div>

          {/* Tagged warnings — extracted into TaggedChips so adding new
              tags (lowReviewTrust, outOfPolicy, …) is one config row,
              not new inline JSX in App.tsx. */}
          <TaggedChips agents={result.agents} />

          {/* Agent score bars — each shows its score, its verdict label,
              and on hover its top finding so the user can see *why* each
              agent concluded what it did instead of just a number. */}
          <div className="kg-agents">
            {AGENT_LABELS.map(({ key, short }) => {
              const agent = result.agents[key];
              const score = Math.max(0, Math.min(100, agent?.score ?? 0));
              const tcls = scoreTone(score);
              const verdict = agent?.label ?? "—";
              const firstFinding = agent?.findings?.[0]?.message;
              return (
                <div
                  className="kg-agent"
                  key={key}
                  title={firstFinding ?? verdict}
                >
                  <div className="kg-agent-row">
                    <span className="kg-agent-label">{short}</span>
                    <span className={`kg-agent-score kg-${tcls}`}>{score}</span>
                  </div>
                  <div className="kg-agent-track">
                    <div
                      className={`kg-agent-fill kg-fill-${tcls}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <div className={`kg-agent-verdict kg-${tcls}`}>{verdict}</div>
                </div>
              );
            })}
          </div>

          {/* Summary + reasons */}
          <p className="kg-summary">{result.summary}</p>
          <ul className={`kg-reasons ${tone}`}>
            {result.reasons.map((r, i) => (
              <li key={i}>
                <span className="kg-reason-text">{r}</span>
              </li>
            ))}
          </ul>

          {/* Section 6 — causal rules that fired on top of the
              weighted-sum baseline. Collapsible; opens by default
              when present because the explanation is genuinely useful. */}
          <TriggeredRulesList rules={result.triggeredRules ?? []} />

          <div className="kg-actions">
            <button className="kg-btn kg-btn-primary" onClick={onPause}>
              {result.recommendedAction}
            </button>
            <button className="kg-btn" onClick={onContinue}>
              Yine de Devam Et
            </button>
          </div>
        </>
      )}

      {phase === "error" && (() => {
        const cat = categorizeError(errorMsg);
        return (
          <>
            <div className="kg-empty">
              <div className="kg-empty-icon" aria-hidden="true">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4" />
                  <path d="M12 16h.01" />
                </svg>
              </div>
              <div className="kg-empty-title">{cat.title}</div>
              <div className="kg-empty-body">{cat.body}</div>
            </div>
            <div className="kg-actions">
              <button className="kg-btn kg-btn-primary" onClick={onContinue}>
                Satın almaya devam et
              </button>
              <button className="kg-btn" onClick={onClose}>
                Kapat
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}
