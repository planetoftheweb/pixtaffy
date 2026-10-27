import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export interface RateLimits { perMinute?: number; perHour?: number; perDay?: number }
export function evaluateRateLimit(data: Record<string, unknown>, limits: RateLimits, now: number, bucket = 'requests'): Record<string, number> {
  const next: Record<string, number> = { updatedAt: now };
  for (const [window, duration, limit] of [
    ['minute', 60000, limits.perMinute],
    ['hour', 3600000, limits.perHour],
    ['day', 86400000, limits.perDay],
  ] as const) {
    if (limit === undefined) continue;
    const start = Number(data[`${window}Start`] ?? now);
    const active = now - start < duration;
    const count = active ? Number(data[`${window}Count`] ?? 0) : 0;
    if (count >= limit) throw new HttpsError('resource-exhausted', `PixTaffy ${bucket} rate limit reached. Try again later.`);
    next[`${window}Start`] = active ? start : now;
    next[`${window}Count`] = count + 1;
  }
  return next;
}
export async function enforceRateLimit(uid: string, bucket: string, limits: RateLimits, now = Date.now()): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`users/${uid}/private/rate-${bucket}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    tx.set(ref, evaluateRateLimit(snap.data() ?? {}, limits, now, bucket));
  });
}
