/**
 * Stable per-install identifier.
 *
 * Stored once in `chrome.storage.local` on first read; reused for every
 * subsequent request. The value is an opaque random UUID — no PII, no
 * device fingerprinting. The backend uses it to key budget rows and
 * (eventually) personal observation history.
 *
 * Falls back to "demo-user" when chrome.storage isn't available (jsdom
 * tests, landing page) so callers don't need to special-case test envs.
 */

const STORAGE_KEY = "thundrly:installId";

function _randomId(): string {
  // Prefer crypto.randomUUID where available (Chrome 92+, all MV3 envs).
  const c: { randomUUID?: () => string } | undefined = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback — non-cryptographic, OK for an anonymous installId.
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

let _cached: string | null = null;

export async function getInstallId(): Promise<string> {
  if (_cached) return _cached;

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    // jsdom, landing, or test env — return a stable demo id without
    // touching storage so the call is synchronous-friendly.
    _cached = "demo-user";
    return _cached;
  }

  const got = await chrome.storage.local.get(STORAGE_KEY);
  let id = got?.[STORAGE_KEY] as string | undefined;
  if (!id) {
    id = _randomId();
    await chrome.storage.local.set({ [STORAGE_KEY]: id });
  }
  _cached = id;
  return id;
}

/** For tests — wipe the in-memory cache so the next call re-reads. */
export function resetInstallIdCache(): void {
  _cached = null;
}
