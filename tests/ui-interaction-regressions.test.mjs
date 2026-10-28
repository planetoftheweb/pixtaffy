import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('#54 header reserves wordmark width and focus clearance beside auth controls', () => {
  const header = appSource.match(/<header\b[\s\S]*?<\/header>/)?.[0];
  assert.ok(header, 'main header was not found');
  const wrapper = header.match(/<header[^>]*>\s*<div className="([^"]+)"/);
  assert.ok(wrapper, 'wordmark wrapper was not found');
  assert.match(wrapper[1], /\bmin-w-max\b/);
  assert.match(wrapper[1], /\bshrink-0\b/);
  assert.match(header, /<header className="[^"]*\bgap-3\b/);
  assert.match(header, /<div className="flex shrink-0 items-center gap-2 sm:gap-3">/);
  const wordmark = header.match(/<button\b[\s\S]*?<\/button>/)?.[0];
  assert.ok(wordmark, 'wordmark button was not found');
  assert.match(wordmark, /focus-visible:ring-brand-teal\b/);
  assert.match(wordmark, /focus-visible:ring-2\b/);
  assert.match(wordmark, /focus-visible:ring-offset-2\b/);
  assert.match(wordmark, /<img\b[^>]*className="[^"]*\bshrink-0\b/);
  assert.match(wordmark, /<span\s+aria-label="PixTaffy"\s+className="[^"]*\bwhitespace-nowrap\b/);
  for (const mode of ['login', 'signup']) {
    const button = header.match(new RegExp(`<button\\s+onClick=\\{\\(\\) => openAuthModal\\('${mode}'\\)\\}[\\s\\S]*?</button>`))?.[0];
    assert.ok(button, `${mode} button was not found`);
    assert.match(button, /min-h-\[44px\]/);
    assert.match(button, /min-w-\[44px\]/);
    assert.match(button, /\btext-xs\b/);
    assert.match(button, /focus-visible:ring-brand-teal\b/);
  }
});

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
  assert.equal(keyRowStatus(saved), 'Saved …AbCd');
  assert.equal(keyFeedback('gemini', 'saved'), 'Gemini key saved');
  assert.equal(keyFeedback('gemini', 'deleted'), 'Gemini key deleted');
  assert.equal(keyRowStatus({ hasKey: false }), 'Not set');
  assert.equal(keyRowStatus({ hasKey: false, last4: 'AbCd' }), 'Not set');
  assert.equal(keyFeedback('openai', 'deleted'), 'OpenAI key deleted');
  assert.equal(keyFeedback('openrouter', 'saved'), 'OpenRouter key saved');
  assert.equal(keyFeedback('gemini-svg', 'deleted'), 'gemini-svg key deleted');
  // Failed deletion retains the persisted status; input edits do not change it.
  assert.equal(keyRowStatus(saved), 'Saved …AbCd');
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
  assert.match(tip, /addEventListener\('pointerenter', showPointer\)/);
  assert.match(tip, /attributeFilter: \['aria-expanded', 'data-tip-expanded'\]/);
  assert.match(tip, /lastInputWasKeyboard &&/);
  assert.match(tip, /\[data-toolbar-dropdown-trigger\]\[aria-expanded="true"\]/);
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
  assert.match(feedback, /fixed bottom-.*z-\[400\]/);
});

test('disabled Generate has a wrapper hint and an accessible reason', () => {
  assert.match(controlPanelSource, /aria-describedby=\{generateButtonDisabled \? generateReasonId : undefined\}/);
  assert.match(controlPanelSource, /<\/button>\s*<Tip text=\{generateButtonTitle\} side="top" \/>/);
  assert.match(controlPanelSource, /id=\{generateReasonId\} className="sr-only">\{generateButtonTitle\}/);
});

test('tips hand visibility to one owner and release ownership on cleanup', () => {
  const tip = readFileSync(new URL('../components/settings/Tip.tsx', import.meta.url), 'utf8');
  assert.match(tip, /if \(hideVisibleTip !== hide\) hideVisibleTip\?\.\(\)/);
  assert.match(tip, /hideVisibleTip = hide/);
  assert.match(tip, /if \(hideVisibleTip === hide\) hideVisibleTip = null/);
  assert.match(tip, /return \(\) => \{\s*hide\(\);/);
});

test('toolbar and rich menus dismiss focus departures without restoring focus', () => {
  const richSelect = readFileSync(new URL('../components/RichSelect.tsx', import.meta.url), 'utf8');
  for (const source of [controlPanelSource, richSelect]) {
    assert.match(source, /addEventListener\('focusout', handleFocusOut, true\)/);
    assert.match(source, /addEventListener\('focusin', handleFocusIn, true\)/);
    assert.match(source, /event\.relatedTarget/);
    const handler = source.slice(source.indexOf('const handleFocusOut'), source.indexOf("document.addEventListener('focusout'"));
    assert.doesNotMatch(handler, /\.focus\(|close\(/);
  }
  assert.match(controlPanelSource, /data-toolbar-panel=\{name\}/);
  assert.match(richSelect, /menuRef\.current\?\.contains\(target\)/);
});

test('reviewed controls compact only for fine pointers and values appear at xl', () => {
  const auth = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  const legal = readFileSync(new URL('../components/LegalPage.tsx', import.meta.url), 'utf8');
  for (const source of [appSource, auth, legal, controlPanelSource]) {
    assert.doesNotMatch(source, /sm:min-[hw]-0/);
    assert.match(source, /\[@media\(pointer:fine\)\]:min-h-0/);
  }
  assert.match(controlPanelSource, /hidden md:inline xl:hidden/);
  assert.match(controlPanelSource, /hidden xl:flex flex-col flex-1/);
  assert.match(controlPanelSource, /focus:ring-1 focus:ring-brand-teal/);
  assert.match(auth, /flex justify-end/);
  assert.match(auth, /target\.blur\(\)/);
  assert.match(auth, /onMouseDown=\{\(event\) => \{[\s\S]*?if \(event\.target === event\.currentTarget && !onScrollbar && !busyRef\.current\) onClose\(\);/);
  assert.doesNotMatch(auth, /fixed inset-0 z-\[100\][^\n]*\n?[^\n]*onClick=\{onClose\}/);
  for (const source of [appSource, auth, readFileSync(new URL('../components/FeedbackModal.tsx', import.meta.url), 'utf8')]) {
    assert.match(source, /bg-brand-teal[^\n]*text-\[#0d1117\]/);
  }
});

test('outside pointer focus restoration uses the target rather than animation timing', () => {
  const rich = readFileSync(new URL('../components/RichSelect.tsx', import.meta.url), 'utf8');
  for (const source of [controlPanelSource, rich]) {
    assert.ok(source.includes(`const restoreFocus = !target.closest('button,a,input,textarea,select,[tabindex],[contenteditable="true"],label')`));
    assert.match(source, /if \(restoreFocus\) (?:e|event)\.preventDefault\(\);\s*close\(restoreFocus\)/);
    assert.doesNotMatch(source, /document.activeElement === document.body|document.activeElement !== document.body/);
  }
});

test('toolbar trigger identity survives menu toggles and neighbouring triggers can switch menus', () => {
  assert.ok(controlPanelSource.indexOf('const DropdownButton =') < controlPanelSource.indexOf('interface ControlPanelProps'));
  assert.match(controlPanelSource, /if \(target\.closest\?\.\('\[data-toolbar-dropdown-trigger\]'\)\) return/);
  assert.match(controlPanelSource, /if \(isTrigger\(event\.relatedTarget\)/);
  assert.match(controlPanelSource, /if \(isTrigger\(event\.target\)\) return/);
  assert.match(controlPanelSource, /role="option"\s+tabIndex=\{0\}/);
});

test('both menu families explicitly navigate portal boundaries and retain trigger focus', () => {
  const rich = readFileSync(new URL('../components/RichSelect.tsx', import.meta.url), 'utf8');
  const keyboard = readFileSync(new URL('../components/utils/menuKeyboard.ts', import.meta.url), 'utf8');
  for (const source of [controlPanelSource, rich]) {
    assert.match(source, /handleMenuKeyboard\(event,/);
    assert.match(source, /removeEventListener\('keydown', handleNavigation, true\)/);
  }
  assert.match(rich, /event\.relatedTarget instanceof Node && triggerRef\.current\?\.contains\(event\.relatedTarget\)/);
  assert.match(keyboard, /event.key === 'Tab'/);
  assert.match(keyboard, /event.key === 'ArrowDown' \|\| event.key === 'ArrowUp'/);
  assert.match(keyboard, /event.preventDefault\(\)/);
  assert.match(keyboard, /trigger.focus\(\)/);
  assert.match(keyboard, /\(next \|\| trigger\)\.focus\(\);\s+close\(\)/);
  assert.match(keyboard, /!panel.contains\(element\)/);
});

test('disabled Generate explains the prompt and batch cap conditions', () => {
  assert.match(controlPanelSource, /const generateButtonTitle = generateButtonDisabled\s+\? !config.prompt\s+\? 'Type a prompt to generate'/);
  assert.match(controlPanelSource, /exceeds your \$\{batchCapLabel\} cap\. Reduce the count/);
});

test('menu keyboard traversal enters options, returns to trigger, and exits in trigger order', async () => {
  const { handleMenuKeyboard } = await import('../components/utils/menuKeyboard.ts');
  const originalNode = globalThis.Node;
  const originalDocument = globalThis.document;
  let focused;
  class FocusNode {
    constructor(name, children = []) { this.name = name; this.children = children; this.tabIndex = 0; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll() { return this.children; }
    getClientRects() { return [{}]; }
    focus() { focused = this; }
  }
  const previous = new FocusNode('previous');
  const trigger = new FocusNode('trigger');
  const next = new FocusNode('next');
  const first = new FocusNode('first');
  const last = new FocusNode('last');
  const panel = new FocusNode('panel', [first, last]);
  // The portal appears after other page controls, independently of the trigger.
  globalThis.Node = FocusNode;
  globalThis.document = new FocusNode('document', [previous, trigger, next, first, last]);
  let closed = false;
  const press = (target, key, shiftKey = false) => {
    let prevented = false;
    handleMenuKeyboard({ target, key, shiftKey, preventDefault() { prevented = true; } }, trigger, panel, () => { closed = true; });
    assert.ok(prevented);
  };
  try {
    press(trigger, 'Tab'); assert.equal(focused, first); assert.equal(closed, false);
    press(first, 'Tab'); assert.equal(focused, last);
    press(last, 'Tab', true); assert.equal(focused, first);
    press(first, 'Tab', true); assert.equal(focused, trigger); assert.equal(closed, false);
    press(trigger, 'ArrowUp'); assert.equal(focused, last);
    press(last, 'ArrowDown'); assert.equal(focused, first);
    press(first, 'ArrowUp'); assert.equal(focused, last);
    press(last, 'Tab'); assert.equal(focused, next); assert.equal(closed, true);
    closed = false;
    press(trigger, 'Tab', true); assert.equal(focused, previous); assert.equal(closed, true);
  } finally {
    if (originalNode === undefined) delete globalThis.Node; else globalThis.Node = originalNode;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});


test('blank panel mouse defaults are cancelled without blocking touch scrolling', () => {
  const rich = readFileSync(new URL('../components/RichSelect.tsx', import.meta.url), 'utf8');
  for (const source of [controlPanelSource, rich]) {
    const handler = source.slice(source.indexOf('const handleBlankMouseDown'), source.indexOf('const handleFocusOut'));
    assert.match(handler, /in(?:Panel|Menu)\(event.target\)/);
    assert.ok(handler.includes(`!target.closest('button,a,input,textarea,select,[tabindex],[contenteditable="true"],label')`));
    assert.match(handler, /event.preventDefault\(\)/);
    assert.match(source, /addEventListener\('mousedown', handleBlankMouseDown, true\)/);
    assert.match(source, /removeEventListener\('mousedown', handleBlankMouseDown, true\)/);
    assert.doesNotMatch(source, /touchmove|touchstart/);
  }
});

test('Generate remains focusable with a stable action name and guarded activation', () => {
  assert.match(controlPanelSource, /aria-label=\{hasSetupAction \? generateButtonLabel : "Generate image"\}/);
  assert.match(controlPanelSource, /aria-disabled=\{generateButtonDisabled\}/);
  assert.doesNotMatch(controlPanelSource, /\sdisabled=\{generateButtonDisabled\}|aria-label=\{generateButtonTitle\}/);
  assert.match(controlPanelSource, /onClick=\{\(\) => \{\s*if \(generateButtonDisabled\) return;/);
  assert.match(controlPanelSource, /if \(!generateButtonDisabled\) \{[\s\S]*?onGenerate\(safeBatchCount\)/);
  assert.equal((controlPanelSource.match(/onGenerate\(safeBatchCount\)/g) || []).length, 2);
  const button = controlPanelSource.slice(controlPanelSource.indexOf('aria-disabled={generateButtonDisabled}'), controlPanelSource.indexOf('aria-label={hasSetupAction ? generateButtonLabel : "Generate image"}'));
  assert.doesNotMatch(button, /pointer-events-none/);
});

test('auth modal ignores Esc and backdrop presses while a request is busy and uses the FeedbackModal backdrop guard', () => {
  const auth = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  assert.match(auth, /busyRef\.current = isLoading \|\| isResetting;/);
  assert.match(auth, /if \(event\.key !== 'Escape'\) return;[\s\S]*?if \(busyRef\.current\) return;[\s\S]*?target\.blur\(\)/);
  assert.match(auth, /onMouseDown=\{\(event\) => \{[\s\S]*?if \(event\.target === event\.currentTarget && !onScrollbar && !busyRef\.current\) onClose\(\);\s*\}\}/);
  assert.doesNotMatch(auth, /<div onClick=\{onClose\}/);
});

test('auth Escape keeps focus in the dialog and dismissal restores a connected opener', () => {
  const auth = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  assert.match(auth, /target.blur\(\);\s*panelRef.current\?\.focus\(\);\s*return;/);
  assert.match(auth, /ref=\{panelRef\} tabIndex=\{-1\} role="dialog" aria-modal="true"/);
  assert.match(auth, /openerRef.current = document.activeElement instanceof HTMLElement/);
  assert.match(auth, /if \(openerRef.current\?\.isConnected\) openerRef.current.focus\(\)/);
  assert.match(auth, /useLayoutEffect\([\s\S]*?\}, \[isOpen\]\)/);
});

test('auth modal scrolls on short screens and uses teal focus styling', () => {
  const auth = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  const backdrop = auth.match(/className="(fixed inset-0 z-\[100\][^"]*)"/)?.[1] || '';
  assert.match(backdrop, /overflow-y-auto/);
  assert.doesNotMatch(backdrop, /items-center/);
  assert.match(auth, /role="dialog"[^\n]*rounded-2xl w-full max-w-md m-auto/);
  assert.equal((auth.match(/focus:ring-brand-teal/g) || []).length, 4);
  assert.doesNotMatch(auth, /focus:ring-brand-red|text-brand-red|brand-orange/);
  assert.equal((auth.match(/focus-visible:ring-2 focus-visible:ring-brand-teal/g) || []).length, 4);
  const forgot = auth.slice(auth.indexOf('onClick={handlePasswordReset}'), auth.indexOf('onClick={handlePasswordReset}') + 700);
  assert.match(forgot, /text-brand-teal/);
});

test('auth submit button shows an offset teal focus ring instead of the browser outline', () => {
  const auth = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  const submit = auth.slice(auth.indexOf('type="submit"'), auth.indexOf('type="submit"') + 700);
  assert.match(submit, /focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-\[#161b22\]/);
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


const parseTsx = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
const findNodes = (root, predicate) => {
  const matches = [];
  const visit = node => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
};
const directTipCount = node => {
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText() === 'Tip' ? 1 : 0;
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText() === 'Tip' ? 1 : 0;
  // Alternative branches render one hint at a time; expressions and fragments share the host.
  if (ts.isConditionalExpression(node)) return Math.max(directTipCount(node.whenTrue), directTipCount(node.whenFalse));
  let count = 0;
  ts.forEachChild(node, child => { count += directTipCount(child); });
  return count;
};
const hostTipCount = node => node.children.reduce((sum, child) => sum + directTipCount(child), 0);
const componentFiles = directory => readdirSync(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? componentFiles(`${directory}/${entry.name}`)
    : entry.name.endsWith('.tsx') ? [`${directory}/${entry.name}`] : []);
const jsxAttribute = (node, name) => (ts.isJsxSelfClosingElement(node) ? node : node.openingElement).attributes.properties
  .find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === name);
const compileExpression = node => ts.transpileModule(`(${node.getText()})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

const authFocusSource = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
const authFocusAst = parseTsx('AuthModal.tsx', authFocusSource);
const controlPanelAst = parseTsx('ControlPanel.tsx', controlPanelSource);

test('every App and component JSX host has at most one direct Tip, including conditional children', t => {
  const duplicateHosts = tree => findNodes(tree, node => ts.isJsxElement(node) && hostTipCount(node) > 1);
  assert.equal(duplicateHosts(parseTsx('fixture.tsx', '<button><Tip />{reason && <Tip />}</button>')).length, 1);
  assert.equal(duplicateHosts(parseTsx('fixture.tsx', '<button><><Tip /><Tip /></></button>')).length, 1);
  assert.equal(duplicateHosts(parseTsx('fixture.tsx', '<button>{reason ? <Tip /> : <Tip />}</button>')).length, 0);
  const files = ['App.tsx', ...componentFiles('components')];
  const duplicates = files.flatMap(file => {
    const tree = parseTsx(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    return duplicateHosts(tree).map(node => `${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
  });
  assert.deepEqual(duplicates, []);
  t.diagnostic(`AST scan: ${files.length} files, ${duplicates.length} duplicate Tip hosts`);
  const compare = findNodes(controlPanelAst, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText() === 'button' && node.getText().includes('<span>Compare models</span>'))[0];
  assert.equal(findNodes(compare, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Tip').length, 1);
});

test('every icon-only button, summary and link has a shared Tip in both availability states', t => {
  const unhinted = (tree, icons) => {
    const tag = node => ts.isJsxElement(node) ? node.openingElement.tagName.getText()
      : ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : '';
    const iconOnly = node => {
      if (ts.isJsxText(node)) return !node.text.trim();
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node)) return icons.has(tag(node)) || tag(node) === 'Tip';
      if (ts.isJsxExpression(node)) return !node.expression || iconOnly(node.expression);
      if (ts.isConditionalExpression(node)) return iconOnly(node.whenTrue) && iconOnly(node.whenFalse);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return iconOnly(node.right);
      if (ts.isJsxFragment(node)) return node.children.every(iconOnly);
      return node.kind === ts.SyntaxKind.NullKeyword;
    };
    const controls = findNodes(tree, node => ts.isJsxElement(node) && ['button', 'summary', 'a'].includes(tag(node))
      && node.children.every(iconOnly)
      && findNodes(node, child => (ts.isJsxSelfClosingElement(child) || ts.isJsxElement(child)) && icons.has(tag(child))).length);
    return { checked: controls.length, missing: controls.filter(node => hostTipCount(node) === 0
      && !(ts.isJsxElement(node.parent) && hostTipCount(node.parent) > 0)) };
  };
  const icons = new Set(['Icon', 'IconComp', 'ScopeIcon', 'svg']);
  for (const tag of ['button', 'summary', 'a']) {
    assert.equal(unhinted(parseTsx('fixture.tsx', `<${tag}><Icon /></${tag}>`), icons).missing.length, 1);
    assert.equal(unhinted(parseTsx('fixture.tsx', `<${tag}><svg><path d="M0 0" /></svg></${tag}>`), icons).missing.length, 1);
    assert.equal(unhinted(parseTsx('fixture.tsx', `<${tag}><Icon /><Tip text="Action" /></${tag}>`), icons).missing.length, 0);
    assert.equal(unhinted(parseTsx('fixture.tsx', `<span><${tag}><Icon /></${tag}><Tip text="Action" /></span>`), icons).missing.length, 0);
  }
  let checked = 0;
  const missing = [];
  const conditional = [];
  for (const file of ['App.tsx', ...componentFiles('components')]) {
    const tree = parseTsx(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const fileIcons = new Set(icons);
    for (const node of findNodes(tree, node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'lucide-react')) {
      for (const icon of node.importClause.namedBindings.elements) fileIcons.add(icon.name.text);
    }
    const scan = unhinted(tree, fileIcons);
    checked += scan.checked;
    missing.push(...scan.missing.map(node => `${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`));
    for (const tip of findNodes(tree, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Tip')) {
      for (let parent = tip.parent; parent && !ts.isJsxElement(parent); parent = parent.parent) {
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          && /disabled/i.test(parent.left.getText())) conditional.push(`${file}:${tree.getLineAndCharacterOfPosition(tip.getStart()).line + 1}`);
      }
    }
  }
  assert.ok(checked > 0, 'the scanner must inspect real icon controls');
  assert.deepEqual(missing, []);
  assert.deepEqual(conditional, []);
  t.diagnostic(`AST icon scan: ${checked} controls, zero missing or availability-only Tips`);
});

test('every App and component button avoids native disabled attributes', t => {
  const invalidButtons = tree => findNodes(tree, node => (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
    && (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText() === 'button' && jsxAttribute(node, 'disabled'));
  assert.equal(invalidButtons(parseTsx('fixture.tsx', '<button disabled><><Tip /></></button>')).length, 1);
  assert.equal(invalidButtons(parseTsx('fixture.tsx', '<span><button disabled></button><Tip /></span>')).length, 1);
  const files = ['App.tsx', ...componentFiles('components')];
  const invalid = files.flatMap(file => {
    const tree = parseTsx(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    return invalidButtons(tree).map(node => `${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
  });
  assert.deepEqual(invalid, []);
  t.diagnostic(`AST scan: ${files.length} files, ${invalid.length} native disabled buttons`);
});

test('Expand and Model controls retain wrapper tips, accessible reasons and guarded clicks when unavailable', () => {
  const dropdown = controlPanelSource.slice(controlPanelSource.indexOf('const DropdownButton ='), controlPanelSource.indexOf('interface ControlPanelProps'));
  const expand = controlPanelSource.slice(controlPanelSource.indexOf('if (expandButtonDisabled) return;') - 100,
    controlPanelSource.indexOf('id={expandReasonId} className="sr-only"') + 100);
  for (const [source, flag, reasonId, title] of [
    [dropdown, 'disabled', 'disabledReasonId', 'disabledReason'],
    [expand, 'expandButtonDisabled', 'expandReasonId', 'expandButtonTitle'],
  ]) {
    assert.ok(source.includes(`aria-disabled={${flag}}`));
    assert.ok(source.includes(`aria-describedby={${flag} ? ${reasonId} : undefined}`));
    assert.ok(source.includes(`if (${flag}) return;`));
    assert.match(source, new RegExp(`</button>\\s*<Tip[^>]*text=\\{${flag === 'disabled' ? 'disabled \\? disabledReason :' : title}`));
    assert.ok(source.includes(`id={${reasonId}} className="sr-only">{${title}}`));
    assert.doesNotMatch(source, /\sdisabled=/);
  }
  assert.match(dropdown, /relative inline-flex shrink-0 lg:shrink lg:min-w-0 align-top/);
  assert.match(dropdown, /aria-haspopup="listbox"/);
  assert.match(dropdown, /aria-expanded=\{Boolean\(isActive\)\}/);
  assert.match(controlPanelSource, /disabledReason="Model selection is locked"/);
  for (const reason of ['Type a prompt to expand it', 'Expanding prompt…', 'Expand prompt']) assert.ok(controlPanelSource.includes(`'${reason}'`));
  for (const [label, disabledName, actionName, args] of [
    ['dropdownName', 'disabled', 'onClick', [{}]],
    ['"Expand prompt with additional creative detail"', 'expandButtonDisabled', 'handleExpandPrompt', []],
  ]) {
    const button = findNodes(controlPanelAst, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button'
      && node.openingElement.getText().includes(label))[0];
    assert.equal(button.parent.openingElement.tagName.getText(), 'span');
    assert.match(jsxAttribute(button.parent, 'className').initializer.text, /relative inline-flex/);
    const click = jsxAttribute(button, 'onClick').initializer.expression;
    for (const disabled of [true, false]) {
      let calls = 0;
      new Function(disabledName, actionName, `return ${compileExpression(click)}`)(disabled, () => { calls++; })(...args);
      assert.equal(calls, disabled ? 0 : 1);
    }
  }
});

test('auth focuses the first input after opening, and cancels pending focus on cleanup', () => {
  const effect = findNodes(authFocusAst, node => ts.isCallExpression(node) && node.expression.getText() === 'React.useEffect'
    && node.arguments[0].getText().includes('querySelector<HTMLInputElement>'))[0];
  assert.equal(effect.arguments[1].getText(), '[isOpen]', 'mode toggles must not rerun initial focus');
  let queued;
  let focused = 0;
  let cancelled;
  const panelRef = { current: { querySelector: selector => {
    assert.equal(selector, 'input:not([disabled]):not([type="hidden"])');
    return { focus: () => { focused++; } };
  } } };
  const makeEffect = open => new Function('isOpen', 'panelRef', 'requestAnimationFrame', 'cancelAnimationFrame',
    `return ${compileExpression(effect.arguments[0])}`)(open, panelRef, fn => { queued = fn; return 7; }, id => { cancelled = id; });
  assert.equal(makeEffect(false)(), undefined);
  assert.equal(queued, undefined);
  const cleanup = makeEffect(true)();
  assert.equal(focused, 0);
  queued();
  assert.equal(focused, 1);
  cleanup();
  assert.equal(cancelled, 7);
});

test('auth Tab trap wraps both directions, recovers outside focus, and excludes unavailable elements', () => {
  const declaration = findNodes(authFocusAst, node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleTab')[0];
  const document = { activeElement: null };
  const element = (name, overrides = {}) => ({ name, tabIndex: 0, matches: () => false, closest: () => null,
    getClientRects: () => [{}], focus() { document.activeElement = this; }, ...overrides });
  const first = element('Close');
  const middle = element('Email');
  const last = element('Toggle');
  const candidates = [first, middle, last, element('disabled', { matches: () => true }),
    element('hidden ancestor', { closest: () => ({}) }), element('hidden layout', { getClientRects: () => [] }),
    element('negative tabIndex', { tabIndex: -1 }), element('invisible', { visibility: 'hidden' })];
  const panel = element('panel', { querySelectorAll: () => candidates });
  const handleTab = new Function('panelRef', 'document', 'getComputedStyle', `return ${compileExpression(declaration.initializer)}`)(
    { current: panel }, document, node => ({ visibility: node.visibility || 'visible' }));
  const press = (active, shiftKey = false, key = 'Tab') => {
    document.activeElement = active;
    let prevented = false;
    handleTab({ key, shiftKey, preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(press(last), true);
  assert.equal(document.activeElement, first);
  assert.equal(press(first, true), true);
  assert.equal(document.activeElement, last);
  assert.equal(press(element('outside')), true);
  assert.equal(document.activeElement, first);
  assert.equal(press(panel, true), true);
  assert.equal(document.activeElement, last);
  assert.equal(press(middle), false);
  assert.equal(press(last, false, 'ArrowDown'), false);
  candidates.splice(1);
  assert.equal(press(first), true);
  assert.equal(document.activeElement, first);
  candidates.splice(0);
  assert.equal(press(element('outside')), true);
  assert.equal(document.activeElement, panel);
  assert.match(authFocusSource, /addEventListener\('keydown', handleTab, true\)/);
  assert.match(authFocusSource, /removeEventListener\('keydown', handleTab, true\)/);
});

test('auth returns focus to a connected opener and gives non-submit controls explicit button types', () => {
  const layout = findNodes(authFocusAst, node => ts.isCallExpression(node) && node.expression.getText() === 'React.useLayoutEffect')[0];
  const openerRef = { current: null };
  class Element { isConnected = true; focuses = 0; focus() { this.focuses++; } }
  const opener = new Element();
  const document = { activeElement: opener };
  const effect = new Function('isOpen', 'openerRef', 'document', 'HTMLElement', `return ${compileExpression(layout.arguments[0])}`)(true, openerRef, document, Element);
  const cleanup = effect();
  document.activeElement = new Element();
  cleanup();
  assert.equal(opener.focuses, 1);
  opener.isConnected = false;
  cleanup();
  assert.equal(opener.focuses, 1);
  for (const marker of ['aria-label="Close"', 'onClick={toggleMode}']) {
    const button = findNodes(authFocusAst, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button'
      && node.openingElement.getText().includes(marker))[0];
    assert.equal(jsxAttribute(button, 'type').initializer.text, 'button');
  }
});

test('reviewed buttons use rounded-lg and auth copy follows Log in and Log out spelling', () => {
  const feedback = readFileSync(new URL('../components/FeedbackModal.tsx', import.meta.url), 'utf8');
  const tree = parseTsx('FeedbackModal.tsx', feedback);
  for (const label of ['Close feedback', 'Done', 'Cancel']) {
    const button = findNodes(tree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button'
      && (jsxAttribute(node, 'aria-label')?.initializer.text === label || node.children.some(child => ts.isJsxText(child) && child.text.trim() === label)))[0];
    const classes = jsxAttribute(button, 'className').initializer.getText();
    assert.match(classes, /\brounded-lg\b/);
    assert.doesNotMatch(classes, /\brounded-xl\b/);
  }
  const headerLogin = appSource.match(/onClick=\{\(\) => openAuthModal\('login'\)\}\s*className="([^"]+)"/)[1];
  assert.match(headerLogin, /\brounded-lg\b/);
  assert.doesNotMatch(headerLogin, /\brounded-xl\b/);
  assert.ok(appSource.includes('<span>Log out</span>'));
  assert.ok(appSource.includes('Create free account'));
  assert.ok(readFileSync(new URL('../services/authService.ts', import.meta.url), 'utf8').includes('could not reach the login service'));
  assert.ok(readFileSync(new URL('../components/StatsPage.tsx', import.meta.url), 'utf8').includes('label="Last login"'));
  const authServiceCopy = readFileSync(new URL('../services/authService.ts', import.meta.url), 'utf8');
  for (const copy of ['could not log you in', 'Email login is temporarily unavailable', 'Failed to log in.']) assert.ok(authServiceCopy.includes(copy), copy);
  assert.doesNotMatch(authServiceCopy, /could not sign you in|Email log in is|Failed to login\./);
});

test('Login is the noun and log in the verb; toolbar labels stay at least 12px; AuthModal Close is disabled while busy', () => {
  const panel = readFileSync(new URL('../components/ControlPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /hidden md:inline xl:hidden text-\[12px\] uppercase font-bold/);  assert.match(panel, /hidden xl:block whitespace-nowrap text-\[12px\] uppercase font-bold/);  assert.ok(panel.includes("'Expanding prompt\u2026'") || panel.includes("'Expanding prompt…'"));
  assert.doesNotMatch(panel, /Expanding prompt\.\.\./);
  const auth = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  const close = auth.slice(auth.indexOf('aria-label="Close"') - 220, auth.indexOf('aria-label="Close"') + 40);
  assert.match(close, /aria-disabled=\{busy\}/);
  assert.doesNotMatch(close, /\sdisabled=/);
});

test('issue #74: Edit prompt controls and every Build Studio header and toolbar button keep coarse 44px targets', () => {
  const coarse = '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';
  const modal = findNodes(controlPanelAst, node => ts.isJsxElement(node)
    && jsxAttribute(node, 'aria-label')?.initializer.text === 'Edit prompt')[0];
  assert.ok(modal, 'Edit prompt dialog must be found');
  const buttons = findNodes(modal, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button');
  assert.equal(buttons.length, 3, 'review the Close, Expand prompt and Done controls if the dialog changes');
  for (const button of buttons) assert.ok(jsxAttribute(button, 'className').initializer.getText().includes(coarse), button.openingElement.getText());
  const close = buttons.find(button => jsxAttribute(button, 'aria-label')?.initializer.text === 'Close');
  assert.match(jsxAttribute(close, 'className').initializer.getText(), /inline-flex shrink-0 items-center justify-center/);
  const done = buttons.find(button => button.children.some(child => ts.isJsxText(child) && child.text.trim() === 'Done'));
  assert.match(jsxAttribute(done, 'className').initializer.getText(), /bg-brand-teal hover:bg-teal-600 text-\[#0d1117\]/);

  const studio = buildStudioSource;
  const header = studio.slice(studio.indexOf('const SidebarSection'), studio.indexOf('const SidebarSection') + 900);
  assert.ok(header.includes('[@media(pointer:coarse)]:min-h-11'), 'SidebarSection header keeps coarse min-h-11');
  const tree = parseTsx('BuildStudio.tsx', studio);
  const headerRows = findNodes(tree, node => ts.isJsxElement(node) && node.children.some(child => ts.isJsxElement(child)
    && child.openingElement.tagName.getText() === 'h2' && child.children.some(text => ts.isJsxText(text) && text.text === 'Build Studio')));
  assert.equal(headerRows.length, 1, 'review Build Studio header coverage if its row changes');
  const headerButtons = findNodes(headerRows[0], node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button');
  assert.deepEqual(headerButtons.map(button => jsxAttribute(button, 'aria-label')?.initializer.text), [
    'Export PowerPoint with builds', 'Export PNGs for slides', 'Export MP4', 'Close Build Studio',
  ], 'review all header buttons if the row changes');
  const toolbar = findNodes(tree, node => ts.isJsxElement(node) && jsxAttribute(node, 'ref')?.initializer.expression?.getText() === 'toolbarRef');
  assert.equal(toolbar.length, 1, 'floating toolbar must be found');
  const toolbarButtons = findNodes(toolbar[0], node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button');
  assert.equal(toolbarButtons.length, 4, 'review grip, AI, cleanup and selected-frame coverage if the toolbar changes');
  const shared = findNodes(tree, node => ts.isVariableDeclaration(node) && node.name.getText() === 'ToolBarButton');
  assert.equal(shared.length, 1, 'shared toolbar button must be found');
  const sharedButtons = findNodes(shared[0], node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button');
  assert.equal(sharedButtons.length, 1);
  for (const button of [...headerButtons, ...toolbarButtons, ...sharedButtons]) {
    assert.ok(jsxAttribute(button, 'className').initializer.getText().includes(coarse), button.openingElement.getText());
  }
});

const evaluateExpression = (node, bindings) => new Function(...Object.keys(bindings),
  `return ${compileExpression(node)}`)(...Object.values(bindings));
const attributeValue = (node, name, bindings) => {
  const value = jsxAttribute(node, name)?.initializer;
  return ts.isStringLiteral(value) ? value.text : evaluateExpression(value.expression, bindings);
};
const localExpression = (tree, name) => {
  const declaration = findNodes(tree, node => ts.isVariableDeclaration(node) && node.name.getText() === name)[0];
  assert.ok(declaration, `${name} must be exercised`);
  const value = declaration.initializer;
  return ts.isCallExpression(value) && value.expression.getText().endsWith('useCallback') ? value.arguments[0] : value;
};

test('all 16 converted controls expose one sibling reason Tip and block unavailable activation', async t => {
  const blocked = {
    FOCUS_RING: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
    busy: true, busyRef: { current: true }, resetDisabled: true, submitDisabled: true, sendDisabled: true,
    deletingRefinementId: 'pending', refinementControlsLocked: true, disabled: true, moveDisabled: true,
    applyRefinementDisabled: true, recomposeDisabled: true, expandButtonDisabled: true, isExpandingPrompt: true,
    config: { prompt: 'fixture' }, visibleHistory: [], disabledTipId: 'fixture', v: { id: 'mark' },
    closeReasonId: 'close', resetReasonId: 'reset', submitReasonId: 'submit', sendReasonId: 'send', modalExpandReasonId: 'expand',
    resetTip: 'Wait for the request to finish', submitTip: 'Wait for the request to finish', sendTip: 'Wait for the request to finish',
    tooltip: 'Wait for the request to finish', recomposeTip: 'Wait for the request to finish', applyRefinementTip: 'Wait for the request to finish',
    moveTip: 'Wait for the request to finish', deleteTip: 'Wait for the request to finish', expandButtonTitle: 'Expanding prompt…',
  };
  let checked = 0;
  for (const [file, reasonMarker, expected] of [
    ['AuthModal', /closeReasonId|resetReasonId|submitReasonId/, 3],
    ['FeedbackModal', /sendReasonId/, 1],
    ['ImageDisplay', /disabledTipId/, 8],
    ['RecentGenerations', /disabledTipId/, 3],
    ['ControlPanel', /modalExpandReasonId/, 1],
  ]) {
    const tree = parseTsx(`${file}.tsx`, readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), 'utf8'));
    const buttons = findNodes(tree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button'
      && reasonMarker.test(jsxAttribute(node, 'aria-describedby')?.getText() || ''));
    assert.equal(buttons.length, expected, `${file} coverage must not silently shrink`);
    for (const button of buttons) await t.test(`${file}: ${jsxAttribute(button, 'aria-describedby').getText()}`, async () => {
      checked++;
      assert.equal(jsxAttribute(button, 'disabled'), undefined);
      assert.equal(hostTipCount(button), 0);
      const wrapper = button.parent;
      assert.equal(hostTipCount(wrapper), 1, 'each wrapper owns one Tip');
      const tips = findNodes(wrapper, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Tip');
      assert.equal(tips.length, 1);
      assert.match(attributeValue(tips[0], 'text', blocked), /Wait for|no images|Expanding prompt/);
      assert.equal(attributeValue(button, 'aria-disabled', blocked), true);
      const reason = attributeValue(button, 'aria-describedby', blocked);
      const spans = findNodes(wrapper, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'span'
        && jsxAttribute(node, 'className')?.initializer.text === 'sr-only');
      assert.ok(spans.some(span => attributeValue(span, 'id', blocked) === reason), 'aria-describedby resolves to the reason');
      const classes = attributeValue(button, 'className', blocked);
      assert.match(classes, /opacity-(?:50|60|70)/);
      assert.match(classes, /cursor-not-allowed/);
      assert.doesNotMatch(classes, /(?:hover|active):/, 'unavailable controls have no hover or active styling');
      let action = jsxAttribute(button, 'onClick')?.initializer.expression;
      if (!action) {
        let form = wrapper;
        while (form && (!ts.isJsxElement(form) || form.openingElement.tagName.getText() !== 'form')) form = form.parent;
        assert.ok(form, 'submit control must have a guarded form');
        action = jsxAttribute(form, 'onSubmit').initializer.expression;
      }
      if (ts.isIdentifier(action)) action = localExpression(tree, action.getText());
      let prevented = false;
      const bindings = file === 'FeedbackModal'
        ? { ...blocked, sendFeedback: evaluateExpression(localExpression(tree, 'sendFeedback'), blocked) } : blocked;
      await evaluateExpression(action, bindings)({ preventDefault: () => { prevented = true; }, stopPropagation() {} });
      if (jsxAttribute(button, 'type')?.initializer.text === 'submit') assert.equal(prevented, true);
    });
  }
  assert.equal(checked, 16);
});

test('auth busy Close keeps its explanatory Tip and ignores clicks without native disabling', () => {
  const button = findNodes(authFocusAst, node => ts.isJsxElement(node) && jsxAttribute(node, 'aria-label')?.initializer.text === 'Close')[0];
  const tip = findNodes(button.parent, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Tip')[0];
  for (const busy of [true, false]) {
    let closes = 0;
    evaluateExpression(jsxAttribute(button, 'onClick').initializer.expression, { busyRef: { current: busy }, onClose: () => { closes++; } })();
    assert.equal(closes, busy ? 0 : 1);
    assert.equal(attributeValue(tip, 'text', { busy }), busy ? 'Wait for the request to finish' : 'Close');
  }
});

test('form reasons cover missing input and requests already in flight without calling Auth', () => {
  const derive = (tree, inputs, names) => {
    const bindings = { ...inputs };
    for (const name of names) bindings[name] = evaluateExpression(localExpression(tree, name), bindings);
    return bindings;
  };
  const filled = { isLoading: false, isResetting: false, isLogin: true, name: '', username: '', email: 'fixture', password: 'fixture' };
  for (const [inputs, expected] of [
    [filled, [false, false]],
    [{ ...filled, email: '' }, [true, true]],
    [{ ...filled, password: '' }, [false, true]],
    [{ ...filled, isLogin: false }, [false, true]],
    [{ ...filled, isLoading: true }, [true, true]],
    [{ ...filled, isResetting: true }, [true, true]],
  ]) {
    const state = derive(authFocusAst, inputs, ['busy', 'resetDisabled', 'resetTip', 'submitDisabled', 'submitTip']);
    assert.deepEqual([state.resetDisabled, state.submitDisabled], expected);
    if (state.busy) assert.equal(state.submitTip, 'Wait for the request to finish');
    else if (state.submitDisabled) assert.match(state.submitTip, /Enter your/);
  }
  const tree = parseTsx('FeedbackModal.tsx', readFileSync(new URL('../components/FeedbackModal.tsx', import.meta.url), 'utf8'));
  for (const [busy, message, expected] of [[false, '', true], [false, ' a ', true], [false, 'note', false], [true, 'note', true]]) {
    const state = derive(tree, { busy, message }, ['sendDisabled', 'sendTip']);
    assert.equal(state.sendDisabled, expected);
    if (busy) assert.equal(state.sendTip, 'Wait for the request to finish');
    else if (expected) assert.match(state.sendTip, /at least 3 characters/);
  }
});

test('Edit prompt footer hints use the shared portal and the placeholder ends with one ellipsis', () => {
  const modal = findNodes(controlPanelAst, node => ts.isJsxElement(node) && jsxAttribute(node, 'aria-label')?.initializer.text === 'Edit prompt')[0];
  const tips = findNodes(modal, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Tip');
  assert.equal(tips.length, 3);
  assert.equal(jsxAttribute(tips[0], 'text').initializer.text, 'Close');
  assert.equal(jsxAttribute(tips[0], 'side').initializer.text, 'bottom');
  assert.equal(jsxAttribute(tips[1], 'text').initializer.expression.getText(), 'expandButtonTitle');
  assert.equal(jsxAttribute(tips[2], 'text').initializer.text, 'Close the editor');
  assert.ok(tips.slice(1).every(tip => jsxAttribute(tip, 'side').initializer.text === 'top'));
  const textarea = findNodes(modal, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'textarea')[0];
  assert.equal(jsxAttribute(textarea, 'placeholder').initializer.text, 'Prompt or drop image ({a,b} or ["tile 1","tile 2"])…');
  const tip = readFileSync(new URL('../components/settings/Tip.tsx', import.meta.url), 'utf8');
  assert.match(tip, /createPortal\([\s\S]*document.body/);
  assert.match(tip, /position: 'fixed'[\s\S]*zIndex: 500/);
});

test('locked Model wrapper suppresses hints while neighbouring menus are open and preserves button focus lookups', () => {
  const dropdown = findNodes(controlPanelAst, node => ts.isVariableDeclaration(node) && node.name.getText() === 'DropdownButton')[0];
  const wrapper = findNodes(dropdown, node => ts.isJsxElement(node) && jsxAttribute(node, 'data-toolbar-dropdown-wrapper'))[0];
  assert.ok(wrapper, 'disabled Model Tip needs the toolbar wrapper marker');
  assert.equal(jsxAttribute(wrapper, 'data-toolbar-dropdown-trigger'), undefined);
  assert.equal(jsxAttribute(wrapper, 'data-tip-expanded').initializer.expression.getText(), 'Boolean(isActive)');
  const triggers = findNodes(controlPanelAst, node => ts.isJsxElement(node) && jsxAttribute(node, 'data-toolbar-dropdown-trigger'));
  assert.ok(triggers.length > 0);
  assert.ok(triggers.every(node => node.openingElement.tagName.getText() === 'button'), 'focus-return selectors must still resolve to buttons');

  const source = readFileSync(new URL('../components/settings/Tip.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /:disabled/);
  const tree = parseTsx('Tip.tsx', source);
  const effect = findNodes(tree, node => ts.isCallExpression(node) && node.expression.getText() === 'useEffect')[0];
  const listeners = new Map();
  const toolbar = {};
  const rect = { left: 20, top: 30, right: 64, bottom: 74, width: 44, height: 44 };
  let otherOpen = false;
  let ownOpen = false;
  let observed;
  let notify;
  let visible = null;
  const host = {
    matches: selector => selector === ':disabled' || selector.includes('[data-toolbar-dropdown-wrapper]'),
    getAttribute: () => String(ownOpen),
    getBoundingClientRect: () => rect,
    closest: () => toolbar,
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name),
  };
  class Element { matches() { return true; } }
  class Observer {
    constructor(callback) { notify = callback; }
    observe(target, options) { observed = { target, options }; }
    disconnect() {}
  }
  const cleanup = new Function('anchorRef', 'setHostRect', 'MutationObserver', 'document', 'window', 'HTMLElement',
    `let hideVisibleTip = null; const lastInputWasKeyboard = true; return (${compileExpression(effect.arguments[0]).replace(/;\s*$/, '')})();`)(
    { current: { parentElement: host } }, value => { visible = value; }, Observer,
    { querySelector: () => otherOpen ? {} : null }, { addEventListener() {}, removeEventListener() {} }, Element);
  assert.equal(observed.target, toolbar);
  assert.equal(observed.options.subtree, true, 'a neighbouring trigger expanding must hide an already visible Tip');
  listeners.get('pointerenter')({ pointerType: 'touch' });
  assert.equal(visible, null);
  listeners.get('pointerenter')({ pointerType: 'mouse' });
  assert.equal(visible, rect, 'native-disabled state is no longer a Tip suppression rule');
  otherOpen = true;
  notify();
  assert.equal(visible, null);
  listeners.get('pointerenter')({ pointerType: 'mouse' });
  listeners.get('focusin')({ target: new Element() });
  assert.equal(visible, null, 'hover and keyboard hints stay hidden beside an open menu');
  otherOpen = false;
  listeners.get('focusin')({ target: new Element() });
  assert.equal(visible, rect);
  ownOpen = true;
  notify();
  assert.equal(visible, null);
  cleanup();
  assert.equal(listeners.size, 0);
});

test('portal hints clamp within the four requested viewports near modal footer edges', () => {
  const tree = parseTsx('Tip.tsx', readFileSync(new URL('../components/settings/Tip.tsx', import.meta.url), 'utf8'));
  const layout = findNodes(tree, node => ts.isCallExpression(node) && node.expression.getText() === 'useLayoutEffect')[0];
  for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [1280, 800]]) {
    for (const left of [8, width - 52]) {
      const style = {};
      evaluateExpression(layout.arguments[0], {
        tipRef: { current: { style, getBoundingClientRect: () => ({ width: 240, height: 48 }) } },
        hostRect: { left, top: height - 64, bottom: height - 20, width: 44 },
        side: 'top', window: { innerWidth: width, innerHeight: height },
      })();
      assert.ok(parseFloat(style.left) >= 8 && parseFloat(style.left) + 240 <= width - 8);
      assert.ok(parseFloat(style.top) >= 8 && parseFloat(style.top) + 48 <= height - 8);
      assert.equal(style.visibility, 'visible');
    }
  }
});

test('section 8 documents the settings delete confirmation exception once', () => {
  const design = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
  const section = design.slice(design.indexOf('## 8.'), design.indexOf('## 9.'));
  const line = '- Settings deletes may use an inline pale-amber confirm panel instead of double-tap arming.';
  assert.equal(section.split('\n').filter(value => value === line).length, 1);
});

test('#80 shared toolbar options, count presets and #74 Close keep coarse targets at every width', () => {
  const rows = findNodes(controlPanelAst, node => ts.isJsxElement(node)
    && jsxAttribute(node, 'role')?.initializer.text === 'option');
  const shared = rows.find(node => jsxAttribute(node, 'tabIndex'));
  assert.ok(shared, 'Type and Size must use the shared row');
  assert.match(jsxAttribute(shared, 'className').getText(), /\[@media\(pointer:coarse\)\]:min-h-11/);
  const counts = rows.filter(node => node.openingElement.tagName.getText() === 'button'
    && jsxAttribute(node, 'key')?.initializer.expression?.getText() === 'n');
  assert.equal(counts.length, 1, 'preset count rows must be covered');
  assert.match(jsxAttribute(counts[0], 'className').getText(), /\[@media\(pointer:coarse\)\]:min-h-11/);
  const modal = findNodes(controlPanelAst, node => ts.isJsxElement(node) && jsxAttribute(node, 'aria-label')?.initializer.text === 'Edit prompt')[0];
  const close = findNodes(modal, node => ts.isJsxElement(node) && jsxAttribute(node, 'aria-label')?.initializer.text === 'Close')[0];
  assert.match(jsxAttribute(close, 'className').getText(), /inline-flex shrink-0/);
  for (const dimension of ['h', 'w']) assert.ok(jsxAttribute(close, 'className').getText().includes(`[@media(pointer:coarse)]:min-${dimension}-11`));
});

test('#81 Studio buttons, links, inputs and options retain a focus ring, including shared primitives', t => {
  const focus = readFileSync(new URL('../utils/focusRing.ts', import.meta.url), 'utf8');
  assert.match(focus, /focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-\[#0d1117\]/);
  const exceptions = new Map([
    ['hidden', 'Hidden controls cannot receive keyboard focus.'],
    ['file', 'The visible upload button owns focus for hidden file inputs.'],
  ]);
  const invalid = [];
  let controls = 0;
  for (const file of ['App.tsx', ...componentFiles('components')]) {
    const tree = parseTsx(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const definitions = new Map(findNodes(tree, ts.isVariableDeclaration).filter(node => node.initializer)
      .map(node => [node.name.getText(), node.initializer.getText()]));
    for (const node of findNodes(tree, node => (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
      && (['button', 'a', 'input'].includes((ts.isJsxElement(node) ? node.openingElement : node).tagName.getText())
        || jsxAttribute(node, 'role')?.initializer.text === 'option'))) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (opening.tagName.getText() === 'input' && (jsxAttribute(node, 'hidden') || exceptions.has(jsxAttribute(node, 'type')?.initializer?.text))) continue;
      const classes = jsxAttribute(node, 'className')?.getText() || '';
      const resolved = classes.replace(/\b\w+\b/g, word => definitions.get(word) || word);
      controls++;
      if (!/FOCUS_RING|focus(?:-visible)?:ring-[12]/.test(resolved)) invalid.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
  }
  assert.deepEqual(invalid, []);
  assert.match(controlPanelSource, /tabular-nums focus:outline-none focus:ring-1 focus:ring-brand-teal/);
  assert.doesNotMatch(controlPanelSource, /focus-within:ring-2 focus-within:ring-brand-teal/);
  assert.match(settingsPrimitives, /className=\{`\$\{className \|\| ''\} \$\{FOCUS_RING\}/, 'prop className must not overwrite the shared ring');
  assert.match(settingsPrimitives, /<input \{\.\.\.props\} className=\{`\$\{props.className \|\| ''\} \$\{FOCUS_RING\}/);
  const settingsCss = readFileSync(new URL('../components/settings/settings.css', import.meta.url), 'utf8');
  assert.match(settingsCss, /button:focus-visible\) \{ outline: 2px solid var\(--color-brand-teal\); outline-offset: 2px;/);
  assert.match(settingsCss, /@media \(pointer: coarse\)[\s\S]*min-height: 44px;[\s\S]*min-width: 44px;/);
  t.diagnostic(`AST focus scan: ${controls} controls; hidden and file inputs are the only exceptions`);
});

test('#82 wordmark and project footer controls each own their portal Tip', () => {
  const tree = parseTsx('App.tsx', appSource);
  for (const [text, marker] of [
    ['Open PixTaffy home', 'aria-label="PixTaffy"'],
    ['Changelog on GitHub', 'GITHUB_CHANGELOG_URL'],
    ['Releases on GitHub', 'GITHUB_RELEASES_URL'],
    ['Send feedback', 'setIsFeedbackOpen(true)'],
  ]) {
    const hosts = findNodes(tree, node => ts.isJsxElement(node)
      && ['button', 'a'].includes(node.openingElement.tagName.getText()) && node.getText().includes(marker));
    assert.ok(hosts.some(host => findNodes(host, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Tip'
      && jsxAttribute(node, 'text')?.initializer.text === text).length === 1), text);
  }
  const footer = findNodes(tree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'footer')[0];
  const tips = findNodes(footer, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Tip');
  assert.equal(tips.length, 4);
  assert.ok(tips.every(tip => jsxAttribute(tip, 'side').initializer.text === 'top'));
});

test('literal ellipsis sweep covers JSX, attributes and UI status strings without scanning spreads or comments', t => {
  const codeFiles = directory => readdirSync(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? codeFiles(`${directory}/${entry.name}`)
      : /\.tsx?$/.test(entry.name) ? [`${directory}/${entry.name}`] : []);
  const allowlist = new Map([
    ['services/structureSeeder.ts:Admin authenticated. Seeding global defaults...', 'Admin-only diagnostic console output, never displayed in the UI.'],
  ]);
  const invalid = [];
  for (const file of ['App.tsx', ...['components', 'utils', 'services'].flatMap(codeFiles)]) {
    const tree = parseTsx(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    for (const node of findNodes(tree, node => (ts.isStringLiteral(node) || ts.isJsxText(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.includes('...'))) {
      if (!allowlist.has(`${file}:${node.text}`)) invalid.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.text}`);
    }
  }
  assert.deepEqual(invalid, []);
  assert.ok(controlPanelSource.includes('Esc to close – Cmd/Ctrl+Enter to generate'));
  t.diagnostic('Skipped only console output, comments, spread syntax and regex literals');
});

test('all newly converted buttons have conditional reason spans, sibling Tips and guarded activation', t => {
  const blocked = {
    job: { status: 'stopping', id: 'job' }, isBusy: true, isSelf: true, bootstrapClaiming: true, isLoadingMore: true,
    busy: true, disabled: true, exportSupported: false, exportingPptx: true, exportingPngs: true, exporting: true,
    autoSelecting: true, stopIndex: 0, stops: ['one'], naming: true, userId: null,
    isSavingPreset: true, presetNameDraft: '', isPromptImageAnalyzing: true, isAnalyzing: true,
    userTeams: [], newItemName: '', isDisabled: true, canGoNewer: false, canGoOlder: false,
    refinementInput: '', canResizeToSelected: false, refinementControlsLocked: true, rerunDraft: '', onRerun: undefined,
    isSubmittingInstructions: true, isSubmittingRename: true, renameDraft: '', isUpdating: true, isApplied: true,
    loading: true, billing: { plan: 'pro' }, folderBusy: true, newFolderDraft: '', tileDownloadBusy: true,
    inFolder: true, galleryPage: 1, galleryTotalPages: 1, isInteractive: false, isLoading: true,
    unavailableId: 'reason', row: { id: 'row' }, item: { id: 'item' }, product: { id: 'product' }, folder: { id: 'folder' }, opt: { id: 'format' },
  };
  let checked = 0;
  for (const file of ['App.tsx', ...componentFiles('components')]) {
    const tree = parseTsx(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    for (const button of findNodes(tree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button'
      && jsxAttribute(node, 'aria-describedby')?.getText().includes('unavailableId'))) {
      checked++;
      const state = { ...blocked, disabledReason: 'This tool is unavailable for the current frame', busy: file.endsWith('PricingPage.tsx') ? 'verify' : true };
      const flag = jsxAttribute(button, 'aria-disabled').initializer.expression;
      assert.equal(evaluateExpression(flag, state), true, `${file} ${flag.getText()}`);
      let prevented = false;
      evaluateExpression(jsxAttribute(button, 'onClick').initializer.expression, state)({ preventDefault() { prevented = true; }, stopPropagation() {} });
      assert.equal(prevented, true, 'the unavailable click must return before running its action');
      const reason = attributeValue(button, 'aria-describedby', state);
      const spans = findNodes(button.parent, node => ts.isJsxElement(node) && jsxAttribute(node, 'id')
        && jsxAttribute(node, 'className')?.initializer.text === 'sr-only');
      const span = spans.find(node => attributeValue(node, 'id', state) === reason);
      assert.ok(span, `${file}: reason must exist`);
      assert.ok(ts.isBinaryExpression(span.parent) && span.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken,
        'reason span must only render while disabled');
      assert.equal(evaluateExpression(span.parent.left, state), true);
      const tips = findNodes(button.parent, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Tip');
      assert.equal(tips.length, 1, 'one wrapper Tip per converted control');
      assert.equal(typeof attributeValue(tips[0], 'text', state), 'string');
    }
  }
  assert.equal(checked, 57, 'all converted buttons, including the four navigation controls');
  assert.match(recentGenerationsSource, /const next = renameDraft.trim\(\);\s*if \(folderBusy \|\| !next\) return;/);
  assert.match(recentGenerationsSource, /const next = newFolderDraft.trim\(\);\s*if \(folderBusy \|\| !next\) return;/);
  for (const source of [controlPanelSource, captureDismissalSources.find(([file]) => file.endsWith('GalleryPresetMenu.tsx'))[1]]) {
    assert.match(source, /const handleConfirmSavePreset = async \(\) => \{\s*if \(isSavingPreset \|\| !presetNameDraft.trim\(\)\) return;/);
  }
  t.diagnostic(`${checked} unavailable actions blocked without any backend calls`);
});

test('all four navigation controls prevent disabled clicks and activate only when enabled', () => {
  const imageDisplaySource = readFileSync(new URL('../components/ImageDisplay.tsx', import.meta.url), 'utf8');
  const cases = [
    [imageDisplaySource, 'Previous generation (newer)', 'canGoNewer', 'goNewer', false],
    [imageDisplaySource, 'Next generation (older)', 'canGoOlder', 'goOlder', false],
    [recentGenerationsSource, 'Previous page', 'galleryPage', 'setGalleryPage', 1],
    [recentGenerationsSource, 'Next page', 'galleryPage', 'setGalleryPage', 3],
  ];
  for (const [source, label, flag, action, blocked] of cases) {
    const tree = parseTsx('navigation.tsx', source);
    const button = findNodes(tree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button'
      && jsxAttribute(node, 'aria-label')?.initializer.text === label)[0];
    assert.ok(button, label);
    for (const disabled of [true, false]) {
      let calls = 0;
      let prevented = 0;
      let stopped = 0;
      const state = {
        [flag]: disabled ? blocked : typeof blocked === 'boolean' ? true : 2,
        galleryTotalPages: 3,
        [action]: update => { calls++; if (typeof update === 'function') assert.equal(update(2), label === 'Previous page' ? 1 : 3); },
      };
      assert.equal(evaluateExpression(jsxAttribute(button, 'aria-disabled').initializer.expression, state), disabled);
      const reason = attributeValue(button, 'aria-describedby', { ...state, unavailableId: 'reason' });
      const reasonSpan = findNodes(button.parent, node => ts.isJsxElement(node)
        && node.openingElement.tagName.getText() === 'span' && jsxAttribute(node, 'id'))[0];
      assert.ok(reasonSpan, `${label}: conditional reason span`);
      assert.equal(evaluateExpression(reasonSpan.parent.left, state), disabled);
      assert.equal(reason, disabled ? attributeValue(reasonSpan, 'id', { unavailableId: 'reason' }) : undefined);
      evaluateExpression(jsxAttribute(button, 'onClick').initializer.expression, state)({
        preventDefault() { prevented++; }, stopPropagation() { stopped++; },
      });
      assert.equal(calls, disabled ? 0 : 1, `${label}: action count`);
      assert.equal(prevented, disabled ? 1 : 0, `${label}: default navigation`);
      assert.equal(stopped, disabled ? 1 : 0, `${label}: propagation`);
    }
  }
});

test('SettingsButton consumes disabled props instead of forwarding them onto its native button', () => {
  const tree = parseTsx('SettingsPrimitives.tsx', settingsPrimitives);
  const fn = findNodes(tree, node => ts.isFunctionDeclaration(node) && node.name.text === 'SettingsButton')[0];
  assert.ok(fn.parameters[0].name.elements.some(element => element.name.getText() === 'disabled'));
  const button = findNodes(fn, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button')[0];
  assert.ok(jsxAttribute(button, 'aria-disabled'));
  assert.ok(jsxAttribute(button, 'aria-describedby'));
  const click = jsxAttribute(button, 'onClick').initializer.expression;
  for (const disabled of [true, false]) {
    let calls = 0, prevented = false;
    evaluateExpression(click, { disabled, onClick: () => { calls++; } })({ preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.equal(calls, disabled ? 0 : 1);
    assert.equal(prevented, disabled);
  }
});

test('rail and version-popover delete badges keep coarse 44px targets inside the thumbnail', () => {
  const source = readFileSync(new URL('../components/ImageDisplay.tsx', import.meta.url), 'utf8');
  const tree = parseTsx('ImageDisplay.tsx', source);
  const buttons = findNodes(tree, node => ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button'
    && jsxAttribute(node, 'onClick')?.getText().includes('handleVersionDeleteClick(v.id)'));
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.match(jsxAttribute(button, 'className').getText(), /\[@media\(pointer:coarse\)\]:min-h-11 \[@media\(pointer:coarse\)\]:min-w-11/);
  }
  assert.match(source, /absolute top-1 right-1 z-10 inline-flex/);
  assert.match(source, /relative w-full group\/railThumb/);
  assert.match(source, /w-\[124px\]/, 'the rail reserves enough space for a 44px delete badge plus its 4px inset');
});

test('copy-menu layers join the documented scale below modals', () => {
  const design = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');
  assert.match(design, /z-50` busy banners → `z-\[59\]` floating-menu click catchers → `z-\[60\]` floating menus above banners → `z-\[70\]` context menus and hover previews → `z-\[100\]` modals/);
});

test('generic tooltip hosts use neutral expansion data and real menu controls retain aria-expanded', () => {
  for (const file of ['App.tsx', ...componentFiles('components')]) {
    const tree = parseTsx(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const invalid = findNodes(tree, node => (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
      && /^[a-z]/.test((ts.isJsxElement(node) ? node.openingElement : node).tagName.getText())
      && (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText() !== 'button' && jsxAttribute(node, 'aria-expanded'));
    assert.deepEqual(invalid.map(node => node.getText()), []);
  }
  assert.match(recentGenerationsSource, /data-folder-menu ref=\{moveMenuTriggerRef\} data-tip-expanded=\{moveMenuOpen\}/);
  const tip = readFileSync(new URL('../components/settings/Tip.tsx', import.meta.url), 'utf8');
  assert.match(tip, /host.getAttribute\('data-tip-expanded'\)/);
  assert.match(tip, /host.matches\('button\[aria-haspopup\]'\)/);
});

test('confirmation hook disarms on blur, times out, switches keys and still confirms the second click', () => {
  const source = readFileSync(new URL('../hooks/useConfirmAction.ts', import.meta.url), 'utf8');
  const tree = parseTsx('useConfirmAction.ts', source);
  const hook = localExpression(tree, 'useConfirmAction');
  const slots = [], cleanups = [], timers = new Map();
  let cursor = 0, timerId = 0, calls = 0;
  const useState = initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; };
  const useRef = initial => { const index = cursor++; return slots[index] ||= { current: initial }; };
  const useCallback = fn => fn;
  const useEffect = fn => { if (!cleanups.length) cleanups.push(fn()); };
  const window = { setTimeout(fn, delay) { assert.equal(delay, 3000); timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const render = () => { cursor = 0; return evaluateExpression(hook, { useState, useRef, useCallback, useEffect, window })({ onConfirm: () => { calls++; } }); };
  let confirm = render();
  assert.equal(confirm.trigger('one'), false);
  confirm = render();
  confirm.bindDisarmOnBlur('other').onBlur();
  assert.equal(render().isArmed('one'), true);
  confirm.bindDisarmOnBlur('one').onBlur();
  confirm = render();
  assert.equal(confirm.armedKey, null);
  assert.equal(timers.size, 0);
  assert.equal(confirm.trigger('one'), false, 'a click after blur must arm again');
  confirm = render();
  assert.equal(confirm.trigger('one'), true);
  assert.equal(calls, 1);
  confirm = render();
  confirm.trigger('one'); confirm = render(); confirm.trigger('two'); confirm = render();
  assert.equal(confirm.isArmed('one'), false);
  assert.equal(confirm.isArmed('two'), true);
  [...timers.values()][0]();
  assert.equal(render().armedKey, null);
  cleanups.forEach(cleanup => cleanup?.());
});

test('every armed-delete consumer disarms on focus departure, preserving explicit settings confirmation panels', () => {
  let buttons = 0;
  for (const file of componentFiles('components')) {
    if (file === 'components/settings/SettingsPrimitives.tsx') continue; // Explicit confirmation panels are checked as groups below.
    const tree = parseTsx(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const hooks = new Set(findNodes(tree, node => ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText() === 'useConfirmAction').map(node => node.name.getText()));
    if (!hooks.size) continue;
    for (const button of findNodes(tree, node => ts.isJsxElement(node) && ['button', 'SettingsButton'].includes(node.openingElement.tagName.getText()))) {
      const click = jsxAttribute(button, 'onClick')?.getText() || '';
      if (![...hooks].some(hook => click.includes(`${hook}.trigger`)) && !/handleDeleteWithNotice|handleVersionDeleteClick|handleDelete\(e, type|armClearAll/.test(click)) continue;
      assert.match(button.openingElement.getText(), /bindDisarmOnBlur\(/, `${file}: ${click}`);
      buttons++;
    }
  }
  assert.equal(buttons, 10);
  assert.equal((settingsPrimitives.match(/if \(!event.currentTarget.contains\(event.relatedTarget\)\) confirm.reset\(\)/g) || []).length, 2,
    'settings confirmation panels disarm when focus leaves the whole panel, not while moving to Confirm');
});
