import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  STARTUP_GATE_TIMEOUT_MS,
  LAST_MEMBER_STORAGE_KEY,
  hasSavedMemberHint,
  writeMemberHint,
  shouldShowStartupGate,
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

test('startup opens before member enrichment and public Back navigation does not persist preference', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../services/authService.ts', import.meta.url), 'utf8');
  const observer = service.slice(service.indexOf('  onAuthStateChange:'));
  assert.doesNotMatch(observer, /await (?:readAdminClaim|loadKeyStorageMode|getUserApiKeyStatus)/);
  assert.match(observer, /writeMemberHint\(localStorage, !!user && !user.isAnonymous\)/);
  assert.match(observer, /resetKeyStorageMode\(\);\s*callback\(null\)/);
  assert.match(service, /localStorage.removeItem\(PREFER_STUDIO_STORAGE_KEY\)/);
  assert.ok(app.indexOf("releaseGate('authenticated session')") < app.indexOf('authService.hydrateMemberSession'));
  const start = app.indexOf('!isKnownPath(pathname) ?');
  assert.ok(start >= 0);
  const publicRoutes = app.slice(start, app.indexOf(') : welcomeMode ?', start));
  assert.match(publicRoutes, /returnToStudio/);
  assert.doesNotMatch(publicRoutes, /enterStudioFromWelcome/);
  assert.doesNotMatch(app.slice(app.indexOf('const returnToStudio ='), app.indexOf('const enterStudioFromWelcome =')), /writePreferStudioFlag/);
});
