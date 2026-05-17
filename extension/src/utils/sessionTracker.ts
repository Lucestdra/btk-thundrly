/**
 * Live session telemetry for the AnalyzeRequest.session payload.
 *
 * What we measure (no analytics, no PII):
 *   - timeOnPageSeconds: seconds from content-script load to the click
 *     that triggers analysis. SPA navigations reset this.
 *   - clickSpeedMs: time between the most recent mousedown on a buy
 *     button and the corresponding click event. Short = impulsive.
 *   - currentHour: local-clock hour, integer 0-23.
 *   - purchasesToday: a counter stored in chrome.storage.local keyed by
 *     today's local date. Bumped externally via `markPurchase()` once
 *     the user actually completes a checkout (out of scope for V1 — the
 *     extension can't see that signal yet, so today's count is "the
 *     number of times the user clicked through the panel").
 *   - searchedBefore: true if this URL has been seen in a previous tab
 *     session within the last 7 days. Stored as a small LRU in
 *     chrome.storage.local.
 *
 * All fields degrade gracefully when chrome.storage isn't available
 * (e.g. unit tests, the landing page) — the tracker just returns the
 * fields it can measure synchronously.
 */

const PAGE_LOAD_MS = Date.now();
const MOUSEDOWN_TIMESTAMPS = new WeakMap<HTMLElement, number>();

import type { SessionContext } from "@shared/types";
import { onUrlChange } from "./urlWatcher";

const PURCHASES_KEY = "thundrly:purchases";
const SEEN_URLS_KEY = "thundrly:seen-urls";
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// SPA navigation resets the page-view timer.
let _pageBaseline = PAGE_LOAD_MS;
onUrlChange(() => {
  _pageBaseline = Date.now();
});

/**
 * Hook a buy button so we can measure the time between the user's
 * mousedown and the synthetic click event we re-fire. Cheap to call
 * many times — uses a WeakMap so detached buttons get GC'd.
 */
export function trackButtonForClickSpeed(btn: HTMLElement): void {
  if (MOUSEDOWN_TIMESTAMPS.has(btn)) return;
  // Capture-phase so we beat any handler that stops propagation.
  btn.addEventListener(
    "mousedown",
    () => MOUSEDOWN_TIMESTAMPS.set(btn, Date.now()),
    { capture: true, passive: true },
  );
}

function getClickSpeedMs(btn: HTMLElement | null): number {
  if (!btn) return 1000; // sensible default if we don't know
  const t = MOUSEDOWN_TIMESTAMPS.get(btn);
  if (!t) return 1000;
  const dt = Math.max(0, Date.now() - t);
  // Clamp; outliers above 30s are noise (user walked away mid-click).
  return Math.min(dt, 30_000);
}

function getTimeOnPageSeconds(): number {
  return Math.max(0, Math.round((Date.now() - _pageBaseline) / 1000));
}

function currentHour(): number {
  return new Date().getHours();
}

/** Today's date as a stable key, e.g. "2026-05-17" in local time. */
function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function readStorage<T>(key: string): Promise<T | undefined> {
  // chrome.storage is undefined in test envs (jsdom) and on the landing.
  if (typeof chrome === "undefined" || !chrome.storage?.local) return undefined;
  const out = await chrome.storage.local.get(key);
  return out?.[key] as T | undefined;
}

async function writeStorage(key: string, value: unknown): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [key]: value });
}

async function getPurchasesToday(): Promise<number> {
  const data = (await readStorage<Record<string, number>>(PURCHASES_KEY)) ?? {};
  return data[todayKey()] ?? 0;
}

/** Increment the local purchases-today counter; surface in next analyze. */
export async function markPurchase(): Promise<void> {
  const data = (await readStorage<Record<string, number>>(PURCHASES_KEY)) ?? {};
  // Trim stale day keys so the object stays small.
  const key = todayKey();
  const next: Record<string, number> = { [key]: (data[key] ?? 0) + 1 };
  await writeStorage(PURCHASES_KEY, next);
}

async function hasSeenUrlBefore(url: string): Promise<boolean> {
  if (!url) return false;
  const seen = (await readStorage<Record<string, number>>(SEEN_URLS_KEY)) ?? {};
  const now = Date.now();
  return Boolean(seen[url] && now - seen[url] < SEEN_TTL_MS);
}

async function recordUrlSeen(url: string): Promise<void> {
  if (!url) return;
  const seen = (await readStorage<Record<string, number>>(SEEN_URLS_KEY)) ?? {};
  const now = Date.now();
  // Trim entries older than TTL to keep the map small.
  for (const [k, t] of Object.entries(seen)) {
    if (now - t > SEEN_TTL_MS) delete seen[k];
  }
  seen[url] = now;
  await writeStorage(SEEN_URLS_KEY, seen);
}

/** Build the SessionContext for an AnalyzeRequest. */
export async function buildSessionContext(
  triggerButton: HTMLElement | null,
  url: string,
): Promise<SessionContext> {
  const [purchasesToday, searchedBefore] = await Promise.all([
    getPurchasesToday(),
    hasSeenUrlBefore(url),
  ]);
  // Fire and forget — record this view for future searchedBefore checks.
  void recordUrlSeen(url);

  return {
    timeOnPageSeconds: getTimeOnPageSeconds(),
    clickSpeedMs: getClickSpeedMs(triggerButton),
    currentHour: currentHour(),
    purchasesToday,
    searchedBefore,
  };
}
