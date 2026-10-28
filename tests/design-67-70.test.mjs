import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { compile } from 'tailwindcss';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextMenuItemIndex } from '../utils/menuKeyboard.ts';
import { getAuthFormBlocker, getFeedbackFormBlocker, getAuthFormBlockerField, getFeedbackFormBlockerField } from '../utils/formValidation.ts';
import { shouldAutoCollapseGenerationPanel } from '../utils/generationPanel.ts';
import { FOCUS_RING } from '../utils/focusRing.ts';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('npm test and prebuild include the design and error-toast regression suites', () => {
  const { scripts } = JSON.parse(source('package.json'));
  const [frontend, functions] = scripts.test.split(' && ');
  const testFiles = frontend.split(/\s+/).filter(arg => arg.endsWith('.test.mjs'));
  for (const file of ['tests/error-toast.test.mjs', 'tests/design-67-70.test.mjs']) {
    assert.equal(testFiles.filter(path => path === file).length, 1, `${file} must run in npm test`);
  }
  assert.equal(functions, 'npm --prefix functions test');
  assert.ok(scripts.prebuild.split(' && ').includes('npm test'), 'prebuild must run the same suites');
});

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

test('star feedback uses a neutral pill with amber confined to the filled icon', () => {
  const star = image.slice(image.indexOf('{starFeedback && ('), image.indexOf('{isPromptEditorOpen &&'));
  assert.match(star, /fixed inset-0 z-40/);
  assert.match(star, /text-sm px-4 py-3 rounded-lg/);
  assert.match(star, /bg-black\/90 text-white border-white\/10/);
  assert.match(star, /starFeedback.on \? 'text-amber-400 fill-current' : ''/);
  assert.doesNotMatch(star, /bg-amber|border-amber|bg-slate/);
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
  assert.match(studio, /ref=\{toolbarRef\}\s+className="relative z-30 flex flex-wrap lg:flex-nowrap justify-center max-w-full/);
  assert.match(studio, /flex-1 min-h-0 flex flex-col side:flex-row/);
  assert.match(studio, /stack:flex-1 stack:max-h-none stack:min-h-\[40%\] stack:!w-full/);
  assert.match(studio, /toolbarRef\.current\?\.getBoundingClientRect\(\)/);
  assert.match(studio, /rootR\.right - pill\.width/);
  assert.match(studio, /rootR\.bottom - pill\.height/);
  assert.ok(studio.includes('[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11'));
  assert.match(studio, /<Tip text=\{\(disabled\) \? \(disabledReason\) : \(label\)\} side="bottom" \/>/);
});

test('design contract requires overflow checks down to 320px and one transient toast recipe', () => {
  for (const text of ['The page never scrolls horizontally at any width\n  from 320 up. Wide rows wrap or scroll inside their own container.', '`flex-wrap`', '`sm:flex-nowrap`', 'Check at 320, 390, 768 and 1280', 'every transient notice in ImageDisplay and RecentGenerations', 'the no-horizontal-overflow rule in section 5']) {
    assert.ok(design.includes(text), text);
  }
});


test('every product DOM element uses portal Tips instead of native titles', () => {
  const files = ['App.tsx', ...readdirSync(new URL('../components/', import.meta.url), { recursive: true })
    .filter(path => path.endsWith('.tsx'))
    .map(path => `components/${path}`)];
  for (const file of ['components/AdminPage.tsx', 'components/StatsPage.tsx']) {
    assert.ok(files.includes(file), `${file} must remain in the native-title audit`);
  }
  const violations = [];
  for (const file of files) {
    const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const scan = node => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^[a-z]/.test(node.tagName.getText(tree))) {
        for (const attribute of node.attributes.properties) {
          if (attribute.name?.getText(tree) === 'title') {
            const { line } = tree.getLineAndCharacterOfPosition(attribute.getStart(tree));
            violations.push(`${file}:${line + 1}`);
          }
        }
      }
      ts.forEachChild(node, scan);
    };
    scan(tree);
  }
  assert.deepEqual(violations, []);
});

function evaluateComponent(file, name, bindings) {
  const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  const find = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) initializer = node.initializer;
    ts.forEachChild(node, find);
  };
  find(tree);
  assert.ok(initializer, `${name} must be exercised`);
  const compiled = ts.transpileModule(`return (${initializer.getText(tree)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const scope = { getAuthFormBlockerField, getFeedbackFormBlockerField, setErrorField() {}, setErrorAttempt() {}, ...bindings };
  return new Function('React', 'FOCUS_RING', ...Object.keys(scope), compiled)(React, FOCUS_RING, ...Object.values(scope));
}

test('self-account menu keeps disabled actions and one explanatory Tip on each hoverable wrapper', () => {
  const Tip = () => null;
  const icon = () => null;
  const renderMenu = evaluateComponent('components/AdminPage.tsx', 'renderRowMenu', {
    Tip, Key: icon, Sparkles: icon, Unlock: icon, Lock: icon, UserMinus: icon, UserPlus: icon, Trash2: icon,
    rowMenuRef: { current: null }, actionInFlight: null, currentUser: { id: 'self' },
    unavailableId: 'fixture',
    setOpenRowMenu: () => {}, setConfirm: () => {},
  });
  for (const id of ['self', 'other']) {
    const menu = renderMenu({ id, email: `${id}@example.test` });
    const wrappers = React.Children.toArray(menu.props.children).filter(child =>
      child.type === 'div' && child.props.className.includes('group/tip'));
    assert.equal(wrappers.length, 2);
    for (const [index, wrapper] of wrappers.entries()) {
      assert.match(wrapper.props.className, /\brelative\b/);
      const children = React.Children.toArray(wrapper.props.children);
      const button = children.find(child => child.type === 'button');
      const tip = children.find(child => child.type === Tip);
      assert.equal(button.type, 'button');
      assert.equal(button.props.disabled, undefined);
      assert.equal(button.props['aria-disabled'], id === 'self');
      assert.match(button.props.className, /aria-disabled:cursor-not-allowed/);
      assert.equal(React.Children.toArray(button.props.children).some(child => child.type === Tip), false,
        'Tip must not be hosted by a disabled button');
      if (id === 'self') {
        assert.equal(tip.type, Tip);
        assert.equal(tip.props.text, index === 0
          ? 'You cannot suspend your own account' : 'You cannot delete your own account');
      } else assert.equal(tip.props.text, index === 0 ? 'Suspend account' : 'Delete account');
    }
    assert.doesNotMatch(renderToStaticMarkup(menu), /\stitle=/);
  }
});

test('daily bars expose date and counts to keyboard users with a single portal hint', () => {
  const Tip = () => null;
  const Chart = evaluateComponent('components/StatsPage.tsx', 'DailyBarChart', {
    Tip, numFmt: new Intl.NumberFormat(),
  });
  const chart = Chart({ title: 'Daily activity', data: [
    { date: '2026-10-27', images: 1, refinements: 2 },
    { date: '2026-10-28', images: 0, refinements: 0 },
  ] });
  const bars = chart.props.children[1].props.children;
  assert.equal(bars.length, 2);
  for (const [index, bar] of bars.entries()) {
    assert.equal(bar.props.tabIndex, 0);
    assert.equal(bar.props.role, 'img');
    const tips = React.Children.toArray(bar.props.children).filter(child => child.type === Tip);
    assert.equal(tips.length, 1);
    assert.equal(tips[0].props.text, bar.props['aria-label']);
    assert.equal(tips[0].props.text, index === 0
      ? '2026-10-27: 1 image, 2 refinements' : '2026-10-28: 0 images');
  }
  const markup = renderToStaticMarkup(chart);
  assert.match(markup, /<h3[^>]*>Daily activity<\/h3>/, 'component heading props are preserved');
  assert.doesNotMatch(markup, /\stitle=/);
});

test('admin values, actions, stats labels and uid render one portal hint with the full value', () => {
  const Tip = ({ text }) => React.createElement('span', { 'data-tip': text });
  const bindings = {
    FOCUS_RING,
    Tip, MoreHorizontal: () => null, Hash: () => null,
    entry: { label: 'A long model label that truncates in a narrow card' },
    u: { uid: 'fixture-user-with-a-long-uid-for-truncation' },
    row: { id: 'self', email: 'self@example.test', lastSignInAt: 1 },
    openRowMenu: null,
    lastSignInRelative: '1 day ago', lastSignInFull: 'October 27, 2026, 12:00:00 PM',
    createdShort: 'Oct 1, 2026', createdFull: 'October 1, 2026, 12:00:00 PM',
  };
  for (const [file, expression, expected] of [
    ['AdminPage', 'lastSignInFull', bindings.lastSignInFull],
    ['AdminPage', 'createdFull', bindings.createdFull],
    ['AdminPage', '"Actions"', 'Actions'],
    ['StatsPage', 'entry.label', bindings.entry.label],
    ['StatsPage', 'u.uid', bindings.u.uid],
  ]) {
    const text = source(`components/${file}.tsx`);
    assert.match(text, /import \{ Tip \} from '\.\/settings\/Tip'/);
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const hosts = [];
    const find = node => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'Tip' &&
          node.attributes.properties.some(attr => attr.name?.getText(tree) === 'text' &&
            (attr.initializer?.expression || attr.initializer)?.getText(tree) === expression)) {
        let host = node.parent;
        while (host && !ts.isJsxElement(host)) host = host.parent;
        hosts.push(host);
      }
      ts.forEachChild(node, find);
    };
    find(tree);
    assert.equal(hosts.length, 1, `${file}: ${expression} must have one tooltip host`);
    const compiled = ts.transpileModule(`return (${hosts[0].getText(tree)});`, {
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const host = new Function('React', ...Object.keys(bindings), compiled)(React, ...Object.values(bindings));
    assert.match(host.props.className, /\brelative\b/);
    assert.ok(host.props.className.includes('group/tip'));
    const tips = React.Children.toArray(host.props.children).filter(child => child.type === Tip);
    assert.equal(tips.length, 1);
    assert.equal(tips[0].props.text, expected);
    const markup = renderToStaticMarkup(host);
    assert.equal((markup.match(/data-tip=/g) || []).length, 1);
    assert.doesNotMatch(markup, /\stitle=|group-hover\/tip:opacity/);
    if (expression === '"Actions"') assert.ok(host.props['aria-label']);
  }
});

test('coarse-pointer studio controls keep 44px targets at tablet widths and hide mobile dividers', () => {
  const coarse = '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';
  assert.equal(studio.split(coarse).length - 1, 24, 'all reviewed studio controls retain coarse pointer targets');
  assert.doesNotMatch(studio, /max-sm:min-h-11|flex-wrap sm:flex-nowrap/);
  const dividers = studio.match(/className="w-px h-6[^"]*"/g) || [];
  assert.equal(dividers.length, 5);
  assert.ok(dividers.every(classes => classes.includes('max-lg:hidden')));
  assert.ok(dividers.every(classes => classes.includes('[@media(pointer:coarse)_and_(max-width:1024px)]:hidden')));
  const tree = ts.createSourceFile('BuildStudio.tsx', studio, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const headerButtons = [];
  const scan = node => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'button') {
      const label = node.attributes.properties.find(attr => attr.name?.getText(tree) === 'aria-label')?.initializer?.text;
      if (['Export PowerPoint with builds', 'Export PNGs for slides', 'Export MP4', 'Close Build Studio'].includes(label)) {
        headerButtons.push(label);
        const classes = node.attributes.properties.find(attr => attr.name?.getText(tree) === 'className')?.initializer?.getText(tree);
        assert.ok(classes?.includes(coarse), label);
      }
    }
    ts.forEachChild(node, scan);
  };
  scan(tree);
  assert.equal(headerButtons.length, 4, 'check every header action, including disabled exports');
});

const stackQuery = '(max-width:767px), (max-width:1279px) and (orientation:portrait)';
const sideQuery = '(min-width:1280px), (min-width:768px) and (orientation:landscape)';

test('stack and side variants compile complete complementary media lists', async () => {
  const css = postcss.parse(source('index.css'));
  const variants = css.nodes.filter(node => node.name === 'custom-variant' && ['stack', 'side'].includes(node.params));
  assert.equal(variants.length, 2);
  assert.ok(variants.every(node => css.nodes.indexOf(node) > css.nodes.findLastIndex(node => node.name === 'import')));
  const compiler = await compile(variants.map(node => node.toString()).join('\n') + '\n@tailwind utilities;');
  const compiled = postcss.parse(compiler.build(['stack:flex-none', 'side:flex-row']));
  for (const [selector, query, property, value] of [
    ['.stack\\:flex-none', stackQuery, 'flex', 'none'],
    ['.side\\:flex-row', sideQuery, 'flex-direction', 'row'],
  ]) {
    let found = 0;
    compiled.walkRules(selector, rule => {
      assert.equal(rule.nodes.length, 1, 'the variant must emit one complete media query list');
      const media = rule.nodes[0];
      assert.equal(media.name, 'media');
      assert.equal(media.params, query);
      assert.ok(media.nodes.some(node => node.prop === property && node.value === value));
      found++;
    });
    assert.equal(found, 1, `${selector} must compile`);
  }
  const matches = (query, width, height) => query.split(',').some(branch =>
    [...branch.matchAll(/\((max|min)-width:(\d+)px\)|\(orientation:(portrait|landscape)\)/g)]
      .every(([, bound, limit, orientation]) => orientation
        ? (orientation === 'portrait' ? height >= width : width > height)
        : bound === 'max' ? width <= Number(limit) : width >= Number(limit)));
  for (const width of [320, 390, 767, 768, 800, 1023, 1024, 1025, 1279, 1280, 1281]) {
    for (const height of [width - 100, width, width + 100]) {
      const stacked = matches(stackQuery, width, height);
      assert.equal(stacked, width <= 767 || (width <= 1279 && height >= width), `${width}x${height}`);
      assert.notEqual(stacked, matches(sideQuery, width, height), `${width}x${height}: no gap or overlap`);
    }
  }
});

test('stage stacks only when narrow or portrait without measuring its own height', () => {
  assert.match(studio, /flex flex-col side:flex-row/);
  assert.match(studio, /flex-1 stack:flex-none[^\n]*min-w-0 flex flex-col/);
  assert.match(studio, /flex-1 stack:flex-none[^\n]*min-h-0 flex items-center/);
  assert.match(studio, /stack:flex-1 stack:max-h-none stack:min-h-\[40%\] stack:!w-full/);
  assert.doesNotMatch(studio, /max-lg:(?!hidden)|lg:flex-row|innerWidth < 1024|pointer: coarse/);
  const touch = '[@media(pointer:coarse)_and_(max-width:1024px)]:';
  assert.deepEqual(studio.split(touch).slice(1).map(rest => rest.split(/[\s"]/)[0]), Array(5).fill('hidden'),
    'coarse pointer conditions only hide dividers');
  const measureBody = studio.match(/const measure = \(\) => \{([\s\S]*?)\n    \};/)[1];
  const compiledMeasure = ts.transpileModule(measureBody, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const measure = new Function('window', 'el', 'imgDims', 'fitBox', 'setBox', compiledMeasure);
  const cs = { paddingTop: '16', paddingBottom: '16', paddingLeft: '16', paddingRight: '16' };
  const layoutTop = 69;
  for (const [width, viewportHeight] of [[320, 640], [390, 844], [767, 500], [768, 1024], [1023, 1366], [1024, 1366]]) {
    const window = { innerHeight: viewportHeight, getComputedStyle: () => cs, matchMedia: query => {
      assert.equal(query, stackQuery);
      return { matches: true };
    } };
    for (const toolbarHeight of [70, 116, 162]) {
      const el = {
        clientWidth: width,
        get clientHeight() { throw new Error('stacked measurement must not read its own height'); },
        getBoundingClientRect: () => ({ top: layoutTop + toolbarHeight }),
        parentElement: { parentElement: { getBoundingClientRect: () => ({ top: layoutTop }) } },
      };
      for (const imgDims of [{ w: 1600, h: 900 }, { w: 900, h: 1600 }]) {
        const available = (viewportHeight - layoutTop) * 0.6 - toolbarHeight - 32;
        const expected = Math.max(0, Math.min(viewportHeight * 0.5, (width - 32) * imgDims.h / imgDims.w, available));
        measure(window, el, imgDims, (_w, h) => h, actual => {
          assert.equal(actual, expected);
          assert.ok(actual + toolbarHeight + 32 <= (viewportHeight - layoutTop) * 0.6, 'leave at least 40% for the panel');
        });
      }
    }
  }
  assert.match(studio, /window.addEventListener\('resize', measure\)/);
  assert.match(studio, /window.removeEventListener\('resize', measure\)/);
  for (const [width, height] of [[768, 600], [800, 600], [1023, 768], [1024, 768], [1024, 1366], [1025, 1366], [1280, 800], [768, 1024]]) {
    const stacked = width <= 767 || (width <= 1279 && height >= width);
    measure({ innerHeight: height, getComputedStyle: () => cs, matchMedia: query => {
      assert.equal(query, stackQuery);
      return { matches: stacked };
    } }, {
      clientWidth: width, clientHeight: 600,
      getBoundingClientRect: () => ({ top: 139 }),
      parentElement: { parentElement: { getBoundingClientRect: () => ({ top: layoutTop }) } },
    }, { w: 1600, h: 900 }, (_w, h) => h, actual => assert.equal(actual, stacked
      ? Math.min(height * 0.5, (width - 32) * 900 / 1600, (height - layoutTop) * 0.6 - 70 - 32)
      : 568));
  }
});

test('primary actions are teal with dark text while folder deletion stays red', () => {
  const control = source('components/ControlPanel.tsx');
  const primary = /bg-brand-teal hover:bg-teal-600 text-\[#0d1117\]/;
  assert.match(control.slice(control.indexOf('handleSaveItem();'), control.indexOf('handleSaveItem();') + 700), primary);
  assert.match(studio.slice(studio.indexOf('aria-label="Export MP4"'), studio.indexOf('aria-label="Export MP4"') + 450), primary);
  const refine = image.slice(image.indexOf('group/tip relative h-11 w-11'), image.indexOf('group/tip relative h-11 w-11') + 700);
  assert.match(refine, primary);
  assert.doesNotMatch(refine, /text-white|bg-brand-red|shadow-brand-red/);
  const submit = image.slice(image.indexOf("aria-disabled={(!refinementInput.trim()"), image.indexOf("aria-disabled={(!refinementInput.trim()") + 900);
  assert.match(submit, primary);
  assert.doesNotMatch(submit, /text-white|bg-brand-red/);
  const folderDelete = gallery.match(/className=\{`([^`]+)`\}\s*>\s*Delete folder/)[1];
  assert.match(folderDelete, /bg-brand-red text-white hover:opacity-90/);
});

test('copy menu clamps its measured position before paint and keeps outside-click and Escape dismissal', () => {
  assert.match(image, /ref=\{copyMenuRef\}/);
  assert.match(image, /ref=\{copyMenuTriggerRef\}/);
  assert.match(image, /w-48 max-w-\[calc\(100vw-1rem\)\]/);
  assert.match(image, /useLayoutEffect\(\(\) => \{\s+if \(!copyMenuOpen\) return;\s+const clampMenu/);
  assert.match(image, /Math.max\(8, Math.min\(window.innerWidth - rect.width - 8, anchor.right - rect.width\)\)/);
  assert.match(image, /menu.style.left = `\$\{left\}px`/);
  assert.match(image, /menu.style.top = `\$\{top\}px`/);
  assert.match(image, /copyMenuOpen && typeof document !== 'undefined' && createPortal\(/);
  const menu = image.slice(image.indexOf('{copyMenuOpen &&'), image.indexOf('{/* Unified Download menu'));
  assert.match(menu, /document.body/);
  assert.match(menu, /data-copy-menu-portal\s+data-folder-menu/);
  assert.match(menu, /className="fixed left-0 top-0[^"\n]*z-\[60\]/);
  assert.match(menu, /fixed inset-0 z-\[59\]" onClick=\{\(\) => setCopyMenuOpen\(false\)\}/);
  assert.match(gallery, /target.closest\('\[data-folder-menu\]'\)/);
  assert.match(image, /dismissErrorToastOnEscape\(event, hasVisibleErrorToast\(\), dismissTopErrorToast\)/);
  assert.match(image, /window.addEventListener\('keydown', onKey, true\)/);
  for (const event of ['scroll', 'resize']) {
    assert.ok(image.includes(`window.addEventListener('${event}', clampMenu`));
    assert.ok(image.includes(`window.removeEventListener('${event}', clampMenu`));
  }
  for (const width of [320, 390, 768, 1280]) {
    for (const anchor of [
      { right: 40, top: 400, bottom: 444 },
      { right: width - 12, top: 600, bottom: 644 },
      { right: width + 100, top: -20, bottom: 24 },
    ]) {
      const style = {};
      const clampMenu = evaluateComponent('components/ImageDisplay.tsx', 'clampMenu', {
        copyMenuRef: { current: { style, getBoundingClientRect: () => ({ width: 192, height: 142 }) } },
        copyMenuTriggerRef: { current: { getBoundingClientRect: () => anchor } },
        window: { innerWidth: width, innerHeight: 700 },
      });
      clampMenu();
      assert.equal(parseFloat(style.left), Math.max(8, Math.min(width - 200, anchor.right - 192)));
      assert.equal(parseFloat(style.top), anchor.top === 600 ? 450 : anchor.bottom + 8);
      assert.ok(parseFloat(style.left) + 192 <= width - 8);
      assert.ok(parseFloat(style.top) + 142 <= 692);
      assert.equal(style.maxHeight, '684px');
    }
  }
});

test('site footer reserves measured error-toast clearance and the toast uses the floating shadow', () => {
  const app = source('App.tsx');
  assert.match(app, /import \{[^}]*useErrorToastClearance[^}]*\} from '.\/utils\/errorToastStore'/);
  assert.match(app, /const errorToastClearance = useErrorToastClearance\(\)/);
  const footer = app.slice(app.indexOf('<footer'), app.indexOf('</footer>'));
  assert.match(footer, /style=\{\{ paddingBottom: errorToastClearance \? errorToastClearance \+ 16 : undefined \}\}/);
  for (const label of ['Changelog', 'Releases', 'Feedback']) assert.ok(footer.includes(label));
  const toast = source('components/ErrorToast.tsx');
  assert.match(toast, /role="alert"[^\n]*shadow-2xl/);
  assert.doesNotMatch(toast, /shadow-lg/);
});

function hookHarness() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  const changed = (previous, deps) => !previous || deps.some((value, index) => !Object.is(value, previous[index]));
  return {
    bindings: {
      useRef: value => slots[cursor++] ??= { current: value },
      useState: initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useCallback: (callback, deps) => {
        const index = cursor++;
        if (changed(slots[index]?.deps, deps)) slots[index] = { callback, deps };
        return slots[index].callback;
      },
      useEffect: (effect, deps) => {
        const index = cursor++;
        if (changed(slots[index]?.deps, deps)) pending.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      },
      window: { setTimeout: (...args) => setTimeout(...args), clearTimeout: timer => clearTimeout(timer) },
    },
    render: callback => {
      cursor = 0;
      const value = callback();
      pending.forEach(effect => effect());
      pending = [];
      return value;
    },
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

test('generation dock collapses after three idle seconds and cancels for new work, manual expansion and unmount', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = hookHarness();
  const hook = evaluateComponent('App.tsx', 'useGenerationPanelAutoCollapse', { ...harness.bindings, shouldAutoCollapseGenerationPanel });
  const collapsed = [];
  const setCollapsed = value => collapsed.push(value);
  const render = (hasJobs, running) => harness.render(() => hook(hasJobs ? [{ status: running ? 'running' : 'completed' }] : [], setCollapsed));
  render(false, false);
  t.mock.timers.tick(3001);
  assert.deepEqual(collapsed, []);
  render(true, true);
  t.mock.timers.tick(3001);
  assert.deepEqual(collapsed, []);
  render(true, false);
  t.mock.timers.tick(2999);
  assert.deepEqual(collapsed, []);
  t.mock.timers.tick(1);
  assert.deepEqual(collapsed, [true]);
  render(true, true);
  const cancel = render(true, false);
  t.mock.timers.tick(1000);
  cancel();
  render(true, false);
  t.mock.timers.tick(5000);
  assert.deepEqual(collapsed, [true], 'manual expansion must not reschedule while idle');
  render(true, true);
  render(true, false);
  t.mock.timers.tick(1000);
  render(true, true);
  t.mock.timers.tick(3000);
  assert.deepEqual(collapsed, [true], 'new work cancels the pending collapse');
  render(true, false);
  harness.unmount();
  t.mock.timers.tick(3001);
  assert.deepEqual(collapsed, [true]);
  const app = source('App.tsx');
  assert.match(app, /useGenerationPanelAutoCollapse\(\s+activeGenerationJobs,/);
  assert.match(app, /const canAutoCollapse = shouldAutoCollapseGenerationPanel\(jobs\)/);
  assert.match(app, /if \(!canAutoCollapse\) return/);
  assert.match(app, /job.status === 'running' \|\| job.status === 'stopping'/);
  assert.match(app, /cancelGenerationsPanelAutoCollapse\(\);\s+setIsGenerationsPanelCollapsed\(false\)/);
  assert.equal((app.match(/cancelGenerationsPanelAutoCollapse\(\);/g) || []).length, 2);
  assert.match(app, /scheduleGenerationJobDismissal = \(jobId: string, delayMs = 9000\)/);
  assert.match(app, /Toolbar hidden – scroll up or tap/);
});

test('Generate icons inherit their disabled and enabled foreground and Variations adds detail', () => {
  const panel = source('components/ControlPanel.tsx');
  const generate = panel.slice(panel.indexOf('aria-disabled={generateButtonDisabled}'), panel.indexOf('{!generateButtonDisabled &&'));
  const tree = ts.createSourceFile('generate.tsx', `<button ${generate}</button>`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const icons = [];
  const scan = node => {
    if (ts.isJsxSelfClosingElement(node) && ['KeyRound', 'UserPlus', 'Send'].includes(node.tagName.getText(tree))) {
      icons.push(node.tagName.getText(tree));
      assert.equal(node.attributes.properties.some(attr => attr.name?.getText(tree) === 'className'), false);
    }
    ts.forEachChild(node, scan);
  };
  scan(tree);
  assert.deepEqual(icons, ['KeyRound', 'UserPlus', 'Send']);
  assert.match(generate, /text-slate-400 dark:text-slate-500/);
  assert.match(generate, /: 'bg-gradient[^'\n]*text-white/);
  assert.match(panel, /<Tip title="Variations per prompt" text=\{Number.isFinite\(batchCap\) \? `Max \$\{batchCapLabel\} per prompt`/);
});

test('gallery context Delete arms before firing, auto-disarms and resets when its menu changes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = hookHarness();
  const useConfirmAction = evaluateComponent('hooks/useConfirmAction.ts', 'useConfirmAction', harness.bindings);
  const calls = [];
  const render = () => harness.render(() => evaluateComponent('components/RecentGenerations.tsx', 'tileDelete', {
    useConfirmAction,
    onDelete: id => calls.push(['delete', id]),
    showToast: message => calls.push(['toast', message]),
    closeAllContextMenus: () => calls.push(['close']),
  }));
  let action = render();
  assert.equal(action.trigger('tile-1'), false);
  assert.deepEqual(calls, [], 'first click must keep the menu open without deleting');
  action = render();
  assert.equal(action.isArmed('tile-1'), true);
  t.mock.timers.tick(2999);
  assert.equal(action.trigger('tile-1'), true);
  assert.deepEqual(calls, [['delete', 'tile-1'], ['toast', 'Deleting…'], ['close']]);
  action = render();
  action.trigger('tile-1');
  t.mock.timers.tick(3000);
  action = render();
  assert.equal(action.isArmed('tile-1'), false);
  assert.equal(action.trigger('tile-1'), false);
  action = render();
  action.reset();
  action = render();
  assert.equal(action.isArmed('tile-1'), false);
  harness.unmount();
  const menu = gallery.slice(gallery.indexOf('onClick={() => tileDelete.trigger(gen.id)}'), gallery.indexOf('onClick={() => tileDelete.trigger(gen.id)}') + 1000);
  assert.doesNotMatch(menu, /onDelete\(/);
  assert.match(menu, /aria-label=\{tileDelete.isArmed\(gen.id\) \? 'Click again to confirm' : 'Delete'\}/);
  assert.match(menu, /\{tileDelete.isArmed\(gen.id\) \? 'Click again to confirm' : 'Delete'\}/);
  assert.match(menu, /w-full min-w-\[13rem\]/);
  const minWidthPx = Number(menu.match(/min-w-\[(\d+)rem\]/)[1]) * 16;
  // Chrome measures Mona Sans 14px semibold at 147.77px for the armed label.
  // Reserve 24px padding, a 14px icon, an 8px gap and another 8px of margin.
  assert.ok(minWidthPx >= 147.77 + 24 + 14 + 8 + 8, 'armed label must fit without widening the menu');
  assert.ok(minWidthPx + 2 <= Math.min(320 - 16, 16 * 16), 'row and panel borders fit the 320px viewport cap');
  assert.match(gallery, /max-w-\[min\(100vw-1rem,16rem\)\]/);
  assert.doesNotMatch(menu, /Click again to delete/);
  assert.match(menu, /bg-amber-500 text-\[#0d1117\] animate-pulse/);
  assert.match(menu, /<Check size=\{14\}/);
  assert.match(gallery, /React.useEffect\(\(\) => \{\s+resetTileDelete\(\);\s+\}, \[tileContextMenu\?\.generationId, tileContextMenu\?\.view, resetTileDelete\]\)/);
});

test('disabled-control wrappers can show one viewport-clamped shared Tip', () => {
  const tip = source('components/settings/Tip.tsx');
  assert.doesNotMatch(tip, /host.querySelector\(':disabled'\)/);
  assert.doesNotMatch(tip, /host.matches\(':disabled'\)/);
  assert.match(tip, /w-72 max-w-\[calc\(100vw-16px\)\]/);
  const download = source('components/DownloadMenu.tsx');
  assert.equal((download.match(/<Tip\b/g) || []).length, 1);
  assert.doesNotMatch(download, /group-hover\/dl-tip|role="tooltip"/);
});

function classAlternatives(node) {
  if (!node) return [''];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) return classAlternatives(node.expression);
  if (ts.isConditionalExpression(node)) return [...classAlternatives(node.whenTrue), ...classAlternatives(node.whenFalse)];
  const combine = (left, right) => left.flatMap(a => right.map(b => a + b));
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce((classes, span) => combine(classes, classAlternatives(span.expression)).map(value => value + span.literal.text), [node.head.text]);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return combine(classAlternatives(node.left), classAlternatives(node.right));
    return [...classAlternatives(node.left), ...classAlternatives(node.right)];
  }
  return [''];
}

function componentClassLists(text, file = 'fixture.tsx') {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lists = [];
  const scan = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'className') {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      for (const classes of classAlternatives(node.initializer)) lists.push({ classes, location: `${file}:${line + 1}` });
    }
    ts.forEachChild(node, scan);
  };
  scan(tree);
  return lists;
}

const isAmberWhite = classes => /(?:^|[\s:])bg-amber-\S+/.test(classes) && /(?:^|[\s:])text-white(?:\/\S+)?(?=\s|$)/.test(classes);

test('amber scan catches literal, multiline, hover and conditional combinations without mixing exclusive branches', () => {
  const unsafe = [
    '<div className="bg-amber-400 text-white" />',
    '<div className={`bg-amber-500/90\ntext-white`} />',
    '<div className={`text-white ${armed ? "bg-amber-500" : "bg-black"}`} />',
    '<div className={`bg-amber-500 ${armed ? "text-white" : "text-[#0d1117]"}`} />',
    '<div className={"text-white " + (armed ? "hover:bg-amber-500" : "bg-black")} />',
    '<div className={armed && "bg-amber-500 text-white"} />',
  ];
  for (const fixture of unsafe) assert.ok(componentClassLists(fixture).some(({ classes }) => isAmberWhite(classes)), fixture);
  for (const fixture of [
    '<div className={`rounded ${armed ? "bg-amber-500 text-[#0d1117] animate-pulse" : "bg-red-600 text-white"}`} />',
    '<div className="bg-black/90 text-white"><Star className="text-amber-400" /></div>',
    '<div className={armed ? "bg-amber-500 text-[#0d1117]" : "bg-black text-white"} />',
  ]) assert.equal(componentClassLists(fixture).some(({ classes }) => isAmberWhite(classes)), false, fixture);
});

test('design rules and every component class list keep white off amber, including armed confirms', () => {
  for (const rule of [
    'Below md, or below xl in portrait, the stage stacks above the panel and hugs its image; leftover height goes to the panel, never to empty space around the image. Landscape tablets stay side by side.',
    'Favorite star icon = amber-400 (icon only, never a fill behind text).',
    'bg-amber-500 text-[#0d1117] animate-pulse',
    'Amber backgrounds always take #0d1117 text; amber text/icons on photos need a solid dark chip behind them.',
  ]) assert.ok(design.includes(rule), rule);
  const files = ['App.tsx', ...readdirSync(new URL('../components/', import.meta.url), { recursive: true })
    .filter(path => path.endsWith('.tsx')).map(path => `components/${path}`)];
  let armedControls = 0;
  const violations = [];
  for (const file of files) {
    for (const { classes, location } of componentClassLists(source(file), file)) {
      if (isAmberWhite(classes)) violations.push(location);
      if (classes.includes('bg-amber-500') && classes.includes('animate-pulse')) {
        armedControls++;
        assert.ok(classes.includes('bg-amber-500 text-[#0d1117] animate-pulse'), location);
      }
    }
  }
  assert.deepEqual([...new Set(violations)], []);
  assert.ok(armedControls > 0, 'armed controls must be checked');
});

const luminance = hex => hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255)
  .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test('favorite chips use neutral backgrounds with amber icons and warnings use opaque dark-on-amber', () => {
  const best = image.slice(image.indexOf('{generation.starredVersionId && generation.starredVersionId === version.id && ('), image.indexOf('{/* Info overlay'));
  assert.match(best, /bg-black\/90 text-white border border-white\/10/);
  assert.match(best, /<Star[^>]*className="text-amber-400 fill-current"/);
  assert.doesNotMatch(best, /bg-amber/);
  const rail = image.slice(image.indexOf('aria-pressed={isStarredVersion}'), image.indexOf('Starred - Unstar'));
  assert.match(rail, /bg-black\/90 text-white/);
  assert.match(rail, /className=\{isStarredVersion \? 'text-amber-400 fill-current' : 'text-white'\}/);
  assert.doesNotMatch(rail, /bg-amber|text-amber-300/);
  const juxtapose = source('components/JuxtaposeSlider.tsx').split('\n').find(line => line.includes('bg-amber-500'));
  const admin = source('components/AdminPage.tsx').split('\n').find(line => line.includes('bg-amber-500'));
  for (const classes of [juxtapose, admin]) {
    assert.match(classes, /bg-amber-500 text-\[#0d1117\]/);
    assert.doesNotMatch(classes, /bg-amber-\d+\/|text-white|hover:bg-amber-700/);
  }
  assert.ok(contrast('fbbf24', '1a1a1a') >= 3, 'amber-400 icon against the worst-case white photo through black/90');
  assert.ok(contrast('ffffff', '1a1a1a') >= 4.5, 'BEST label on its neutral chip');
  assert.ok(contrast('f59e0b', '0d1117') >= 4.5, 'opaque amber-500 text in juxtapose and admin');
});

test('Build Studio sidebar draws its divider on the matching edge for stacked and side layouts', () => {
  const studio = source('components/BuildStudio.tsx');
  const sidebar = studio.match(/<div className="(relative shrink-0 min-h-0 stack:flex-1[^"]*)" style=\{\{ width: sidebarW/);
  assert.ok(sidebar, 'Build Studio edit sidebar not found');
  const classes = sidebar[1].split(/\s+/);
  assert.ok(classes.includes('side:border-l'), 'side layout keeps the left divider');
  assert.ok(classes.includes('stack:border-t'), 'stacked layout gets a top divider');
  assert.ok(!classes.includes('border-l'), 'unconditional border-l leaves a stray left border when stacked');
});

test('enabled Generate uses brightness hover only in its enabled gradient branch', () => {
  const panel = source('components/ControlPanel.tsx');
  assert.match(panel, /generateButtonDisabled\s*\? 'bg-gray[^']*'\s*: 'bg-gradient[^']*hover:brightness-95[^']*'/);
  assert.doesNotMatch(panel, /hover:saturate-125/);
});

test('copy menu index navigation wraps arrows and Tab, supports Home and End, and ignores other keys', () => {
  for (const count of [1, 2, 4]) {
    for (let index = 0; index < count; index++) {
      for (const [key, shift, expected] of [
        ['ArrowDown', false, (index + 1) % count], ['ArrowUp', false, (index + count - 1) % count],
        ['Tab', false, (index + 1) % count], ['Tab', true, (index + count - 1) % count],
        ['Home', false, 0], ['End', false, count - 1], ['Escape', false, null], ['x', false, null],
      ]) assert.equal(nextMenuItemIndex(index, count, key, shift), expected);
    }
  }
  assert.equal(nextMenuItemIndex(-1, 3, 'ArrowDown'), 0);
  assert.equal(nextMenuItemIndex(-1, 3, 'ArrowUp'), 2);
  assert.equal(nextMenuItemIndex(-1, 3, 'Tab', true), 2);
  assert.equal(nextMenuItemIndex(-1, 0, 'Tab'), null);
});

test('copy menu focuses its first enabled item, traps navigation and returns focus for every close path', () => {
  const selector = 'button[role="menuitem"]:not(:disabled):not([aria-disabled="true"])';
  const items = [0, 1, 2].map(index => ({ focus: () => { document.activeElement = items[index]; } }));
  const document = { activeElement: null };
  const menu = {
    style: {}, getBoundingClientRect: () => ({ width: 192, height: 142 }),
    querySelector: query => { assert.equal(query, selector); return items[0]; },
    querySelectorAll: query => { assert.equal(query, selector); return items; },
  };
  const handler = evaluateComponent('components/ImageDisplay.tsx', 'handleCopyMenuKeyDown', { nextMenuItemIndex, document });
  const tree = ts.createSourceFile('image.tsx', image, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const find = node => {
    if (ts.isCallExpression(node) && node.expression.getText() === 'useLayoutEffect'
      && node.arguments[0].getText().includes('if (!copyMenuOpen)')) effect = node.arguments[0];
    ts.forEachChild(node, find);
  };
  find(tree);
  assert.ok(effect);
  const listeners = new Map();
  let triggerFocus = 0;
  let open = true;
  let cleanup;
  let toastOpen = false;
  const bindings = {
    copyMenuOpen: true, copyMenuRef: { current: menu },
    copyMenuTriggerRef: { current: { focus: () => { triggerFocus++; }, getBoundingClientRect: () => ({ right: 300, top: 100, bottom: 144 }) } },
    window: {
      innerWidth: 390, innerHeight: 844,
      addEventListener: (type, fn, capture) => { listeners.set(type, { fn, capture }); },
      removeEventListener: (type, fn, capture) => { assert.deepEqual(listeners.get(type), { fn, capture }); listeners.delete(type); },
    },
    setCopyMenuOpen: value => { open = value; cleanup(); },
    hasVisibleErrorToast: () => toastOpen, dismissTopErrorToast() {},
    dismissErrorToastOnEscape: (_event, visible) => visible,
  };
  const compiled = ts.transpileModule(`return (${effect.getText()});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const runEffect = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
  cleanup = runEffect();
  assert.equal(document.activeElement, items[0], 'opening focuses the first eligible menuitem');
  for (const [key, shiftKey, expected] of [['ArrowUp', false, 2], ['Tab', false, 0], ['Tab', true, 2], ['Home', false, 0], ['End', false, 2]]) {
    let prevented = false;
    let stopped = false;
    handler({ key, shiftKey, currentTarget: menu, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    assert.equal(document.activeElement, items[expected]);
    assert.ok(prevented && stopped, 'navigation stays inside the portaled menu');
  }
  assert.equal(listeners.get('keydown').capture, true);
  let prevented = false;
  let stopped = false;
  const escape = { key: 'Escape', preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } };
  toastOpen = true;
  listeners.get('keydown').fn(escape);
  assert.equal(open, true, 'the visible error toast retains Escape priority');
  toastOpen = false;
  listeners.get('keydown').fn(escape);
  assert.equal(open, false);
  assert.ok(prevented && stopped, 'Escape cannot dismiss the parent modal');
  assert.equal(triggerFocus, 1);
  assert.equal(listeners.size, 0);
  assert.match(image, /role="menu"\s+aria-label="Copy"\s+onKeyDown=\{handleCopyMenuKeyDown\}/);
  const portal = image.slice(image.indexOf('{copyMenuOpen &&'), image.indexOf('{/* Unified Download menu'));
  assert.equal((portal.match(/setCopyMenuOpen\(false\)/g) || []).length, 5, 'outside catcher and all four selection paths close through effect cleanup');
  assert.match(portal, /z-\[60\]/);
});

function reasonSpanViolations(text, filename = 'fixture.tsx') {
  const tree = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  const visit = node => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const attr = (node, name) => (ts.isJsxElement(node) ? node.openingElement : node).attributes.properties
    .find(prop => ts.isJsxAttribute(prop) && prop.name.getText() === name)?.initializer;
  const normalize = node => {
    while (node && ts.isParenthesizedExpression(node)) node = node.expression;
    return node?.getText().replace(/\s/g, '').replace(/^Boolean\((.*)\)$/, '$1');
  };
  const value = (node, name) => {
    const initializer = attr(node, name);
    return initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
  };
  const ids = node => {
    if (!node) return [];
    if (ts.isParenthesizedExpression(node)) return ids(node.expression);
    if (ts.isConditionalExpression(node)) return [...ids(node.whenTrue), ...ids(node.whenFalse)];
    if (ts.isStringLiteralLike(node)) return node.text.split(/\s+/).filter(Boolean).map(id => JSON.stringify(id));
    return [normalize(node)];
  };
  const references = nodes.flatMap(node => ['aria-describedby', 'aria-labelledby', 'htmlFor'].flatMap(name => {
    const described = value(node, name);
    return described ? [{ node, described, ids: ids(described) }] : [];
  }));
  const violations = [];
  let checked = 0;
  for (const node of nodes) {
    if ((ts.isJsxElement(node) ? node.openingElement : node).tagName.getText() !== 'span'
      || !/\bsr-only\b/.test(attr(node, 'className')?.getText() || '')) continue;
    const id = value(node, 'id');
    if (!id) continue;
    const controls = references.filter(ref => ref.ids.includes(ids(id)[0]));
    const location = `${filename}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    if (!controls.length) { violations.push(location); continue; }
    const disabledControls = controls.filter(({ node }) => value(node, 'aria-disabled') || value(node, 'disabled'));
    if (!disabledControls.length) continue;
    checked++;
    for (const { node: control, described } of disabledControls) {
      const condition = ts.isConditionalExpression(described) ? described.condition : null;
      const disabled = attr(control, 'aria-disabled')?.expression || attr(control, 'disabled')?.expression;
      let guarded = false;
      for (let child = node, parent = child.parent; parent && !ts.isSourceFile(parent); child = parent, parent = parent.parent) {
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          && parent.right === child && normalize(parent.left) === normalize(condition)) guarded = true;
        if (ts.isConditionalExpression(parent) && parent.whenTrue === child
          && normalize(parent.condition) === normalize(condition)) guarded = true;
      }
      if (!condition || !disabled || normalize(disabled) !== normalize(condition) || !guarded
        || normalize(described.whenFalse) !== 'undefined') {
        violations.push(location);
      }
    }
  }
  return { violations, checked };
}

test('all described sr-only reason spans are conditional on the matching disabled condition', t => {
  const control = '<button aria-disabled={blocked} aria-describedby={blocked ? reasonId : undefined} />';
  const span = '<span id={reasonId} className="sr-only">Reason</span>';
  assert.equal(reasonSpanViolations(`<div>${span}</div>`).violations.length, 1, 'unreferenced expression IDs must fail');
  assert.equal(reasonSpanViolations('<span id="orphan" className="sr-only">Reason</span>').violations.length, 1,
    'unreferenced literal IDs must fail');
  for (const reference of ['aria-describedby', 'aria-labelledby', 'htmlFor']) {
    assert.deepEqual(reasonSpanViolations(`<div><label ${reference}="other reason" /><span id="reason" className="sr-only">Reason</span></div>`).violations, []);
    assert.deepEqual(reasonSpanViolations(`<div><label ${reference}={reasonId} />${span}</div>`).violations, []);
  }
  for (const classes of ['"sr-only extra"', '{`sr-only ${extra}`}', '{blocked ? "sr-only" : "hidden"}', '{clsx("extra", "sr-only") }']) {
    const expressionSpan = span.replace('"sr-only"', classes);
    assert.equal(reasonSpanViolations(`<div>${control}${expressionSpan}</div>`).violations.length, 1);
    assert.deepEqual(reasonSpanViolations(`<div>${control}{blocked && ${expressionSpan}}</div>`), { violations: [], checked: 1 });
  }
  for (const bad of [span, `{other && ${span}}`, `{blocked ? null : ${span}}`]) {
    assert.equal(reasonSpanViolations(`<div>${control}${bad}</div>`).violations.length, 1);
  }
  for (const good of [`{blocked && ${span}}`, `{blocked ? (${span}) : null}`]) {
    assert.deepEqual(reasonSpanViolations(`<div>${control}${good}</div>`), { violations: [], checked: 1 });
  }
  assert.equal(reasonSpanViolations(`<div>${control.replace('aria-disabled={blocked}', 'aria-disabled={other}')}{blocked && ${span}}</div>`).violations.length, 1);
  const filesIn = dir => readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? filesIn(`${dir}/${entry.name}`) : entry.name.endsWith('.tsx') ? [`${dir}/${entry.name}`] : []);
  const files = ['App.tsx', ...filesIn('components')];
  const scans = files.map(file => reasonSpanViolations(source(file), file));
  assert.deepEqual(scans.flatMap(scan => scan.violations), []);
  assert.equal(scans.reduce((count, scan) => count + scan.checked, 0), 73, 'four navigation controls describe their existing rich cards instead of duplicate reasons');
  t.diagnostic(`AST scan: ${files.length} files, 73 conditional disabled-reason spans`);
});

test('incomplete auth and feedback form guards report specific errors before any backend work', async () => {
  const filled = { isLogin: true, name: 'Name', username: 'name', email: 'fixture', password: 'fixture' };
  const cases = [
    [{ ...filled, email: '' }, 'Enter your email or username first.'],
    [{ ...filled, email: '   ' }, 'Enter your email or username first.'],
    [{ ...filled, password: '' }, 'Password is required.'],
    [{ ...filled, isLogin: false, name: ' ' }, 'Name is required.'],
    [{ ...filled, isLogin: false, username: ' ' }, 'Username is required.'],
    [{ ...filled, isLogin: false, email: '' }, 'Email address is required.'],
    [{ ...filled, isLogin: false }, 'Enter a valid email address.'],
    [{ ...filled, isLogin: false, email: 'a@b', password: '' }, 'Password is required.'],
  ];
  assert.equal(getAuthFormBlocker(filled), null);
  assert.equal(getAuthFormBlocker({ ...filled, isLogin: false, email: 'a@b' }), null);
  for (const [state, expected] of cases) {
    assert.equal(getAuthFormBlocker(state), expected);
    let error;
    let status = 'old status';
    let prevented = false;
    const handle = evaluateComponent('components/AuthModal.tsx', 'handleSubmit', {
      ...state, busyRef: { current: false }, isSubmittingRef: { current: false }, getAuthFormBlocker,
      setError: value => { error = value; }, setStatus: value => { status = value; },
      setIsLoading: () => assert.fail('incomplete form must not start a request'),
      authService: new Proxy({}, { get: () => assert.fail('Auth must never be called') }),
    });
    await handle({ preventDefault: () => { prevented = true; } });
    assert.ok(prevented);
    assert.equal(error, expected);
    assert.equal(status, null);
  }
  for (const message of ['', ' ', 'a', ' ab ']) {
    const expected = 'Write a short note so we know what to look at.';
    assert.equal(getFeedbackFormBlocker(message), expected);
    let error;
    const handle = evaluateComponent('components/FeedbackModal.tsx', 'sendFeedback', {
      message, contactEmail: '', busy: false, getFeedbackFormBlocker, setError: value => { error = value; },
      setBusy: () => assert.fail('incomplete feedback must not start a request'),
      submitFeedback: () => assert.fail('feedback backend must never be called'),
    });
    await handle({ preventDefault() {} });
    assert.equal(error, expected);
  }
  assert.equal(getFeedbackFormBlocker(' abc '), null);
  for (const [file, handler, bindings] of [
    ['AuthModal', 'handleSubmit', { busy: true, isSubmittingRef: { current: false } }],
    ['AuthModal', 'handleSubmit', { busy: false, isSubmittingRef: { current: true } }],
    ['FeedbackModal', 'sendFeedback', { busy: true }],
  ]) {
    await evaluateComponent(`components/${file}.tsx`, handler, {
      ...bindings, busyRef: { current: bindings.busy }, setError: () => assert.fail('busy submissions return silently'),
      getAuthFormBlocker: () => assert.fail('busy guard runs first'), getFeedbackFormBlocker: () => assert.fail('busy guard runs first'),
    })({ preventDefault() {} });
  }
  const auth = source('components/AuthModal.tsx');
  const feedback = source('components/FeedbackModal.tsx');
  assert.match(auth, /<form noValidate onSubmit=\{handleSubmit\}/);
  assert.match(feedback, /<form noValidate onSubmit=\{\(event\) => void sendFeedback\(event\)\}/);
  for (const text of [auth, feedback]) {
    assert.match(text, /role="alert"/);
    assert.match(text, /<button\s+type="submit"\s+aria-disabled=/);
    assert.doesNotMatch(text, /if \((?:submitDisabled|sendDisabled)(?: \|\|[^)]*)?\) return/);
  }
});

test('password reset reports an empty email before backend work and returns silently while busy', async () => {
  const auth = source('components/AuthModal.tsx');
  const handler = auth.slice(auth.indexOf('  const handlePasswordReset ='), auth.indexOf('  const toggleMode ='));
  assert.match(handler, /const handlePasswordReset = async \(\) => \{\s+if \(busyRef\.current\) return;/);
  assert.doesNotMatch(handler, /if \(resetDisabled\) return;/);
  for (const email of ['', '   ']) {
    for (const busy of [false, true]) {
      let error = 'old error';
      let status = 'old status';
      await evaluateComponent('components/AuthModal.tsx', 'handlePasswordReset', {
        busyRef: { current: busy }, resetDisabled: true, email,
        setError: value => { error = value; }, setStatus: value => { status = value; },
        setIsResetting: () => assert.fail('empty email must not start a reset request'),
        authService: { requestPasswordReset: () => assert.fail('reset service must never be called') },
      })();
      assert.equal(error, busy ? 'old error' : 'Enter your email or username first.');
      assert.equal(status, busy ? 'old status' : null);
    }
  }
});

test('feedback accepts optional contact emails and checks the message before the email', () => {
  for (const contactEmail of [undefined, '', '   ', 'a@b', ' a@b ']) {
    assert.equal(getFeedbackFormBlocker('A useful note', contactEmail), null);
  }
  for (const contactEmail of ['not an email', 'a@', '@b', 'a@@b', 'a b@c']) {
    assert.equal(getFeedbackFormBlocker('A useful note', contactEmail), 'Enter a valid email address.');
  }
  assert.equal(getFeedbackFormBlocker(' ab ', 'not an email'), 'Write a short note so we know what to look at.');
});

test('feedback reports a bad contact email inline without starting a request', async () => {
  let error;
  let prevented = false;
  await evaluateComponent('components/FeedbackModal.tsx', 'sendFeedback', {
    message: 'A useful note', contactEmail: 'not an email', busy: false, getFeedbackFormBlocker,
    setError: value => { error = value; },
    setBusy: () => assert.fail('invalid contact email must not start a request'),
    submitFeedback: () => assert.fail('feedback backend must never be called'),
  })({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(error, 'Enter a valid email address.');
  assert.match(source('components/FeedbackModal.tsx'), /const sendDisabled = busy \|\| message\.trim\(\)\.length < 3;/);
});

test('feedback keeps its inline error inside the sticky footer above both actions', () => {
  const tree = ts.createSourceFile('FeedbackModal.tsx', source('components/FeedbackModal.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const footers = [];
  const findFooter = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr =>
      attr.name?.getText(tree) === 'className' && attr.initializer?.text?.includes('sticky bottom-0'))) footers.push(node);
    ts.forEachChild(node, findFooter);
  };
  findFooter(tree);
  assert.equal(footers.length, 1);
  const footer = footers[0];
  const alert = footer.children.find(node => ts.isJsxExpression(node) && node.getText(tree).includes('role="alert"'));
  const actions = footer.children.find(node => ts.isJsxElement(node) && node.getText(tree).includes('type="submit"'));
  assert.ok(alert, 'the sticky footer must contain the inline error so it cannot cover it');
  assert.ok(actions, 'the action row stays inside the same sticky footer');
  assert.ok(alert.end < actions.getStart(tree), 'the error must precede the action row at every breakpoint');
  assert.match(actions.getText(tree), /flex shrink-0 gap-2 justify-end/);
  assert.match(actions.getText(tree), />Cancel<\/button>/);
});

test('dock eligibility excludes running, stopping and failed rows, including mixed terminal results', () => {
  for (const [statuses, expected] of [
    [['running'], false], [['stopping'], false], [['failed'], false], [['completed'], true],
    [['completed', 'failed'], false], [[], false], [['stopped'], true], [['completed', 'running'], false],
  ]) assert.equal(shouldAutoCollapseGenerationPanel(statuses.map(status => ({ status }))), expected);
});

test('failed dock rows cancel pending collapse until dismissal without changing removal timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = hookHarness();
  const hook = evaluateComponent('App.tsx', 'useGenerationPanelAutoCollapse', { ...harness.bindings, shouldAutoCollapseGenerationPanel });
  const collapsed = [];
  const setCollapsed = value => collapsed.push(value);
  const render = statuses => harness.render(() => hook(statuses.map(status => ({ status })), setCollapsed));
  render(['completed']);
  t.mock.timers.tick(2000);
  render(['completed', 'failed']);
  t.mock.timers.tick(14000);
  assert.deepEqual(collapsed, [], 'Needs attention stays visible beyond the collapse timeout');
  render(['completed']);
  t.mock.timers.tick(2999);
  assert.deepEqual(collapsed, []);
  t.mock.timers.tick(1);
  assert.deepEqual(collapsed, [true], 'dismissing the failure restores the ordinary idle collapse rule');
  render(['failed']);
  render([]);
  t.mock.timers.tick(14000);
  assert.deepEqual(collapsed, [true], 'dismissing the final row never schedules a collapse');
  harness.unmount();
  const app = source('App.tsx');
  assert.match(app, /scheduleGenerationJobDismissal = \(jobId: string, delayMs = 9000\)/);
  assert.match(app, /scheduleGenerationJobDismissal\(jobId, 14000\)/);
  assert.match(app, /onClick=\{\(\) => clearGenerationJob\(job.id\)\}/);
});

test('form blockers map each inline error to its field while preserving message helpers', () => {
  const complete = { isLogin: false, name: 'Name', username: 'name', email: 'a@b', password: 'fixture' };
  for (const [changes, field, message] of [
    [{ name: ' ' }, 'name', 'Name is required.'],
    [{ username: '' }, 'username', 'Username is required.'],
    [{ email: '' }, 'email', 'Email address is required.'],
    [{ email: 'invalid' }, 'email', 'Enter a valid email address.'],
    [{ password: '' }, 'password', 'Password is required.'],
    [{ isLogin: true, email: '' }, 'email', 'Enter your email or username first.'],
  ]) {
    const state = { ...complete, ...changes };
    assert.equal(getAuthFormBlockerField(state), field);
    assert.equal(getAuthFormBlocker(state), message);
  }
  assert.equal(getAuthFormBlockerField(complete), null);
  assert.equal(getAuthFormBlockerField({ ...complete, isLogin: true, email: 'username' }), null);
  assert.equal(getFeedbackFormBlockerField('', 'invalid'), 'message');
  assert.equal(getFeedbackFormBlockerField('Useful note', 'invalid'), 'contactEmail');
  assert.equal(getFeedbackFormBlockerField('Useful note', 'a@b'), null);
  assert.equal(getFeedbackFormBlockerField('Useful note'), null);
});

test('modal field errors focus and scroll the invalid field and clear on edits', () => {
  for (const [file, fields] of [
    ['AuthModal', ['name', 'username', 'email', 'password']],
    ['FeedbackModal', ['message', 'contactEmail']],
  ]) {
    const text = source(`components/${file}.tsx`);
    assert.match(text, /<p id=\{errorId\} role="alert"/);
    assert.match(text, /field\?\.focus\(\{ preventScroll: true \}\)/);
    assert.match(text, /field\?\.scrollIntoView\(\{ block: 'center' \}\)/);
    assert.match(text, /\[error, errorField, errorAttempt\]/);
    for (const field of fields) {
      assert.ok(text.includes(`aria-invalid={Boolean(error && errorField === '${field}')}`));
      assert.ok(text.includes(`aria-describedby={error && errorField === '${field}' ? errorId : undefined}`));
      assert.ok(text.includes(`if (errorField === '${field}') { setError(null); setErrorField(null); }`));
    }
  }
  const feedback = source('components/FeedbackModal.tsx');
  assert.match(feedback, /setErrorField\(getFeedbackFormBlockerField\(message, contactEmail\)\)/);
  assert.match(feedback, /scroll-mb-\[25vh\]/);
  assert.match(feedback, /max-h-\[25vh\] flex flex-col overflow-hidden/);
  assert.match(feedback, /max-h-16 shrink overflow-y-auto break-words[^\n]*text-sm leading-5/);
  const auth = source('components/AuthModal.tsx');
  assert.match(auth, /setErrorField\(getAuthFormBlockerField\(/);
  assert.match(auth, /setError\('Enter your email or username first\.'\);\s*setErrorField\('email'\)/);
});

test('two synchronous reset activations send one request and release the guard after success or failure', async () => {
  for (const reject of [false, true]) {
    let finish, calls = 0;
    const busyRef = { current: false };
    const pending = new Promise((resolve, fail) => { finish = reject ? fail : resolve; });
    const reset = evaluateComponent('components/AuthModal.tsx', 'handlePasswordReset', {
      busyRef, email: 'fixture', setError() {}, setStatus() {}, setIsResetting() {},
      authService: { requestPasswordReset() { calls++; return pending; } },
    });
    const first = reset();
    const second = reset();
    assert.equal(calls, 1);
    assert.equal(busyRef.current, true);
    finish(reject ? new Error('mock failure') : undefined);
    await Promise.all([first, second]);
    assert.equal(busyRef.current, false);
  }
});

test('converted controls have unconditional Tips and existing navigation cards own their descriptions', () => {
  const filesIn = dir => readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? filesIn(`${dir}/${entry.name}`) : entry.name.endsWith('.tsx') ? [`${dir}/${entry.name}`] : []);
  for (const file of ['App.tsx', ...filesIn('components')]) {
    const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const inspect = node => {
      if (ts.isJsxElement(node)) {
        const buttons = node.children.filter(child => ts.isJsxElement(child) && child.openingElement.tagName.getText() === 'button');
        for (const button of buttons) {
          if (!button.openingElement.getText().includes('aria-disabled')) continue;
          const directTips = [...node.children, ...button.children].filter(child =>
            ts.isJsxSelfClosingElement(child) && child.tagName.getText() === 'Tip');
          assert.ok(directTips.length <= 1, `${file}: one direct Tip per control`);
          const conditionalTips = [...node.children, ...button.children].filter(child =>
            ts.isJsxExpression(child) && child.expression && ts.isBinaryExpression(child.expression)
            && child.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
            && child.expression.right.getText().startsWith('<Tip'));
          assert.equal(conditionalTips.length, 0, `${file}: Tip must exist in both enabled and disabled states`);
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(tree);
  }
  for (const [text, nums] of [[image, [1, 2]], [gallery, [7, 8]]]) {
    for (const num of nums) {
      assert.ok(text.includes(`aria-describedby={\x60\x24{unavailableId}-${num}-card\x60}`));
      assert.ok(text.includes(`id={\x60\x24{unavailableId}-${num}-card\x60}`));
    }
  }
  assert.equal((gallery.match(/className="relative flex w-full"/g) || []).length, 4);
});

test('reviewed controls retain teal rings, coarse targets, icon labels and the documented layer scale', () => {
  assert.match(image, /focus-visible:ring-brand-teal resize-none/);
  assert.doesNotMatch(image, /focus-visible:ring-white\/70/);
  assert.match(image, /pointer-events-none fixed z-\[70\]/);
  assert.match(studio, /disabledReason="Add a frame to play the slideshow"/);
  const copy = image.slice(image.indexOf('data-copy-menu-portal'), image.indexOf('{/* Unified Download menu'));
  assert.match(copy, /role="menu"\s+aria-label="Copy"/);
  assert.equal((copy.match(/\$\{FOCUS_RING\}/g) || []).length, 4);
  for (const file of ['SettingsPage', 'LegacySettingsPage']) {
    const summaries = source(`components/${file}.tsx`).match(/<summary[^>]*>/g);
    assert.equal(summaries.length, 2);
    assert.ok(summaries.every(summary => summary.includes('focus-visible:ring-brand-teal')));
  }
  const control = source('components/ControlPanel.tsx');
  const variation = control.slice(control.indexOf('ref={batchCountTriggerRef}'), control.indexOf("{activeDropdown === 'batch-count' && batchCountAnchor"));
  assert.doesNotMatch(variation, /focus-within:ring/);
  assert.match(variation, /focus:ring-1 focus:ring-brand-teal/);
  assert.match(control, /<Tip text="Close" side="bottom" align="right"/);
  for (const [file, label] of [['BrandAnalysisModal', 'Close'], ['CatalogPage', 'Back']]) {
    const text = source(`components/${file}.tsx`);
    assert.ok(text.includes(`aria-label="${label}"`));
    assert.ok(text.includes(`<Tip text="${label}"`));
  }
  for (const file of ['ControlPanel', 'GalleryPresetMenu']) {
    assert.match(source(`components/${file}.tsx`), /<MoreHorizontal size=\{14\} \/>\s*<Tip text=\{isActionMenuOpen/);
  }
  assert.doesNotMatch(source('components/GalleryPresetMenu.tsx'), /sm:min-w-0/);
  const app = source('App.tsx');
  assert.match(app, /group\/dismiss[^\n]*pointer:coarse[^\n]*focus-visible:opacity-100[^\n]*\$\{FOCUS_RING\}/);
  for (const text of ['toolbar-hidden hint and gallery preset panel', 'floating menus above banners', 'context menus and hover previews', 'menus inside modals', 'gallery thumbnail-size menu']) assert.ok(design.includes(text));
  assert.match(source('components/AdminPage.tsx'), /fixed inset-0 z-\[100\] flex items-center justify-center bg-black\/50/);
  assert.match(source('components/settings/settings.css'), /outline: 2px solid var\(--color-brand-teal\); outline-offset: 2px/);
  for (const text of [image, gallery]) {
    const downloads = text.match(/triggerClassName="[^"]+"/g);
    assert.ok(downloads.every(classes => classes.includes('aria-disabled:opacity-50 aria-disabled:cursor-not-allowed')));
  }
});

test('reviewed icon buttons preserve coarse sizes and teal label contrast without changing excluded controls', () => {
  const coarse = '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';
  for (const [file, labels] of [
    ['RecentGenerations', ['Cancel rename', 'Cancel', 'Actions for ${folder.name}']],
    ['ImageDisplay', ['Close details']],
    ['ControlPanel', ['Remove color']],
  ]) {
    const text = source(`components/${file}.tsx`);
    const tree = ts.createSourceFile(`${file}.tsx`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const buttons = [];
    const scan = node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button') buttons.push(node);
      ts.forEachChild(node, scan);
    };
    scan(tree);
    for (const label of labels) {
      const matching = buttons.filter(node => node.openingElement.attributes.properties.some(prop =>
        prop.name?.getText() === 'aria-label' && prop.getText().includes(label)));
      assert.ok(matching.length, `${file}: ${label}`);
      for (const node of matching) assert.ok(node.openingElement.getText().includes(coarse), `${file}: ${label} must stay 44px on coarse pointers`);
    }
  }
  for (const [file, expected] of [
    ['ControlPanel', /rounded-md bg-brand-teal text-\[#0d1117\] hover:bg-teal-600/],
    ['RecentGenerations', /rounded-lg bg-brand-teal text-\[#0d1117\] hover:opacity-90/],
  ]) assert.match(source(`components/${file}.tsx`), expected);
  assert.equal((source('components/GalleryPresetMenu.tsx').match(/\? 'bg-brand-teal text-\[#0d1117\]'/g) || []).length, 2);
  assert.match(studio, /w-6 h-6[^\n]*bg-brand-teal text-\[#0d1117\]/);
});

test('Add Marks keeps dark labels on enabled teal and readable labels in every disabled state', () => {
  const buttons = elements.filter(node => node.tagName.getText(ast) === 'button'
    && node.attributes.properties.some(prop => prop.name?.getText(ast) === 'aria-disabled'
      && prop.getText(ast).includes('rerunDraft')));
  assert.equal(buttons.length, 1);
  const expression = buttons[0].attributes.properties.find(prop => prop.name?.getText(ast) === 'className').initializer.expression;
  const compiled = ts.transpileModule(`return (${expression.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const classesFor = new Function('rerunDraft', 'refinementControlsLocked', 'onRerun', 'FOCUS_RING', compiled);
  for (const [draft, locked, onRerun] of [
    ['', false, () => {}], ['   ', false, () => {}], ['A prompt', true, () => {}], ['A prompt', false, undefined],
  ]) {
    const classes = classesFor(draft, locked, onRerun, FOCUS_RING).split(/\s+/);
    for (const token of ['bg-gray-300', 'text-slate-600', 'dark:bg-[#30363d]', 'dark:text-slate-300']) {
      assert.ok(classes.includes(token), `disabled Add Marks needs ${token}`);
    }
    assert.ok(!classes.includes('text-[#0d1117]'), 'dark disabled backgrounds must not inherit the enabled dark label');
  }
  const enabled = classesFor('A prompt', false, () => {}, FOCUS_RING).split(/\s+/);
  for (const token of ['bg-brand-teal', 'hover:bg-teal-600', 'text-[#0d1117]']) assert.ok(enabled.includes(token));
  assert.ok(!enabled.includes('dark:bg-[#30363d]'));
  assert.ok(contrast('475569', 'd1d5db') >= 4.5, 'disabled light label contrast');
  assert.ok(contrast('cbd5e1', '30363d') >= 4.5, 'disabled dark label contrast');
});

test('round 3 icon controls have accessible names and exactly one shared Tip', () => {
  const reviewed = [
    ['App.tsx', ['Close setup instructions']],
    ['components/AdminPage.tsx', ['Back']],
    ['components/BuildStudio.tsx', ["playing ? 'Pause' : 'Play'"]],
    ['components/ControlPanel.tsx', ['Pick a preset count', 'Remove prompt image style reference', 'Clear art direction']],
    ['components/ImageDisplay.tsx', ['Close prompt editor', 'Previous (newer in history)', 'Next (older in history)', 'Move refine panel. Use arrow keys to move and Home to reset.']],
    ['components/RecentGenerations.tsx', ['Cancel rename', "isCollapsed", 'Actions for ${folder.name}', 'Cancel']],
    ['components/SearchModal.tsx', ['Clear search']],
    ['components/WhatsNewPage.tsx', ['Back']],
    ['components/WhatsNewSpotlight.tsx', ['Close']],
    ['components/settings/SettingsFeedback.tsx', ['Dismiss notification']],
  ];
  let checked = 0;
  for (const [file, labels] of reviewed) {
    const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const buttons = [];
    const visit = node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button') buttons.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const label of labels) {
      const matches = buttons.filter(node => node.openingElement.attributes.properties.some(prop =>
        prop.name?.getText() === 'aria-label' && (ts.isStringLiteral(prop.initializer)
          ? prop.initializer.text === label : prop.initializer.getText().includes(label))));
      assert.ok(matches.length, `${file}: ${label}`);
      for (const button of matches) {
        assert.equal(button.children.filter(child => ts.isJsxSelfClosingElement(child) && child.tagName.getText() === 'Tip').length, 1, `${file}: ${label}`);
        assert.doesNotMatch(button.getText(), /group-hover\/(?:tip|move):opacity/);
        checked++;
      }
    }
  }
  assert.equal(checked, 19, '17 missing Tips and two hover-only replacements');
});

test('round 3 shared controls and stragglers retain coarse targets without changing fine-pointer dimensions', () => {
  const coarse = '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';
  const reviewed = [
    ['components/ImageDisplay.tsx', ['description', 'Close the comparison viewer', 'Close refine panel', 'Copy…', 'isGenerationDeleteArmed', 'Exit fullscreen (F or Esc)', 'Move refine panel. Use arrow keys to move and Home to reset.']],
    ['components/ControlPanel.tsx', ['item.scope', 'Edit', 'isArmed', 'Close color picker', 'Clear art direction']],
    ['App.tsx', ['View latest result', 'Dismiss generation status', 'Close setup instructions']],
    ['components/AdminPage.tsx', ['Back']],
    ['components/WhatsNewPage.tsx', ['Back']],
    ['components/WhatsNewSpotlight.tsx', ['Close']],
    ['components/SearchModal.tsx', ['Clear search']],
    ['components/WhatsNewBell.tsx', ['hasUnread']],
    ['components/BuildStudio.tsx', ['tip']],
  ];
  for (const [file, labels] of reviewed) {
    const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const buttons = [];
    const visit = node => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button') buttons.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const label of labels) {
      const matches = buttons.filter(node => node.openingElement.attributes.properties.some(prop => prop.name?.getText() === 'aria-label'
        && (ts.isStringLiteral(prop.initializer) ? prop.initializer.text === label
          : /^[a-z]/.test(label) && prop.initializer.getText().includes(label))));
      assert.ok(matches.length, `${file}: ${label}`);
      for (const button of matches) assert.ok(button.openingElement.getText().includes(coarse), `${file}: ${label}`);
    }
  }
  const settings = source('components/settings/SettingsPrimitives.tsx');
  assert.equal(settings.split(coarse).length - 1, 1, 'SettingsButton owns coarse dimensions once');
  const action = image.slice(image.indexOf('const ActionButton ='), image.indexOf('// Roman-numeral suffix'));
  assert.equal(action.split(coarse).length - 1, 1, 'ActionButton owns coarse dimensions once');
  const toast = source('components/settings/SettingsFeedback.tsx');
  assert.match(toast, /min-h-11 min-w-11/);
  assert.match(toast, /\[@media\(pointer:fine\)\]:min-h-8 \[@media\(pointer:fine\)\]:min-w-8/);
  assert.doesNotMatch(toast, /sm:min-[hw]-8/);
});

test('round 3 overlays use documented tiers and selected teal labels use dark text', () => {
  const control = source('components/ControlPanel.tsx');
  assert.match(control, /margin: 0, zIndex: 60, overflowY/);
  assert.match(control, /fixed z-\[500\] pointer-events-none w-72/);
  assert.match(source('components/PresetHoverPreview.tsx'), /zIndex: 70/);
  assert.match(source('components/settings/SettingsFeedback.tsx'), /fixed bottom-[^\n]+z-\[400\]/);
  assert.match(design, /selected `bg-brand-teal text-\[#0d1117\]`/);
  assert.match(design, /bg-brand-teal text-\[#0d1117\] text-\[11px\] font-bold shadow-lg/);
  assert.match(studio, /style=\{\{ fontSize: 12, lineHeight: '24px' \}\}/);
});

test('round 3 feedback uses a short mobile label, accessible busy text and 44px actions', () => {
  const text = source('components/FeedbackModal.tsx');
  const tree = ts.createSourceFile('FeedbackModal.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submit;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'button'
      && node.openingElement.attributes.properties.some(prop => prop.name?.getText() === 'type' && prop.initializer?.text === 'submit')) submit = node;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const compiled = ts.transpileModule(`return (${submit.getText()});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const busy of [false, true]) {
    const button = new Function('React', 'Send', 'busy', 'sendDisabled', 'sendReasonId', 'FOCUS_RING', compiled)(React, () => null, busy, false, 'reason', FOCUS_RING);
    const markup = renderToStaticMarkup(button);
    assert.equal(button.props['aria-label'], busy ? 'Sending feedback' : 'Send feedback');
    assert.ok(button.props.className.includes('min-h-11'));
    if (busy) assert.match(markup, /Sending…/);
    else {
      assert.match(markup, /class="sm:hidden">Send<\/span>/);
      assert.match(markup, /class="hidden sm:inline">Send feedback<\/span>/);
    }
  }
});

test('round 3 responsive controls fit narrow screens without shrinking text', () => {
  const control = source('components/ControlPanel.tsx');
  assert.equal((control.match(/className="relative min-w-0 lg:shrink">\s*<DropdownButton/g) || []).length, 5);
  assert.equal((control.match(/max-w-\[100px\] xl:max-w-\[160px\]/g) || []).length, 2);
  assert.match(source('components/LandingPage.tsx'), /group mt-7 inline-flex w-full sm:w-auto whitespace-normal min-h-14/);
  assert.match(source('App.tsx'), /className="text-sm font-semibold text-slate-900 dark:text-white">\s*Active Generations/);
  assert.match(source('components/AuthModal.tsx'), /id=\{errorId\} role="alert" className="[^\n]*break-words/);
  assert.match(source('components/AuthModal.tsx'), /setError\(err.message \|\| "Authentication failed\."\)/);
});
