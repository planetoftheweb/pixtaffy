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
