// Rules tests for the users/{uid} profile doc.
// Run with: npm run test:rules (Firestore emulator, demo- project, no cloud).
import { createRequire } from 'node:module';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');
let adminApp;
const clientApps = [];

const projectId = 'demo-pixtaffy';
let testEnv;
const registered = (uid, claims = {}) => testEnv.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'password' },
  ...claims,
});

before(async () => {
  adminApp = initializeAdminApp({ projectId }, `profile-rules-${Date.now()}`);
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'config/featureFlags'), { serverSideUserKeys: { stage: 2 } });
    await setDoc(doc(ctx.firestore(), 'users/alice'), {
      name: 'Alice',
      username: 'alice',
      email: 'alice@example.com',
      preferences: { theme: 'dark' },
      createdAt: '2026-01-01T00:00:00.000Z',
      isDisabled: true,
      teamIds: ['team-a'],
    });
  });
});

after(async () => {
  await Promise.all(clientApps.map(app => deleteApp(app)));
  if (testEnv) await testEnv.cleanup();
  if (adminApp) await deleteAdminApp(adminApp);
});

// Match register's sanitized default preferences. Real Auth sessions and
// Admin SDK flag seeding mirror the browser walkthrough.
for (const [label, stage, allowlisted, enabled] of [
  ['stage 0', 0, false, false],
  ['stage 1 excluded', 1, false, false],
  ['stage 1 allowlisted', 1, true, true],
  ['stage 2', 2, false, true],
]) {
  test(`register batch and profile writes: ${label}`, async () => {
    const app = initializeApp({ projectId, apiKey: 'fake-emulator-only' }, label);
    clientApps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    const { user } = await createUserWithEmailAndPassword(auth, `signup-${stage}-${allowlisted}@example.com`, 'fake-test-password');
    const uid = user.uid;
    const db = getFirestore(app);
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    connectFirestoreEmulator(db, host, Number(port));
    // The rollout script and walkthrough seed flags through the Admin SDK.
    await getAdminFirestore(adminApp).doc('config/featureFlags').set({
      serverSideUserKeys: { stage, allowAdmins: false, allowlistUids: allowlisted ? [uid] : [] },
    });
    const preferences = {
      ...(enabled ? { apiKeyStatus: {} } : {}),
      selectedModel: 'openai-2.5',
      settings: {
        contributeByDefault: false, confirmDeleteHistory: true, confirmDeleteCurrent: true,
        defaultGraphicTypeId: 'infographic', defaultVisualStyleId: 'hand-drawn',
        defaultAspectRatio: '16:9', openaiImageQuality: 'auto', openaiImageBackground: 'auto',
      },
    };
    const ref = doc(db, `users/${uid}`);
    const batch = writeBatch(db);
    const profile = {
      name: 'Bob', username: 'bob', email: 'bob@example.com',
      preferences, createdAt: new Date().toISOString(),
    };
    batch.set(ref, profile);
    batch.set(doc(db, 'usernames/bob'), { uid, email: 'bob@example.com' });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { lastSignInAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { preferences: { ...preferences, selectedModel: 'gemini' } }));
    await assertSucceeds(updateDoc(ref, {
      name: 'Bob B', username: 'bobb', photoURL: 'https://example.com/b.png',
      photoDataUrl: 'data:image/png;base64,AAAA',
    }));
    // Existing legacy accounts still have an empty or populated key map.
    // Exercise the flag lookup on both preference and sign-in writes too.
    if (!enabled) {
      for (const apiKeys of [{}, { gemini: 'fake-test-only' }]) {
        await assertSucceeds(updateDoc(ref, { preferences: { ...preferences, apiKeys } }));
        await assertSucceeds(updateDoc(ref, { lastSignInAt: serverTimestamp() }));
        await assertSucceeds(getDoc(ref));
      }
      await assertSucceeds(updateDoc(ref, { preferences }));
      const cleared = await getDoc(ref);
      if ('apiKeys' in cleared.data().preferences) throw new Error('Clearing keys must remove the legacy map');
    }
    // ensureUserDocument repairs a missing profile with the same fields.
    const { deleteDoc } = await import('firebase/firestore');
    await testEnv.withSecurityRulesDisabled(async ctx => deleteDoc(doc(ctx.firestore(), `users/${uid}`)));
    await assertSucceeds(getDoc(ref));
    if (!enabled) {
      const legacyBatch = writeBatch(db);
      legacyBatch.set(ref, { ...profile, preferences: { ...preferences, apiKeys: {} } });
      legacyBatch.set(doc(db, 'usernames/bob-legacy'), { uid, email: 'bob@example.com' });
      await assertSucceeds(legacyBatch.commit());
      await testEnv.withSecurityRulesDisabled(async ctx => deleteDoc(doc(ctx.firestore(), `users/${uid}`)));
    }
    await assertSucceeds(setDoc(ref, {
      name: 'Bob', username: 'bob', email: 'bob@example.com',
      preferences, createdAt: new Date().toISOString(),
    }));
  });
}

test('attack: owner cannot create a profile that carries privileged fields', async () => {
  const db = registered('mallory').firestore();
  await assertFails(setDoc(doc(db, 'users/mallory'), {
    name: 'M', username: 'm', email: 'm@example.com', preferences: {}, createdAt: 'x',
    teamIds: ['team-a'],
  }));
  await assertFails(setDoc(doc(db, 'users/mallory'), {
    name: 'M', username: 'm', email: 'm@example.com', preferences: {}, createdAt: 'x',
    isDisabled: false, role: 'admin',
  }));
});

test('normal use: owner can update name, username, photo, preferences and lastSignInAt', async () => {
  const db = registered('alice').firestore();
  const ref = doc(db, 'users/alice');
  await assertSucceeds(updateDoc(ref, { lastSignInAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { preferences: { theme: 'light' } }));
  await assertSucceeds(updateDoc(ref, {
    name: 'Alice B', username: 'aliceb', photoURL: 'https://example.com/a.png',
    photoDataUrl: 'data:image/png;base64,AAAA',
  }));
  await assertSucceeds(getDoc(ref));
});

test('attack: suspended owner cannot clear isDisabled', async () => {
  const db = registered('alice').firestore();
  await assertFails(updateDoc(doc(db, 'users/alice'), { isDisabled: false }));
});

test('attack: owner cannot add teamIds the server trusts for catalog access', async () => {
  const db = registered('alice').firestore();
  await assertFails(updateDoc(doc(db, 'users/alice'), { teamIds: ['team-a', 'victim-team'] }));
});

test('attack: owner cannot add role, admin or billing fields', async () => {
  const db = registered('alice').firestore();
  const ref = doc(db, 'users/alice');
  await assertFails(updateDoc(ref, { role: 'admin' }));
  await assertFails(updateDoc(ref, { admin: true }));
  await assertFails(updateDoc(ref, { balanceMilliCredits: 999999 }));
  await assertFails(updateDoc(ref, { name: 'ok', isDisabled: false }));
});

test('attack: another user cannot read or write someone else profile', async () => {
  const db = registered('mallory').firestore();
  await assertFails(getDoc(doc(db, 'users/alice')));
  await assertFails(updateDoc(doc(db, 'users/alice'), { name: 'pwned' }));
});

test('admins can still suspend users and edit any field', async () => {
  const db = registered('root', { admin: true }).firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/alice'), { isDisabled: false }));
  await assertFails(updateDoc(doc(db, 'users/alice'), { 'preferences.apiKeys': {} }));
});

for (const identity of ['anonymous', 'alice', 'stranger', 'admin']) {
  test(`encrypted key store denies ${identity} reads and writes`, async () => {
    const db = identity === 'anonymous' ? testEnv.unauthenticatedContext().firestore() : registered(identity, { admin: identity === 'admin' }).firestore();
    const ref = doc(db, 'userApiKeys/alice');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { keys: {} }));
  });
}
for (const field of ['apiKeys', 'geminiApiKey', 'preferences.apiKeys', 'preferences.geminiApiKey']) {
  for (const admin of [false, true]) {
    test(`plaintext ${field} rejected for ${admin ? 'admin' : 'owner'}`, async () => {
      const db = registered('alice', { admin }).firestore();
      await assertFails(updateDoc(doc(db, 'users/alice'), { [field]: {} }));
      const create = field.startsWith('preferences.') ? { preferences: { [field.split('.')[1]]: {} } } : { [field]: {} };
      await assertFails(setDoc(doc(registered('new', { admin }).firestore(), 'users/new'), create));
    });
  }
}
test('legacy profile cannot expose plaintext even to its owner or an admin', async () => {
  await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'users/legacy'), { preferences: { apiKeys: {} } }));
  for (const identity of ['legacy', 'stranger', 'admin']) {
    await assertFails(getDoc(doc(registered(identity, { admin: identity === 'admin' }).firestore(), 'users/legacy')));
  }
});

test('owner may check whether their profile exists before creation', async () => {
  await assertSucceeds(getDoc(doc(registered('new-owner').firestore(), 'users/new-owner')));
});

for (const [name, flag, claims, enabled] of [
  ['missing', null, {}, false],
  ['off', { stage: 0 }, {}, false],
  ['admin default excluded', { stage: 1 }, { admin: true }, false],
  ['admin opt-in', { stage: 1, allowAdmins: true }, { admin: true }, true],
  ['regular pilot', { stage: 1 }, {}, false],
  ['allowlist', { stage: 1, allowlistUids: ['alice'] }, {}, true],
  ['admins disabled', { stage: 1, allowAdmins: false }, { admin: true }, false],
  ['everyone', { stage: 2 }, {}, true],
  ['invalid', { stage: 3 }, {}, false],
]) {
  test(`rollout ${name}`, async () => {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const { deleteDoc } = await import('firebase/firestore');
      const ref = doc(ctx.firestore(), 'config/featureFlags');
      if (flag) await setDoc(ref, { serverSideUserKeys: flag });
      else await deleteDoc(ref);
    });
    const owner = registered('alice', claims).firestore();
    const write = updateDoc(doc(owner, 'users/alice'), { 'preferences.apiKeys': { gemini: 'fake-test-only' } });
    await (enabled ? assertFails(write) : assertSucceeds(write));
    await assertSucceeds(getDoc(doc(owner, 'users/alice')));
    await assertFails(getDoc(doc(registered('stranger').firestore(), 'users/alice')));
    for (const identity of ['alice', 'stranger', 'admin']) {
      const db = registered(identity, { admin: identity === 'admin' }).firestore();
      for (const path of ['config/featureFlags', 'userApiKeys/alice']) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), {}));
      }
    }
  });
}
