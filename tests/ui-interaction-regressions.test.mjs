import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.match(controlPanelSource, /generateButtonDisabled && <Tip text=\{generateButtonTitle\} side="top" allowDisabledChildren/);
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
  assert.match(auth, /onClick=\{onClose\}/);
  assert.match(auth, /onClick=\{event => event.stopPropagation\(\)\}/);
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

test('auth Escape keeps focus in the dialog and dismissal restores a connected opener', () => {
  const auth = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');
  assert.match(auth, /target.blur\(\);\s*panelRef.current\?\.focus\(\);\s*return;/);
  assert.match(auth, /ref=\{panelRef\} tabIndex=\{-1\} role="dialog" aria-modal="true"/);
  assert.match(auth, /openerRef.current = document.activeElement instanceof HTMLElement/);
  assert.match(auth, /if \(openerRef.current\?\.isConnected\) openerRef.current.focus\(\)/);
  assert.match(auth, /useLayoutEffect\([\s\S]*?\}, \[isOpen\]\)/);
});
