/**
 * SPA navigation watcher.
 *
 * Trendyol, Hepsiburada, N11 are all SPAs — clicking a product from a
 * listing changes the URL via `history.pushState` without a full page
 * reload, so the content_scripts entry never re-runs. This module wraps
 * `pushState` / `replaceState` to dispatch a custom event, and also
 * listens for `popstate` (back/forward navigation). Subscribers are
 * called with the new URL whenever it actually changes.
 *
 * Idempotent: install() is safe to call multiple times — the original
 * functions are only wrapped once.
 */

const NAV_EVENT = "tarti:navigation";
const INSTALLED_FLAG = "__tartiUrlWatcherInstalled__";

let currentUrl = location.href;

interface InstalledWindow extends Window {
  [INSTALLED_FLAG]?: boolean;
}

function _maybeEmit() {
  if (location.href === currentUrl) return;
  const prev = currentUrl;
  currentUrl = location.href;
  window.dispatchEvent(
    new CustomEvent<{ from: string; to: string }>(NAV_EVENT, {
      detail: { from: prev, to: currentUrl },
    }),
  );
}

function install() {
  const w = window as InstalledWindow;
  if (w[INSTALLED_FLAG]) return;
  w[INSTALLED_FLAG] = true;

  const origPushState = history.pushState.bind(history);
  history.pushState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    origPushState(data, unused, url);
    _maybeEmit();
  };

  const origReplaceState = history.replaceState.bind(history);
  history.replaceState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    origReplaceState(data, unused, url);
    _maybeEmit();
  };

  window.addEventListener("popstate", _maybeEmit);
  // hashchange covers some legacy SPA patterns.
  window.addEventListener("hashchange", _maybeEmit);
}

/**
 * Subscribe to URL changes. Returns an unsubscribe function. Installing
 * the watcher is a side effect of the first subscription.
 */
export function onUrlChange(handler: (to: string, from: string) => void): () => void {
  install();
  const listener = (e: Event) => {
    const ce = e as CustomEvent<{ from: string; to: string }>;
    handler(ce.detail.to, ce.detail.from);
  };
  window.addEventListener(NAV_EVENT, listener);
  return () => window.removeEventListener(NAV_EVENT, listener);
}

/** Current URL as the watcher sees it (matches `location.href` when no
 *  pending navigation is in flight). */
export function getWatchedUrl(): string {
  return currentUrl;
}
