#!/usr/bin/env node
// CI test count guard. Reads captured test output, sums the node:test totals
// (TAP "# tests N" and spec "ℹ tests N" lines, one block per test run), writes a
// JSON summary and a GitHub step summary, and fails when no tests ran or any failed.
// Usage: node scripts/ci-test-counts.mjs <log file> <output json>
import fs from 'node:fs';

const [logFile, outFile = 'test-counts.json'] = process.argv.slice(2);
if (!logFile) {
  console.error('usage: node scripts/ci-test-counts.mjs <log file> <output json>');
  process.exit(1);
}

const raw = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
const text = raw.replace(/\x1b\[[0-9;]*m/g, '');
const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, runs: 0 };
for (const key of ['tests', 'pass', 'fail', 'skipped']) {
  const re = new RegExp(`^\\s*(?:#|ℹ)\\s+${key}\\s+(\\d+)\\s*$`, 'gm');
  for (const m of text.matchAll(re)) {
    totals[key] += Number(m[1]);
    if (key === 'tests') totals.runs += 1;
  }
}

const problems = [];
if (!raw) problems.push(`log file ${logFile} is missing or empty`);
if (totals.tests < 1) problems.push('no tests ran (test count is 0)');
if (totals.fail > 0) problems.push(`${totals.fail} test(s) failed`);
const result = { ...totals, ok: problems.length === 0, problems };
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

const summary = [
  `### Test counts (${outFile.replace(/\.json$/, '')})`,
  '',
  '| Test runs | Tests | Pass | Fail | Skipped |',
  '|---|---|---|---|---|',
  `| ${totals.runs} | ${totals.tests} | ${totals.pass} | ${totals.fail} | ${totals.skipped} |`,
  '',
  problems.length ? `**Guard failed:** ${problems.join('; ')}` : '**Guard passed.**',
  '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
process.exit(problems.length ? 1 : 0);
