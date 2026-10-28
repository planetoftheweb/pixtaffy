import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const buildStudioSource = readFileSync(
  new URL('../components/BuildStudio.tsx', import.meta.url),
  'utf8'
);
const controlPanelSource = readFileSync(
  new URL('../components/ControlPanel.tsx', import.meta.url),
  'utf8'
);
const captureDismissalSources = [
  '../components/GalleryPresetMenu.tsx',
  '../components/DownloadMenu.tsx',
  '../components/RichSelect.tsx',
  '../components/RecentGenerations.tsx',
  '../components/AdminPage.tsx',
].map((path) => [path, readFileSync(new URL(path, import.meta.url), 'utf8')]);
const recentGenerationsSource = captureDismissalSources.find(
  ([path]) => path.endsWith('RecentGenerations.tsx')
)?.[1];
const adminPageSource = captureDismissalSources.find(
  ([path]) => path.endsWith('AdminPage.tsx')
)?.[1];

test('toolbar hint is not suppressed by a cooldown after a later scroll collapse', () => {
  assert.doesNotMatch(appSource, /toolbarHintCooldownRef/);
  assert.match(
    appSource,
    /if \(isToolbarCollapsed\) \{\s*setShowToolbarHint\(true\)/
  );
  assert.match(appSource, /data-testid="toolbar-hidden-hint"/);
});

test('frame name keeps the row stable until the double-click enters rename mode', () => {
  const frameName = buildStudioSource.match(
    /<span\s+data-no-row-drag[\s\S]*?onDoubleClick=\{\(e\) => \{[\s\S]*?setRenamingId\(s\.id\);[\s\S]*?<\/span>/
  );

  assert.ok(frameName, 'frame-name interaction block was not found');
  assert.match(frameName[0], /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(frameName[0], /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
});

test('Enter commits the current frame name without relying on a later blur', () => {
  assert.match(
    buildStudioSource,
    /if \(e\.key === 'Enter'\) \{[\s\S]*?commitStepRename\(s\.id, e\.currentTarget\.value\);/
  );
});

test('toolbar menus dismiss against the active menu instead of the full toolbar', () => {
  assert.match(controlPanelSource, /target\.closest\?\.\('\.mobile-dropdown-panel'\)/);
  assert.match(controlPanelSource, /data-toolbar-dropdown-trigger=\{dropdownName\}/);
  assert.doesNotMatch(
    controlPanelSource,
    /containerRef\.current\?\.contains\(target\) return/
  );
});

test('menu families capture pointer dismissal before child controls can swallow it', () => {
  const sources = [['../components/ControlPanel.tsx', controlPanelSource], ...captureDismissalSources];
  for (const [path, source] of sources) {
    assert.match(
      source,
      /addEventListener\(['"]pointerdown['"],\s*\w+,\s*true\)/,
      `${path} must capture pointerdown for outside-menu dismissal`
    );
  }
});

test('capture-phase dismissal preserves each menu trigger as part of its widget', () => {
  assert.match(recentGenerationsSource, /data-folder-menu\s+onClick=\{\(e\) => \{/);
  assert.match(adminPageSource, /data-admin-row-menu-trigger=\{row\.id\}/);
  assert.match(adminPageSource, /data-admin-row-menu-trigger="\$\{openRowMenu\}"/);
});

const settingsPages = ['SettingsPage', 'LegacySettingsPage'].map(name =>
  readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), 'utf8'));
const settingsPrimitives = readFileSync(new URL('../components/settings/SettingsPrimitives.tsx', import.meta.url), 'utf8');
const settingsPresentation = readFileSync(new URL('../components/settings/keyPresentation.ts', import.meta.url), 'utf8');

test('settings share compact key controls, confirmation, and accessible feedback in both modes', () => {
  for (const source of [...settingsPages, settingsPrimitives]) {
    assert.doesNotMatch(source, /<select\b|\btitle=/);
    assert.doesNotMatch(source, /\u2014/);
  }
  for (const source of settingsPages) {
    assert.match(source, /<SettingsSurface>/);
    assert.match(source, /lg:grid-cols-2/);
    assert.match(source, /<KeyRow/);
    assert.match(source, /<DeleteAllKeys/);
    assert.match(source, /<SettingsToast/);
    assert.match(source, /feedbackId=\{feedbackId\}/);
    assert.match(source, /Settings saved successfully!/);
    assert.match(source, /setKeyMessage\(keyFeedback\(modelId, 'deleted'\)\)/);
    assert.match(source, /setKeyMessage\('All keys deleted'\)/);
    assert.match(source, /SHOW_TEAMS_SETTINGS &&/);
    assert.match(source, /if \(SHOW_TEAMS_SETTINGS\) loadTeams\(\)/);
  }
  assert.match(settingsPresentation, /SHOW_TEAMS_SETTINGS = false/);
  assert.match(settingsPrimitives, /aria-label="Delete key"/);
  assert.match(settingsPrimitives, /aria-label="Delete all keys"/);
  assert.match(settingsPrimitives, /confirm.trigger\('all'\)/);
  assert.match(settingsPrimitives, /confirm.trigger\(slot\)/);
  assert.match(settingsPrimitives, /aria-label="Confirm delete"/);
  assert.match(settingsPrimitives, /aria-label="Confirm delete all keys"/);
  assert.match(settingsPrimitives, /Delete your \{providerName\} key\?/);
  assert.match(settingsPrimitives, /onClick=\{confirm.reset\}/);
  assert.match(settingsPrimitives, /event.key === 'Escape'/);
  assert.match(settingsPrimitives, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(settingsPrimitives, /Sure\?/);
  assert.match(settingsPrimitives, /data-key-slot=\{slot\}/);
});

test('key feedback and persisted row presentation follow save and delete outcomes', async () => {
  const { keyFeedback, keyRowStatus } = await import('../components/settings/keyPresentation.ts');
  assert.equal(keyRowStatus(), 'Not set');
  const saved = { hasKey: true, last4: 'AbCd' };
  assert.equal(keyRowStatus(saved), 'Saved ...AbCd');
  assert.equal(keyFeedback('gemini', 'saved'), 'Gemini key saved');
  assert.equal(keyFeedback('gemini', 'deleted'), 'Gemini key deleted');
  assert.equal(keyRowStatus({ hasKey: false }), 'Not set');
  assert.equal(keyRowStatus({ hasKey: false, last4: 'AbCd' }), 'Not set');
  assert.equal(keyFeedback('openai', 'deleted'), 'OpenAI key deleted');
  assert.equal(keyFeedback('openrouter', 'saved'), 'OpenRouter key saved');
  assert.equal(keyFeedback('gemini-svg', 'deleted'), 'gemini-svg key deleted');
  // Failed deletion retains the persisted status; input edits do not change it.
  assert.equal(keyRowStatus(saved), 'Saved ...AbCd');
});


test('settings feedback is timed, dismissible, and anchored above the mobile safe area', () => {
  const feedback = readFileSync(new URL('../components/settings/SettingsFeedback.tsx', import.meta.url), 'utf8');
  assert.match(feedback, /aria-live="polite"/);
  assert.match(feedback, /aria-label="Dismiss notification"/);
  assert.match(feedback, /safe-area-inset-bottom/);
  assert.match(feedback, /sm:left-auto sm:right-5/);
  assert.match(feedback, /text-\[14px\]/);
  assert.match(feedback, /4000/);
  assert.match(settingsPrimitives, /4000/);
  assert.match(settingsPrimitives, /inlineStatus/);
  for (const source of settingsPages) assert.doesNotMatch(source, /sticky top-16/);
});

test('settings tips require hover or visible keyboard focus and clear on leave and blur', () => {
  const tip = readFileSync(new URL('../components/settings/Tip.tsx', import.meta.url), 'utf8');
  assert.match(tip, /matches\(':focus-visible'\)/);
  assert.match(tip, /addEventListener\('pointerenter', show\)/);
  assert.match(tip, /addEventListener\('pointerleave', hide\)/);
  assert.match(tip, /addEventListener\('focusout', hide\)/);
  assert.match(tip, /useState<DOMRect \| null>\(null\)/);
  const walkthrough = readFileSync(new URL('../e2e/walkthroughs/key-flow.mjs', import.meta.url), 'utf8');
  assert.match(walkthrough, /name: 'Confirm delete'/);
  assert.match(walkthrough, /Gemini key deleted/);
});


test('Quick Start stays suppressed in Settings and after intentional key deletion until a new session', () => {
  assert.match(appSource, /setIsSetupModalOpen\(Boolean\(user && needsSetup && !settingsMode && !setupSuppressedByKeyDeletion\)\)/);
  assert.match(appSource, /\[isAuthResolved, needsSetup, user\?\.id, settingsMode, setupSuppressedByKeyDeletion\]/);
  assert.match(appSource, /!welcomeMode && !settingsMode && !setupSuppressedByKeyDeletion && needsSetup && isSetupModalOpen/);
  assert.match(appSource, /useEffect\(\(\) => \{\s*setSetupSuppressedByKeyDeletion\(false\);\s*\}, \[user\?\.id\]\)/);
  assert.match(appSource, /const handleKeyDeletion = \(\) => \{\s*setSetupSuppressedByKeyDeletion\(true\);\s*setIsSetupModalOpen\(false\)/);
  assert.match(appSource, /onKeyDeletion=\{handleKeyDeletion\}/);
  for (const source of settingsPages) {
    // Notify before async writes can change needsSetup, for individual and bulk deletion.
    assert.match(source, /const handleClearOverride = async \(modelId: string\) => \{\s*onKeyDeletion\(\)/);
    assert.match(source, /const handleDeleteAllKeys = async \(\) => \{\s*onKeyDeletion\(\)/);
  }
});

test('settings toast escapes page stacking contexts and sits above overlays and the footer', () => {
  const feedback = readFileSync(new URL('../components/settings/SettingsFeedback.tsx', import.meta.url), 'utf8');
  assert.match(feedback, /return createPortal\(/);
  assert.match(feedback, /document\.body/);
  assert.match(feedback, /fixed bottom-.*z-\[500\]/);
});

// Exercise the real cache paths with local browser stubs and no network access.
test('history image misses are quiet, session-scoped, and bounded', async (t) => {
  const cache = await import('../services/imageCache.ts');
  const records = new Map();
  const request = (result) => {
    const pending = { result };
    queueMicrotask(() => pending.onsuccess?.());
    return pending;
  };
  const database = {
    transaction() {
      const tx = {
        objectStore: () => ({
          getAllKeys: () => request([...records.keys()]),
          get: (key) => request(records.get(key)),
          getAll: () => request([...records.values()]),
          put: (record) => {
            records.set(record.key, record);
            queueMicrotask(() => tx.oncomplete?.());
          },
        }),
      };
      return tx;
    },
  };
  for (const [name, value] of Object.entries({
    window: {},
    indexedDB: { open: () => request(database) },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  const warnings = t.mock.method(console, 'warn', () => {});
  const errors = t.mock.method(console, 'error', () => {});
  let status = 403;
  let offline = false;
  const fetching = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.mode, 'cors');
    assert.equal(options.credentials, 'omit');
    if (offline) throw new TypeError('Network unavailable');
    return {
      status,
      ok: status === 200,
      blob: async () => new Blob(['pixels'], { type: 'image/png' }),
    };
  });
  const url = 'https://images.example.test/asset';

  await t.test('only 403 and 404 are missing-image statuses', () => {
    for (const value of [403, 404]) assert.equal(cache.isMissingImageStatus(value), true);
    for (const value of [200, 500, 503, undefined, new TypeError('Network unavailable')]) {
      assert.equal(cache.isMissingImageStatus(value), false);
    }
  });

  await t.test('403 and 404 suppress subsequent fetches and remain silent', async () => {
    for (status of [403, 404]) {
      const key = `missing-${status}`;
      const before = fetching.mock.callCount();
      await Promise.all([cache.backfillBlobByKey(key, url), cache.backfillBlobByKey(key, url)]);
      await cache.backfillBlobByKey(key, url);
      assert.equal(cache.isImageMissing(key, url), true);
      assert.equal(fetching.mock.callCount() - before, 1);
    }
    assert.equal(warnings.mock.callCount(), 0);
    assert.equal(errors.mock.callCount(), 0);
  });

  await t.test('a changed URL clears the miss and caches valid bytes', async () => {
    status = 200;
    const before = fetching.mock.callCount();
    await cache.backfillBlobByKey('missing-403', `${url}/fresh`);
    assert.equal(fetching.mock.callCount() - before, 1);
    assert.equal(cache.isImageMissing('missing-403', url), false);
    assert.equal((await cache.getCachedBlobByKey('missing-403')).size, 6);
  });

  await t.test('a changed URL can load while the previous URL is still in flight', async () => {
    let release;
    let started;
    const pending = new Promise(resolve => { started = resolve; });
    fetching.mock.mockImplementation(async (source) => {
      if (source.endsWith('/old')) {
        started();
        return new Promise(resolve => { release = () => resolve({ status: 404, ok: false }); });
      }
      return { status: 200, ok: true, blob: async () => new Blob(['fresh']) };
    });
    const before = fetching.mock.callCount();
    const previous = cache.backfillBlobByKey('changing', `${url}/old`);
    await pending;
    await cache.backfillBlobByKey('changing', `${url}/new`);
    release();
    await previous;
    assert.equal(fetching.mock.callCount() - before, 2);
    assert.equal(cache.isImageMissing('changing', `${url}/new`), false);
  });

  fetching.mock.mockImplementation(async () => {
    if (offline) throw new TypeError('Network unavailable');
    return { status, ok: false };
  });

  await t.test('500, 503 and offline failures retain later-call retry behavior', async () => {
    for (const value of [500, 503, 'offline']) {
      status = value;
      offline = value === 'offline';
      const key = `transient-${value}`;
      const before = fetching.mock.callCount();
      await cache.backfillBlobByKey(key, url);
      await cache.backfillBlobByKey(key, url);
      assert.equal(fetching.mock.callCount() - before, 2);
      assert.equal(cache.isImageMissing(key, url), false);
    }
    offline = false;
  });

  await t.test('history batch and single-key backfills share misses and accept fresh URLs', async () => {
    status = 404;
    const target = { generationId: 'batch', versionId: 'image', imageUrl: url };
    const key = cache.buildImageCacheKey(target.generationId, target.versionId);
    const before = fetching.mock.callCount();
    await cache.backfillImageCache([target]);
    await cache.backfillImageCache([target]);
    await cache.backfillBlobByKey(key, url);
    assert.equal(fetching.mock.callCount() - before, 1);
    await cache.backfillImageCache([{ ...target, imageUrl: `${url}/updated` }]);
    assert.equal(fetching.mock.callCount() - before, 2);
    assert.equal(cache.isImageMissing(key, `${url}/updated`), true);
    assert.equal(warnings.mock.callCount(), 0);
    assert.equal(errors.mock.callCount(), 0);
  });

  await t.test('the negative cache evicts the oldest miss after 256 entries', async () => {
    status = 403;
    for (let index = 0; index <= 256; index += 1) {
      await cache.backfillBlobByKey(`bounded-${index}`, url);
    }
    assert.equal(cache.isImageMissing('bounded-0', url), false);
    assert.equal(cache.isImageMissing('bounded-1', url), true);
    assert.equal(cache.isImageMissing('bounded-256', url), true);
    const before = fetching.mock.callCount();
    await cache.backfillBlobByKey('bounded-256', url);
    assert.equal(fetching.mock.callCount(), before);
    await cache.backfillBlobByKey('bounded-0', url);
    assert.equal(fetching.mock.callCount() - before, 1);
  });
});

test('history images use a terminal accessible placeholder and try each fallback once', () => {
  const source = readFileSync(new URL('../components/CachedImage.tsx', import.meta.url), 'utf8');
  assert.match(source, /fallback \?\? \([\s\S]*?<span[\s\S]*?aria-label="Image unavailable"/);
  assert.match(source, /min-h-\[44px\] min-w-\[44px\]/);
  assert.match(source, /<ImageOff size=\{20\} aria-hidden="true"/);
  assert.doesNotMatch(source, /\btitle=|\u2014|setTimeout|setInterval/);
  assert.match(source, /if \(!renderSrc \|\| failed\)/);
  assert.match(source, /if \(!triedCache\.current\)/);
  assert.match(source, /triedCache\.current = true/);
  assert.match(source, /!triedSources\.current\.has\(fallbackSrc\)/);
  assert.match(source, /if \(triedSources\.current\.has\(renderSrc\)\) return/);
  assert.match(source, /knownMissing \? undefined : src/);
  assert.match(source, /key=\{JSON\.stringify\(\[props\.cacheKey, props\.src, props\.fallbackSrc\]\)\}/);
  const placeholder = source.slice(source.indexOf('if (!renderSrc || failed)'), source.indexOf('return <img'));
  assert.doesNotMatch(placeholder, /onError|<img\b/);
  assert.match(buildStudioSource, /if \(missing\) throw new Error\('Image unavailable'\)/);
  assert.match(buildStudioSource, /fetchImageResponseByKey\(buildImageCacheKey\(generation\.id, version\.id\), version\.imageUrl\)/);
  assert.equal((recentGenerationsSource.match(/<CachedImage\b/g) || []).length, 2);
  assert.doesNotMatch(recentGenerationsSource, /^\s*<img(?:\s|>)/m);
  assert.match(appSource, /<CachedImage\s+cacheKey=\{buildImageCacheKey\(completionToast\.id, toastVersion\.id\)\}/);
});
