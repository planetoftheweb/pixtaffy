// Rolling per-model duration estimates used for batch previews and live
// elapsed/remaining displays.
//
// Baselines reflect observed wall-clock time per single generation (one API
// round-trip end-to-end, not including Firestore persistence). They are
// deliberately conservative: a slow first estimate is less jarring than an
// optimistic one that slides backward.
//
// Every completed generation feeds back into a per-model rolling average that
// is persisted to localStorage so estimates improve with use.

const STORAGE_KEY = "brandoit.modelDurations.v1";
const SAMPLE_WINDOW = 12; // How many recent samples to keep per model.
const MIN_SECONDS = 3;
const MAX_SECONDS = 600;

/** Conservative defaults in seconds per single generation. */
const DEFAULT_SECONDS_PER_GEN: Record<string, number> = {
  "gemini-svg": 150,
  gemini: 18,
  "gemini-3.1-flash-image-preview": 12,
  "gemini-3.1-flash-lite-image": 8,
  openai: 35,
};

const FALLBACK_SECONDS_PER_GEN = 30;

type DurationStore = Record<string, number[]>;

const isBrowser = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const readStore = (): DurationStore => {
  if (!isBrowser) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const store: DurationStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const samples = value.filter(
        (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0
      );
      if (samples.length) store[key] = samples.slice(-SAMPLE_WINDOW);
    }
    return store;
  } catch {
    return {};
  }
};

const writeStore = (store: DurationStore) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or privacy-mode failures are non-fatal; estimates fall back to defaults.
  }
};

const averageSeconds = (samplesMs: number[]): number => {
  if (!samplesMs.length) return 0;
  const sum = samplesMs.reduce((acc, n) => acc + n, 0);
  return sum / samplesMs.length / 1000;
};

const clampSeconds = (seconds: number): number =>
  Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, seconds));

/**
 * Best current estimate for seconds-per-generation for the given model.
 *
 * If we have recent samples for this model, blend them with the baseline so a
 * single outlier can't skew early estimates too far.
 */
export const getModelSecondsPerGen = (modelId: string): number => {
  const baseline =
    DEFAULT_SECONDS_PER_GEN[modelId] ?? FALLBACK_SECONDS_PER_GEN;
  const store = readStore();
  const samples = store[modelId];
  if (!samples || samples.length === 0) return baseline;

  const avg = averageSeconds(samples);
  if (!avg) return baseline;

  // Blend: as we collect more samples, trust the rolling average more.
  const weight = Math.min(samples.length / SAMPLE_WINDOW, 1);
  const blended = avg * weight + baseline * (1 - weight);
  return clampSeconds(blended);
};

/** Record how long a single generation took, so future estimates are smarter. */
export const recordModelDuration = (modelId: string, ms: number): void => {
  if (!modelId || !Number.isFinite(ms) || ms <= 0) return;
  const store = readStore();
  const next = [...(store[modelId] ?? []), ms].slice(-SAMPLE_WINDOW);
  store[modelId] = next;
  writeStore(store);
};

export interface BatchDurationEstimate {
  /** Expected total wall-clock seconds for the whole batch. */
  totalSeconds: number;
  /** Per-generation assumption used for this estimate. */
  secondsPerGen: number;
  /** Effective concurrency (clamped to total). */
  effectiveConcurrency: number;
}

/**
 * Estimate total wall-clock time to complete a batch given total jobs and the
 * number of workers running in parallel. This is always an approximation; if
 * the caller has live elapsed/completed numbers they should prefer those.
 */
export const estimateBatchDuration = ({
  total,
  concurrency,
  secondsPerGen,
}: {
  total: number;
  concurrency: number;
  secondsPerGen: number;
}): BatchDurationEstimate => {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeSeconds = clampSeconds(secondsPerGen || FALLBACK_SECONDS_PER_GEN);
  const effectiveConcurrency = Math.max(1, Math.min(concurrency || 1, Math.max(1, safeTotal)));
  if (safeTotal === 0) {
    return { totalSeconds: 0, secondsPerGen: safeSeconds, effectiveConcurrency };
  }
  const waves = Math.ceil(safeTotal / effectiveConcurrency);
  return {
    totalSeconds: Math.round(waves * safeSeconds),
    secondsPerGen: safeSeconds,
    effectiveConcurrency,
  };
};

/**
 * Live progress estimate derived from the in-flight batch. Falls back to the
 * static per-model baseline until the first generation completes.
 */
export const estimateRemainingSeconds = ({
  total,
  completed,
  failed,
  elapsedMs,
  concurrency,
  secondsPerGen,
}: {
  total: number;
  completed: number;
  failed: number;
  elapsedMs: number;
  concurrency: number;
  secondsPerGen: number;
}): number => {
  const done = Math.max(0, completed + failed);
  const remainingJobs = Math.max(0, total - done);
  if (remainingJobs === 0) return 0;

  const safeConcurrency = Math.max(
    1,
    Math.min(concurrency || 1, Math.max(1, total))
  );

  let perGen = clampSeconds(secondsPerGen || FALLBACK_SECONDS_PER_GEN);
  if (completed > 0 && elapsedMs > 0) {
    // Each wave serves up to `concurrency` jobs in parallel, so the observed
    // elapsed time corresponds to ~ceil(completed/concurrency) serial waves.
    const wavesElapsed = Math.max(1, Math.ceil(completed / safeConcurrency));
    const observedPerWaveSec = elapsedMs / 1000 / wavesElapsed;
    perGen = clampSeconds(observedPerWaveSec);
  }

  const wavesRemaining = Math.ceil(remainingJobs / safeConcurrency);
  return Math.round(wavesRemaining * perGen);
};

/**
 * Humanize a duration in seconds. Rounds to whole minutes once the value is
 * above ~1 minute so the UI doesn't jitter on every tick.
 */
export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (total < 3600) {
    return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
  }
  const hrs = Math.floor(total / 3600);
  const restMins = Math.floor((total % 3600) / 60);
  return restMins === 0 ? `${hrs}h` : `${hrs}h ${restMins}m`;
};
