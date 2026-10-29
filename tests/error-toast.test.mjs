import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dismissErrorToastOnEscape, dismissTopErrorToast, hasVisibleErrorToast, registerErrorToast } from '../utils/errorToastEscape.ts';
import { createErrorToastStore, errorToastStore, setErrorToast } from '../utils/errorToastStore.ts';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const toast = source('components/ErrorToast.tsx');
const studio = source('components/BuildStudio.tsx');
const panel = source('components/ControlPanel.tsx');
const app = source('App.tsx');
const design = source('DESIGN.md');
const storeSource = source('utils/errorToastStore.ts');
const imageDisplay = source('components/ImageDisplay.tsx');

function keyEvent(key = 'Escape') {
  const calls = [];
  return {
    calls,
    event: {
      key,
      preventDefault: () => calls.push('preventDefault'),
      stopPropagation: () => calls.push('stopPropagation'),
      stopImmediatePropagation: () => calls.push('stopImmediatePropagation'),
    },
  };
}

test('visible error consumes Escape and dismisses exactly once', () => {
  const { calls, event } = keyEvent();
  assert.equal(dismissErrorToastOnEscape(event, true, () => calls.push('dismiss')), true);
  assert.deepEqual(calls, ['preventDefault', 'stopPropagation', 'stopImmediatePropagation', 'dismiss']);
});

test('hidden error and non-Escape keys leave all other handlers alone', () => {
  for (const [visible, key] of [[false, 'Escape'], [true, 'Enter'], [true, 'a']]) {
    const { calls, event } = keyEvent(key);
    assert.equal(dismissErrorToastOnEscape(event, visible, () => calls.push('dismiss')), false);
    assert.deepEqual(calls, []);
  }
});

test('one Escape dismisses only the toast; the next reaches studio close', () => {
  let visible = true;
  const calls = [];
  const studioKey = (event) => {
    if (dismissErrorToastOnEscape(event, visible, () => { visible = false; calls.push('dismiss'); })) return;
    calls.push('close');
  };
  studioKey(keyEvent().event);
  assert.deepEqual(calls, ['dismiss']);
  studioKey(keyEvent().event);
  assert.deepEqual(calls, ['dismiss', 'close']);
});

test('mounted shared slot registry dismisses once and cleans up on unmount', () => {
  const store = createErrorToastStore(() => undefined);
  const calls = [];
  store.show('ControlPanel error');
  store.show('App error');
  const unregister = registerErrorToast(() => { store.dismiss(); calls.push('dismiss'); });
  try {
    assert.equal(hasVisibleErrorToast(), true);
    dismissErrorToastOnEscape(keyEvent().event, hasVisibleErrorToast(), dismissTopErrorToast);
    assert.deepEqual(store.getSnapshot(), { message: null, height: 0 });
    assert.deepEqual(calls, ['dismiss']);
  } finally {
    unregister();
    unregister();
  }
  assert.equal(hasVisibleErrorToast(), false);
  dismissTopErrorToast();
  assert.deepEqual(calls, ['dismiss']);
});

test('App error peels before studio or Edit prompt regardless of capture listener order', () => {
  for (const surface of ['studio', 'Edit prompt']) {
    for (const modalFirst of [true, false]) {
      const target = new EventTarget();
      const calls = [];
      const modalKey = (event) => {
        if (dismissErrorToastOnEscape(event, hasVisibleErrorToast(), dismissTopErrorToast)) return;
        if (event.key === 'Escape') calls.push(`close ${surface}`);
      };
      const toastKey = (event) => {
        dismissErrorToastOnEscape(event, hasVisibleErrorToast(), dismissTopErrorToast);
      };
      if (modalFirst) target.addEventListener('keydown', modalKey, { capture: true });
      const unregister = registerErrorToast(() => calls.push('dismiss App error'));
      target.addEventListener('keydown', toastKey, { capture: true });
      if (!modalFirst) target.addEventListener('keydown', modalKey, { capture: true });
      const escape = () => Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
      try {
        const firstEscape = escape();
        target.dispatchEvent(firstEscape);
        assert.equal(firstEscape.defaultPrevented, true);
        assert.deepEqual(calls, ['dismiss App error']);
        unregister();
        target.dispatchEvent(escape());
        assert.deepEqual(calls, ['dismiss App error', `close ${surface}`]);
      } finally {
        unregister();
        target.removeEventListener('keydown', modalKey, { capture: true });
        target.removeEventListener('keydown', toastKey, { capture: true });
      }
    }
  }
});

test('Escape while typing dismisses the toast without blurring the field', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'DIV']) {
    const { event } = keyEvent();
    let blurred = false;
    let dismissed = false;
    event.target = { tagName, isContentEditable: tagName === 'DIV', blur: () => { blurred = true; } };
    assert.equal(dismissErrorToastOnEscape(event, true, () => { dismissed = true; }), true);
    assert.equal(dismissed, true);
    assert.equal(blurred, false);
  }
  const handler = studio.slice(studio.indexOf('keyHandlerRef.current ='), studio.indexOf('const onKey = (e: KeyboardEvent)'));
  assert.match(handler, /if \(dismissErrorToastOnEscape\(e, hasVisibleErrorToast\(\), dismissTopErrorToast\)\) return;/);
  assert.ok(handler.indexOf('dismissErrorToastOnEscape(') < handler.indexOf('const typing ='));
  assert.ok(handler.indexOf('dismissErrorToastOnEscape(') < handler.indexOf('onClose()'));
});

test('shared toast portals one stable alert above modals with no extra live region', () => {
  assert.equal((toast.match(/role="alert"/g) ?? []).length, 1);
  assert.doesNotMatch(toast, /aria-live|setTimeout|title=/);
  assert.match(toast, /return createPortal\([\s\S]*document\.body/);
  for (const token of ['fixed', 'bottom-6', 'left-1/2', '-translate-x-1/2', 'z-[400]', 'bg-red-900', 'border', 'border-brand-red/70', 'text-white', 'text-sm']) {
    assert.ok(toast.includes(token), `missing ${token}`);
  }
  assert.doesNotMatch(toast, /bg-red-100|text-red-800|border-red-200|dark:/);
  assert.equal((app.match(/<ErrorToastHost \/>/g) ?? []).length, 1);
  assert.match(toast, /useSyncExternalStore\(errorToastStore.subscribe, errorToastStore.getSnapshot/);
  assert.match(toast, /message === null \? null : <ErrorToast message=\{message\} onDismiss=\{errorToastStore.dismiss\}/);
  for (const parent of [panel, studio, app, imageDisplay]) {
    assert.doesNotMatch(parent, /<ErrorToast\b/);
    assert.doesNotMatch(parent, /(?:const|function) ErrorToast\b/);
  }
});

test('dismiss control retains its accessible name, touch target, and portaled rich Tip', () => {
  assert.match(toast, /dismissLabel = 'Dismiss AI assist error'/);
  assert.match(toast, /<button type="button" aria-label=\{dismissLabel\} onClick=\{\(\) => onDismiss\(\)\}/);
  assert.match(toast, /min-h-11 min-w-11/);
  assert.match(toast, /import \{ Tip \} from '\.\/settings\/Tip'/);
  assert.match(toast, /<Tip text="Dismiss" side="top" \/>/);
  const tip = source('components/settings/Tip.tsx');
  assert.match(tip, /createPortal\([\s\S]*document\.body/);
  assert.match(tip, /position: 'fixed'[\s\S]*zIndex: 500/);
  assert.match(tip, /text-\[13px\][\s\S]*bg-black\/90 text-white/);
  assert.match(tip, /Math\.max\(8, Math\.min/);
});

test('shared Escape capture listener uses the helper and removes itself on unmount', () => {
  assert.match(toast, /registerErrorToast\(\(restoreFocus\) => onDismissRef\.current\(restoreFocus\)\)/);
  assert.match(toast, /useLayoutEffect\(\(\) => \{\s*onDismissRef\.current = onDismiss;\s*\}, \[onDismiss\]\)/);
  assert.match(toast, /dismissErrorToastOnEscape\(event, hasVisibleErrorToast\(\), dismissTopErrorToast\)/);
  assert.match(toast, /window\.addEventListener\('keydown', onKeyDown, \{ capture: true \}\)/);
  assert.match(toast, /return \(\) => \{\s*unregister\(\);\s*window\.removeEventListener\('keydown', onKeyDown, \{ capture: true \}\);\s*\};\s*\}, \[\]\)/);
});

test('Edit prompt handles the next Escape even after its toast button loses focus', () => {
  const modalEscape = panel.match(/useEffect\(\(\) => \{\s*if \(!isPromptModalOpen\) return;[\s\S]*?\}, \[isPromptModalOpen\]\);/);
  assert.ok(modalEscape, 'Edit prompt must capture Escape outside its textarea');
  assert.match(modalEscape[0], /if \(dismissErrorToastOnEscape\(event, hasVisibleErrorToast\(\), dismissTopErrorToast\)\) return;/);
  assert.match(modalEscape[0], /if \(event.key !== 'Escape'\) return;/);
  assert.match(modalEscape[0], /closest\('input, textarea, select, \[contenteditable="true"\]'\)/);
  assert.match(modalEscape[0], /if \(field\) \{\s*\(field as HTMLElement\).blur\(\);\s*return;/);
  assert.match(modalEscape[0], /event.stopPropagation\(\);\s*event.stopImmediatePropagation\(\)/);
  assert.ok(modalEscape[0].indexOf('dismissErrorToastOnEscape(') < modalEscape[0].indexOf('setIsPromptModalOpen(false)'));
  assert.ok(modalEscape[0].indexOf('.blur()') < modalEscape[0].indexOf('setIsPromptModalOpen(false)'));
  assert.match(modalEscape[0], /addEventListener\('keydown', onKeyDown, \{ capture: true \}\)/);
  assert.match(modalEscape[0], /removeEventListener\('keydown', onKeyDown, \{ capture: true \}\)/);
});

test('Build Studio no longer renders a separate error bar', () => {
  assert.doesNotMatch(studio, /role="alert"|bg-red-900\/30|aria-label="Dismiss AI assist error"/);
  assert.match(studio, /ref=\{rootRef\} data-error-toast-scope className="fixed inset-0 z-\[300\]/);
  for (const parent of [studio, panel]) {
    assert.match(parent, /setErrorToast as setAiAssistError/);
    assert.doesNotMatch(parent, /\[aiAssistError, setAiAssistError\]/);
    assert.match(parent, /setAiAssistError\(null\);\s*set(?:Is\w+|Naming|AutoSelecting)\(true\)/);
  }
  assert.match(app, /setErrorToast as setError/);
  assert.doesNotMatch(app, /\[error, setError\]/);
});

test('copy and gallery error notices use red-900 and alert without changing neutral live feedback', () => {
  for (const [path, tone] of [['components/ImageDisplay.tsx', 'copyNoticeTone'], ['components/RecentGenerations.tsx', 'toastTone']]) {
    const text = source(path);
    assert.ok(text.includes(`${tone} === 'error' ? 'bg-red-900 border-brand-red/70' : 'bg-black/90 border-white/10'`));
    assert.ok(text.includes(`role={${tone} === 'error' ? 'alert' : 'status'}`));
    assert.ok(text.includes(`aria-live={${tone} === 'error' ? undefined : 'polite'}`));
  }
});

test('Edit prompt Done keeps its action and sizing with the requested teal contrast', () => {
  const done = panel.match(/<button\s+type="button"\s+onClick=\{\(\) => setIsPromptModalOpen\(false\)\}\s+className=\{`([^`]+)`\}\s*>\s*Done\s*<Tip\b[^>]*\/>\s*<\/button>/);
  assert.ok(done, 'Edit prompt Done button not found');
  for (const token of ['px-4', 'py-2', 'rounded-lg', 'bg-brand-teal', 'hover:bg-teal-600', 'text-[#0d1117]', 'font-semibold', 'text-sm', 'shadow-md', 'shadow-brand-teal/20']) {
    assert.ok(done[1].includes(token), `missing ${token}`);
  }
  assert.doesNotMatch(done[1], /brand-red|text-white/);
});

test('design documents the error-first Escape, persistent error contract, and neutral exception', () => {
  const keyboardAndFeedback = design.slice(design.indexOf('## 11.'), design.indexOf('## 14.'));
  assert.match(keyboardAndFeedback, /> error toast dismiss → typing field/);
  assert.match(keyboardAndFeedback, /Neutral toasts[\s\S]*role="status" aria-live="polite"/);
  assert.match(keyboardAndFeedback, /error toasts carry `role="alert"`[\s\S]*no extra `aria-live`/);
  assert.match(keyboardAndFeedback, /persist until dismissed or the next AI call starts/);
  for (const text of ['bottom-center', 'bg-red-900', 'border-brand-red/70', 'text-white text-sm', '44px', 'Tip tooltip "Dismiss"', 'Esc dismisses', 'Red is reserved for errors', 'supersedes the old auto-clear pill rule for errors', 'auto-clear ~1.8s']) {
    assert.ok(keyboardAndFeedback.includes(text), `missing ${text}`);
  }
  assert.doesNotMatch(keyboardAndFeedback.slice(keyboardAndFeedback.indexOf('- Error toasts'), keyboardAndFeedback.indexOf('- Progress')), /\u2014/);
  assert.match(design, /Primary CTA:\s+px-6 py-2 bg-brand-teal hover:bg-teal-600 text-\[#0d1117\]/);
  for (const text of ['single shared slot', 'newest error replaces', 'identical messages dedupe', 'focus returns', 'measured toast height', 'Edit prompt footer', 'Build Studio right panel', 'Esc 1 in a field', 'Esc 2 blurs', 'Esc 3 closes']) {
    assert.ok(design.includes(text), `missing ${text}`);
  }
  assert.match(design, /z-\[140-300\][^\n]+z-\[400\][^\n]+500/);
  assert.doesNotMatch(design, /next successful AI call/);
});

test('one shared slot replaces newest and dedupes without publishing or changing the snapshot', () => {
  const store = createErrorToastStore(() => undefined);
  let renders = 0;
  const unsubscribe = store.subscribe(() => renders++);
  store.show('Panel error');
  store.show('Studio error');
  const newest = store.getSnapshot();
  store.show('Studio error');
  assert.strictEqual(store.getSnapshot(), newest);
  assert.equal(store.getSnapshot().message, 'Studio error');
  assert.equal(renders, 2);
  store.dismiss();
  store.dismiss();
  assert.deepEqual(store.getSnapshot(), { message: null, height: 0 });
  assert.equal(renders, 3);
  unsubscribe();
  store.show('After unmount');
  assert.equal(renders, 3);
});

test('starting any next AI call clears the shared slot, including another caller error', () => {
  try {
    setErrorToast('Panel failure');
    setErrorToast('App failure');
    setErrorToast(null);
    assert.equal(errorToastStore.getSnapshot().message, null);
    setErrorToast('The same failure after retry');
    assert.equal(errorToastStore.getSnapshot().message, 'The same failure after retry');
  } finally {
    setErrorToast(null);
  }
});

function focusFixture() {
  const doc = { activeElement: null, defaultView: { getComputedStyle: (element) => ({ visibility: element.visibility, display: element.display }) } };
  const container = { isConnected: true, querySelectorAll: () => [fallback] };
  const makeControl = () => ({
    isConnected: true, disabled: false, hidden: false, visibility: 'visible', display: 'block', focusCount: 0,
    matches() { return this.disabled; },
    closest(selector) { return selector.includes('[hidden]') ? (this.hidden ? {} : null) : container; },
    getClientRects() { return this.hidden ? [] : [{}]; },
    focus() { this.focusCount++; doc.activeElement = this; },
  });
  const original = makeControl();
  const fallback = makeControl();
  doc.activeElement = original;
  return { doc, original, fallback, container, makeControl };
}

test('show captures focus without stealing it; replace and dedupe keep the original return target', () => {
  for (const dismissal of ['mouse X', 'Enter X', 'Escape']) {
    const { doc, original, makeControl } = focusFixture();
    const store = createErrorToastStore(() => doc);
    store.show('First failure');
    assert.equal(original.focusCount, 0);
    assert.strictEqual(doc.activeElement, original);
    doc.activeElement = makeControl();
    store.show('Replacement failure');
    store.show('Replacement failure');
    if (dismissal === 'Escape') dismissErrorToastOnEscape(keyEvent().event, true, store.dismiss);
    else store.dismiss();
    assert.strictEqual(doc.activeElement, original, dismissal);
    assert.equal(original.focusCount, 1);
    store.dismiss();
    assert.equal(original.focusCount, 1);
  }
  assert.match(storeSource, /getDocument\(\)\?\.activeElement/);
  assert.match(storeSource, /if \(snapshot.message === null\) \{/);
  assert.match(toast, /onClick=\{\(\) => onDismiss\(\)\}/);
});

test('Escape keeps focus in the current typing field even after moving from the original target', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'DIV']) {
    const { doc, original, makeControl } = focusFixture();
    const current = makeControl();
    current.tagName = tagName;
    current.closest = () => current;
    const store = createErrorToastStore(() => doc);
    store.show('Failure');
    doc.activeElement = current;
    const { event } = keyEvent();
    event.target = current;
    const unregister = registerErrorToast(store.dismiss);
    try {
      dismissErrorToastOnEscape(event, hasVisibleErrorToast(), dismissTopErrorToast);
      assert.equal(store.getSnapshot().message, null);
      assert.strictEqual(doc.activeElement, current);
      assert.equal(original.focusCount, 0);
    } finally {
      unregister();
    }
  }
});

test('focus falls back for disconnected, disabled and hidden targets without trapping focus', () => {
  for (const invalid of [{ isConnected: false }, { disabled: true }, { hidden: true }, { visibility: 'hidden' }, { display: 'none' }]) {
    const { doc, original, fallback } = focusFixture();
    const store = createErrorToastStore(() => doc);
    store.show('Failure');
    Object.assign(original, invalid);
    store.dismiss();
    assert.equal(original.focusCount, 0);
    assert.strictEqual(doc.activeElement, fallback);
  }
  const { doc, original, fallback, container } = focusFixture();
  const store = createErrorToastStore(() => doc);
  store.show('Failure');
  original.isConnected = false;
  container.isConnected = false;
  assert.doesNotThrow(() => store.dismiss());
  assert.equal(fallback.focusCount, 0);
});

test('clearance tracks measured wrapping height plus bottom-6 and resets on dismiss', () => {
  const store = createErrorToastStore(() => undefined);
  assert.equal(store.getClearance(), 0);
  store.show('Wrapped error');
  store.setHeight(92);
  assert.equal(store.getClearance(), 116);
  store.setHeight(140);
  assert.equal(store.getClearance(), 164);
  store.dismiss();
  store.setHeight(140);
  assert.equal(store.getClearance(), 0);
  assert.match(toast, /new ResizeObserver\(measure\)/);
  assert.match(toast, /onHeightChange\(toast.getBoundingClientRect\(\).height\)/);
  assert.match(panel, /const errorToastClearance = useErrorToastClearance\(\)/);
  assert.match(panel, /aria-label="Edit prompt"\s*style=\{errorToastClearance \? \{ paddingBottom: errorToastClearance \+ 16 \}/);
  assert.match(panel, /maxHeight: `min\(85vh, calc\(100dvh - \$\{errorToastClearance \+ 32\}px\)\)`/);
  assert.match(studio, /overflow-y-auto[^\n]+style=\{\{ width: sidebarW, paddingBottom: errorToastClearance \|\| undefined/);
});

test('refine analysis and expansion report one deduped persistent error instead of an error pill', () => {
  const handlers = imageDisplay.slice(imageDisplay.indexOf('const handleAnalyzeRefineClick'), imageDisplay.indexOf('const handleResizeCanvasClick'));
  assert.match(handlers, /setErrorToast\(error\?\.message \|\| 'Analysis failed'\)/);
  assert.match(handlers, /setErrorToast\(error\?\.message \|\| 'Expand failed'\)/);
  assert.equal((handlers.match(/setErrorToast\(null\)/g) ?? []).length, 2);
  assert.doesNotMatch(handlers, /showNotice\([^\n]+, 'error'\)/);
  assert.match(handlers, /showNotice\('Prompt expanded\.'\)/);
  for (const name of ['handleAnalyzeRefinePrompt', 'handleExpandRefinementPrompt']) {
    assert.match(app.slice(app.indexOf(`const ${name}`)), /=> \{\s*setError\(null\)/);
  }
});

test('header signup, auth submit and feedback primary actions use teal with a dark label', () => {
  const classes = [
    app.match(/className="([^"]+)"\s*>\s*Sign [Uu]p(?:<Tip[^>]*\/>)?\s*<\/button>/)?.[1],
    source('components/AuthModal.tsx').match(/type="submit"[\s\S]*?className=\{`([\s\S]*?)`\}/)?.[1],
    source('components/FeedbackModal.tsx').match(/<button type="submit"[^>]+className=\{`([\s\S]*?)`\}/)?.[1],
    source('components/FeedbackModal.tsx').match(/<a href=\{issue.url\}[^>]+className=\{`([^`]+)`\}/)?.[1],
  ];
  for (const value of classes) {
    assert.ok(value, 'primary CTA not found');
    for (const token of ['bg-brand-teal', 'hover:bg-teal-600', 'text-[#0d1117]', 'shadow-lg', 'shadow-brand-teal/20', 'text-sm']) assert.ok(value.includes(token), `missing ${token}`);
    assert.match(value, /min-h-(?:11|\[44px\])/);
    assert.doesNotMatch(value, /brand-red|text-white/);
  }
});

test('main prompt textarea leaves the field on Escape (second Esc) without bubbling', () => {
  const start = panel.indexOf("onChange={(e) => handleChange('prompt', e.target.value)}\n                  onKeyDown");
  assert.ok(start > 0, 'main prompt textarea has an onKeyDown');
  const handler = panel.slice(start, start + 400);
  assert.match(handler, /e\.key !== 'Escape'\) return;/);
  for (const call of ['e.preventDefault()', 'e.stopPropagation()', 'e.currentTarget.blur()']) assert.ok(handler.includes(call), `missing ${call}`);
  // Toast-first ordering is unchanged: the window capture listener consumes Esc 1 before React sees it.
  assert.ok(toast.includes("addEventListener('keydown'"));
});

test('guest and credits primary CTAs in App use teal with a dark label, not brand-red', () => {
  for (const label of ['Create account for future work', 'Create free account', 'View Credits']) {
    const idx = app.indexOf(label.includes('future') ? "'Create account for future work'" : label);
    const before = app.slice(Math.max(0, idx - 900), idx);
    const className = [...before.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map(match => match[1] || match[2]).pop();
    assert.ok(className, `${label} button class found`);
    for (const token of ['bg-brand-teal', 'hover:bg-teal-600', 'text-[#0d1117]', 'shadow-brand-teal/20']) assert.ok(className.includes(token), `${label}: missing ${token}`);
    assert.doesNotMatch(className, /brand-red|text-white/);
  }
});
