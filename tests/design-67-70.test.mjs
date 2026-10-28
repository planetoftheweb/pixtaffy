import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
  assert.match(studio, /flex-1 min-h-0 flex flex-col md:flex-row/);
  assert.match(studio, /max-md:flex-1 max-md:max-h-none max-md:min-h-\[40%\] max-md:!w-full/);
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
  assert.equal(studio.split(coarse).length - 1, 6, 'shared button, grip, AI, cleanup, zoom, selected frame');
  assert.doesNotMatch(studio, /max-sm:min-h-11|flex-wrap sm:flex-nowrap/);
  const dividers = studio.match(/className="w-px h-6[^"]*"/g) || [];
  assert.equal(dividers.length, 5);
  assert.ok(dividers.every(classes => classes.includes('max-sm:hidden')));
});

test('mobile stage height depends on viewport and image aspect rather than its own height', () => {
  assert.match(studio, /flex-1 max-md:flex-none min-w-0 flex flex-col/);
  assert.match(studio, /flex-1 max-md:flex-none min-h-0 flex items-center/);
  const expression = studio.match(/const availH = ([\s\S]*?);/)[1];
  const height = new Function('window', 'availW', 'imgDims', 'el', 'cs', `return ${expression}`);
  const cs = { paddingTop: '16', paddingBottom: '16' };
  for (const [width, viewportHeight] of [[320, 640], [390, 844]]) {
    const window = { innerWidth: width, innerHeight: viewportHeight };
    const expected = Math.min(viewportHeight * 0.5, (width - 32) * 9 / 16);
    for (const clientHeight of [0, 100, 900]) {
      assert.equal(height(window, width - 32, { w: 1600, h: 900 }, { clientHeight }, cs), expected);
    }
  }
  assert.equal(height({ innerWidth: 768 }, 400, { w: 1600, h: 900 }, { clientHeight: 600 }, cs), 568);
  assert.match(studio, /window.addEventListener\('resize', measure\)/);
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
  assert.match(image, /w-48 max-w-\[calc\(100vw-1rem\)\]/);
  assert.match(image, /Math.max\(8, Math.min\(window.innerWidth - rect.width - 8, rect.left\)\)/);
  assert.match(image, /menu.style.transform = `translateX\(\$\{left - rect.left\}px\)`/);
  assert.match(image, /fixed inset-0 z-10" onClick=\{\(\) => setCopyMenuOpen\(false\)\}/);
  assert.match(image, /dismissErrorToastOnEscape\(event, hasVisibleErrorToast\(\), dismissTopErrorToast\)/);
  assert.match(image, /window.addEventListener\('keydown', onKey, true\)/);
});

test('disabled-control wrappers can show one viewport-clamped shared Tip', () => {
  const tip = source('components/settings/Tip.tsx');
  assert.doesNotMatch(tip, /host.querySelector\(':disabled'\)/);
  assert.match(tip, /!host.matches\(':disabled'\)/);
  assert.match(tip, /w-72 max-w-\[calc\(100vw-16px\)\]/);
  const download = source('components/DownloadMenu.tsx');
  assert.equal((download.match(/<Tip\b/g) || []).length, 1);
  assert.doesNotMatch(download, /group-hover\/dl-tip|role="tooltip"/);
});

test('design rules and every armed confirm agree on readable amber styling', () => {
  for (const rule of [
    'Below md, the stage hugs its image; leftover height goes to the panel, never to empty space around the image.',
    'Favorite star icon = amber-400 (icon only, never a fill behind text).',
    'bg-amber-500 text-[#0d1117] animate-pulse',
  ]) assert.ok(design.includes(rule), rule);
  let armedControls = 0;
  for (const path of readdirSync(new URL('../components/', import.meta.url), { recursive: true }).filter(path => path.endsWith('.tsx'))) {
    source(`components/${path}`).split('\n').forEach((line, index) => {
      if (!/(?:^|[\s'"`])bg-amber-500(?=[\s'"`]|$)/.test(line)) return;
      armedControls++;
      assert.ok(line.includes('bg-amber-500 text-[#0d1117] animate-pulse') && !line.includes('text-white'), `components/${path}:${index + 1}`);
    });
  }
  assert.ok(armedControls > 0, 'armed controls must be checked');
  const luminance = hex => {
    const channels = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels.reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  };
  assert.ok((luminance('f59e0b') + 0.05) / (luminance('0d1117') + 0.05) >= 4.5);
});
