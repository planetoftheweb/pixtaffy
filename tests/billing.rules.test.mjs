import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

const projectId = 'brandoit';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
    storage: { rules: await readFile('storage.rules', 'utf8') },
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/owner/billingLedger/grant-1'), {
      deltaMilliCredits: 5_000,
      reason: 'signup_grant',
      createdAt: Date.now(),
    });
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test('owners may read their ledger but cannot edit billing authority', async () => {
  const ownerDb = testEnv.authenticatedContext('owner').firestore();
  await assertSucceeds(getDoc(doc(ownerDb, 'users/owner/billingLedger/grant-1')));
  await assertFails(setDoc(doc(ownerDb, 'users/owner/billingLedger/forged'), { deltaMilliCredits: 999_000 }));
  await assertFails(setDoc(doc(ownerDb, 'users/owner/private/billing'), { balanceMilliCredits: 999_000 }));
  await assertFails(getDoc(doc(ownerDb, 'users/owner/private/billing')));
});

test('clients cannot edit reservations, grants, provider costs, or spend controls', async () => {
  const ownerDb = testEnv.authenticatedContext('owner').firestore();
  await assertFails(setDoc(doc(ownerDb, 'billingReservations/fake'), { state: 'committed' }));
  await assertFails(setDoc(doc(ownerDb, 'billingReservations/fake/items/item-1'), { state: 'committed' }));
  await assertFails(setDoc(doc(ownerDb, 'systemSpend/2099-01-01'), { openrouterUsd: 0 }));
  await assertFails(setDoc(doc(ownerDb, 'paidAiDisabledModels/fake'), { disabled: false }));
  await assertFails(setDoc(doc(ownerDb, 'paidAiModelCatalog/fake'), { costCeilingUsd: 99 }));
  await assertFails(setDoc(doc(ownerDb, 'systemConfig/historyRetention'), { enforceAfter: 0 }));
});

test('admins retain server-support access to protected billing data', async () => {
  const adminDb = testEnv.authenticatedContext('admin', { admin: true }).firestore();
  await assertSucceeds(setDoc(doc(adminDb, 'users/owner/private/billing'), { balanceMilliCredits: 0 }));
  await assertSucceeds(getDoc(doc(adminDb, 'users/owner/billingLedger/grant-1')));
});

test('history storage accepts bounded images and rejects other uploads', async () => {
  const storage = testEnv.authenticatedContext('owner').storage(`gs://${projectId}.firebasestorage.app`);
  await assertSucceeds(uploadBytes(
    ref(storage, 'users/owner/history/generation-1/mark.webp'),
    new Uint8Array([1, 2, 3]),
    { contentType: 'image/webp' },
  ));
  await assertFails(uploadBytes(
    ref(storage, 'users/owner/history/generation-1/payload.txt'),
    new TextEncoder().encode('not an image'),
    { contentType: 'text/plain' },
  ));
  const otherStorage = testEnv.authenticatedContext('other').storage(`gs://${projectId}.firebasestorage.app`);
  await assertFails(uploadBytes(
    ref(otherStorage, 'users/owner/history/generation-1/stolen.webp'),
    new Uint8Array([1, 2, 3]),
    { contentType: 'image/webp' },
  ));
});
