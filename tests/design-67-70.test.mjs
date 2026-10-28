import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const image = source('components/ImageDisplay.tsx');
const gallery = source('components/RecentGenerations.tsx');
const studio = source('components/BuildStudio.tsx');
const design = source('DESIGN.md');
const ast = ts.createSourceFile('ImageDisplay.tsx', image, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const elements = [];
function visit(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);

test('ImageDisplay uses portal Tips and never native title attributes', () => {
  assert.match(image, /import \{ Tip \} from '\.\/settings\/Tip'/);
  const titled = elements.filter(node => node.attributes.properties.some(attr => attr.name?.getText(ast) === 'title'));
  assert.ok(titled.length > 0, 'rich Tips retain their explanatory headlines');
  assert.ok(titled.every(node => node.tagName.getText(ast) === 'Tip'));
  assert.ok(elements.filter(node => node.tagName.getText(ast) === 'Tip').length >= 20);
  assert.match(image, /triggerTooltip="Download"/);
});

test('ActionButton has one portal hint, an accessible name, and no CSS tooltip or title forwarding', () => {
  const action = image.slice(image.indexOf('  const ActionButton ='), image.indexOf('  // Roman-numeral suffix'));
  assert.match(action, /aria-label=\{description\}/);
  assert.match(action, /<Tip title=\{tooltip\} text=\{description\} side="top" align="right" \/>/);
  assert.equal((action.match(/<Tip\b/g) || []).length, 1);
  assert.doesNotMatch(action, /\btitle:|\btitle=\{title\}|-top-9|<span/);
});

test('Mark Tips never repeat the label as both headline and body', () => {
  const tips = elements.filter(node => node.tagName.getText(ast) === 'Tip');
  const markTips = tips.filter(node => node.attributes.properties.some(attr =>
    attr.name?.getText(ast) === 'title' && attr.initializer?.expression?.getText(ast) === 'v.label'));
  assert.equal(markTips.length, 2, 'cover both the rail thumbnail and version dropdown');
  const fixtures = [
    { v: { label: 'Mark II', type: 'generation' }, isCommitted: false, pickSide: null, hasMixedModels: false },
    { v: { label: 'Mark II', type: 'refinement', refinementPrompt: '' }, isCommitted: false, pickSide: null, hasMixedModels: false },
    { v: { label: 'Mark II', type: 'refinement', refinementPrompt: 'Make it brighter' }, isCommitted: true, pickSide: null, hasMixedModels: false },
    { v: { label: 'Mark II', type: 'generation' }, isCommitted: false, pickSide: 'a', hasMixedModels: true },
  ];
  for (const tip of markTips) {
    let expression = tip;
    while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
    if (ts.isConditionalExpression(expression.parent)) expression = expression.parent;
    const compiled = ts.transpileModule(`return (${expression.getText(ast)});`, {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const render = new Function('React', 'Tip', 'v', 'isCommitted', 'pickSide', 'hasMixedModels', 'thumbModelId', 'modelLabelMap', 'getModelDisplayName', 'thumbTipDetail', compiled);
    for (const { v, isCommitted, pickSide, hasMixedModels } of fixtures) {
      const thumbModelId = 'fixture-model';
      const modelLabelMap = { [thumbModelId]: 'Fixture model' };
      const thumbTipDetail = [
        isCommitted && !pickSide ? 'Currently shown' : '',
        hasMixedModels && thumbModelId ? modelLabelMap[thumbModelId] : '',
      ].filter(Boolean).join(' · ');
      const props = render({ createElement: (_type, props) => props }, 'Tip', v, isCommitted, pickSide, hasMixedModels, thumbModelId, modelLabelMap, () => 'Fixture model', thumbTipDetail);
      assert.notEqual(props.title, props.text, `${v.type} ${v.label} must not repeat its label`);
      if (!props.title) assert.equal(props.text, v.label);
      else {
        assert.equal(props.title, v.label);
        assert.ok(props.text.length > 0, 'headlines require extra detail');
      }
    }
  }
});

test('Add Mark uses the same portal Tip with batching and editor guidance', () => {
  assert.doesNotMatch(image, /addMarkTipAnchor|addMarkTipVisible|browser-default tooltips/);
  assert.match(image, /<Tip title="Add a new Mark"[^\n]*Hold 1-9[^\n]*Shift-click[^\n]*side="top" wide/);
  const thumb = image.slice(image.indexOf('aria-selected={isCommitted}'), image.indexOf('{showRailDelete &&'));
  assert.equal((thumb.match(/<Tip\b/g) || []).length, 2, 'conditional branches each supply one thumbnail hint');
  assert.match(thumb, /thumbTipDetail \? \(/);
  assert.match(image, /isCommitted && !pickSide \? 'Currently shown'/);
  assert.match(image, /hasMixedModels && thumbModelId \? modelLabelMap\[thumbModelId\]/);
});

test('ImageDisplay and gallery transient notices share the exact toast recipe and tone semantics', () => {
  const wrapper = 'pointer-events-none fixed inset-0 z-40 flex items-center justify-center';
  const pill = 'text-white text-sm px-4 py-3 rounded-lg shadow-2xl border animate-in fade-in duration-150';
  for (const [text, tone, message] of [[image, 'copyNoticeTone', 'copyNotice'], [gallery, 'toastTone', 'toastMessage']]) {
    const block = text.slice(text.indexOf(`{${message} && (`)).split('\n      )}')[0];
    assert.ok(block.includes(wrapper));
    assert.ok(block.includes(pill));
    assert.ok(block.includes(`${tone} === 'error' ? 'bg-red-900 border-brand-red/70' : 'bg-black/90 border-white/10'`));
    assert.ok(block.includes(`role={${tone} === 'error' ? 'alert' : 'status'}`));
    assert.ok(block.includes(`aria-live={${tone} === 'error' ? undefined : 'polite'}`));
    assert.doesNotMatch(block, /text-base|px-6|py-4|rounded-2xl|z-50/);
  }
});

test('star feedback keeps its separate tone and announcements at the shared size and layer', () => {
  const star = image.slice(image.indexOf('{starFeedback && ('), image.indexOf('{isPromptEditorOpen &&'));
  assert.match(star, /fixed inset-0 z-40/);
  assert.match(star, /text-sm px-4 py-3 rounded-lg/);
  assert.match(star, /bg-amber-400 text-white border-amber-300/);
  assert.match(star, /role="status"\s+aria-live="polite"/);
  assert.doesNotMatch(star, /text-base|px-5|rounded-2xl|z-50/);
});

test('gallery toolbar wraps within the content box without clipping tooltip overflow', () => {
  assert.match(gallery, /className="flex flex-wrap sm:flex-nowrap min-w-0 max-w-full items-center gap-1\.5"/);
  assert.match(gallery, /flex flex-wrap min-w-0 max-w-full items-center justify-between/);
  const toolbar = gallery.slice(gallery.indexOf('{/* Wrap below sm'), gallery.indexOf('{/* Wrap below sm') + 2200);
  assert.doesNotMatch(toolbar, /overflow-x-auto/);
  assert.match(toolbar, /min-h-11 min-w-11/);
  assert.match(gallery, /<Tip text="Select items" side="bottom" align="right" \/>/);
  assert.match(gallery, /<Tip text="Exit selection mode" side="bottom" align="right" \/>/);
  assert.doesNotMatch(gallery, /group-hover\/tip-(select|cancel):opacity-100/);
});

test('Build Studio wraps its toolbar and measures both pill dimensions when clamping a drag', () => {
  assert.match(studio, /ref=\{toolbarRef\}\s+className="relative z-30 flex flex-wrap sm:flex-nowrap justify-center max-w-full/);
  assert.match(studio, /flex-1 min-h-0 flex flex-col md:flex-row/);
  assert.match(studio, /max-md:max-h-\[45%\] max-md:!w-full/);
  assert.match(studio, /toolbarRef\.current\?\.getBoundingClientRect\(\)/);
  assert.match(studio, /rootR\.right - pill\.width/);
  assert.match(studio, /rootR\.bottom - pill\.height/);
  assert.match(studio, /max-sm:min-h-11 max-sm:min-w-11/);
  assert.ok(studio.includes('max-w-[calc(100vw-16px)] whitespace-normal'));
  assert.match(studio, /<Tip text=\{label\} side="bottom" \/>/);
});

test('design contract requires overflow checks down to 320px and one transient toast recipe', () => {
  for (const text of ['The page never scrolls horizontally at any width\n  from 320 up. Wide rows wrap or scroll inside their own container.', '`flex-wrap`', '`sm:flex-nowrap`', 'Check at 320, 390, 768 and 1280', 'every transient notice in ImageDisplay and RecentGenerations', 'the no-horizontal-overflow rule in section 5']) {
    assert.ok(design.includes(text), text);
  }
});
