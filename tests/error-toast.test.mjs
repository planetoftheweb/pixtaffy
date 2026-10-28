import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dismissErrorToastOnEscape, dismissTopErrorToast, hasVisibleErrorToast, registerErrorToast } from '../utils/errorToastEscape.ts';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const toast = source('components/ErrorToast.tsx');
const studio = source('components/BuildStudio.tsx');
const panel = source('components/ControlPanel.tsx');
const app = source('App.tsx');
const design = source('DESIGN.md');

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

test('mounted toast registry dismisses the newest toast and cleans up on unmount', () => {
  const calls = [];
  const unregisterFirst = registerErrorToast(() => calls.push('first'));
  const unregisterSecond = registerErrorToast(() => calls.push('second'));
  try {
    assert.equal(hasVisibleErrorToast(), true);
    dismissTopErrorToast();
    assert.deepEqual(calls, ['second']);
    unregisterSecond();
    unregisterSecond();
    dismissTopErrorToast();
    assert.deepEqual(calls, ['second', 'first']);
  } finally {
    unregisterFirst();
    unregisterSecond();
  }
  assert.equal(hasVisibleErrorToast(), false);
  dismissTopErrorToast();
  assert.deepEqual(calls, ['second', 'first']);
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
  for (const [parent, value] of [[panel, 'aiAssistError'], [studio, 'aiAssistError'], [app, 'error']]) {
    assert.match(parent, new RegExp(`\\{${value} && \\(\\s*<ErrorToast message=\\{${value}\\}`));
    assert.doesNotMatch(parent, /(?:const|function) ErrorToast\b/);
  }
});

test('dismiss control retains its accessible name, touch target, and portaled rich Tip', () => {
  assert.match(toast, /dismissLabel = 'Dismiss AI assist error'/);
  assert.match(toast, /<button type="button" aria-label=\{dismissLabel\} onClick=\{onDismiss\}/);
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
  assert.match(toast, /registerErrorToast\(\(\) => onDismissRef\.current\(\)\)/);
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
  assert.ok(modalEscape[0].indexOf('dismissErrorToastOnEscape(') < modalEscape[0].indexOf('setIsPromptModalOpen(false)'));
  assert.match(modalEscape[0], /addEventListener\('keydown', onKeyDown, \{ capture: true \}\)/);
  assert.match(modalEscape[0], /removeEventListener\('keydown', onKeyDown, \{ capture: true \}\)/);
});

test('Build Studio no longer renders a separate error bar', () => {
  assert.doesNotMatch(studio, /role="alert"|bg-red-900\/30|aria-label="Dismiss AI assist error"/);
  assert.match(studio, /ref=\{rootRef\} className="fixed inset-0 z-\[300\]/);
  assert.match(studio, /<ErrorToast message=\{aiAssistError\} onDismiss=\{\(\) => setAiAssistError\(null\)\}/);
  assert.match(panel, /<ErrorToast message=\{aiAssistError\} onDismiss=\{\(\) => setAiAssistError\(null\)\}/);
  assert.match(app, /<ErrorToast message=\{error\} onDismiss=\{\(\) => setError\(null\)\} dismissLabel="Dismiss error"/);
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
  const done = panel.match(/<button\s+type="button"\s+onClick=\{\(\) => setIsPromptModalOpen\(false\)\}\s+className="([^"]+)"\s*>\s*Done\s*<\/button>/);
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
  assert.match(keyboardAndFeedback, /persist until dismissed or the next successful AI call/);
  for (const text of ['bottom-center', 'bg-red-900', 'border-brand-red/70', 'text-white text-sm', '44px', 'Tip tooltip "Dismiss"', 'Esc dismisses', 'Red is reserved for errors', 'supersedes the old auto-clear pill rule for errors', 'auto-clear ~1.8s']) {
    assert.ok(keyboardAndFeedback.includes(text), `missing ${text}`);
  }
  assert.doesNotMatch(keyboardAndFeedback.slice(keyboardAndFeedback.indexOf('- Error toasts'), keyboardAndFeedback.indexOf('- Progress')), /\u2014/);
  assert.match(design, /Primary CTA:\s+px-6 py-2 bg-brand-teal hover:bg-teal-600 text-white/);
});
