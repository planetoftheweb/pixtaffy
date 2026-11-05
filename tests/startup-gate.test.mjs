import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  STARTUP_GATE_TIMEOUT_MS,
  LAST_MEMBER_STORAGE_KEY,
  hasSavedMemberHint,
  writeMemberHint,
  shouldShowStartupGate,
  shouldResolveMemberSession,
} from '../utils/startupGate.ts';

test('guests open immediately, including returning guests who prefer studio', () => {
  for (const resolved of [false, true]) {
    assert.equal(shouldShowStartupGate(false, resolved), false);
  }
  assert.equal(hasSavedMemberHint({ getItem: key => key === 'pixtaffy_prefer_studio' ? 'true' : null }), false);
});

test('saved members wait only until auth resolves or the short timeout releases it', () => {
  assert.equal(STARTUP_GATE_TIMEOUT_MS, 1500);
  assert.equal(shouldShowStartupGate(true, false), true);
  assert.equal(shouldShowStartupGate(true, true), false);
});

test('member hint is set for members and cleared for null or anonymous sessions', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  assert.equal(hasSavedMemberHint(storage), false);
  writeMemberHint(storage, true);
  assert.equal(values.get(LAST_MEMBER_STORAGE_KEY), 'true');
  assert.equal(hasSavedMemberHint(storage), true);
  writeMemberHint(storage, false);
  assert.equal(hasSavedMemberHint(storage), false);
});

test('unavailable storage does not block guests', () => {
  assert.equal(hasSavedMemberHint(null), false);
  const storage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  assert.equal(hasSavedMemberHint(storage), false);
  assert.doesNotThrow(() => writeMemberHint(storage, true));
  assert.doesNotThrow(() => writeMemberHint(storage, false));
});

test('a blocked browser localStorage getter does not prevent launch', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { get localStorage() { throw new Error('Storage access denied'); } },
  });
  try {
    assert.equal(hasSavedMemberHint(), false);
    assert.equal(shouldShowStartupGate(hasSavedMemberHint(), false), false);
    assert.doesNotThrow(() => writeMemberHint(undefined, true));
    assert.doesNotThrow(() => writeMemberHint(undefined, false));
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

test('startup opens before member enrichment and public Back navigation does not persist preference', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../services/authService.ts', import.meta.url), 'utf8');
  const observer = service.slice(service.indexOf('  onAuthStateChange:'));
  assert.doesNotMatch(observer, /await (?:readAdminClaim|loadKeyStorageMode|getUserApiKeyStatus)/);
  assert.match(observer, /writeMemberHint\(undefined, !!user && !user.isAnonymous\)/);
  assert.match(observer, /resetKeyStorageMode\(\);\s*callback\(null\)/);
  assert.match(service, /localStorage.removeItem\(PREFER_STUDIO_STORAGE_KEY\)/);
  assert.ok(app.indexOf("releaseGate('authenticated session')") < app.indexOf('authService.hydrateMemberSession'));
  const memberStartup = app.slice(app.indexOf("releaseGate('authenticated session')"), app.indexOf("releaseGate('guest session')"));
  assert.match(memberStartup, /window\.setTimeout\([\s\S]*const enrichment = await authService\.hydrateMemberSession\(hydratedUser\.id\);\s*if \(!active\) return;\s*const sessionUser = \{ \.\.\.hydratedUser, \.\.\.enrichment, preferences: \{ \.\.\.hydratedUser.preferences, \.\.\.enrichment.preferences \} \}/);
  assert.ok(memberStartup.indexOf('await authService.hydrateMemberSession') < memberStartup.indexOf('historyService.mergeLocalToRemote'));
  assert.match(memberStartup, /mergeLocalToRemote\(sessionUser\.id, sessionUser\.isAdmin === true\)/);
  assert.match(memberStartup, /getHistory\(sessionUser\)/);
  assert.doesNotMatch(memberStartup, /getHistory\(hydratedUser\)|mergeLocalToRemote\(hydratedUser/);
  const start = app.indexOf('!isKnownPath(pathname) ?');
  assert.ok(start >= 0);
  const publicRoutes = app.slice(start, app.indexOf(') : welcomeMode ?', start));
  assert.match(publicRoutes, /returnToStudio/);
  assert.doesNotMatch(publicRoutes, /enterStudioFromWelcome/);
  assert.doesNotMatch(app.slice(app.indexOf('const returnToStudio ='), app.indexOf('const enterStudioFromWelcome =')), /writePreferStudioFlag/);
});


test('stored Firebase members keep resolving after the splash timeout without starting guest auth', () => {
  const storedHint = (savedUser) => {
    const key = 'firebase:authUser:public-key:[DEFAULT]';
    return hasSavedMemberHint({ length: 1, key: () => key, getItem: name => name === key ? savedUser : null });
  };
  assert.equal(storedHint(JSON.stringify({ uid: 'member', isAnonymous: false })), true);
  assert.equal(storedHint(JSON.stringify({ uid: 'guest', isAnonymous: true })), false);
  assert.equal(storedHint('{malformed'), false);
  assert.equal(shouldResolveMemberSession(true, false), true);
  assert.equal(shouldShowStartupGate(true, true), false);
  assert.equal(shouldResolveMemberSession(true, true), false);
  assert.equal(shouldResolveMemberSession(false, false), false);
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /if \(!isAuthResolved \|\| isMemberResolving \|\| user \|\| welcomeMode\) return;/);
  const timeout = app.slice(app.indexOf('const timeoutId = window.setTimeout'), app.indexOf('const unsubscribe = authService.onAuthStateChange'));
  assert.match(timeout, /setIsMemberResolving\(shouldResolveMemberSession\(hasMemberHint, false\)\)/);
  assert.doesNotMatch(timeout, /setUser\(null\)/);
  assert.match(app, /setIsMemberResolving\(false\);\s*if \(restoredUser\)/);
});

test('anonymous session waits for slow auth restoration and preserves the restored member', async () => {
  const service = readFileSync(new URL('../services/authService.ts', import.meta.url), 'utf8');
  const body = service.match(/ensureAnonymousSession: async \(\): Promise<string> => \{([\s\S]*?)\n  \},/)[1];
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('auth', 'startAnonymousSession', body);
  let finishRestoring;
  let anonymousCalls = 0;
  const auth = { currentUser: null, authStateReady: () => new Promise(resolve => { finishRestoring = resolve; }) };
  const startAnonymousSession = async () => { anonymousCalls++; return 'guest'; };
  const pending = run(auth, startAnonymousSession);
  await Promise.resolve();
  assert.equal(anonymousCalls, 0);
  auth.currentUser = { uid: 'returning-member', isAnonymous: false };
  finishRestoring();
  assert.equal(await pending, 'returning-member');
  assert.equal(anonymousCalls, 0);
  auth.currentUser = null;
  auth.authStateReady = async () => {};
  assert.equal(await run(auth, startAnonymousSession), 'guest');
  assert.equal(anonymousCalls, 1);
});

test('member hydration returns migrated key status and setup waits for it', async () => {
  const service = readFileSync(new URL('../services/authService.ts', import.meta.url), 'utf8');
  const body = service.slice(service.indexOf('    const member = auth.currentUser;', service.indexOf('  hydrateMemberSession:')), service.indexOf('\n  },', service.indexOf('  hydrateMemberSession:')));
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('uid', 'auth', 'readAdminClaim', 'loadKeyStorageMode', 'getUserApiKeyStatus', 'recordSignIn', body);
  let completeMigration;
  let completeAdminClaim;
  let hydrationFinished = false;
  const status = { gemini: { configured: true } };
  const pending = run('member', { currentUser: { uid: 'member', isAnonymous: false } }, () => new Promise(resolve => { completeAdminClaim = resolve; }), async () => true, () => new Promise(resolve => { completeMigration = resolve; }), () => {});
  void pending.then(() => { hydrationFinished = true; });
  await Promise.resolve();
  await Promise.resolve();
  completeMigration(status);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(hydrationFinished, false, 'history setup must wait for the real admin claim even when key migration is ready');
  completeAdminClaim(true);
  assert.deepEqual(await pending, { isAdmin: true, preferences: { apiKeyStatus: status, apiKeys: {}, geminiApiKey: undefined } });
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /preferences: \{ \.\.\.current.preferences, \.\.\.enrichment.preferences \}/);
  assert.match(app, /const needsSetup = !isMemberHydrating && \(user/);
});


test('legacy profile migration completes before the read, after the splash release', async () => {
  const service = readFileSync(new URL('../services/authService.ts', import.meta.url), 'utf8');
  const ensure = service.slice(service.indexOf('const ensureUserDocument ='), service.indexOf('  const fbUser =', service.indexOf('const ensureUserDocument =')));
  assert.doesNotMatch(ensure, /readAdminClaim/);
  const body = ensure.slice(ensure.indexOf('  const userRef ='));
  const run = new (Object.getPrototypeOf(async function () {}).constructor)('uid', 'doc', 'db', 'loadKeyStorageMode', 'getUserApiKeyStatus', 'getDoc', body.replace(' as Record<string, unknown>', ''));
  let finishMigration;
  let migrated = false;
  let reads = 0;
  const pending = run('member', () => ({}), {}, async () => true, () => new Promise(resolve => {
    finishMigration = () => { migrated = true; resolve({}); };
  }), async () => {
    assert.equal(migrated, true, 'rules deny legacy plaintext profiles before migration');
    reads++;
    return { exists: () => true, data: () => ({ name: 'Restored member' }) };
  });
  await Promise.resolve();
  assert.equal(reads, 0);
  finishMigration();
  assert.deepEqual(await pending, { name: 'Restored member' });
  assert.equal(reads, 1);
  const observer = service.slice(service.indexOf('  onAuthStateChange:'));
  assert.ok(observer.indexOf('onMemberIdentified?.()') < observer.indexOf('await ensureUserDocument'));
  assert.match(observer, /onMemberIdentified\?\.\(\);[\s\S]*await new Promise<void>\(resolve => window.setTimeout\(resolve, 0\)\);/);
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /setIsMemberResolving\(true\);\s*releaseGate\('member identified'\)/);
});

test('every auth retry refreshes the member hint before resolving the session', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const attempt = app.slice(app.indexOf('    const gateStartedAt ='), app.indexOf('    const releaseGate ='));
  assert.match(attempt, /const hasMemberHint = hasSavedMemberHint\(\);\s*setHasMemberHint\(hasMemberHint\);/);
  assert.ok(attempt.indexOf('hasSavedMemberHint()') < attempt.indexOf('shouldResolveMemberSession(hasMemberHint, false)'));
});
