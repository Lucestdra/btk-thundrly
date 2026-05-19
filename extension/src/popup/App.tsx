/**
 * Thundrly extension popup.
 *
 * Two responsibilities:
 *   1. Show the user's current-month spend (overall + per category) so
 *      they understand where the budget agent's numbers come from.
 *   2. Let the user edit their monthly limit and per-category limits.
 *
 * Data flow:
 *   - On mount: GET /api/user-budgets?userId=<installId> → summary
 *   - On save: PUT /api/user-budget for each changed category, sequentially
 *
 * The popup is intentionally read-mostly: spend tallies are accumulated
 * server-side via /api/purchases when the user clicks "Yine de Devam Et"
 * in the panel. We don't let users hand-edit `categorySpent` — keeping
 * the trail honest matters more than convenience.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getInstallId } from "@/utils/installId";
import { HEALTH_URL, USER_BUDGETS_URL, USER_BUDGET_GLOBAL_URL, USER_BUDGET_URL } from "@/config";
import { LogoMark } from "@/components/LogoMark";

interface HealthStatus {
  online: boolean;
  gemini?: boolean;
  geminiModel?: string | null;
  error?: string;
}

interface CategoryBudget {
  category: string;
  categoryLimit: number;
  categorySpent: number;
}

interface BudgetSummary {
  userId: string;
  monthlyLimit: number;
  monthlySpent: number;
  currency: string;
  periodStart: string;
  categories: CategoryBudget[];
}

interface EditableCategory extends CategoryBudget {
  isNew?: boolean;
}

// Common Turkish e-commerce categories — used as quick-add suggestions.
const SUGGESTED_CATEGORIES = ["Giyim", "Elektronik", "Market", "Kitap", "Ev", "Kozmetik", "Spor"];

async function pingHealth(): Promise<HealthStatus> {
  try {
    const r = await fetch(HEALTH_URL, { cache: "no-store" });
    if (!r.ok) return { online: false, error: `HTTP ${r.status}` };
    const data = (await r.json()) as { gemini?: boolean; geminiModel?: string | null };
    return { online: true, gemini: !!data.gemini, geminiModel: data.geminiModel ?? null };
  } catch (e) {
    return { online: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function formatTRY(amount: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(amount);
}

function pct(spent: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((spent / limit) * 100));
}

function toneFor(p: number): "green" | "yellow" | "red" {
  if (p < 70) return "green";
  if (p < 100) return "yellow";
  return "red";
}

function monthLabel(periodStartIso: string): string {
  try {
    const d = new Date(periodStartIso);
    return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(d);
  } catch {
    return periodStartIso;
  }
}

export function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [monthlyLimit, setMonthlyLimit] = useState<string>("");
  const [categories, setCategories] = useState<EditableCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const refresh = useCallback(async (uid: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${USER_BUDGETS_URL}?userId=${encodeURIComponent(uid)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as BudgetSummary;
      setSummary(data);
      setMonthlyLimit(String(data.monthlyLimit));
      setCategories(data.categories.map((c) => ({ ...c })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const uid = await getInstallId();
      setUserId(uid);
      // Logged on every popup open so the user can match this against the
      // `userId` field in the [Thundrly] AnalyzeRequest log emitted by the
      // content script — mismatching installIds is the #1 cause of
      // "Bütçe Verisi Yok" after a budget save.
      console.log(`[Thundrly/popup] installId=${uid}`);
      // Backend health probe runs in parallel with the budget fetch so the
      // popup footer can show whether Gemini is actually wired in.
      void pingHealth().then(setHealth);
      await refresh(uid);
    })();
  }, [refresh]);

  const missingSuggestions = useMemo(
    () => SUGGESTED_CATEGORIES.filter((s) => !categories.some((c) => c.category.toLowerCase() === s.toLowerCase())),
    [categories],
  );

  const addCategory = (name: string) => {
    if (!name.trim()) return;
    if (categories.some((c) => c.category.toLowerCase() === name.toLowerCase())) return;
    setCategories((prev) => [
      ...prev,
      { category: name.trim(), categoryLimit: 0, categorySpent: 0, isNew: true },
    ]);
  };

  const updateLimit = (index: number, raw: string) => {
    const next = raw.replace(/[^\d]/g, "");
    setCategories((prev) => {
      const out = prev.slice();
      out[index] = { ...out[index], categoryLimit: next === "" ? 0 : Number(next) };
      return out;
    });
  };

  const removeCategory = (index: number) => {
    setCategories((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!userId) return;
    const monthly = Number((monthlyLimit || "0").replace(/[^\d]/g, ""));
    if (monthly <= 0) {
      setError("Aylık bütçe sıfırdan büyük olmalı.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // Always persist the global envelope FIRST. This is the hybrid
      // model's primary signal — even users with zero per-category rows
      // get a working budget agent after this PUT.
      const globalPayload = {
        monthlyLimit: monthly,
        categoryLimit: monthly,
        categorySpent: 0,
        currency: "TRY",
      };
      console.log(
        `[Thundrly/popup] saving global budget · userId=${userId} · monthlyLimit=${monthly}`,
      );
      const rg = await fetch(
        `${USER_BUDGET_GLOBAL_URL}?userId=${encodeURIComponent(userId)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(globalPayload),
        },
      );
      if (!rg.ok) throw new Error(`Aylık genel bütçe kaydedilemedi: HTTP ${rg.status}`);
      // Echo the persisted row so the user can confirm the round-trip in
      // the console — debugging "I saved but agent still says Bütçe Verisi
      // Yok" was previously impossible without backend access.
      try {
        const body = await rg.clone().json();
        console.log("[Thundrly/popup] global budget saved · backend ack:", body);
      } catch {
        /* body may not be JSON in some error variants — already caught above */
      }

      // Per-category rows are optional power-user data — only PUT the
      // ones the user actually configured. Sequential so the first
      // failure surfaces a clear category name in the error.
      for (const cat of categories) {
        if (!cat.category.trim() || cat.categoryLimit < 0) continue;
        const payload = {
          monthlyLimit: monthly,
          categoryLimit: cat.categoryLimit,
          categorySpent: cat.categorySpent, // preserved; backend keeps running tally
          currency: "TRY",
        };
        const r = await fetch(
          `${USER_BUDGET_URL}?userId=${encodeURIComponent(userId)}&category=${encodeURIComponent(cat.category)}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!r.ok) throw new Error(`${cat.category} kaydedilemedi: HTTP ${r.status}`);
      }

      setSavedAt(Date.now());
      await refresh(userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="pop">
        <Header />
        <div className="pop-empty">Yükleniyor…</div>
      </div>
    );
  }

  return (
    <div className="pop">
      <Header />

      {summary && (
        <div className="pop-period">
          {monthLabel(summary.periodStart)} dönemi
        </div>
      )}

      {/* Overall monthly progress — the PRIMARY field in the hybrid model.
          The global envelope alone is enough for the budget agent to work
          on every category. Per-category limits below are optional and
          only narrow the verdict on products that confidently match one. */}
      <section className="pop-section">
        <label className="pop-label" htmlFor="monthly">Aylık genel bütçe</label>
        <div className="pop-row">
          <span className="pop-currency">₺</span>
          <input
            id="monthly"
            className="pop-input pop-input-money"
            inputMode="numeric"
            value={monthlyLimit}
            onChange={(e) => setMonthlyLimit(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
          />
        </div>
        {summary && (
          <>
            <ProgressBar
              spent={summary.monthlySpent}
              limit={Number(monthlyLimit) || summary.monthlyLimit}
            />
            <div className="pop-meta">
              <span>{formatTRY(summary.monthlySpent)} harcandı</span>
              <span className="pop-meta-dot">·</span>
              <span>
                {formatTRY(Math.max(0, (Number(monthlyLimit) || summary.monthlyLimit) - summary.monthlySpent))} kaldı
              </span>
            </div>
          </>
        )}
      </section>

      {/* Per-category — optional fine-tuning */}
      <section className="pop-section">
        <div className="pop-label-row">
          <label className="pop-label">Kategori limitleri <span className="pop-optional">(opsiyonel)</span></label>
          <span className="pop-hint">limit • bu ay harcanan</span>
        </div>

        {categories.length === 0 && (
          <div className="pop-empty-cats">
            Kategori eklemen zorunlu değil — genel bütçe her ürün için geçerli.
          </div>
        )}

        <ul className="pop-cat-list">
          {categories.map((cat, i) => {
            const p = pct(cat.categorySpent, cat.categoryLimit);
            const tone = toneFor(p);
            return (
              <li className="pop-cat" key={cat.category}>
                <div className="pop-cat-head">
                  <span className="pop-cat-name">{cat.category}</span>
                  <button
                    type="button"
                    className="pop-cat-remove"
                    aria-label={`${cat.category} kaldır`}
                    onClick={() => removeCategory(i)}
                  >
                    ×
                  </button>
                </div>
                <div className="pop-row">
                  <span className="pop-currency">₺</span>
                  <input
                    className="pop-input pop-input-money"
                    inputMode="numeric"
                    value={cat.categoryLimit === 0 ? "" : String(cat.categoryLimit)}
                    onChange={(e) => updateLimit(i, e.target.value)}
                    placeholder="0"
                  />
                  <span className={`pop-cat-spent pop-tone-${tone}`}>
                    {formatTRY(cat.categorySpent)}
                  </span>
                </div>
                <ProgressBar spent={cat.categorySpent} limit={cat.categoryLimit} />
              </li>
            );
          })}
        </ul>

        {missingSuggestions.length > 0 && (
          <div className="pop-suggestions">
            <span className="pop-suggestions-label">Hızlı ekle:</span>
            {missingSuggestions.slice(0, 5).map((s) => (
              <button
                type="button"
                key={s}
                className="pop-suggestion"
                onClick={() => addCategory(s)}
              >
                + {s}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <div className="pop-error">{error}</div>}
      {savedAt && !error && <div className="pop-success">Kaydedildi.</div>}

      <button
        type="button"
        className="pop-save"
        onClick={save}
        disabled={saving}
      >
        {saving ? "Kaydediliyor…" : "Kaydet"}
      </button>

      <p className="pop-footer">
        Harcamalar, panelde <strong>Yine de Devam Et</strong>'e bastığında otomatik eklenir.
        Ayın başında otomatik sıfırlanır.
      </p>

      <DiagnosticsRow userId={userId} health={health} summary={summary} />
    </div>
  );
}

function DiagnosticsRow({
  userId,
  health,
  summary,
}: {
  userId: string | null;
  health: HealthStatus | null;
  summary: BudgetSummary | null;
}) {
  // Show a short installId fingerprint + backend/Gemini status so the user
  // can immediately spot two of the most common misconfigurations:
  //   - popup saving budget under a different installId than the content
  //     script sends (would manifest as "Bütçe Verisi Yok" after save)
  //   - backend reachable but GEMINI_API_KEY missing (review + decision
  //     fall back to heuristics, which the user may misread as a bug)
  const idTag = userId ? userId.slice(0, 8) : "—";
  let backendDot: "ok" | "warn" | "err" = "warn";
  let backendLabel = "Sunucu yoklanıyor…";
  if (health) {
    if (!health.online) { backendDot = "err"; backendLabel = `Sunucu yok (${health.error || "?"})`; }
    else if (health.gemini) { backendDot = "ok"; backendLabel = `Gemini açık · ${health.geminiModel || ""}`; }
    else { backendDot = "warn"; backendLabel = "Sunucu açık · Gemini KAPALI (heuristik mod)"; }
  }
  // Surface the actual persisted monthly limit the backend returned on
  // last refresh. If it's 0 here even though the user "saved" a budget,
  // the PUT didn't land on this userId — most likely an installId
  // mismatch with the content-script's analyze request.
  const persistedLine =
    summary && summary.monthlyLimit > 0
      ? `Kayıtlı: ₺${summary.monthlyLimit.toLocaleString("tr-TR")} / ay`
      : "Kayıtlı bütçe yok";
  return (
    <div className="pop-diag-wrap" title={userId ?? undefined}>
      <div className="pop-diag">
        <span className={`pop-diag-dot pop-diag-${backendDot}`} />
        <span className="pop-diag-label">{backendLabel}</span>
        <span className="pop-diag-id">ID·{idTag}</span>
      </div>
      <div className="pop-diag-sub">{persistedLine}</div>
    </div>
  );
}

function Header() {
  return (
    <header className="pop-header">
      <span className="pop-logo">
        <LogoMark size={22} />
      </span>
      <div className="pop-brand">
        <small>Thundrly</small>
        <strong>Bütçe ayarları</strong>
      </div>
    </header>
  );
}

function ProgressBar({ spent, limit }: { spent: number; limit: number }) {
  const p = pct(spent, limit);
  const tone = toneFor(p);
  return (
    <div className="pop-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div className={`pop-bar-fill pop-fill-${tone}`} style={{ width: `${p}%` }} />
    </div>
  );
}
