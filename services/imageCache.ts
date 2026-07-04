// IndexedDB-backed blob cache for generated images.
//
// Why this exists:
//   Release 0.6.0 moved raster bytes out of Firestore into Firebase Storage to
//   keep the per-doc payload below 1 MiB. After upload, `imageData` (base64)
//   is stripped from the saved generation, so the only surviving pointer is
//   the Storage download URL. When a network blocks `firebasestorage.googleapis.com`
//   (e.g. VPN/corporate proxy), every history thumbnail and the main preview
//   render as broken `<img>` because there is nothing to fall back to.
//
//   This cache keeps a copy of the raw image bytes on the device so the
//   `onError` fallback can still produce a blob URL. We deliberately use
//   IndexedDB (not localStorage) because:
//     - localStorage is capped near 5 MB and stores strings (base64 wastes ~33%).
//     - We need to survive reloads, so SessionStorage / in-memory won't do.
//     - IndexedDB stores native Blob objects so we get free zero-copy reuse.
//
// Capacity guard:
//   We keep the cache bounded by total bytes (CACHE_BUDGET_BYTES). When the
//   budget is exceeded, the oldest entries (by `cachedAt`) are evicted.

const DB_NAME = 'brandoit_image_cache_v1';
const STORE_NAME = 'images';
const DB_VERSION = 1;
const CACHE_BUDGET_BYTES = 200 * 1024 * 1024; // 200 MB total
const BACKFILL_CONCURRENCY = 3;
const BACKFILL_TIMEOUT_MS = 12_000;

export interface CachedImageRecord {
  key: string;
  generationId: string;
  versionId: string;
  blob: Blob;
  mimeType: string;
  size: number;
  cachedAt: number;
}

export const buildImageCacheKey = (generationId: string, versionId: string): string =>
  `${generationId}|${versionId}`;

// Reserved namespace prefix for cache keys that don't belong to a generation.
// Anything starting with `__` is treated as off-limits to history-driven prune
// passes so per-user assets (profile photos, etc.) survive history changes.
const RESERVED_KEY_PREFIX = '__';

export const buildProfileImageCacheKey = (userId: string): string =>
  `__profile__|${userId}`;

const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (!isBrowser()) {
    return Promise.reject(new Error('IndexedDB not available in this environment'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('cachedAt', 'cachedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open image cache DB'));
    request.onblocked = () => {
      // Another tab is holding an old version open. Reject so callers fall
      // back to a no-op; the next page load will retry cleanly.
      reject(new Error('Image cache DB upgrade blocked by another tab'));
    };
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
};

const promisifyRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });

const stripDataUrlPrefix = (base64Data: string): string => {
  const match = base64Data.match(/^data:[^,]+,(.+)$/i);
  return (match ? match[1] : base64Data).replace(/\s+/g, '');
};

const base64ToBlob = (base64Data: string, mimeType: string): Blob => {
  const cleanBase64 = stripDataUrlPrefix(base64Data);
  const binary = atob(cleanBase64);
  const chunkSize = 8192;
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) {
      bytes[i] = slice.charCodeAt(i);
    }
    chunks.push(bytes);
  }
  return new Blob(chunks, { type: mimeType || 'application/octet-stream' });
};

// Best-effort write. Never throws — callers don't want a cache hiccup to
// break the surrounding save/upload pipeline.
export const cacheImageBlob = async (
  generationId: string,
  versionId: string,
  blob: Blob
): Promise<void> => {
  if (!isBrowser() || !generationId || !versionId || !blob || blob.size === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: CachedImageRecord = {
      key: buildImageCacheKey(generationId, versionId),
      generationId,
      versionId,
      blob,
      mimeType: blob.type || 'image/webp',
      size: blob.size,
      cachedAt: Date.now()
    };
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Cache write failed'));
      tx.onabort = () => reject(tx.error || new Error('Cache write aborted'));
    });
    // Fire-and-forget capacity enforcement.
    void enforceBudget();
  } catch (error) {
    console.warn('[imageCache] Failed to cache image blob:', error);
  }
};

export const cacheImageFromBase64 = async (
  generationId: string,
  versionId: string,
  base64Data: string,
  mimeType: string
): Promise<void> => {
  if (!base64Data?.trim()) return;
  try {
    const blob = base64ToBlob(base64Data, mimeType || 'image/webp');
    await cacheImageBlob(generationId, versionId, blob);
  } catch (error) {
    console.warn('[imageCache] Failed to convert base64 for cache:', error);
  }
};

export const getCachedImageBlob = async (
  generationId: string,
  versionId: string
): Promise<Blob | null> => {
  if (!isBrowser() || !generationId || !versionId) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const record = await promisifyRequest<CachedImageRecord | undefined>(
      store.get(buildImageCacheKey(generationId, versionId))
    );
    return record?.blob || null;
  } catch (error) {
    console.warn('[imageCache] Failed to read cached image:', error);
    return null;
  }
};

// Returns a fresh `blob:` object URL. The caller is responsible for revoking
// the URL when it stops being used (e.g. on unmount or when the version
// changes). If nothing is cached, returns null.
export const getCachedImageBlobUrl = async (
  generationId: string,
  versionId: string
): Promise<string | null> => {
  const blob = await getCachedImageBlob(generationId, versionId);
  if (!blob) return null;
  try {
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn('[imageCache] Failed to create object URL:', error);
    return null;
  }
};

export const removeCachedImage = async (
  generationId: string,
  versionId: string
): Promise<void> => {
  if (!isBrowser() || !generationId || !versionId) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(buildImageCacheKey(generationId, versionId));
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (error) {
    console.warn('[imageCache] Failed to remove cached image:', error);
  }
};

// Remove every cache entry that belongs to a given generation. Used when a
// whole generation is deleted from history.
export const removeCachedGeneration = async (generationId: string): Promise<void> => {
  if (!isBrowser() || !generationId) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const keysRequest = store.getAllKeys();
    const allKeys = (await promisifyRequest(keysRequest)) as string[];
    const prefix = `${generationId}|`;
    allKeys.filter((key) => typeof key === 'string' && key.startsWith(prefix))
      .forEach((key) => store.delete(key));
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (error) {
    console.warn('[imageCache] Failed to remove cached generation:', error);
  }
};

// Drop any cache entry that no longer corresponds to an active history item.
// `activeKeys` should contain `${generationId}|${versionId}` for every version
// currently in the user's history. Reserved namespace keys (profile photos,
// etc.) are preserved unconditionally so unrelated subsystems don't accidentally
// nuke each other's cached blobs. Best-effort.
export const pruneCacheToActiveKeys = async (activeKeys: Set<string>): Promise<void> => {
  if (!isBrowser()) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const allKeys = (await promisifyRequest(store.getAllKeys())) as string[];
    const stale = allKeys.filter(
      (key) =>
        typeof key === 'string' &&
        !key.startsWith(RESERVED_KEY_PREFIX) &&
        !activeKeys.has(key)
    );
    stale.forEach((key) => store.delete(key));
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (error) {
    console.warn('[imageCache] Failed to prune cache:', error);
  }
};

// Generic key-based variants. Used for non-generation assets like profile
// photos, where the call site supplies a stable cache key (e.g. via
// `buildProfileImageCacheKey`).
export const cacheBlobByKey = async (key: string, blob: Blob): Promise<void> => {
  if (!isBrowser() || !key || !blob || blob.size === 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: CachedImageRecord = {
      key,
      generationId: '',
      versionId: '',
      blob,
      mimeType: blob.type || 'image/jpeg',
      size: blob.size,
      cachedAt: Date.now()
    };
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Cache write failed'));
      tx.onabort = () => reject(tx.error || new Error('Cache write aborted'));
    });
    void enforceBudget();
  } catch (error) {
    console.warn('[imageCache] Failed to cache blob by key:', error);
  }
};

export const getCachedBlobByKey = async (key: string): Promise<Blob | null> => {
  if (!isBrowser() || !key) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const record = await promisifyRequest<CachedImageRecord | undefined>(
      tx.objectStore(STORE_NAME).get(key)
    );
    return record?.blob || null;
  } catch (error) {
    console.warn('[imageCache] Failed to read cached blob by key:', error);
    return null;
  }
};

export const getCachedBlobUrlByKey = async (key: string): Promise<string | null> => {
  const blob = await getCachedBlobByKey(key);
  if (!blob) return null;
  try {
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn('[imageCache] Failed to create object URL by key:', error);
    return null;
  }
};

const cachedKeysSnapshot = async (): Promise<Set<string>> => {
  if (!isBrowser()) return new Set();
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const allKeys = (await promisifyRequest(tx.objectStore(STORE_NAME).getAllKeys())) as string[];
    return new Set(allKeys);
  } catch {
    return new Set();
  }
};

// Single-key backfill. If the URL is reachable (no VPN block, CORS ok, etc.)
// the blob is stashed under `key`. Idempotent and de-duplicated per key.
const inflightBackfillsByKey = new Map<string, Promise<void>>();

export const backfillBlobByKey = (key: string, url: string): Promise<void> => {
  if (!isBrowser() || !key || !url || !/^https?:/i.test(url)) return Promise.resolve();
  const existing = inflightBackfillsByKey.get(key);
  if (existing) return existing;

  const work = (async () => {
    try {
      const cached = await cachedKeysSnapshot();
      if (cached.has(key)) return;
      const response = await fetchWithTimeout(url, BACKFILL_TIMEOUT_MS);
      if (!response.ok) return;
      const blob = await response.blob();
      if (blob.size === 0) return;
      await cacheBlobByKey(key, blob);
    } catch {
      // VPN block / CORS / network drop — silently skip. Next session retries.
    } finally {
      inflightBackfillsByKey.delete(key);
    }
  })();

  inflightBackfillsByKey.set(key, work);
  return work;
};

// Evict oldest entries until total `size` falls below CACHE_BUDGET_BYTES.
const enforceBudget = async (): Promise<void> => {
  if (!isBrowser()) return;
  try {
    const db = await openDb();
    const readTx = db.transaction(STORE_NAME, 'readonly');
    const records = (await promisifyRequest(readTx.objectStore(STORE_NAME).getAll())) as CachedImageRecord[];
    const totalBytes = records.reduce((sum, r) => sum + (r.size || 0), 0);
    if (totalBytes <= CACHE_BUDGET_BYTES) return;

    const sorted = [...records].sort((a, b) => (a.cachedAt || 0) - (b.cachedAt || 0));
    let remaining = totalBytes;
    const toDelete: string[] = [];
    for (const record of sorted) {
      if (remaining <= CACHE_BUDGET_BYTES) break;
      toDelete.push(record.key);
      remaining -= record.size || 0;
    }
    if (toDelete.length === 0) return;

    const writeTx = db.transaction(STORE_NAME, 'readwrite');
    const writeStore = writeTx.objectStore(STORE_NAME);
    toDelete.forEach((key) => writeStore.delete(key));
    await new Promise<void>((resolve) => {
      writeTx.oncomplete = () => resolve();
      writeTx.onerror = () => resolve();
      writeTx.onabort = () => resolve();
    });
  } catch (error) {
    console.warn('[imageCache] Failed to enforce cache budget:', error);
  }
};

export interface BackfillTarget {
  generationId: string;
  versionId: string;
  imageUrl: string;
}

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
  } finally {
    clearTimeout(timer);
  }
};

const filterUncachedTargets = async (targets: BackfillTarget[]): Promise<BackfillTarget[]> => {
  if (!isBrowser() || targets.length === 0) return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const allKeys = (await promisifyRequest(store.getAllKeys())) as string[];
    const cached = new Set(allKeys);
    return targets.filter((target) => !cached.has(buildImageCacheKey(target.generationId, target.versionId)));
  } catch (error) {
    console.warn('[imageCache] Failed to inspect cache for backfill:', error);
    return targets;
  }
};

const getBackfillTargetKey = (target: BackfillTarget): string =>
  buildImageCacheKey(target.generationId, target.versionId);

// Best-effort background fetch of any history image whose bytes aren't in
// IndexedDB yet. Idempotent and rate-limited so concurrent calls (e.g. from
// repeated `getHistory` invocations during the session) don't pile up. New
// targets requested while a run is active are queued for the same run instead
// of being dropped.
let backfillInFlight: Promise<void> | null = null;
const pendingBackfillTargets = new Map<string, BackfillTarget>();

export const backfillImageCache = (targets: BackfillTarget[]): Promise<void> => {
  if (!isBrowser()) return Promise.resolve();
  targets
    .filter((target) => target.imageUrl && /^https?:/i.test(target.imageUrl))
    .forEach((target) => pendingBackfillTargets.set(getBackfillTargetKey(target), target));
  if (backfillInFlight) return backfillInFlight;

  backfillInFlight = (async () => {
    try {
      while (pendingBackfillTargets.size > 0) {
        const batch = Array.from(pendingBackfillTargets.values());
        pendingBackfillTargets.clear();
        const uncached = await filterUncachedTargets(batch);
        if (uncached.length === 0) continue;

        let cursor = 0;
        const worker = async () => {
          while (cursor < uncached.length) {
            const index = cursor;
            cursor += 1;
            const target = uncached[index];
            try {
              const response = await fetchWithTimeout(target.imageUrl, BACKFILL_TIMEOUT_MS);
              if (!response.ok) continue;
              const blob = await response.blob();
              if (blob.size === 0) continue;
              await cacheImageBlob(target.generationId, target.versionId, blob);
            } catch {
              // VPN block, network drop, CORS — silently skip. We'll try again
              // next session.
            }
          }
        };

        const workers = Array.from(
          { length: Math.min(BACKFILL_CONCURRENCY, uncached.length) },
          () => worker()
        );
        await Promise.all(workers);
      }
    } finally {
      backfillInFlight = null;
    }
  })();

  return backfillInFlight;
};
