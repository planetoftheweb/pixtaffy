const TTL_MS = 10 * 60 * 1000;
const STORAGE_KEY = 'pixtaffy.assistRequestKeys';
const retryableCodes = new Set([
  'functions/unavailable', 'functions/deadline-exceeded', 'functions/internal',
  'functions/resource-exhausted', 'functions/already-exists', 'functions/aborted',
]);
type Entry = { key: string; createdAt: number };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

// Normalize JSON values before sorting so omitted fields and toJSON match the wire payload.
function canonicalJson(value: unknown): string {
  const sort = (item: any): any => Array.isArray(item) ? item.map(sort)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}

export function createAssistRequestKeys(
  storage: () => StorageLike | undefined = () => globalThis.sessionStorage,
  now: () => number = Date.now,
) {
  const entries = new Map<string, Entry>();
  try {
    const saved = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '{}');
    for (const [fingerprint, entry] of Object.entries(saved)) {
      const value = entry as Entry;
      if (/^[a-f0-9]{64}$/.test(fingerprint) && typeof value?.key === 'string'
        && Number.isFinite(value.createdAt) && now() - value.createdAt < TTL_MS) {
        entries.set(fingerprint, { key: value.key, createdAt: value.createdAt });
      }
    }
  } catch { /* Storage is optional in private browsing. */ }
  const persist = () => {
    for (const [fingerprint, entry] of entries) {
      if (now() - entry.createdAt >= TTL_MS) entries.delete(fingerprint);
    }
    try { storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries))); }
    catch { /* Keep the in-memory retry key if storage is unavailable. */ }
  };
  return {
    async acquire(action: string, payload: Record<string, unknown>, mint: () => string) {
      const bytes = new TextEncoder().encode(canonicalJson([action, payload]));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      let entry = entries.get(fingerprint);
      if (!entry || now() - entry.createdAt >= TTL_MS) {
        entry = { key: mint(), createdAt: now() };
        entries.set(fingerprint, entry);
      }
      persist();
      return { fingerprint, key: entry.key };
    },
    finish(request: { fingerprint: string; key: string }, outcome: { error: unknown } | { success: true }) {
      const code = 'error' in outcome ? (outcome.error as { code?: unknown } | null)?.code : undefined;
      if ('error' in outcome && (code == null || retryableCodes.has(String(code)))) return;
      if (entries.get(request.fingerprint)?.key === request.key) entries.delete(request.fingerprint);
      persist();
    },
  };
}

export const assistRequestKeys = createAssistRequestKeys();
