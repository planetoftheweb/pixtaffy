import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import test from 'node:test';

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
