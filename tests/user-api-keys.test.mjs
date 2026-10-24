import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const api = require('../functions/lib/userApiKeys.js');
// Tests use a throwaway key. CI sets USER_API_KEYS_TEST_ENCRYPTION_KEY to a clearly fake value; locally a random one is generated.
const secret = process.env.USER_API_KEYS_TEST_ENCRYPTION_KEY || randomBytes(32).toString('base64');
const key = randomBytes(32).toString('hex');
test('AES-GCM round trip, random IV, tamper and account substitution rejection', () => {
  const encrypted = api.encryptKey(key, secret, 'owner:gemini');
  assert.ok(api.decryptKey(encrypted, secret, 'owner:gemini') === key);
  assert.ok(encrypted.iv !== api.encryptKey(key, secret, 'owner:gemini').iv);
  assert.ok(!JSON.stringify(encrypted).includes(key));
  assert.throws(() => api.decryptKey({ ...encrypted, ciphertext: Buffer.alloc(32).toString('base64') }, secret, 'owner:gemini'));
  assert.throws(() => api.decryptKey(encrypted, secret, 'stranger:gemini'));
  assert.throws(() => api.decryptKey(encrypted, randomBytes(32).toString('hex'), 'owner:gemini'));
  assert.throws(() => api.encryptKey(key, '', 'owner:gemini'));
});
test('legacy precedence and masked status contain no key values', () => {
  const legacy = api.legacyKeys({ geminiApiKey: 'older', apiKeys: { openai: key }, preferences: { geminiApiKey: 'old', apiKeys: { gemini: key } } });
  assert.ok(legacy.gemini === key && legacy.openai === key);
  const status = api.keyStatus({ gemini: api.encryptKey(key, secret, 'owner:gemini') });
  assert.deepEqual(Object.keys(status.gemini).sort(), ['hasKey', 'last4']);
  assert.ok(status.gemini.hasKey && status.gemini.last4 === key.slice(-4));
  assert.ok(!JSON.stringify(status).includes(key));
});
test('callables reject unauthenticated and stranger-target requests', async () => {
  // No Admin app is initialized: any premature Firestore access fails this test.
  const { getKeyStorageMode } = require('../functions/lib/featureFlags.js');
  for (const callable of [api.getUserApiKeyStatus, api.setUserApiKey, api.deleteUserApiKey, api.clearUserApiKeys, api.generateWithUserKey, api.listUserKeyProfiles, getKeyStorageMode]) {
    for (const auth of [undefined, { uid: 'guest', token: { firebase: { sign_in_provider: 'anonymous' } } }]) {
      await assert.rejects(callable.run({ auth, data: {} }), { code: 'unauthenticated' });
    }
  }
  const admin = { uid: 'admin', token: { admin: true } };
  for (const uid of ['', 'users/owner', 123, null]) {
    await assert.rejects(api.listUserKeyProfiles.run({ auth: admin, data: { uid, countOnly: true } }), { code: 'invalid-argument' });
  }
  await assert.rejects(api.clearUserApiKeys.run({ auth: admin, data: { uid: 'users/owner' } }), { code: 'invalid-argument' });
  await assert.rejects(api.listUserKeyProfiles.run({ auth: admin, data: { cursor: 'users/owner' } }), { code: 'invalid-argument' });
  await assert.rejects(api.listUserKeyProfiles.run({ auth: { uid: 'stranger', token: {} }, data: {} }), { code: 'permission-denied' });
  await assert.rejects(api.clearUserApiKeys.run({ auth: { uid: 'stranger', token: {} }, data: { uid: 'owner' } }), { code: 'permission-denied' });
});
test('emulator: migration, CRUD, server generation, CLI dry run and migration', { skip: !process.env.FIRESTORE_EMULATOR_HOST && !process.env.REQUIRE_EMULATOR_TESTS }, async () => {
  assert.ok(/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''), 'Local Firestore emulator required');
  process.env.USER_API_KEYS_ENCRYPTION_KEY = secret;
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: 'demo-pixtaffy', storageBucket: 'demo-pixtaffy.appspot.com' });
  const db = getFirestore();
  const flags = require('../functions/lib/featureFlags.js');
  const setStage = async (stage, fields = {}) => { await db.doc('config/featureFlags').set({ serverSideUserKeys: { stage, allowAdmins: false, ...fields } }); flags.resetFeatureFlagCache(); };
  await setStage(0);
  const uid = `key-test-${randomBytes(8).toString('hex')}`;
  let ownerToken;
  let strangerToken;
  let auth = { uid, token: { firebase: { sign_in_provider: 'password' } } };
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.com`, password: randomBytes(24).toString('hex'), returnSecureToken: true }) });
    assert.ok(signup.ok);
    const body = await signup.json();
    const { getAuth } = require('firebase-admin/auth');
    ownerToken = body.idToken;
    auth = { uid: body.localId, token: await getAuth().verifyIdToken(body.idToken) };
    const stranger = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `stranger-${uid}@example.com`, password: randomBytes(24).toString('hex'), returnSecureToken: true }) });
    assert.ok(stranger.ok);
    strangerToken = (await stranger.json()).idToken;
  }
  const request = data => ({ auth, data });
  const profile = db.doc(`users/${auth.uid}`);
  const store = db.doc(`userApiKeys/${auth.uid}`);
  await profile.set({ name: 'Test', apiKeys: { openrouter: key }, geminiApiKey: key, preferences: { apiKeys: { openai: key, gemini: key }, geminiApiKey: key } });
  assert.deepEqual(await flags.getKeyStorageMode.run(request({})), { serverKeys: false });
  for (const [callable, data] of [[api.getUserApiKeyStatus, {}], [api.setUserApiKey, { slot: 'gemini', key }], [api.deleteUserApiKey, { slot: 'gemini' }], [api.clearUserApiKeys, {}], [api.generateWithUserKey, {}]]) {
    await assert.rejects(callable.run(request(data)), { code: 'failed-precondition' });
  }
  assert.ok((await profile.get()).data().preferences.geminiApiKey === key);
  assert.ok(await api.resolveUserApiKey(auth.uid, 'gemini') === key);
  assert.ok(!(await store.get()).exists);
  await api.listUserKeyProfiles.run({ auth: { uid: 'admin', token: { admin: true } }, data: { uid: auth.uid } });
  assert.ok((await profile.get()).data().preferences.geminiApiKey === key);
  assert.ok(!(await store.get()).exists);
  await setStage(1);
  await assert.rejects(api.getUserApiKeyStatus.run(request({})), { code: 'failed-precondition' });
  auth.token.admin = true;
  assert.deepEqual(await flags.getKeyStorageMode.run(request({})), { serverKeys: false });
  await setStage(1, { allowlistUids: [auth.uid] });
  assert.deepEqual(await flags.getKeyStorageMode.run(request({})), { serverKeys: true });
  const status = await api.getUserApiKeyStatus.run(request({}));
  assert.ok(status.gemini.hasKey && status.openai.hasKey && status.openrouter.hasKey);
  for (const value of [(await profile.get()).data(), (await store.get()).data(), status]) assert.ok(!JSON.stringify(value).includes(key));
  const migrated = (await profile.get()).data();
  assert.ok(!('apiKeys' in migrated) && !('geminiApiKey' in migrated) && !('apiKeys' in migrated.preferences) && !('geminiApiKey' in migrated.preferences));
  if (ownerToken && strangerToken) {
    const read = (collection, token) => fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-pixtaffy/databases/(default)/documents/${collection}/${auth.uid}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.ok((await read('userApiKeys', ownerToken)).status === 403);
    assert.ok((await read('userApiKeys', strangerToken)).status === 403);
    assert.ok((await read('users', strangerToken)).status === 403);
    const ownProfile = await read('users', ownerToken);
    assert.ok(ownProfile.ok && !(await ownProfile.text()).includes(key));
  }
  // Rollback preserves encrypted keys without lazily migrating any legacy fields.
  await setStage(0);
  await profile.set({ preferences: { geminiApiKey: key } }, { merge: true });
  assert.deepEqual(await flags.getKeyStorageMode.run(request({})), { serverKeys: true });
  assert.ok((await api.getUserApiKeyStatus.run(request({}))).gemini.hasKey);
  assert.ok((await profile.get()).data().preferences.geminiApiKey === key);
  await setStage(0, { forceLegacy: true });
  assert.deepEqual(await flags.getKeyStorageMode.run(request({})), { serverKeys: false });
  for (const [callable, data] of [[api.getUserApiKeyStatus, {}], [api.setUserApiKey, { slot: 'gemini', key }], [api.deleteUserApiKey, { slot: 'gemini' }], [api.clearUserApiKeys, {}], [api.generateWithUserKey, {}]]) {
    await assert.rejects(callable.run(request(data)), { code: 'failed-precondition' });
  }
  assert.ok((await store.get()).data().keys.gemini);
  await setStage(0);
  const replacement = randomBytes(32).toString('hex');
  const adminPage = await api.listUserKeyProfiles.run({ auth: { uid: 'admin', token: { admin: true } }, data: { uid: auth.uid } });
  assert.ok(adminPage.rows.length === 1 && !JSON.stringify(adminPage).includes(key));
  const replaced = await api.setUserApiKey.run(request({ slot: 'openai', key: replacement }));
  assert.ok(replaced.openai.last4 === replacement.slice(-4));
  await api.deleteUserApiKey.run(request({ slot: 'unused' }));
  assert.ok((await profile.get()).data().preferences.geminiApiKey === key);
  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://api.openai.com/'));
    assert.ok(options.headers.Authorization === `Bearer ${replacement}`);
    providerCalled = true;
    return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 });
  };
  try {
    const generated = await api.generateWithUserKey.run(request({ model: 'openai', prompt: 'Test', config: { aspectRatio: '1:1' } }));
    assert.ok(providerCalled && generated.base64Data === 'aW1hZ2U=');
    assert.ok(!JSON.stringify(generated).includes(replacement));
    globalThis.fetch = async () => { throw new Error(replacement); };
    await assert.rejects(api.generateWithUserKey.run(request({ model: 'openai' })), error => !error.message.includes(replacement));
  } finally { globalThis.fetch = originalFetch; }
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url || String(input);
    let response;
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      response = { candidates: [{ content: { parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }, { text: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }] } }] };
    } else if (url.startsWith('https://openrouter.ai/api/v1/models')) {
      response = { data: [{ id: 'example/image', name: 'Example' }] };
    } else if (url.startsWith('https://openrouter.ai/') || url.startsWith('https://api.openai.com/')) {
      response = { data: [{ b64_json: Buffer.alloc(100).toString('base64') }] };
    } else {
      throw new Error('Unexpected provider endpoint');
    }
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (const model of ['gemini', 'gemini-svg', 'openai', 'openrouter:example/image']) {
      for (const action of ['generate', 'refine', 'style']) {
        const result = await api.generateWithUserKey.run(request({ model, action, prompt: 'Test operation', config: { aspectRatio: '16:9' }, image: { base64Data: 'aW1hZ2U=', mimeType: 'image/png' }, svg: '<svg></svg>' }));
        assert.ok(result.base64Data && !JSON.stringify(result).includes(key) && !JSON.stringify(result).includes(replacement));
      }
    }
    assert.ok((await profile.get()).data().preferences.geminiApiKey === key);
    await setStage(2);
    delete auth.token.admin;
    const everyone = await api.generateWithUserKey.run(request({ model: 'openai', prompt: 'Stage 2', config: { aspectRatio: '1:1' } }));
    assert.ok(everyone.base64Data);
    const models = await api.generateWithUserKey.run(request({ model: 'openrouter', action: 'models' }));
    assert.ok(models[0].slug === 'example/image' && !JSON.stringify(models).includes(key));
  } finally { globalThis.fetch = originalFetch; }
  await api.deleteUserApiKey.run(request({ slot: 'openai' }));
  assert.ok(!(await api.getUserApiKeyStatus.run(request({}))).openai?.hasKey);
  await api.clearUserApiKeys.run(request({}));
  assert.ok(Object.values(await api.getUserApiKeyStatus.run(request({}))).every(status => status.hasKey === false && status.last4 === null));
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    const { ensureStarterGrant } = require('../functions/lib/billing.js');
    const { generateWithCredits } = require('../functions/lib/paidAi.js');
    const billing = db.doc(`users/${auth.uid}/private/billing`);
    await ensureStarterGrant(auth.uid, true);
    const before = (await billing.get()).data().balanceMilliCredits;
    process.env.OPENROUTER_API_KEY = randomBytes(32).toString('hex');
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('https://openrouter.ai/')) {
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.alloc(100).toString('base64'), media_type: 'image/png' }], usage: { cost: 0.01 } }), { status: 200 });
      }
      return originalFetch(url, options);
    };
    try {
      const generated = await generateWithCredits.run(request({ modelId: 'openrouter:bytedance-seed/seedream-4.5', prompt: 'Test credits', idempotencyKey: randomBytes(16).toString('hex') }));
      assert.ok(generated.base64Data && generated.milliCreditsCharged > 0);
      assert.ok((await billing.get()).data().balanceMilliCredits === before - generated.milliCreditsCharged);
    } finally { globalThis.fetch = originalFetch; }
  }
  await setStage(2);
  delete auth.token.admin;
  assert.deepEqual(await flags.getKeyStorageMode.run(request({})), { serverKeys: true });
  await api.getUserApiKeyStatus.run(request({}));
  await profile.set({ preferences: { geminiApiKey: key } });
  execFileSync(process.execPath, ['scripts/migrate-user-api-keys.mjs', '--project', 'demo-pixtaffy', '--dry-run'], { stdio: 'pipe' });
  assert.ok((await profile.get()).data().preferences.geminiApiKey === key);
  execFileSync(process.execPath, ['scripts/migrate-user-api-keys.mjs', '--project', 'demo-pixtaffy'], { stdio: 'pipe' });
  assert.ok(!(await profile.get()).data().preferences.geminiApiKey);
  assert.ok(await api.resolveUserApiKey(auth.uid, 'gemini') === key);
  await setStage(0);
  await api.clearUserApiKeys.run(request({}));
  assert.deepEqual(await flags.getKeyStorageMode.run(request({})), { serverKeys: false });
  await Promise.all([profile.delete(), store.delete()]);
});
