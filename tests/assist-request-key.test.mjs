import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistRequestKeys } from '../services/assistRequestKey.ts';

function fixture(storage) {
  let time = 1000, count = 0;
  const keys = createAssistRequestKeys(() => storage, () => time);
  return { keys, get: (action = 'expand', payload = { prompt: 'private prompt' }) => keys.acquire(action, payload, () => `key-${++count}`), advance: () => { time += 600_000; } };
}
test('canonical payload reuses key including concurrent lookups; different payload or action differs', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.get('a', { b: 2, a: { z: 1, y: 2 } }), f.get('a', { a: { y: 2, z: 1 }, b: 2 })]);
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, (await f.get('b', { b: 2, a: { z: 1, y: 2 } })).key);
  assert.notEqual(a.key, (await f.get('a', { b: 3 })).key);
});
test('success clears and stale completion cannot clear a newer key', async () => {
  const f = fixture(); const a = await f.get();
  f.keys.finish(a, { success: true });
  const b = await f.get(); assert.notEqual(a.key, b.key);
  f.keys.finish(a, { success: true }); assert.equal((await f.get()).key, b.key);
});
for (const code of [undefined, 'unavailable', 'deadline-exceeded', 'internal', 'resource-exhausted', 'already-exists', 'aborted']) {
  test(`retryable ${code ?? 'network'} keeps key`, async () => {
    const f = fixture(); const a = await f.get();
    f.keys.finish(a, { error: code ? { code: `functions/${code}` } : new Error('network') });
    assert.equal((await f.get()).key, a.key);
  });
}
for (const code of ['invalid-argument', 'failed-precondition', 'permission-denied', 'unauthenticated', 'not-found', 'cancelled']) {
  test(`non-retryable ${code} clears key`, async () => {
    const f = fixture(); const a = await f.get();
    f.keys.finish(a, { error: { code: `functions/${code}` } });
    assert.notEqual((await f.get()).key, a.key);
  });
}
test('ten minute TTL expires', async () => {
  const f = fixture(); const a = await f.get(); f.advance();
  assert.notEqual((await f.get()).key, a.key);
});
test('storage getter, read, and write failures are tolerated', async () => {
  for (const storage of [() => { throw Error('blocked'); }, () => ({ getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } })]) {
    const keys = createAssistRequestKeys(storage);
    const a = await keys.acquire('a', {}, () => 'first');
    assert.equal((await keys.acquire('a', {}, () => 'second')).key, a.key);
    keys.finish(a, { success: true });
  }
});
test('session restoration uses only SHA-256 fingerprints and key metadata, never payload or action', async () => {
  let saved;
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const f = fixture(storage); const a = await f.get('private action');
  assert.doesNotMatch(saved, /private|prompt|action/);
  const entries = Object.entries(JSON.parse(saved));
  assert.match(entries[0][0], /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(entries[0][1]).sort(), ['createdAt', 'key']);
  const restored = createAssistRequestKeys(() => storage, () => 1000);
  assert.equal((await restored.acquire('private action', { prompt: 'private prompt' }, () => 'new')).key, a.key);
  restored.finish(a, { success: true }); assert.equal(saved, '{}');
});

test('restoration discards unexpected entry fields before mirroring storage', async () => {
  let saved;
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const f = fixture(storage);
  const request = await f.get();
  const entries = JSON.parse(saved);
  entries[request.fingerprint].payload = { prompt: 'private prompt' };
  saved = JSON.stringify(entries);
  const restored = createAssistRequestKeys(() => storage, () => 1000);
  assert.equal((await restored.acquire('expand', { prompt: 'private prompt' }, () => 'new')).key, request.key);
  assert.deepEqual(JSON.parse(saved), {
    [request.fingerprint]: { key: request.key, createdAt: 1000 },
  });
});

// These pure helpers run without loading Firebase or making network requests.
const { AI_ASSIST_TIMEOUT_MS, friendlyAiAssistError, withAiAssistGuard } = await import('../services/aiAssistGuard.ts');

for (const [code, message] of [
  ['deadline-exceeded', 'The AI request took too long. Please try again.'],
  ['unavailable', 'AI assist is temporarily unavailable. Please try again shortly.'],
  ['resource-exhausted', 'AI assist is busy or your credits are low. Check your balance and try again shortly.'],
  ['failed-precondition', 'AI assist could not complete this request. Check your account and try rephrasing it.'],
  ['unauthenticated', 'Sign in to use AI assist, then try again.'],
  ['internal', 'AI assist could not finish. Please try again.'],
  ['unknown', 'AI assist could not finish. Please try again.'],
]) {
  test(`assist friendly error hides upstream text for ${code}`, () => {
    for (const prefix of ['', 'functions/']) {
      assert.equal(friendlyAiAssistError({ code: prefix + code, message: 'private upstream text' }), message);
    }
  });
}
test('assist friendly error handles missing and malformed errors', () => {
  for (const error of [undefined, null, 'private upstream text', new Error('private upstream text'), { code: null }]) {
    assert.equal(friendlyAiAssistError(error), 'AI assist could not finish. Please try again.');
  }
});

function guardClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clear = t.mock.method(globalThis, 'clearTimeout');
  return { clear, expire: () => t.mock.timers.tick(AI_ASSIST_TIMEOUT_MS) };
}

for (const lateOutcome of ['resolve', 'reject']) {
  test(`assist guard settles a stalled callable with a retryable code and ignores late ${lateOutcome}`, async (t) => {
    const clock = guardClock(t);
    const f = fixture(); const key = await f.get();
    let resolveCall, rejectCall;
    const call = new Promise((resolve, reject) => { resolveCall = resolve; rejectCall = reject; });
    const result = withAiAssistGuard(() => call);
    const rejected = assert.rejects(result, error => {
      assert.ok(error instanceof Error);
      assert.equal(error.code, 'functions/deadline-exceeded');
      assert.match(error.message, /try again/i);
      f.keys.finish(key, { error });
      return true;
    });
    await Promise.resolve();
    clock.expire();
    await rejected;
    assert.equal((await f.get()).key, key.key);
    assert.equal(clock.clear.mock.callCount(), 1);
    if (lateOutcome === 'resolve') resolveCall('late result');
    else rejectCall(new Error('late failure'));
    await new Promise(resolve => setImmediate(resolve));
  });
}

test('assist guard returns a fast result and clears its timer', async (t) => {
  const clock = guardClock(t);
  assert.equal(await withAiAssistGuard(async () => 'result'), 'result');
  assert.equal(clock.clear.mock.callCount(), 1);
  clock.expire();
});
test('assist guard preserves immediate failures and clears its timer', async (t) => {
  const clock = guardClock(t);
  const error = { code: 'functions/unavailable', message: 'private upstream text' };
  await assert.rejects(withAiAssistGuard(() => Promise.reject(error)), e => e === error);
  assert.equal(clock.clear.mock.callCount(), 1);
  clock.expire();
});
test('assist guard clears its timer after synchronous callable failure', async (t) => {
  const clock = guardClock(t);
  await assert.rejects(withAiAssistGuard(() => { throw new Error('call failed'); }), /call failed/);
  assert.equal(clock.clear.mock.callCount(), 1);
  clock.expire();
});
