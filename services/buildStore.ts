// Local + cloud persistence for image "builds" (reveal animations).
//
// Local: localStorage, keyed by `${generationId}|${versionId}` (same scheme as
// the IndexedDB image cache — see buildImageCacheKey in services/imageCache.ts).
// Always written first and synchronously, so an edit is never lost to a slow
// or blocked network — mirrors the VPN-safety "cache before upload" invariant
// documented in CLAUDE.md for images.
//
// Cloud (signed-in users only): Firestore at `users/{uid}/builds/{buildId}`,
// where `buildId` is that SAME `${generationId}|${versionId}` key. Using the
// app's own stable generation/version ids — rather than Firestore's own
// internal document id for the parent history entry — means a build doesn't
// depend on how/where the generation itself is stored, and matches the
// identity scheme already used elsewhere in this codebase.

import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { ImageBuild } from '../types';
import { defaultBuild } from './buildAnimator';

const STORAGE_KEY = 'brandoit.builds.v1';

const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const keyFor = (generationId: string, versionId: string): string =>
  `${generationId}|${versionId}`;

type BuildMap = Record<string, ImageBuild>;

const readAllLocal = (): BuildMap => {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as BuildMap) : {};
  } catch {
    return {};
  }
};

const writeAllLocal = (map: BuildMap): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    // Quota or serialization failure — non-fatal; the build just won't persist
    // locally. If the user is signed in, the Firestore write (called
    // separately by `saveBuild`) still has a chance to succeed.
    console.warn('[buildStore] failed to persist build locally:', err);
  }
};

const isPoint = (p: unknown): p is { x: number; y: number } =>
  !!p && typeof (p as { x?: unknown }).x === 'number' && typeof (p as { y?: unknown }).y === 'number';

const normalizeShape = (raw: unknown): ImageBuild['steps'][number]['shapes'][number] | null => {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { kind?: unknown; op?: unknown; points?: unknown; radius?: unknown };
  const op: 'add' | 'sub' = s.op === 'sub' ? 'sub' : 'add';
  const points = Array.isArray(s.points) ? s.points.filter(isPoint) : [];
  if (s.kind === 'brush') {
    if (points.length < 1) return null;
    const radius = typeof s.radius === 'number' && s.radius > 0 ? s.radius : 0.03;
    return { kind: 'brush', op, points, radius };
  }
  if (points.length < 3) return null;
  return { kind: 'poly', op, points };
};

const normalizeStep = (raw: unknown): ImageBuild['steps'][number] | null => {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as {
    id?: unknown;
    shapes?: unknown;
    points?: unknown;
    rect?: { x: number; y: number; w: number; h: number };
    durationMs?: unknown;
    zoomFrom?: unknown;
  };
  const id = typeof s.id === 'string' ? s.id : null;
  if (!id) return null;
  const extra: Pick<ImageBuild['steps'][number], 'durationMs' | 'zoomFrom'> = {};
  if (typeof s.durationMs === 'number') extra.durationMs = s.durationMs;
  if (s.zoomFrom === 'smart' || s.zoomFrom === 'center') extra.zoomFrom = s.zoomFrom;

  // Current format: shapes[].
  if (Array.isArray(s.shapes)) {
    const shapes = s.shapes.map(normalizeShape).filter((x): x is ImageBuild['steps'][number]['shapes'][number] => x !== null);
    if (shapes.length) return { id, shapes, ...extra };
    return null;
  }
  // Legacy: a single polygon (points) → one additive poly shape.
  if (Array.isArray(s.points) && s.points.filter(isPoint).length >= 3) {
    return { id, shapes: [{ kind: 'poly', op: 'add', points: s.points.filter(isPoint) }], ...extra };
  }
  // Legacy: a rect → additive poly shape.
  const r = s.rect;
  if (r && typeof r.x === 'number' && typeof r.w === 'number') {
    return {
      id,
      shapes: [{
        kind: 'poly', op: 'add',
        points: [
          { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
          { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
        ],
      }],
      ...extra,
    };
  }
  return null;
};

/** Coerce a stored value into a valid ImageBuild, filling any missing fields. */
const normalize = (value: unknown): ImageBuild => {
  const base = defaultBuild();
  if (!value || typeof value !== 'object') return base;
  const v = value as Partial<ImageBuild>;
  const steps = Array.isArray(v.steps)
    ? v.steps.map(normalizeStep).filter((s): s is ImageBuild['steps'][number] => s !== null)
    : [];
  return {
    ...base,
    ...v,
    steps,
  } as ImageBuild;
};

// --- Local (synchronous) ---------------------------------------------------

export const loadLocalBuild = (generationId: string, versionId: string): ImageBuild | null => {
  const all = readAllLocal();
  const found = all[keyFor(generationId, versionId)];
  return found ? normalize(found) : null;
};

export const saveLocalBuild = (generationId: string, versionId: string, build: ImageBuild): void => {
  const all = readAllLocal();
  all[keyFor(generationId, versionId)] = build;
  writeAllLocal(all);
};

export const deleteLocalBuild = (generationId: string, versionId: string): void => {
  const all = readAllLocal();
  delete all[keyFor(generationId, versionId)];
  writeAllLocal(all);
};

// --- Cloud (Firestore, signed-in users only) --------------------------------

const buildDocRef = (userId: string, generationId: string, versionId: string) =>
  doc(db, 'users', userId, 'builds', keyFor(generationId, versionId));

export const loadRemoteBuild = async (
  userId: string,
  generationId: string,
  versionId: string
): Promise<ImageBuild | null> => {
  try {
    const snap = await getDoc(buildDocRef(userId, generationId, versionId));
    if (!snap.exists()) return null;
    return normalize(snap.data());
  } catch (err) {
    console.warn('[buildStore] Failed to load build from Firestore:', err);
    return null;
  }
};

export const saveRemoteBuild = async (
  userId: string,
  generationId: string,
  versionId: string,
  build: ImageBuild
): Promise<void> => {
  await setDoc(buildDocRef(userId, generationId, versionId), {
    ...build,
    updatedAt: Date.now(),
  });
};

export const deleteRemoteBuild = async (
  userId: string,
  generationId: string,
  versionId: string
): Promise<void> => {
  await deleteDoc(buildDocRef(userId, generationId, versionId));
};

// --- Combined public API -----------------------------------------------------

/**
 * Synchronous, local-only load — for the initial paint (no network wait,
 * works offline and for guests). `BuildStudio` also fires an async
 * `loadRemoteBuild` check afterward (only when this returns null) to recover
 * a build saved from a different browser/device, or after local storage was
 * cleared.
 */
export const loadBuildSync = loadLocalBuild;

/**
 * Save: the local cache is written synchronously FIRST (so the edit survives
 * even if the network is down or blocked), then — for signed-in users —
 * mirrored to Firestore in the background. Fire-and-forget by design; a
 * failed remote write is logged but doesn't block or roll back the local one.
 */
export const saveBuild = (
  userId: string | null | undefined,
  generationId: string,
  versionId: string,
  build: ImageBuild
): void => {
  saveLocalBuild(generationId, versionId, build);
  if (userId) {
    void saveRemoteBuild(userId, generationId, versionId, build).catch((err) => {
      console.warn('[buildStore] Failed to save build to Firestore (kept locally):', err);
    });
  }
};

export const deleteBuild = (
  userId: string | null | undefined,
  generationId: string,
  versionId: string
): void => {
  deleteLocalBuild(generationId, versionId);
  if (userId) {
    void deleteRemoteBuild(userId, generationId, versionId).catch((err) => {
      console.warn('[buildStore] Failed to delete build from Firestore:', err);
    });
  }
};

export const hasBuild = (generationId: string, versionId: string): boolean =>
  !!loadLocalBuild(generationId, versionId);
