import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PREFER_STUDIO_STORAGE_KEY,
  readPreferStudioFlag,
  shouldStartInWelcomeMode,
  writePreferStudioFlag,
} from '../utils/welcomeMode.ts';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
};

test('shouldStartInWelcomeMode keeps first visits on welcome', () => {
  assert.equal(
    shouldStartInWelcomeMode({ search: '', preferStudio: false }),
    true
  );
  assert.equal(
    shouldStartInWelcomeMode({ search: '?', preferStudio: false }),
    true
  );
});

test('shouldStartInWelcomeMode prefers studio when flag is set', () => {
  assert.equal(
    shouldStartInWelcomeMode({ search: '', preferStudio: true }),
    false
  );
  assert.equal(
    shouldStartInWelcomeMode({ search: '?utm=home', preferStudio: true }),
    false
  );
});

test('shouldStartInWelcomeMode honors billing checkout and whatsnew deep links', () => {
  for (const search of [
    '?billing=1',
    '?checkout=success',
    '?whatsnewpage=1',
    '?whatsnew=v0.32.0',
    'billing=1',
  ]) {
    assert.equal(
      shouldStartInWelcomeMode({ search, preferStudio: false }),
      false,
      search
    );
  }
});

test('prefer-studio flag read/write uses the dedicated localStorage key', () => {
  const storage = memoryStorage();
  assert.equal(readPreferStudioFlag(storage), false);
  writePreferStudioFlag(storage);
  assert.equal(storage.getItem(PREFER_STUDIO_STORAGE_KEY), 'true');
  assert.equal(readPreferStudioFlag(storage), true);
});

test('App persists prefer studio on enter and generation without clearing on view welcome', () => {
  assert.match(appSource, /from '\.\/utils\/welcomeMode'/);
  assert.match(appSource, /shouldStartInWelcomeMode\(\{/);
  assert.match(appSource, /preferStudio: readPreferStudioFlag\(\)/);
  assert.match(
    appSource,
    /const enterStudioFromWelcome = useCallback\(\(\) => \{\s*writePreferStudioFlag\(\);/
  );
  assert.match(appSource, /writePreferStudioFlag\(\);\s*\n\s*if \(!user\) \{/);
  // Casual "View welcome page" must flip welcomeMode without clearing the flag.
  assert.match(
    appSource,
    /onClick=\{\(\) => \{\s*setWelcomeMode\(true\);/
  );
  assert.doesNotMatch(
    appSource,
    /localStorage\.removeItem\(['"]pixtaffy_prefer_studio['"]\)/
  );
});
