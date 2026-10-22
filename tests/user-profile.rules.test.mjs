// Rules tests for the users/{uid} profile doc.
// Run with: npm run test:rules (Firestore emulator, demo- project, no cloud).
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const projectId = 'demo-pixtaffy';
let testEnv;
const registered = (uid, claims = {}) => testEnv.authenticatedContext(uid, {
  firebase: { sign_in_provider: 'password' },
  ...claims,
});

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
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
  if (testEnv) await testEnv.cleanup();
});

test('signup: owner can create a profile with the normal fields (register batch)', async () => {
  const db = registered('bob').firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, 'users/bob'), {
    name: 'Bob',
    username: 'bob',
    email: 'bob@example.com',
    preferences: { theme: 'light' },
    createdAt: new Date().toISOString(),
  });
  batch.set(doc(db, 'usernames/bob'), { uid: 'bob', email: 'bob@example.com' });
  await assertSucceeds(batch.commit());
});

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
  await assertSucceeds(updateDoc(ref, { preferences: { theme: 'light', apiKeys: {} } }));
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
  await assertSucceeds(updateDoc(doc(db, 'users/alice'), { 'preferences.apiKeys': {} }));
});
