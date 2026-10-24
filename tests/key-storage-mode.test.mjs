import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyStorageModeCache } from '../services/keyStorageModeCache.ts';
for (const code of ['not-found', 'internal', 'unavailable']) {
  test(`mode lookup ${code} stays legacy for this sign-in`, async () => {
    let calls = 0;
    const cache = createKeyStorageModeCache(async () => { calls++; throw new Error(code); });
    assert.equal(await cache.load('alice'), false);
    assert.equal(await cache.load('alice'), false);
    assert.equal(cache.enabled('alice'), false);
    assert.equal(calls, 1);
    cache.reset();
    await cache.load('alice');
    assert.equal(calls, 2);
  });
}
test('mode response cannot enable a different account or a later session', async () => {
  let complete;
  const cache = createKeyStorageModeCache(() => new Promise(resolve => { complete = resolve; }));
  const pending = cache.load('alice');
  await Promise.resolve();
  cache.reset();
  complete(true);
  await pending;
  assert.equal(cache.enabled('alice'), false);
  assert.equal(cache.enabled('bob'), false);
});
