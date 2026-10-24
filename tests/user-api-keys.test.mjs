import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const api = require('../functions/lib/userApiKeys.js');
const secret = randomBytes(32).toString('base64');
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
  await assert.rejects(api.getUserApiKeyStatus.run({ data: {} }), { code: 'unauthenticated' });
  await assert.rejects(api.listUserKeyProfiles.run({ auth: { uid: 'stranger', token: {} }, data: {} }), { code: 'permission-denied' });
  await assert.rejects(api.clearUserApiKeys.run({ auth: { uid: 'stranger', token: {} }, data: { uid: 'owner' } }), { code: 'permission-denied' });
});
test('emulator: migration, CRUD, server generation, CLI dry run and migration', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST.startsWith('127.0.0.1:') || process.env.FIRESTORE_EMULATOR_HOST.startsWith('localhost:'));
  process.env.USER_API_KEYS_ENCRYPTION_KEY = secret;
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: 'demo-pixtaffy', storageBucket: 'demo-pixtaffy.appspot.com' });
  const db = getFirestore();
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
  const replacement = randomBytes(32).toString('hex');
  const adminPage = await api.listUserKeyProfiles.run({ auth: { uid: 'admin', token: { admin: true } }, data: { uid: auth.uid } });
  assert.ok(adminPage.rows.length === 1 && !JSON.stringify(adminPage).includes(key));
  const replaced = await api.setUserApiKey.run(request({ slot: 'openai', key: replacement }));
  assert.ok(replaced.openai.last4 === replacement.slice(-4));
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
  await profile.set({ preferences: { geminiApiKey: key } });
  execFileSync(process.execPath, ['scripts/migrate-user-api-keys.mjs', '--project', 'demo-pixtaffy', '--dry-run'], { stdio: 'pipe' });
  assert.ok((await profile.get()).data().preferences.geminiApiKey === key);
  execFileSync(process.execPath, ['scripts/migrate-user-api-keys.mjs', '--project', 'demo-pixtaffy'], { stdio: 'pipe' });
  assert.ok(!(await profile.get()).data().preferences.geminiApiKey);
  assert.ok(await api.resolveUserApiKey(auth.uid, 'gemini') === key);
  await Promise.all([profile.delete(), store.delete()]);
});
