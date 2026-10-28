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
  assert.match(tip, /addEventListener\('pointerenter', showPointer\)/);
  assert.match(tip, /attributeFilter: \['aria-expanded'\]/);
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
  assert.match(feedback, /fixed bottom-.*z-\[500\]/);
});

test('disabled Generate has a wrapper hint and an accessible reason', () => {
  assert.match(controlPanelSource, /aria-describedby=\{generateButtonDisabled \? generateReasonId : undefined\}/);
  assert.match(controlPanelSource, /!generateButtonDisabled && <Tip text=\{generateButtonTitle\}/);
  assert.match(controlPanelSource, /generateButtonDisabled && <Tip text=\{generateButtonTitle\} side="top" \/>/);
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


const parseTsx = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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
const jsxAttribute = (node, name) => node.openingElement.attributes.properties
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

test('ControlPanel never hosts a direct Tip on a natively disabled button', () => {
  const invalid = findNodes(controlPanelAst, node => ts.isJsxElement(node)
    && node.openingElement.tagName.getText() === 'button' && jsxAttribute(node, 'disabled') && hostTipCount(node) > 0);
  assert.deepEqual(invalid.map(node => node.getText()), []);
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
    assert.match(source, new RegExp(`</button>\\s*\\{${flag} && <Tip[^>]*text=\\{${title}\\}`));
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
    const classes = jsxAttribute(button, 'className').initializer.text;
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

test('Login is the noun and log in the verb; eyebrow labels keep 11px and 10px; AuthModal Close is disabled while busy', () => {
  const panel = readFileSync(new URL('../components/ControlPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /hidden md:inline xl:hidden text-\[11px\] uppercase font-bold/);
  assert.match(panel, /hidden xl:block text-\[10px\] uppercase font-bold/);
  assert.ok(panel.includes("'Expanding prompt\u2026'") || panel.includes("'Expanding prompt…'"));
  assert.doesNotMatch(panel, /Expanding prompt\.\.\./);
  const auth = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  const close = auth.slice(auth.indexOf('aria-label="Close"') - 220, auth.indexOf('aria-label="Close"') + 40);
  assert.match(close, /disabled=\{isLoading \|\| isResetting\}/);
});

test('issue #74: Edit prompt Done, Edit prompt Expand prompt and Build Studio section headers are 44px on coarse pointers', () => {
  const panel = readFileSync(new URL('../components/ControlPanel.tsx', import.meta.url), 'utf8');
  const studio = readFileSync(new URL('../components/BuildStudio.tsx', import.meta.url), 'utf8');
  const coarse = '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';
  const done = panel.slice(panel.lastIndexOf('<button', panel.indexOf('                  Done\n')), panel.indexOf('                  Done\n'));
  assert.ok(done.includes(coarse), 'Done keeps coarse 44px');
  assert.match(done, /bg-brand-teal hover:bg-teal-600 text-\[#0d1117\]/);
  const expandStart = panel.indexOf('onClick={handleExpandPrompt}\n                disabled=');
  assert.ok(expandStart > 0, 'modal Expand prompt button found');
  assert.ok(panel.slice(expandStart, expandStart + 400).includes(coarse), 'modal Expand prompt keeps coarse 44px');
  const header = studio.slice(studio.indexOf('const SidebarSection'), studio.indexOf('const SidebarSection') + 900);
  assert.ok(header.includes('[@media(pointer:coarse)]:min-h-11'), 'SidebarSection header keeps coarse min-h-11');
}
);
