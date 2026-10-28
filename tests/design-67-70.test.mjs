import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { compile } from 'tailwindcss';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextMenuItemIndex } from '../utils/menuKeyboard.ts';
import { getAuthFormBlocker, getFeedbackFormBlocker } from '../utils/formValidation.ts';
import { shouldAutoCollapseGenerationPanel } from '../utils/generationPanel.ts';

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
  assert.match(studio, /<Tip text=\{label\} side="bottom" \/>/);
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
  return new Function('React', ...Object.keys(bindings), compiled)(React, ...Object.values(bindings));
}

test('self-account menu keeps disabled actions and one explanatory Tip on each hoverable wrapper', () => {
  const Tip = () => null;
  const icon = () => null;
  const renderMenu = evaluateComponent('components/AdminPage.tsx', 'renderRowMenu', {
    Tip, Key: icon, Sparkles: icon, Unlock: icon, Lock: icon, UserMinus: icon, UserPlus: icon, Trash2: icon,
    rowMenuRef: { current: null }, actionInFlight: null, currentUser: { id: 'self' },
    setOpenRowMenu: () => {}, setConfirm: () => {},
  });
  for (const id of ['self', 'other']) {
    const menu = renderMenu({ id, email: `${id}@example.test` });
    const wrappers = React.Children.toArray(menu.props.children).filter(child =>
      child.type === 'div' && child.props.className.includes('group/tip'));
    assert.equal(wrappers.length, 2);
    for (const [index, wrapper] of wrappers.entries()) {
      assert.match(wrapper.props.className, /\brelative\b/);
      const [button, tip] = React.Children.toArray(wrapper.props.children);
      assert.equal(button.type, 'button');
      assert.equal(button.props.disabled, id === 'self');
      assert.match(button.props.className, /disabled:pointer-events-none/);
      assert.equal(React.Children.toArray(button.props.children).some(child => child.type === Tip), false,
        'Tip must not be hosted by a disabled button');
      if (id === 'self') {
        assert.equal(tip.type, Tip);
        assert.equal(tip.props.text, index === 0
          ? 'You cannot disable your own account.' : 'You cannot delete your own account here.');
      } else assert.equal(tip, undefined);
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
  assert.equal(studio.split(coarse).length - 1, 10, 'shared button, grip, AI, cleanup, zoom, selected frame, four header buttons');
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
        const classes = node.attributes.properties.find(attr => attr.name?.getText(tree) === 'className')?.initializer?.text;
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
  assert.match(control.slice(control.indexOf('onClick={handleSaveItem}'), control.indexOf('onClick={handleSaveItem}') + 450), primary);
  assert.match(studio.slice(studio.indexOf('aria-label="Export MP4"'), studio.indexOf('aria-label="Export MP4"') + 450), primary);
  const refine = image.slice(image.indexOf('group/tip relative h-11 w-11'), image.indexOf('group/tip relative h-11 w-11') + 700);
  assert.match(refine, primary);
  assert.doesNotMatch(refine, /text-white|bg-brand-red|shadow-brand-red/);
  const submit = image.slice(image.indexOf("disabled={(!refinementInput.trim()"), image.indexOf("disabled={(!refinementInput.trim()") + 600);
  assert.match(submit, primary);
  assert.doesNotMatch(submit, /text-white|bg-brand-red/);
  const folderDelete = gallery.match(/className="([^"]+)"\s*>\s*Delete folder/)[1];
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
  assert.match(menu, /w-full min-w-\[12rem\]/);
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
  assert.match(image, /role="menu"\s+onKeyDown=\{handleCopyMenuKeyDown\}/);
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
  const normalize = node => node?.getText().replace(/\s/g, '').replace(/^Boolean\((.*)\)$/, '$1');
  const references = nodes.flatMap(node => {
    const described = attr(node, 'aria-describedby')?.expression;
    if (!described) return [];
    return [{ node, described, id: ts.isConditionalExpression(described) ? described.whenTrue : described }];
  });
  const violations = [];
  let checked = 0;
  for (const node of nodes) {
    if ((ts.isJsxElement(node) ? node.openingElement : node).tagName.getText() !== 'span'
      || attr(node, 'className')?.text !== 'sr-only') continue;
    const id = attr(node, 'id')?.expression;
    const controls = references.filter(ref => normalize(ref.id) === normalize(id));
    if (!id || !controls.length) continue;
    checked++;
    for (const { node: control, described } of controls) {
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
        violations.push(`${filename}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
    }
  }
  return { violations, checked };
}

test('all described sr-only reason spans are conditional on the matching disabled condition', t => {
  const control = '<button aria-disabled={blocked} aria-describedby={blocked ? reasonId : undefined} />';
  const span = '<span id={reasonId} className="sr-only">Reason</span>';
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
  assert.equal(scans.reduce((count, scan) => count + scan.checked, 0), 19, 'cover every round 1/2 reason including Model, Generate and both Expand controls');
  t.diagnostic(`AST scan: ${files.length} files, 19 conditional disabled-reason spans`);
});

test('incomplete auth and feedback form guards report specific errors before any backend work', async () => {
  const filled = { isLogin: true, name: 'Name', username: 'name', email: 'fixture', password: 'fixture' };
  const cases = [
    [{ ...filled, email: '' }, 'Enter your email or username first.'],
    [{ ...filled, email: '   ' }, 'Enter your email or username first.'],
    [{ ...filled, password: '' }, 'Password is required'],
    [{ ...filled, isLogin: false, name: ' ' }, 'Name is required'],
    [{ ...filled, isLogin: false, username: ' ' }, 'Username is required'],
    [{ ...filled, isLogin: false, email: '' }, 'Email address is required.'],
    [{ ...filled, isLogin: false }, 'Enter a valid email address.'],
    [{ ...filled, isLogin: false, email: 'a@b', password: '' }, 'Password is required'],
  ];
  assert.equal(getAuthFormBlocker(filled), null);
  assert.equal(getAuthFormBlocker({ ...filled, isLogin: false, email: 'a@b' }), null);
  for (const [state, expected] of cases) {
    assert.equal(getAuthFormBlocker(state), expected);
    let error;
    let status = 'old status';
    let prevented = false;
    const handle = evaluateComponent('components/AuthModal.tsx', 'handleSubmit', {
      ...state, busy: false, isSubmittingRef: { current: false }, getAuthFormBlocker,
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
      message, busy: false, getFeedbackFormBlocker, setError: value => { error = value; },
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
      ...bindings, setError: () => assert.fail('busy submissions return silently'),
      getAuthFormBlocker: () => assert.fail('busy guard runs first'), getFeedbackFormBlocker: () => assert.fail('busy guard runs first'),
    })({ preventDefault() {} });
  }
  const auth = source('components/AuthModal.tsx');
  const feedback = source('components/FeedbackModal.tsx');
  assert.match(auth, /<form noValidate onSubmit=\{handleSubmit\}/);
  assert.match(feedback, /<form onSubmit=\{\(event\) => void sendFeedback\(event\)\}/);
  for (const text of [auth, feedback]) {
    assert.match(text, /role="alert"/);
    assert.match(text, /<button\s+type="submit"\s+aria-disabled=/);
    assert.doesNotMatch(text, /if \((?:submitDisabled|sendDisabled)(?: \|\|[^)]*)?\) return/);
  }
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
