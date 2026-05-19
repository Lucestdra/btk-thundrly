import type { Host } from "./domDetector";

export type PendingPurchase = {
  id: string;
  userId: string;
  category: string;
  amount: number;
  currency: "TRY";
  productUrl: string;
  title: string;
  host: Host;
  createdAt: number;
};

const PENDING_PURCHASE_KEY = "thundrly:pending-purchase";
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

function now(): number {
  return Date.now();
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pending-${now()}-${Math.random().toString(36).slice(2)}`;
}

async function readStorage<T>(key: string): Promise<T | undefined> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return undefined;
  const out = await chrome.storage.local.get(key);
  return out?.[key] as T | undefined;
}

async function writeStorage(key: string, value: unknown): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [key]: value });
}

async function removeStorage(key: string): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.remove(key);
}

export async function rememberPendingPurchase(input: Omit<PendingPurchase, "id" | "createdAt">): Promise<PendingPurchase> {
  const pending: PendingPurchase = {
    ...input,
    id: makeId(),
    createdAt: now(),
  };
  await writeStorage(PENDING_PURCHASE_KEY, pending);
  return pending;
}

export async function getPendingPurchase(): Promise<PendingPurchase | null> {
  const pending = await readStorage<PendingPurchase>(PENDING_PURCHASE_KEY);
  if (!pending) return null;
  if (now() - pending.createdAt > PENDING_TTL_MS) {
    await clearPendingPurchase();
    return null;
  }
  return pending;
}

export async function clearPendingPurchase(id?: string): Promise<void> {
  if (!id) {
    await removeStorage(PENDING_PURCHASE_KEY);
    return;
  }
  const pending = await readStorage<PendingPurchase>(PENDING_PURCHASE_KEY);
  if (!pending || pending.id === id) {
    await removeStorage(PENDING_PURCHASE_KEY);
  }
}

export function isCheckoutSuccessPage(host: Host, href: string, bodyText: string): boolean {
  if (host === "unknown" || host === "demo") return false;

  const haystack = normalize(`${href}\n${bodyText}`).slice(0, 80_000);
  const url = normalize(href);

  const strongTextMarkers = [
    "siparisiniz alindi",
    "siparisiniz olusturuldu",
    "siparisiniz tamamlandi",
    "siparisiniz onaylandi",
    "siparis alindi",
    "siparis tamamlandi",
    "siparis onaylandi",
    "odemeniz basariyla",
    "odeme basarili",
    "alisverisiniz tamamlandi",
    "thank you for your order",
    "order confirmed",
    "order complete",
    "order placed",
    "payment successful",
  ];
  if (strongTextMarkers.some((marker) => haystack.includes(marker))) {
    return true;
  }

  const urlMarkers = [
    "siparisiniz-alindi",
    "siparis-tamamlandi",
    "siparis-onay",
    "siparis-basarili",
    "odeme-basarili",
    "payment-success",
    "checkout-success",
    "order-success",
    "order-confirmation",
    "order-complete",
    "order-received",
    "thank-you",
    "thankyou",
    "tesekkur",
  ];
  const urlLooksSuccessful =
    urlMarkers.some((marker) => url.includes(marker)) ||
    /(?:checkout|order|siparis|odeme|payment)[/?#&=_-]+(?:success|complete|confirmation|received|basarili|tamamlandi|onay|sonuc)/.test(url);
  if (!urlLooksSuccessful) return false;

  return (
    haystack.includes("siparis") ||
    haystack.includes("odeme") ||
    haystack.includes("order") ||
    haystack.includes("payment")
  );
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/İ/g, "i")
    .replace(/\s+/g, " ");
}
