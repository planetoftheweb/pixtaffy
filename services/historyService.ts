import { db } from "./firebase";
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  getDocs, 
  deleteDoc,
  doc,
  updateDoc,
  where,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData
} from "firebase/firestore";
import { User, Generation, GenerationVersion, GeneratedImage, GenerationConfig, INBOX_FOLDER_ID } from "../types";
import { toMarkLabel } from "./versionUtils";
import { convertToWebP, makeImageUrl } from "./imageConversionService";
import { deleteGenerationImages, uploadGenerationImage } from "./imageService";
import {
  backfillImageCache,
  cacheImageFromBase64,
  pruneCacheToActiveKeys,
  removeCachedGeneration,
  buildImageCacheKey
} from "./imageCache";

const LOCAL_STORAGE_KEY = 'brandoit_generations_v2';
const LEGACY_STORAGE_KEY = 'brandoit_history';
const MERGE_BACKUP_KEY = 'brandoit_generations_merge_backup_v1';
const USER_REMOTE_CACHE_KEY_PREFIX = 'brandoit_remote_history_cache_v1';
const LOCAL_LIMIT = 20;
const REMOTE_LIMIT = 20;
const REMOTE_SCAN_LIMIT = REMOTE_LIMIT * 3;
/** Admins keep full Firestore history; fetch in pages (Firestore query limits). */
const ADMIN_REMOTE_PAGE_SIZE = 200;
/** Cap for the per-user localStorage mirror of remote history (admins only). */
const ADMIN_REMOTE_CACHE_LIMIT = 2000;
const MAX_REMOTE_DOC_BYTES = 980_000; // Keep below Firestore 1 MiB per-doc hard limit.
const EMPTY_CONFIG: GenerationConfig = {
  prompt: '',
  colorSchemeId: '',
  visualStyleId: '',
  graphicTypeId: '',
  aspectRatio: ''
};

const generateId = (): string => `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const getUserRemoteCacheKey = (userId: string): string =>
  `${USER_REMOTE_CACHE_KEY_PREFIX}:${userId}`;

const stripUndefined = (obj: Record<string, any>): Record<string, any> =>
  JSON.parse(JSON.stringify(obj));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const getApproxBytes = (value: unknown): number => {
  try {
    const json = JSON.stringify(value) || '';
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const normalizeVersion = (
  generationId: string,
  generationCreatedAt: number,
  version: Partial<GenerationVersion>,
  index: number,
  fallbackAspectRatio?: string
): GenerationVersion => {
  const number = isFiniteNumber(version.number) ? version.number : index + 1;
  const mimeType = version.mimeType || 'image/webp';
  const imageData = version.imageData || '';
  const imageUrl = version.imageUrl || (imageData ? makeImageUrl(imageData, mimeType) : '');
  const timestamp = isFiniteNumber(version.timestamp) ? version.timestamp : generationCreatedAt;

  return {
    id: version.id || `v-${generationId}-${number}`,
    number,
    label: version.label || toMarkLabel(number),
    timestamp,
    type: version.type || (number === 1 ? 'generation' : 'refinement'),
    imageData,
    imageUrl,
    imageStoragePath: version.imageStoragePath,
    mimeType,
    aspectRatio: version.aspectRatio || fallbackAspectRatio,
    svgCode: version.svgCode,
    refinementPrompt: version.refinementPrompt,
    parentVersionId: version.parentVersionId,
    modelId: version.modelId,
  };
};

const normalizeGeneration = (input: Partial<Generation>): Generation => {
  const id = input.id || generateId();
  const createdAt = isFiniteNumber(input.createdAt) ? input.createdAt : Date.now();
  const config = input.config || EMPTY_CONFIG;
  const fallbackAspectRatio = config.aspectRatio;
  const rawVersions = Array.isArray(input.versions) ? input.versions : [];
  const safeVersions = (rawVersions.length > 0
    ? rawVersions.map((version, index) => normalizeVersion(id, createdAt, version, index, fallbackAspectRatio))
    : [
        normalizeVersion(
          id,
          createdAt,
          {
            id: `v-${id}-1`,
            number: 1,
            label: toMarkLabel(1),
            timestamp: createdAt,
            type: 'generation',
            imageData: '',
            imageUrl: '',
            mimeType: 'image/webp',
            aspectRatio: fallbackAspectRatio
          },
          0,
          fallbackAspectRatio
        )
      ]).sort((a, b) => (a.number - b.number) || (a.timestamp - b.timestamp));

  const indexRaw = isFiniteNumber(input.currentVersionIndex)
    ? input.currentVersionIndex
    : safeVersions.length - 1;
  const currentVersionIndex = Math.min(Math.max(0, indexRaw), safeVersions.length - 1);

  // Validate `starredVersionId` against the surviving version ids — if a
  // previously-starred Mark was later deleted, drop the dangling reference
  // so the prev/next-starred navigation never lands on a ghost version.
  const incomingStarred = typeof input.starredVersionId === 'string' ? input.starredVersionId : undefined;
  const starredVersionId = incomingStarred && safeVersions.some((v) => v.id === incomingStarred)
    ? incomingStarred
    : undefined;

  return {
    id,
    createdAt,
    config,
    modelId: input.modelId || 'gemini',
    versions: safeVersions,
    currentVersionIndex,
    comparisonBatchId: input.comparisonBatchId,
    // Legacy generations (saved before folders existed) land in Inbox so the
    // folder-tab gallery can group every tile without losing anything.
    folderId: typeof input.folderId === 'string' && input.folderId.length > 0
      ? input.folderId
      : INBOX_FOLDER_ID,
    ...(starredVersionId ? { starredVersionId } : {}),
  };
};

const mergeVersions = (left: GenerationVersion, right: GenerationVersion): GenerationVersion => {
  const merged: GenerationVersion = {
    ...left,
    ...right,
    imageData: right.imageData || left.imageData || '',
    mimeType: right.mimeType || left.mimeType || 'image/webp',
    imageStoragePath: right.imageStoragePath || left.imageStoragePath,
    svgCode: right.svgCode || left.svgCode,
    refinementPrompt: right.refinementPrompt || left.refinementPrompt,
    parentVersionId: right.parentVersionId || left.parentVersionId,
    aspectRatio: right.aspectRatio || left.aspectRatio,
    type: right.type || left.type || 'generation',
  };

  if (!merged.imageUrl) {
    merged.imageUrl = merged.imageData ? makeImageUrl(merged.imageData, merged.mimeType) : '';
  }
  if (!merged.label) {
    merged.label = toMarkLabel(merged.number);
  }

  return merged;
};

const getVersionMergeKey = (version: GenerationVersion, index: number): string => {
  if (version.id) return `id:${version.id}`;
  return `meta:${version.number || index + 1}:${version.timestamp || 0}:${version.type || 'generation'}`;
};

const mergeGenerationPair = (left: Generation, right: Generation): Generation => {
  const primary = left.createdAt >= right.createdAt ? left : right;
  const secondary = primary === left ? right : left;

  const versionMap = new Map<string, GenerationVersion>();
  const ingest = (source: Generation) => {
    source.versions.forEach((version, index) => {
      const key = getVersionMergeKey(version, index);
      const existing = versionMap.get(key);
      versionMap.set(key, existing ? mergeVersions(existing, version) : version);
    });
  };

  ingest(left);
  ingest(right);

  const versions = Array.from(versionMap.values())
    .map((version, index) => normalizeVersion(primary.id, primary.createdAt, version, index, primary.config?.aspectRatio))
    .sort((a, b) => (a.number - b.number) || (a.timestamp - b.timestamp));

  const preferredCurrent = primary.versions[primary.currentVersionIndex] || primary.versions[primary.versions.length - 1];
  const currentById = preferredCurrent
    ? versions.findIndex((version) => version.id === preferredCurrent.id)
    : -1;
  const currentVersionIndex = currentById >= 0 ? currentById : Math.max(0, versions.length - 1);

  return {
    ...secondary,
    ...primary,
    versions,
    currentVersionIndex
  };
};

// Walks the merged history once, prunes any cache entry whose generation/version
// is no longer present, then kicks the (rate-limited) backfill so any version
// missing local bytes is re-downloaded while the network is healthy. Designed
// to run after every `getHistory` so old generations recover their cache the
// next time the user is off the blocked network.
const primeImageCacheForHistory = (history: Generation[]): void => {
  try {
    const activeKeys = new Set<string>();
    const backfillTargets: { generationId: string; versionId: string; imageUrl: string }[] = [];
    for (const generation of history) {
      for (const version of generation.versions) {
        if (!version.id) continue;
        activeKeys.add(buildImageCacheKey(generation.id, version.id));
        const imageUrl = version.imageUrl;
        // Only chase real http(s) downloads — data: URLs already carry their
        // bytes inline and SVG-only versions have no raster to cache.
        if (imageUrl && /^https?:/i.test(imageUrl) && version.mimeType !== 'image/svg+xml') {
          backfillTargets.push({
            generationId: generation.id,
            versionId: version.id,
            imageUrl
          });
        }
      }
    }
    void pruneCacheToActiveKeys(activeKeys);
    if (backfillTargets.length > 0) {
      void backfillImageCache(backfillTargets);
    }
  } catch (error) {
    console.warn('[historyService] Failed to prime image cache:', error);
  }
};

const mergeGenerationCollections = (
  collections: Generation[][],
  maxItems?: number
): Generation[] => {
  const byId = new Map<string, Generation>();

  for (const collection of collections) {
    for (const raw of collection) {
      const generation = normalizeGeneration(raw);
      const existing = byId.get(generation.id);
      byId.set(generation.id, existing ? mergeGenerationPair(existing, generation) : generation);
    }
  }

  const sorted = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
  return maxItems === undefined ? sorted : sorted.slice(0, maxItems);
};

const getRemoteCacheCap = (isAdmin: boolean): number =>
  isAdmin ? ADMIN_REMOTE_CACHE_LIMIT : REMOTE_LIMIT;

/** Metadata-only mirror for localStorage — raster bytes live in Storage + IndexedDB. */
const stripGenerationForStorageMirror = (generation: Generation): Generation => {
  const normalized = normalizeGeneration(generation);
  return {
    ...normalized,
    versions: normalized.versions.map((version) => ({
      ...version,
      imageData: '',
    })),
  };
};

const readJsonArray = (key: string): unknown[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeJsonArray = (key: string, values: unknown[]) => {
  const attempt = (items: unknown[]) => {
    localStorage.setItem(key, JSON.stringify(items));
  };
  try {
    attempt(values);
  } catch (error) {
    const isQuota =
      error instanceof DOMException && error.name === 'QuotaExceededError';
    if (!isQuota) {
      console.error(`Failed to write storage key ${key}:`, error);
      return;
    }
    // History caches are newest-first — drop oldest entries until something fits.
    for (let keep = values.length - 1; keep >= 1; keep -= Math.max(1, Math.ceil(keep / 4))) {
      try {
        attempt(values.slice(0, keep));
        console.warn(`[historyService] Trimmed ${key} to ${keep} items after quota exceeded.`);
        return;
      } catch {
        // keep shrinking
      }
    }
    console.warn(`[historyService] Dropped write to ${key} — localStorage quota exceeded.`);
  }
};

const readMergeBackup = (): Generation[] =>
  readJsonArray(MERGE_BACKUP_KEY)
    .map((item) => normalizeGeneration(item as Partial<Generation>))
    .slice(0, LOCAL_LIMIT);

const readUserRemoteCache = (userId: string, isAdmin: boolean): Generation[] =>
  readJsonArray(getUserRemoteCacheKey(userId))
    .map((item) => normalizeGeneration(item as Partial<Generation>))
    .slice(0, getRemoteCacheCap(isAdmin));

const writeUserRemoteCache = (userId: string, history: Generation[], isAdmin: boolean) => {
  const slim = history
    .slice(0, getRemoteCacheCap(isAdmin))
    .map(stripGenerationForStorageMirror);
  writeJsonArray(getUserRemoteCacheKey(userId), slim);
};

const upsertUserRemoteCache = (userId: string, generation: Generation, isAdmin: boolean) => {
  const merged = mergeGenerationCollections(
    [readUserRemoteCache(userId, isAdmin), [generation]],
    getRemoteCacheCap(isAdmin)
  );
  writeUserRemoteCache(userId, merged, isAdmin);
};

// Remove a single generation from the per-user remote cache so it cannot
// resurrect itself the next time `getHistory` merges remote + cache. Without
// this scrub a deleted item is removed from Firestore but pulled back in from
// the cache and re-written, making delete look like a no-op to the user.
const removeFromUserRemoteCache = (userId: string, generationId: string, isAdmin: boolean) => {
  const filtered = readUserRemoteCache(userId, isAdmin).filter((gen) => gen.id !== generationId);
  writeUserRemoteCache(userId, filtered, isAdmin);
};

// Remove a single generation from the merge backup so a tombstoned item never
// reappears via the recovery-from-backup path inside `getHistory`.
const removeFromMergeBackup = (generationId: string) => {
  try {
    const current = readMergeBackup();
    const filtered = current.filter((gen) => gen.id !== generationId);
    writeJsonArray(MERGE_BACKUP_KEY, filtered);
  } catch (e) {
    console.error('Failed to scrub merge backup:', e);
  }
};

const serializeGenerationForRemote = async (
  userId: string,
  generation: Generation
): Promise<Record<string, any>> => {
  const normalized = normalizeGeneration(generation);
  const remoteVersions = await Promise.all(
    normalized.versions.map(async (version) => {
      if (version.mimeType === 'image/svg+xml') {
        return {
          ...version,
          imageUrl: undefined
        };
      }

      if (!version.imageData) {
        return version;
      }

      // VPN-SAFETY: Stash the raw bytes in IndexedDB BEFORE the upload attempt.
      // If `firebasestorage.googleapis.com` is blocked (VPN/proxy/captive portal),
      // `uploadGenerationImage` will throw and the code after it never runs.
      // By caching first, the image survives future VPN sessions even when the
      // Firebase Storage upload fails. Await this local write so cloud sync
      // never strips `imageData` before the durable local fallback exists.
      await cacheImageFromBase64(
        normalized.id,
        version.id,
        version.imageData,
        version.mimeType || 'image/webp'
      );

      const uploaded = await uploadGenerationImage({
        userId,
        generationId: normalized.id,
        versionId: version.id,
        base64Data: version.imageData,
        mimeType: version.mimeType || 'image/webp'
      });

      return {
        ...version,
        imageData: '',
        imageUrl: uploaded.downloadUrl,
        imageStoragePath: uploaded.path
      };
    })
  );

  // Raster bytes live in Firebase Storage. Firestore keeps only the generation
  // metadata plus Storage download URL/path to stay below the 1 MiB doc limit.
  const withRemoteVersionWindow = (startIndex: number): Record<string, any> => {
    const windowedVersions = remoteVersions.slice(startIndex);
    const adjustedCurrent = Math.max(0, normalized.currentVersionIndex - startIndex);

    return {
      ...normalized,
      versions: windowedVersions,
      currentVersionIndex: adjustedCurrent,
      remoteTotalVersions: normalized.versions.length,
      remoteVersionOffset: startIndex
    };
  };

  let startIndex = 0;
  let payload = withRemoteVersionWindow(startIndex);
  let payloadBytes = getApproxBytes(payload);

  // If the payload breaches Firestore's per-doc limit, progressively drop oldest
  // versions from cloud storage while preserving the full chain locally.
  while (payloadBytes > MAX_REMOTE_DOC_BYTES && startIndex < normalized.versions.length - 1) {
    startIndex += 1;
    payload = withRemoteVersionWindow(startIndex);
    payloadBytes = getApproxBytes(payload);
  }

  if (payloadBytes > MAX_REMOTE_DOC_BYTES) {
    throw new Error(
      `Cloud history limit reached (${Math.round(payloadBytes / 1024)}KB). This image version is too large to sync to cloud.`
    );
  }

  if (startIndex > 0) {
    payload.remoteTrimmedVersions = startIndex;
  }

  return stripUndefined(payload);
};

const hydrateGenerationFromRemote = (docId: string, data: any): Generation => {
  return normalizeGeneration({
    id: data.id || docId,
    createdAt: data.createdAt || Date.now(),
    config: data.config || EMPTY_CONFIG,
    modelId: data.modelId || 'gemini',
    versions: Array.isArray(data.versions) ? data.versions : [],
    currentVersionIndex: data.currentVersionIndex,
    comparisonBatchId: data.comparisonBatchId,
    folderId: data.folderId,
  });
};

const mapRemoteDocToGeneration = (docId: string, data: any): Generation => {
  if (data.versions) {
    return hydrateGenerationFromRemote(docId, data);
  }

  // Legacy item in Firestore — wrap as Generation
  const version: GenerationVersion = {
    id: `v-legacy-${docId}`,
    number: 1,
    label: toMarkLabel(1),
    timestamp: data.timestamp || Date.now(),
    type: 'generation',
    imageData: data.base64Data || '',
    imageUrl: data.imageUrl || (data.base64Data ? makeImageUrl(data.base64Data, data.mimeType || 'image/png') : ''),
    mimeType: data.mimeType || 'image/png',
    aspectRatio: data.config?.aspectRatio,
  };

  return normalizeGeneration({
    id: data.id || docId,
    createdAt: data.timestamp || Date.now(),
    config: data.config || EMPTY_CONFIG,
    modelId: data.modelId || 'gemini',
    versions: [version],
    currentVersionIndex: 0,
    folderId: data.folderId,
  });
};

/** Paginate Firestore reads so admins can load their full (unbounded) history. */
const fetchAllRemoteHistoryPages = async (userId: string): Promise<Generation[]> => {
  const historyRef = collection(db, 'users', userId, 'history');
  const batches: Generation[][] = [];
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  while (true) {
    const q = lastDoc
      ? query(
          historyRef,
          orderBy('createdAt', 'desc'),
          startAfter(lastDoc),
          limit(ADMIN_REMOTE_PAGE_SIZE)
        )
      : query(historyRef, orderBy('createdAt', 'desc'), limit(ADMIN_REMOTE_PAGE_SIZE));
    const snapshot = await getDocs(q);
    if (snapshot.empty) break;
    batches.push(snapshot.docs.map((d) => mapRemoteDocToGeneration(d.id, d.data())));
    if (snapshot.docs.length < ADMIN_REMOTE_PAGE_SIZE) break;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  return mergeGenerationCollections(batches, undefined);
};

export const createVersionFromImage = async (
  image: GeneratedImage & { svgCode?: string },
  versionNumber: number,
  type: 'generation' | 'refinement',
  refinementPrompt?: string,
  parentVersionId?: string,
  aspectRatio?: string,
  modelId?: string
): Promise<GenerationVersion> => {
  const isSvg = image.mimeType === 'image/svg+xml';
  const id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (isSvg) {
    return {
      id,
      number: versionNumber,
      label: toMarkLabel(versionNumber),
      timestamp: Date.now(),
      type,
      imageData: image.base64Data,
      imageUrl: image.imageUrl,
      mimeType: image.mimeType,
      aspectRatio,
      svgCode: image.svgCode,
      refinementPrompt,
      parentVersionId,
      modelId,
    };
  }

  const converted = await convertToWebP(image.base64Data, image.mimeType);
  return {
    id,
    number: versionNumber,
    label: toMarkLabel(versionNumber),
    timestamp: Date.now(),
    type,
    imageData: converted.base64Data,
    imageUrl: makeImageUrl(converted.base64Data, converted.mimeType),
    mimeType: converted.mimeType,
    aspectRatio,
    refinementPrompt,
    parentVersionId,
    modelId,
  };
};

export const createGeneration = async (
  image: GeneratedImage,
  config: GenerationConfig,
  modelId: string,
  comparisonBatchId?: string,
  folderId?: string
): Promise<Generation> => {
  // First version inherits the Generation's primary model. For comparison
  // tiles, subsequent versions added by App.tsx will pass their own modelId.
  const version = await createVersionFromImage(
    image, 1, 'generation', undefined, undefined, config.aspectRatio, modelId
  );
  return {
    id: generateId(),
    createdAt: Date.now(),
    config,
    modelId,
    versions: [version],
    currentVersionIndex: 0,
    comparisonBatchId,
    // Caller passes the gallery's open folder (or `INBOX_FOLDER_ID` when
    // unset). Falling back here keeps callers from writing tiles with no folder.
    folderId: folderId && folderId.length > 0 ? folderId : INBOX_FOLDER_ID,
  };
};

export const addRefinementVersion = async (
  generation: Generation,
  image: GeneratedImage,
  refinementPrompt: string,
  modelId?: string,
  aspectRatio?: string
): Promise<Generation> => {
  const currentVersion = generation.versions[generation.currentVersionIndex];
  const nextNumber = generation.versions.length + 1;
  const nextAspectRatio = aspectRatio || currentVersion?.aspectRatio || generation.config.aspectRatio;
  const newVersion = await createVersionFromImage(
    image,
    nextNumber,
    'refinement',
    refinementPrompt,
    currentVersion?.id,
    nextAspectRatio
  );
  const updatedVersions = [...generation.versions, newVersion];
  return {
    ...generation,
    modelId: modelId || generation.modelId,
    config: {
      ...generation.config,
      aspectRatio: nextAspectRatio || generation.config.aspectRatio
    },
    versions: updatedVersions,
    currentVersionIndex: updatedVersions.length - 1,
  };
};

export const getLatestVersion = (gen: Generation): GenerationVersion =>
  gen.versions[gen.versions.length - 1];

export const getCurrentVersion = (gen: Generation): GenerationVersion =>
  gen.versions[gen.currentVersionIndex] ?? gen.versions[gen.versions.length - 1];

const migrateLegacyHistory = async (): Promise<Generation[] | null> => {
  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return null;

    const legacyItems = JSON.parse(legacyRaw);
    if (!Array.isArray(legacyItems) || legacyItems.length === 0) return null;

    const generations: Generation[] = [];
    for (const item of legacyItems) {
      if (!item.base64Data && !item.imageUrl) continue;
      try {
        const converted = item.base64Data
          ? await convertToWebP(item.base64Data, item.mimeType || 'image/png')
          : { base64Data: '', mimeType: item.mimeType || 'image/png' };

        const version: GenerationVersion = {
          id: `v-migrated-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          number: 1,
          label: toMarkLabel(1),
          timestamp: item.timestamp || Date.now(),
          type: 'generation',
          imageData: converted.base64Data,
          imageUrl: converted.base64Data
            ? makeImageUrl(converted.base64Data, converted.mimeType)
            : item.imageUrl || '',
          mimeType: converted.mimeType,
        };

        generations.push({
          id: item.id || generateId(),
          createdAt: item.timestamp || Date.now(),
          config: item.config || { prompt: '', colorSchemeId: '', visualStyleId: '', graphicTypeId: '', aspectRatio: '' },
          modelId: item.modelId || 'gemini',
          versions: [version],
          currentVersionIndex: 0,
          folderId: INBOX_FOLDER_ID,
        });
      } catch {
        // Skip items that fail migration
      }
    }

    if (generations.length > 0) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(generations));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    return generations;
  } catch (e) {
    console.error("Legacy migration failed:", e);
    return null;
  }
};

export const historyService = {
  
  saveGeneration: async (user: User | null, generation: Generation): Promise<void> => {
    const normalized = normalizeGeneration(generation);
    if (user) {
      try {
        const remotePayload = await historyService.saveToRemote(
          user.id,
          normalized,
          user.isAdmin === true
        );
        upsertUserRemoteCache(
          user.id,
          hydrateGenerationFromRemote(normalized.id, remotePayload),
          user.isAdmin === true
        );
        historyService.deleteFromLocal(normalized.id);
      } catch (e) {
        // Preserve locally if remote write fails so data is not lost on refresh.
        historyService.saveToLocal(normalized);
        throw e;
      }
    } else {
      historyService.saveToLocal(normalized);
    }
  },

  updateGeneration: async (user: User | null, generation: Generation): Promise<void> => {
    const normalized = normalizeGeneration(generation);
    if (user) {
      try {
        const remotePayload = await historyService.updateRemote(
          user.id,
          normalized,
          user.isAdmin === true
        );
        upsertUserRemoteCache(
          user.id,
          hydrateGenerationFromRemote(normalized.id, remotePayload),
          user.isAdmin === true
        );
        historyService.deleteFromLocal(normalized.id);
      } catch (e) {
        // Preserve locally if remote write fails so refinements can be retried/synced.
        historyService.updateLocal(normalized);
        throw e;
      }
    } else {
      historyService.updateLocal(normalized);
    }
  },

  /**
   * Bulk-reassign a list of generations to a different folder. Used by the
   * gallery's selection-mode "Move to folder" action and by folder
   * deletion (which sweeps tiles into Inbox before removing the folder
   * entry). Returns the updated generations so the caller can splice them
   * into local history state in one shot.
   */
  moveGenerationsToFolder: async (
    user: User | null,
    history: Generation[],
    generationIds: string[],
    folderId: string
  ): Promise<Generation[]> => {
    if (generationIds.length === 0) return [];
    const targetIds = new Set(generationIds);
    const targets = history.filter(g => targetIds.has(g.id));
    const updated: Generation[] = [];
    for (const gen of targets) {
      if (gen.folderId === folderId) {
        updated.push(gen);
        continue;
      }
      const next: Generation = { ...gen, folderId };
      try {
        await historyService.updateGeneration(user, next);
        updated.push(next);
      } catch (e) {
        // One failed write shouldn't strand the rest of the batch — log
        // and keep going so the user sees as much progress as possible.
        console.error('[historyService] Failed to move generation to folder:', gen.id, e);
      }
    }
    return updated;
  },

  getHistory: async (user: User | null): Promise<Generation[]> => {
    if (user) {
      const isAdmin = user.isAdmin === true;
      const [remoteHistory, localPending, remoteCache, mergeBackup] = await Promise.all([
        historyService.getFromRemote(user.id, isAdmin),
        Promise.resolve(historyService.getFromLocal()),
        Promise.resolve(readUserRemoteCache(user.id, isAdmin)),
        Promise.resolve(readMergeBackup())
      ]);
      const knownIds = new Set<string>([
        ...remoteHistory.map((generation) => generation.id),
        ...localPending.map((generation) => generation.id),
        ...remoteCache.map((generation) => generation.id)
      ]);
      const recoveryFromBackup = mergeBackup.filter((generation) => knownIds.has(generation.id));
      const merged = mergeGenerationCollections(
        [remoteHistory, remoteCache, localPending, recoveryFromBackup],
        isAdmin ? undefined : Math.max(REMOTE_LIMIT, LOCAL_LIMIT)
      );
      writeUserRemoteCache(user.id, merged, isAdmin);
      // Best-effort: pull every history image into IndexedDB so VPN-blocked
      // sessions still have raster bytes to render. Also drop stale cache
      // entries for items that no longer exist in history. Both are
      // fire-and-forget — they must not delay the UI.
      void primeImageCacheForHistory(merged);
      return merged;
    } else {
      return mergeGenerationCollections([historyService.getFromLocal()], LOCAL_LIMIT);
    }
  },

  getGeneration: async (
    user: User | null,
    generationId: string,
    referenceGeneration?: Generation
  ): Promise<Generation | null> => {
    if (!generationId) return null;

    const localCandidate = historyService.getFromLocal().find((generation) => generation.id === generationId) || null;
    if (!user) {
      return localCandidate;
    }

    const remoteCacheCandidate =
      readUserRemoteCache(user.id, user.isAdmin === true).find((generation) => generation.id === generationId) ||
      null;
    const backupCandidate = readMergeBackup().find((generation) => generation.id === generationId) || null;

    const remoteCandidates: Generation[] = [];
    try {
      const historyRef = collection(db, "users", user.id, "history");
      const byId = query(historyRef, where("id", "==", generationId), limit(REMOTE_SCAN_LIMIT * 2));
      const byIdSnapshot = await getDocs(byId);

      byIdSnapshot.docs.forEach((snapshotDoc) => {
        remoteCandidates.push(mapRemoteDocToGeneration(snapshotDoc.id, snapshotDoc.data()));
      });

      if (remoteCandidates.length === 0) {
        // Fallback for legacy docs where id wasn't written in the payload.
        const scan = query(historyRef, orderBy("createdAt", "desc"), limit(REMOTE_SCAN_LIMIT));
        const scanSnapshot = await getDocs(scan);
        scanSnapshot.docs
          .filter((snapshotDoc) => snapshotDoc.id === generationId || snapshotDoc.data().id === generationId)
          .forEach((snapshotDoc) => {
            remoteCandidates.push(mapRemoteDocToGeneration(snapshotDoc.id, snapshotDoc.data()));
          });
      }

      const reference = referenceGeneration || localCandidate || remoteCacheCandidate || backupCandidate;
      if (remoteCandidates.length === 0 && reference) {
        // Last resort: recover chain by matching same generation timestamp/prompt.
        const byCreatedAt = query(historyRef, where("createdAt", "==", reference.createdAt), limit(REMOTE_SCAN_LIMIT * 2));
        const byCreatedAtSnapshot = await getDocs(byCreatedAt);
        byCreatedAtSnapshot.docs
          .map((snapshotDoc) => mapRemoteDocToGeneration(snapshotDoc.id, snapshotDoc.data()))
          .filter((candidate) =>
            candidate.config.prompt === reference.config.prompt &&
            candidate.modelId === reference.modelId
          )
          .forEach((candidate) => remoteCandidates.push(candidate));
      }
    } catch (error) {
      console.error("Failed to fetch remote generation by id:", generationId, error);
    }

    const merged = mergeGenerationCollections(
      [
        remoteCandidates,
        remoteCacheCandidate ? [remoteCacheCandidate] : [],
        localCandidate ? [localCandidate] : [],
        backupCandidate ? [backupCandidate] : []
      ],
      1
    );

    const generation = merged[0] || null;
    if (generation) {
      upsertUserRemoteCache(user.id, generation, user.isAdmin === true);
    }
    return generation;
  },

  // --- Local Storage Logic ---

  saveToLocal: (generation: Generation) => {
    const history = historyService.getFromLocal();
    const merged = mergeGenerationCollections([history, [generation]], LOCAL_LIMIT);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {
      console.error("Failed to save to local storage (likely quota exceeded):", e);
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([normalizeGeneration(generation)]));
      } catch {
        // Storage completely full
      }
    }
  },

  updateLocal: (generation: Generation) => {
    try {
      const history = historyService.getFromLocal();
      const merged = mergeGenerationCollections([history, [generation]], LOCAL_LIMIT);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {
      console.error("Failed to update local storage:", e);
    }
  },

  getFromLocal: (): Generation[] => {
    try {
      const json = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (json) {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return [];
        return mergeGenerationCollections(
          [parsed.map((item) => normalizeGeneration(item as Partial<Generation>))],
          LOCAL_LIMIT
        );
      }

      const migrated = migrateLegacyHistory();
      if (migrated instanceof Promise) {
        return [];
      }
      return migrated
        ? mergeGenerationCollections([migrated.map((item) => normalizeGeneration(item))], LOCAL_LIMIT)
        : [];
    } catch (e) {
      console.error("Failed to parse local history:", e);
      return [];
    }
  },

  initLocal: async (): Promise<Generation[]> => {
    const json = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (json) {
      try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return [];
        return mergeGenerationCollections(
          [parsed.map((item) => normalizeGeneration(item as Partial<Generation>))],
          LOCAL_LIMIT
        );
      } catch {
        return [];
      }
    }
    const migrated = await migrateLegacyHistory();
    return migrated
      ? mergeGenerationCollections([migrated.map((item) => normalizeGeneration(item))], LOCAL_LIMIT)
      : [];
  },

  clearLocal: () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  },

  deleteFromLocal: (generationId: string) => {
    try {
      const history = historyService.getFromLocal();
      const filtered = history.filter(g => g.id !== generationId).slice(0, LOCAL_LIMIT);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
      console.error("Failed to delete local generation:", e);
    }
  },

  // --- Firestore Logic ---

  saveToRemote: async (
    userId: string,
    generation: Generation,
    isAdmin: boolean = false
  ): Promise<Record<string, unknown>> => {
    const historyRef = collection(db, "users", userId, "history");
    const payload = await serializeGenerationForRemote(userId, normalizeGeneration(generation));
    await addDoc(historyRef, payload);

    // Admins keep an unbounded history (Firestore + Storage) so we can always
    // audit, recover, or repurpose past assets. Regular accounts are capped at
    // REMOTE_LIMIT to keep storage costs predictable; this will become tier-aware
    // once paid plans are introduced.
    if (!isAdmin) {
      const q = query(historyRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);

      if (snapshot.size > REMOTE_LIMIT) {
        const itemsToDelete = snapshot.docs.slice(REMOTE_LIMIT);
        const deletePromises = itemsToDelete.map(async (d) => {
          const evictedId = d.data().id || d.id;
          await deleteDoc(doc(db, "users", userId, "history", d.id));
          await deleteGenerationImages(userId, evictedId);
          void removeCachedGeneration(evictedId);
        });
        await Promise.all(deletePromises);
      }
    }

    return payload;
  },

  updateRemote: async (
    userId: string,
    generation: Generation,
    isAdmin: boolean = false
  ): Promise<Record<string, unknown>> => {
    const historyRef = collection(db, "users", userId, "history");
    const genId = generation.id;
    const payload = await serializeGenerationForRemote(userId, normalizeGeneration(generation));
    const byIdQ = query(historyRef, where("id", "==", genId), limit(5));
    const byIdSnap = await getDocs(byIdQ);
    const byIdMatch = byIdSnap.docs[0];
    if (byIdMatch) {
      await updateDoc(doc(db, "users", userId, "history", byIdMatch.id), payload);
      return payload;
    }
    // Fallback: legacy docs missing `id` in payload — scan recent docs only.
    const scanLimit = isAdmin ? Math.max(REMOTE_SCAN_LIMIT, 500) : REMOTE_SCAN_LIMIT;
    const q = query(historyRef, orderBy("createdAt", "desc"), limit(scanLimit));
    const snapshot = await getDocs(q);
    const existing = snapshot.docs.find(d => d.data().id === generation.id);
    if (existing) {
      await updateDoc(doc(db, "users", userId, "history", existing.id), payload);
      return payload;
    }
    return historyService.saveToRemote(userId, generation, isAdmin);
  },

  getFromRemote: async (userId: string, isAdmin: boolean = false): Promise<Generation[]> => {
    try {
      if (isAdmin) {
        return await fetchAllRemoteHistoryPages(userId);
      }
      const historyRef = collection(db, "users", userId, "history");
      const q = query(historyRef, orderBy("createdAt", "desc"), limit(REMOTE_SCAN_LIMIT));
      const snapshot = await getDocs(q);

      const parsed = snapshot.docs.map(d => mapRemoteDocToGeneration(d.id, d.data()));
      return mergeGenerationCollections([parsed], REMOTE_LIMIT);
    } catch (e) {
      console.error("Failed to fetch remote history:", e);
      return [];
    }
  },

  deleteFromRemote: async (userId: string, generationId: string, isAdmin: boolean = false) => {
    try {
      const historyRef = collection(db, "users", userId, "history");
      const byIdQ = query(historyRef, where("id", "==", generationId), limit(10));
      const byIdSnap = await getDocs(byIdQ);
      let target = byIdSnap.docs[0];
      if (!target) {
        const scan = query(
          historyRef,
          orderBy("createdAt", "desc"),
          limit(isAdmin ? 500 : REMOTE_SCAN_LIMIT)
        );
        const snapshot = await getDocs(scan);
        target = snapshot.docs.find(d => {
          const data = d.data();
          return data.id === generationId || d.id === generationId;
        });
      }
      if (target) {
        await deleteDoc(doc(db, "users", userId, "history", target.id));
        await deleteGenerationImages(userId, generationId);
      }
      void removeCachedGeneration(generationId);
    } catch (e) {
      console.error("Failed to delete remote generation:", e);
      throw e;
    } finally {
      // Always scrub local mirrors so the next `getHistory` merge can't
      // resurrect the deleted item from the per-user remote cache, the
      // local-pending list, or the merge backup. We do this in `finally` so
      // that even if the Firestore delete partially failed, we don't leave
      // a phantom client-side entry that the user keeps trying to retry.
      removeFromUserRemoteCache(userId, generationId, isAdmin);
      historyService.deleteFromLocal(generationId);
      removeFromMergeBackup(generationId);
    }
  },

  mergeLocalToRemote: async (userId: string, isAdmin: boolean = false): Promise<{ synced: number; failed: number }> => {
    const localHistory = historyService.getFromLocal();
    if (localHistory.length === 0) return { synced: 0, failed: 0 };

    try {
      localStorage.setItem(MERGE_BACKUP_KEY, JSON.stringify(localHistory));
    } catch {
      // Ignore backup write errors; merge can still proceed.
    }

    const failedIds = new Set<string>();
    let synced = 0;

    for (const gen of [...localHistory].reverse()) {
      try {
        const remotePayload = await historyService.saveToRemote(userId, gen, isAdmin);
        upsertUserRemoteCache(
          userId,
          hydrateGenerationFromRemote(gen.id, remotePayload),
          isAdmin
        );
        synced += 1;
      } catch (e) {
        console.error("Failed to sync local generation to remote:", gen.id, e);
        failedIds.add(gen.id);
      }
    }

    if (failedIds.size === 0) {
      historyService.clearLocal();
      return { synced, failed: 0 };
    }

    // Preserve only unsynced items locally, in original order (newest first).
    const unsynced = mergeGenerationCollections(
      [localHistory.filter(gen => failedIds.has(gen.id))],
      LOCAL_LIMIT
    );
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(unsynced.slice(0, LOCAL_LIMIT)));
    } catch (e) {
      console.error("Failed to preserve unsynced local generations:", e);
    }

    return { synced, failed: failedIds.size };
  }
};
