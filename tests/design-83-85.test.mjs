import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pricing = source('components/PricingPage.tsx');
const landing = source('components/LandingPage.tsx');

test('pack Pro estimates have a readable dark color and purchase CTAs use marketing radii', () => {
  assert.ok(pricing.includes('<Estimate value={product.estimates.pro} label="Pro" color="text-brand-purple dark:text-purple-200" />'));
  const purchase = pricing.split('\n').find(line => line.includes('checkout(product.id)'));
  assert.ok(purchase.includes('rounded-2xl'));
  assert.ok(!purchase.includes('rounded-xl'));
  const luminance = hex => hex.match(/../g)
    .map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  assert.ok((luminance('e9d4ff') + 0.05) / (luminance('202534') + 0.05) >= 4.5);
});

test('the focused regression suite runs in npm test', () => {
  assert.ok(JSON.parse(source('package.json')).scripts.test.includes(' tests/design-83-85.test.mjs && npm --prefix functions test'));
});

test('credit packs use single accent bars and faint two-stop washes', () => {
  for (const color of ['orange', 'cyan', 'purple']) {
    assert.ok(pricing.includes(`accent: 'bg-brand-${color}',`));
  }
  assert.ok(pricing.includes("className={'h-2 ' + product.accent}"));
  assert.ok(pricing.includes('className="relative h-48 overflow-hidden bg-gradient-to-br from-orange-50 to-white dark:from-white/10 dark:to-white/5 sm:h-52"'));
  assert.doesNotMatch(pricing, /\bwash:|product\.wash/);
  assert.doesNotMatch(pricing.slice(pricing.indexOf('const products = ['), pricing.indexOf('const products = [') + pricing.split('const products = [')[1].indexOf('];')), /via-/);
  const packs = pricing.slice(pricing.indexOf('One-time credit packs'), pricing.indexOf('</section>', pricing.indexOf('One-time credit packs')));
  assert.doesNotMatch(packs, /via-|h-2 bg-gradient-to-r/);
});

test('mobile hero glows retain desktop opacity and marketing CTAs use accessible solid pink', () => {
  assert.ok(landing.includes('bg-brand-orange/10 sm:bg-brand-orange/25'));
  assert.ok(landing.includes('bg-brand-pink/10 sm:bg-brand-pink/25'));
  const hero = landing.match(/className="group inline-flex whitespace-nowrap[^\"]+"/)[0];
  const membership = pricing.split('\n').find(line => line.includes("checkout('pro_monthly')"));
  for (const cta of [hero, membership]) {
    for (const token of ['bg-brand-pink', 'text-[#0d1117]', 'rounded-2xl']) assert.ok(cta.includes(token));
    assert.doesNotMatch(cta, /bg-gradient-|via-|text-white/);
  }
  const luminance = hex => {
    const channels = hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const contrast = (luminance('F22991') + 0.05) / (luminance('0d1117') + 0.05);
  assert.ok(contrast >= 4.5);
  assert.equal(contrast.toFixed(2), '4.96');
});

const radiusTargets = {
  "App.tsx": [
    "className=\"absolute right-0 top-full mt-2 w-64 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150\"",
    "className=\"inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-500 text-[#0d1117] px-4 py-2 text-sm font-black hover:bg-amber-400\"",
    "className=\"inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 py-2.5 text-sm font-bold text-[#0d1117] shadow-lg shadow-brand-teal/20 transition-colors hover:bg-teal-600\"",
    "className=\"inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1f2937] transition-colors\"",
    "className=\"inline-flex items-center gap-2 rounded-lg bg-brand-teal hover:bg-teal-600 px-4 py-2.5 text-sm font-semibold text-[#0d1117] shadow-lg shadow-brand-teal/20 transition-colors\"",
    "className=\"inline-flex items-center gap-2 rounded-lg bg-brand-teal hover:bg-teal-600 px-4 py-2.5 text-sm font-semibold text-[#0d1117] shadow-lg shadow-brand-teal/20 transition-colors\"",
    "className=\"inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1f2937] transition-colors\"",
    "className=\"inline-flex items-center rounded-lg border border-transparent px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors\""
  ],
  "components/ControlPanel.tsx": [
    "className=\"bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 py-0.5\""
  ],
  "components/DownloadMenu.tsx": [
    "} top-full mt-2 z-50 w-64 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-xl overflow-hidden text-sm`}"
  ],
  "components/GalleryPresetMenu.tsx": [
    "className=\"absolute top-full right-0 mt-2 w-72 sm:w-80 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-xl z-[45] overflow-hidden flex flex-col\""
  ],
  "components/ImageDisplay.tsx": [
    "<div className=\"absolute top-full left-0 mt-2 w-auto min-w-[10rem] bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-xl z-20 overflow-hidden p-1\">",
    "className=\"fixed left-0 top-0 w-48 max-w-[calc(100vw-1rem)] bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-xl z-[60] overflow-y-auto p-1 [&_button]:[@media(pointer:coarse)]:min-h-11\""
  ],
  "components/RecentGenerations.tsx": [
    "className=\"fixed max-h-[min(70vh,480px)] overflow-y-auto rounded-2xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-xl p-1\"",
    "className=\"bg-white dark:bg-[#161b22] rounded-2xl border border-gray-200 dark:border-[#30363d] shadow-2xl max-w-lg w-full p-5\"",
    "<div role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"delete-folder-title\" className=\"bg-white dark:bg-[#161b22] rounded-2xl border border-gray-200 dark:border-[#30363d] shadow-2xl max-w-sm w-full p-5\">"
  ],
  "components/WhatsNewBell.tsx": [
    "className=\"fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.75rem)] bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:bottom-auto sm:mt-2 sm:w-[32rem] sm:max-w-[calc(100vw-2rem)] sm:max-h-[calc(100dvh-6rem)] flex flex-col bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150\""
  ],
  "components/AuthModal.tsx": [
    "className=\"w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all\"",
    "className=\"w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg py-3 pl-8 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all\"",
    "className=\"w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all\"",
    "className=\"w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-teal transition-all\""
  ],
  "components/FeedbackModal.tsx": [
    "<textarea ref={textareaRef} rows={6} maxLength={8000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder=\"What happened, or what would make PixTaffy more useful?\" className=\"mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20 dark:border-[#30363d] dark:bg-[#161b22] dark:text-white\" />",
    "<input type=\"email\" maxLength={320} value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder=\"you@example.com\" className=\"mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-900 outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20 dark:border-[#30363d] dark:bg-[#161b22] dark:text-white\" />"
  ]
};

for (const [file, targets] of Object.entries(radiusTargets)) {
  test(`${file} applies the specified control and panel radii`, () => {
    const actual = source(file);
    for (const target of new Set(targets)) {
      assert.equal(actual.split(target).length - 1, targets.filter(line => line === target).length, target);
    }
  });
}

const protectedRadii = {
  "components/ImageDisplay.tsx": [
    "buttonClassName=\"rounded-xl\"",
    "buttonClassName=\"rounded-xl\"",
    "className={`group/tip relative inline-flex h-9 items-center gap-1.5 px-3.5 rounded-xl border text-xs font-semibold transition-all group/recomposeBtn ${",
    "className=\"text-sm font-semibold text-brand-teal dark:text-teal-400 hover:underline decoration-brand-teal/60 underline-offset-2 min-h-11 px-2 rounded-lg hover:bg-brand-teal/10 dark:hover:bg-teal-950/40 transition-colors\"",
    "className={`group/tip relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all group/expandBtn ${",
    "className={`group/tip relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all ${",
    "className={`group/tip relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all group/analyzeBtn ${",
    "className={`group/tip relative h-11 w-11 shrink-0 rounded-xl font-medium inline-flex items-center justify-center transition-all ${"
  ],
  "components/PresetActionPopover.tsx": [
    "className=\"bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg shadow-xl p-1 space-y-0.5\""
  ],
  "components/AdminPage.tsx": [
    "className=\"absolute right-2 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-lg py-1 text-sm\""
  ]
};
test('refine bar and context menu radius exceptions remain intact', () => {
  for (const [file, lines] of Object.entries(protectedRadii)) {
    assert.ok(lines.length > 0);
    for (const line of lines) assert.ok(source(file).includes(line));
  }
});

const documentation = [
  "| Class | Usage |\n|---|---|\n| `rounded` / `rounded-md` | Compact controls: segments, chips, kbd, small tooltips, inline rename inputs |\n| `rounded-lg` | Default: buttons (incl. text CTAs), inputs/textareas, standard cards, toasts, simple tooltips, right-click context menus |\n| `rounded-xl` | Elevated cards, rich tooltips, grouped canvas toolbars (refine bar) |\n| `rounded-2xl` | Every dropdown/popover/listbox panel (any size), modal panels |\n| `rounded-full` | Pills, circular icon buttons, toggles, badges |\n| `rounded-3xl` / `rounded-[2rem]` | Marketing pages only (landing, pricing): hero panels, pack cards; marketing CTAs rounded-2xl |",
  "Dark mode is the class strategy. The app boots dark (`<html class=\"dark\">`, OS preference ignored) and the account menu has a session-only light toggle (App.tsx:4103); it does not persist.",
  "- Dropdown/popover (any size): `absolute top-full mt-2` + `rounded-2xl shadow-xl` panel;"
];
test('design documentation defines the complete radius map and session-only theme toggle', () => {
  for (const text of documentation) assert.ok(source('DESIGN.md').includes(text));
  for (const text of [...documentation, ...Object.values(radiusTargets).flat()]) assert.ok(!text.includes('\u2014'));
});

const imageDisplay = source('components/ImageDisplay.tsx');
const app = source('App.tsx');
const controls = source('components/ControlPanel.tsx');
const coarseHeight = '[@media(pointer:coarse)]:min-h-11';
const coarseSize = `${coarseHeight} [@media(pointer:coarse)]:min-w-11`;

const precedingClass = (text, marker) => {
  const end = text.indexOf(marker);
  assert.ok(end >= 0, marker);
  const start = text.lastIndexOf('className=', end);
  assert.ok(start >= 0, marker);
  return text.slice(start, end);
};

test('preview action bar stays visible without hover, including when idle', () => {
  const start = imageDisplay.indexOf('{/* Action buttons (top right).');
  assert.ok(start >= 0);
  const bar = imageDisplay.slice(start, imageDisplay.indexOf('{/* Refine / Recompose toggle.', start));
  assert.ok(bar.includes('opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:opacity-100'));
  for (const token of ['group-data-[idle=true]:!opacity-0', 'group-data-[idle=true]:!pointer-events-none']) {
    assert.ok(bar.includes(`[@media(hover:hover)]:${token}`));
    assert.ok(!bar.includes(` ${token}`));
  }
  assert.ok(bar.includes("isComparing\n                  ? 'opacity-0 pointer-events-none'"));
});

test('preview action, copy and download triggers preserve padding and meet coarse target sizes', () => {
  const action = imageDisplay.slice(imageDisplay.indexOf('const ActionButton ='), imageDisplay.indexOf('aria-label={description}', imageDisplay.indexOf('const ActionButton =')));
  const copy = imageDisplay.slice(imageDisplay.indexOf('ref={copyMenuTriggerRef}'), imageDisplay.indexOf('<Copy size={18}', imageDisplay.indexOf('ref={copyMenuTriggerRef}')));
  const deleteButton = imageDisplay.slice(imageDisplay.indexOf('onClick={handleDeleteWithNotice}'), imageDisplay.indexOf('<Tip text={isGenerationDeleteArmed', imageDisplay.indexOf('onClick={handleDeleteWithNotice}')));
  const download = imageDisplay.split('\n').find(line => line.includes('triggerClassName="'));
  for (const target of [action, copy, download, deleteButton]) {
    assert.ok(target.includes(coarseSize));
    assert.ok(target.includes('p-2.5 lg:p-3'));
  }
});

test('active generation controls retain fine sizes and add coarse targets', () => {
  for (const [marker, fineSize] of [
    ['aria-label={`Show active generations panel', 'px-3 py-1.5'],
    ['aria-label="Minimize active generations panel"', 'h-6 w-6'],
    ['aria-label="Dismiss generation status"', 'h-7 w-7'],
  ]) {
    const target = precedingClass(app, marker);
    assert.ok(target.includes(coarseSize));
    assert.ok(target.includes(fineSize));
  }
});

test('folder switcher and option rows add coarse height without changing fine sizes or preset width', () => {
  assert.ok(source('components/RecentGenerations.tsx').includes(`py-1.5 min-h-9 ${coarseHeight} rounded-full`));
  assert.ok(controls.includes(`className={\`${coarseHeight} group relative flex items-center justify-between p-2 rounded-md cursor-pointer`));
  assert.ok(controls.includes(`className={\`${coarseSize} w-full flex items-center justify-between px-2.5 py-0.5 text-sm tabular-nums`));
  assert.ok(controls.includes('left: Math.max(8, batchCountAnchor.right - 64),\n                          width: 64,'));
});
