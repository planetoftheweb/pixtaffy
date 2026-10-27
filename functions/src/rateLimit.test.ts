import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { evaluateRateLimit, enforceRateLimit } from './rateLimit';
import { requireAppCheck } from './userApiKeys';

test('all windows permit exactly the limit and reset at expiry', () => {
  for (const [window, duration, limits] of [
    ['minute', 60000, { perMinute: 30 }],
    ['hour', 3600000, { perHour: 20 }],
    ['day', 86400000, { perDay: 100 }],
  ] as const) {
    const limit = Object.values(limits)[0];
    let data: Record<string, number> = {};
    for (let i = 0; i < limit; i++) data = evaluateRateLimit(data, limits, 1000);
    assert.equal(data[window + 'Count'], limit);
    assert.throws(() => evaluateRateLimit(data, limits, 1000 + duration - 1), { code: 'resource-exhausted' });
    const reset = evaluateRateLimit(data, limits, 1000 + duration);
    assert.equal(reset[window + 'Count'], 1);
    assert.equal(reset[window + 'Start'], 1000 + duration);
  }
});
test('expired windows reset while active windows retain counters', () => {
  assert.deepEqual(evaluateRateLimit({
    minuteStart: 0, minuteCount: 30, hourStart: 0, hourCount: 3, dayStart: 0, dayCount: 8,
  }, { perMinute: 30, perHour: 20, perDay: 100 }, 60000), {
    minuteStart: 60000, minuteCount: 1, hourStart: 0, hourCount: 4, dayStart: 0, dayCount: 9, updatedAt: 60000,
  });
});
test('App Check gate only rejects missing attestation when enabled', () => {
  requireAppCheck(false, undefined);
  requireAppCheck(true, { appId: 'test' });
  assert.throws(() => requireAppCheck(true, undefined), { code: 'failed-precondition', message: 'App Check required.' });
});
test('paid AI retains buckets, thresholds and exact legacy transaction fields', async () => {
  const source = readFileSync(require.resolve('../src/paidAi.ts'), 'utf8');
  assert.equal((source.match(/enforceRateLimit\(uid, "images", \{ perHour: 20, perDay: 100 \}\)/g) || []).length, 2);
  assert.match(source, /enforceRateLimit\(uid, "helpers", \{ perHour: 60, perDay: 300 \}\)/);
  const app = initializeApp({ projectId: 'demo-pixtaffy' });
  const db = getFirestore();
  const paths: string[] = [];
  const writes: unknown[] = [];
  const doc = mock.method(db, 'doc', (path: string) => { paths.push(path); return { path }; });
  const transaction = mock.method(db, 'runTransaction', async (fn: any) => fn({
    get: async () => ({ data: () => ({ hourStart: 0, hourCount: 19, dayStart: 0, dayCount: 99 }) }),
    set: (_ref: unknown, value: unknown) => writes.push(value),
  }));
  try {
    for (const bucket of ['images', 'helpers']) await enforceRateLimit('owner', bucket, { perHour: 20, perDay: 100 }, 1000);
    assert.deepEqual(paths, ['users/owner/private/rate-images', 'users/owner/private/rate-helpers']);
    assert.deepEqual(writes[0], { hourStart: 0, hourCount: 20, dayStart: 0, dayCount: 100, updatedAt: 1000 });
  } finally {
    doc.mock.restore(); transaction.mock.restore(); await deleteApp(app);
  }
});
