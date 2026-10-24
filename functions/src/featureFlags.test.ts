import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { flagEnabled, userKeysMode, resetFeatureFlagCache } from './featureFlags';
const user = { uid: 'owner', token: {} };
const admin = { uid: 'ray', token: { admin: true } };
test('flag defaults off and rejects invalid fields', () => {
  for (const flag of [undefined, null, false, [], {}, { stage: 3 }, { stage: '2' }, { stage: 2, allowAdmins: 'true' }, { stage: 2, allowlistUids: [1] }]) {
    assert.equal(flagEnabled(flag, user), false);
    assert.equal(flagEnabled(flag, admin), false);
  }
});
test('stage 1 requires an explicit allowlist or admin opt-in', () => {
  assert.equal(flagEnabled({ stage: 0 }, admin), false);
  assert.equal(flagEnabled({ stage: 1 }, user), false);
  assert.equal(flagEnabled({ stage: 1 }, admin), false);
  assert.equal(flagEnabled({ stage: 1, allowAdmins: true }, admin), true);
  assert.equal(flagEnabled({ stage: 1, allowAdmins: false }, admin), false);
  assert.equal(flagEnabled({ stage: 1, allowlistUids: ['owner'] }, user), true);
  assert.equal(flagEnabled({ stage: 2 }, user), true);
  assert.equal(flagEnabled({ stage: 2 }, undefined), false);
});

test('storage mode keeps migrated users sticky unless stage 0 forces legacy', async () => {
  const app = initializeApp({ projectId: 'demo-pixtaffy' });
  let flag: unknown;
  let keys: unknown;
  const reads: string[] = [];
  const stub = mock.method(getFirestore(), 'doc', (path: string) => ({
    get: async () => {
      reads.push(path);
      return { data: () => path === 'config/featureFlags' ? { serverSideUserKeys: flag } : { keys } };
    },
  }));
  try {
    for (const value of [undefined, { stage: 0 }, { stage: 1, allowlistUids: ['someone-else'] }]) {
      flag = value;
      resetFeatureFlagCache();
      keys = {};
      assert.equal(await userKeysMode(user), false);
      keys = { gemini: { ciphertext: 'test-placeholder' } };
      assert.equal(await userKeysMode(user), true);
    }
    flag = { stage: 0, forceLegacy: true };
    resetFeatureFlagCache();
    reads.length = 0;
    assert.equal(await userKeysMode(user), false);
    assert.deepEqual(reads, ['config/featureFlags']);
    flag = { stage: 2, forceLegacy: true };
    resetFeatureFlagCache();
    assert.equal(await userKeysMode(user), true);
    assert.equal(await userKeysMode(undefined), false);
  } finally {
    stub.mock.restore();
    resetFeatureFlagCache();
    await deleteApp(app);
  }
});
