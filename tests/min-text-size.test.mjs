import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const excluded = new Set(['node_modules', 'dist', 'functions', '.git']);
const patterns = [
  /text-\[([\d.]+)px\]/g,
  /fontSize\s*:\s*['"]?([\d.]+)(?:px)?/g,
  /fontSize\s*=\s*(?:\{\s*)?['"]?([\d.]+)(?:px)?/g,
  /fontSize\s*:\s*[^,;}\n]*\?\s*['"]?([\d.]+)(?:px)?/g,
  /fontSize\s*:\s*[^,;}\n]*\?[^,;}\n]*:\s*['"]?([\d.]+)(?:px)?/g,
  /font-size\s*[:=]\s*['"]?([\d.]+)px/g,
  /font-size\s*=\s*['"]([\d.]+)['"]/g,
  /\bfont\s*:\s*(?:[\w-]+\s+)*([\d.]+)px/g,
];

function violations(source) {
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)]
    .filter((match) => Number(match[1]) < 12)
    .map((match) => ({ text: match[0], line: source.slice(0, match.index).split('\n').length })));
}

function eyebrowViolations(source) {
  const ast = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures = [];
  function visit(node) {
    const text = ts.isStringLiteralLike(node) ? node.text
      : ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ')
      : '';
    if (/(?:^|\s)(?:\S+:)?uppercase(?=\s|$)/.test(text)) {
      const invalid = /(?:^|\s)(?:\S+:)?tracking-(?:wider|widest|\[)/.test(text);
      const missing = !/(?:^|\s)(?:\S+:)?tracking-/.test(text);
      if (invalid || missing) failures.push({
        text,
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        reason: invalid ? 'use tracking-wide' : 'missing tracking-wide',
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return failures;
}

function* appFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* appFiles(path);
    else if (['.tsx', '.ts', '.css', '.html'].includes(extname(path))) yield path;
  }
}

test('all app text declarations meet the 12px minimum', () => {
  const failures = [];
  for (const path of appFiles(root.pathname)) {
    for (const match of violations(readFileSync(path, 'utf8'))) {
      failures.push(`${relative(root.pathname, path)}:${match.line}: ${match.text}`);
    }
  }
  assert.deepEqual(failures, [], `Text below 12px:\n${failures.join('\n')}`);
});

test('minimum size guard recognizes responsive, decimal, inline, CSS and SVG sizes', () => {
  for (const source of [
    'sm:text-[10.5px]', 'xl:text-[11px]', 'text-[9px]',
    'fontSize: selectedIdx + 1 >= 10 ? 10 : 12',
    'fontSize: selectedIdx + 1 >= 10 ? 12 : 11',
    'fontSize: 10', "fontSize: '11px'", 'fontSize={11}',
    'font-size: 10.5px', 'font-size="11"', 'font-size="10px"',
    "font: 11px sans-serif",
  ]) assert.equal(violations(source).length, 1, source);
  assert.equal(violations('text-[12px] fontSize: 12; font-size: 14px').length, 0);
});

test('DESIGN.md states the eyebrow label rule exactly', () => {
  const design = readFileSync(new URL('DESIGN.md', root), 'utf8');
  assert.match(design, /^- Eyebrow labels are 12px \(text-\[12px\]\), uppercase, tracking-wide, never smaller\.$/m);
});

test('uppercase labels use tracking-wide in App, components and utils', () => {
  const paths = [new URL('App.tsx', root).pathname, ...appFiles(new URL('components', root).pathname), ...appFiles(new URL('utils', root).pathname)];
  const failures = paths.flatMap(path => eyebrowViolations(readFileSync(path, 'utf8'))
    .map(match => `${relative(root.pathname, path)}:${match.line}: ${match.reason}: ${match.text}`));
  assert.deepEqual(failures, [], `Eyebrow tracking violations:\n${failures.join('\n')}`);
});

test('eyebrow guard rejects invalid or missing tracking in literal and template classes', () => {
  for (const source of [
    '<p className="uppercase tracking-wider" />',
    "const labelClass = 'tracking-widest uppercase';",
    '<p className={`uppercase tracking-[0.2em] ${tone}`} />',
    '<p className="uppercase tracking-wide sm:tracking-wider" />',
    '<p className="uppercase tracking-wide md:tracking-[0.16em]" />',
    '<p className="text-[12px] uppercase font-bold" />',
    '<p className={active ? "uppercase" : "tracking-wide"} />',
    '<p className={`uppercase ${tone}`} />',
    '<p className="uppercase\nfont-bold" />',
  ]) assert.equal(eyebrowViolations(source).length, 1, source);
  for (const source of [
    '<p className="uppercase tracking-wide" />',
    '<p className={`uppercase ${tone} tracking-wide`} />',
    '<p className="text-3xl tracking-[-0.035em]" />',
    '<p className="tracking-wider" />',
    '// <p className="uppercase tracking-widest" />',
  ]) assert.deepEqual(eyebrowViolations(source), [], source);
});

test('landing hero caption wraps inside a shrinking flex item without reducing its type', () => {
  const source = readFileSync(new URL('components/LandingPage.tsx', root), 'utf8');
  const ast = ts.createSourceFile('LandingPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let caption;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'p'
      && node.children.some(child => ts.isJsxText(child) && child.text.trim() === 'Prompt. Generate. Refine. Build.')) caption = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(caption, 'full hero caption must be present');
  const classes = node => node.openingElement.attributes.properties.find(attr => attr.name?.getText(ast) === 'className').initializer.text.split(/\s+/);
  assert.ok(classes(caption).includes('whitespace-normal'));
  assert.ok(classes(caption).includes('text-sm'));
  assert.ok(classes(caption).includes('sm:text-base'));
  assert.ok(!classes(caption).some(value => /^(truncate|whitespace-nowrap|overflow-hidden|h-)/.test(value)));
  assert.ok(classes(caption.parent).includes('min-w-0'));
  assert.ok(classes(caption.parent).includes('flex-1'));
  assert.ok(classes(caption.parent.parent).includes('flex'));
  assert.ok(!classes(caption.parent.parent).some(value => /^h-/.test(value)));
});
