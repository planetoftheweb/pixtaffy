import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const appSource = read('App.tsx');
const controlPanelSource = read('components/ControlPanel.tsx');
const featureGridSource = read('components/FeatureDemoGrid.tsx');
const landingSource = read('components/LandingPage.tsx');
const pricingSource = read('components/PricingPage.tsx');
const billingServiceSource = read('services/billingService.ts');
const serverPricingSource = read('functions/src/pricing.ts');
const recentSource = read('components/RecentGenerations.tsx');
const constantsSource = read('constants.ts');
const cssSource = read('index.css');
const whatsNewData = read('data/whatsNew.ts');
const whatsNewScript = read('scripts/whats-new.mjs');
const whatsNewScriptPath = fileURLToPath(new URL('../scripts/whats-new.mjs', import.meta.url));

const extractPaths = (source, pattern) => [...source.matchAll(pattern)].map((match) => match[1]);

const runWhatsNewFixture = ({ version, data, files = {} }) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'pixtaffy-whats-new-'));
  const fixtureScript = join(fixtureRoot, 'scripts', 'whats-new.mjs');
  mkdirSync(dirname(fixtureScript), { recursive: true });
  mkdirSync(join(fixtureRoot, 'data'), { recursive: true });
  writeFileSync(fixtureScript, whatsNewScript);
  writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(fixtureRoot, 'data', 'whatsNew.ts'), data);
  for (const [path, bytes] of Object.entries(files)) {
    const target = join(fixtureRoot, 'public', path.replace(/^\//, ''));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  const result = spawnSync(process.execPath, [fixtureScript, 'check'], { encoding: 'utf8' });
  rmSync(fixtureRoot, { recursive: true, force: true });
  return result;
};

test('guest messaging distinguishes browser-local work from free cloud sync', () => {
  assert.match(appSource, /first image is stored in this browser/);
  assert.match(appSource, /this browser could not store it\. Download it now/);
  assert.match(appSource, /This browser could not store your first image\./);
  assert.match(appSource, /Create account for future work/);
  assert.match(appSource, /create a free account to sync it across browsers/i);
  assert.match(landingSource, /It stays in this browser, ready to download/);
  assert.match(pricingSource, /Registration is free and moves the guest image into cloud history/);
  assert.match(landingSource, /isMember \? 'Back to the studio' : 'Create free image'/);
});

test('the compact wordmark keeps Pix light and Taffy heavy with the candy gradient', () => {
  assert.match(appSource, /<span>Pix<\/span>/);
  assert.match(appSource, /from-brand-orange via-brand-red to-brand-purple[^\n]+font-black/);
  assert.match(appSource, /text-lg font-normal tracking-/);
});

test('studio and toolbar surfaces reuse the restrained PixTaffy background language', () => {
  assert.match(appSource, /pixtaffy-studio-surface/);
  assert.match(controlPanelSource, /pixtaffy-toolbar-surface/);
  assert.match(cssSource, /\.pixtaffy-studio-surface[\s\S]*radial-gradient[\s\S]*42px 42px/);
  assert.match(cssSource, /\.dark \.pixtaffy-studio-surface/);
});

test('feature demos use six distinct optimized images on both public surfaces', () => {
  const images = extractPaths(featureGridSource, /image:\s*'([^']+)'/g);
  assert.equal(images.length, 6);
  assert.equal(new Set(images).size, 6);
  for (const image of images) {
    assert.equal(existsSync(new URL(`../public${image}`, import.meta.url)), true, `${image} should exist`);
  }
  assert.match(landingSource, /<FeatureDemoGrid className="mt-12"/);
  assert.match(pricingSource, /<FeatureDemoGrid className="mt-6"/);
});

test('pricing cards derive estimates from credit bands and use unique artwork', () => {
  assert.match(pricingSource, /Object\.values\(SITE_FUNDED_MODEL_MILLICREDITS\)/);
  assert.match(pricingSource, /standard:\s*Math\.floor\(credits \/ standardCreditCost\)/);
  assert.match(pricingSource, /pro:\s*Math\.floor\(credits \/ proCreditCost\)/);
  assert.match(pricingSource, /premium:\s*Math\.floor\(credits \/ premiumCreditCost\)/);
  const images = extractPaths(pricingSource, /image:\s*'([^']+pricing-taffy-[^']+)'/g);
  assert.equal(images.length, 3);
  assert.equal(new Set(images).size, 3);
  assert.match(pricingSource, /Guest first image[\s\S]*Free account[\s\S]*Any credit pack[\s\S]*Taffy Studio/);
});

test('client and server model credit catalogs stay in sync', () => {
  const clientPairs = [...billingServiceSource.matchAll(/['"]?([^'"\n:]+(?::[^'"\n]+)?)['"]?:\s*([123]_000)/g)]
    .map(([, model, cost]) => `${model.trim()}=${cost}`)
    .filter((pair) => pair.startsWith('openrouter:') || pair.startsWith('gemini=') || pair.startsWith('gemini-') || pair.startsWith('openai-2='));
  const serverPairs = [...serverPricingSource.matchAll(/['"]([^'"]+)['"]:\s*\{[\s\S]*?milliCredits:\s*([123]_000)/g)]
    .map(([, model, cost]) => `${model}=${cost}`);
  assert.deepEqual(new Set(clientPairs), new Set(serverPairs));
});

test('default resources include the PixTaffy palette, character style, and scene type', () => {
  assert.match(constantsSource, /id:\s*'pixtaffy-candy'/);
  assert.match(constantsSource, /#009EAA[\s\S]*#08D5E8[\s\S]*#FF7A18[\s\S]*#F22991[\s\S]*#9B35E3/);
  assert.match(constantsSource, /id:\s*'pixtaffy-candy-3d'/);
  assert.match(constantsSource, /id:\s*'pixtaffy-character-scene'/);
});

test('model costs stay compact in the menu and detailed in the rollover', () => {
  assert.doesNotMatch(controlPanelSource, /cr or BYOK/);
  assert.match(controlPanelSource, /aria-label=\{`\$\{SITE_FUNDED_MODEL_MILLICREDITS\[model\.id\] \/ 1_000\} PixTaffy credits`\}/);
  assert.match(controlPanelSource, /PixTaffy billing\. Free with your own key\./);
  assert.match(controlPanelSource, /modelTip\.creditCost === 1 \? 'credit' : 'credits'/);
  assert.match(controlPanelSource, /Number = PixTaffy credit cost; your own key is free\. No number = own key required\./);
  assert.match(controlPanelSource, /min-h-11 w-full items-center/);
  assert.match(controlPanelSource, /onFocus=\{\(e\) => \{/);
  assert.match(controlPanelSource, /\{SITE_FUNDED_MODEL_MILLICREDITS\[model\.id\] && \(/);
});

test('non-clickable feature cards do not imitate links with hover movement', () => {
  assert.doesNotMatch(featureGridSource, /hover:-translate-y/);
  assert.doesNotMatch(featureGridSource, /group-hover:scale/);
});

test('creative actions and gallery tools keep neutral controls with candy accents', () => {
  assert.match(controlPanelSource, /from-brand-orange via-brand-red to-brand-purple hover:saturate-125/);
  assert.match(controlPanelSource, /accentClass="text-brand-pink"/);
  assert.match(controlPanelSource, /accentClass="text-brand-purple"/);
  assert.match(recentSource, /Eye size=\{16\} aria-hidden className="text-brand-teal dark:text-brand-cyan"/);
  assert.match(recentSource, /Archive size=\{16\} aria-hidden className="text-brand-pink"/);
});

test('What’s New release entries use existing files with distinct image bytes', () => {
  const images = extractPaths(whatsNewData, /image:\s*'([^']+)'/g).filter((image) =>
    /whatsnew-v0\.2[5-9]\./.test(image),
  );
  assert.equal(images.length, 7);
  const hashes = images.map((image) => {
    const bytes = readFileSync(new URL(`../public${image}`, import.meta.url));
    return createHash('sha256').update(bytes).digest('hex');
  });
  assert.equal(new Set(images).size, images.length, 'release image paths must be unique');
  assert.equal(new Set(hashes).size, hashes.length, 'release image bytes must be unique');
});

test('What’s New validation requires an exact patch-version entry', () => {
  const result = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.0', image: '/missing.webp' }];\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No exact entry found for v2\.4\.1/);
});

test('What’s New validation accepts fields between version and unique artwork', () => {
  const result = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.1', featured: true, image: '/current.webp' }];\n",
    files: { '/current.webp': 'current artwork' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /unique artwork exist for v2\.4\.1/);
});

test('What’s New validation rejects an exact-version entry without artwork', () => {
  const result = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.1', featured: true }];\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /v2\.4\.1 has no image field/);
});

test('What’s New validation rejects reused paths and identical image bytes', () => {
  const reusedPath = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.1', image: '/same.webp' }, { version: '2.3.0', image: '/same.webp' }];\n",
    files: { '/same.webp': 'current artwork' },
  });
  assert.equal(reusedPath.status, 1);
  assert.match(reusedPath.stderr, /v2\.4\.1 reuses release artwork from v2\.3\.0/);

  const reusedBytes = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.1', image: '/current.webp' }, { version: '2.3.0', image: '/older.webp' }];\n",
    files: { '/current.webp': 'same artwork bytes', '/older.webp': 'same artwork bytes' },
  });
  assert.equal(reusedBytes.status, 1);
  assert.match(reusedBytes.stderr, /v2\.4\.1 reuses release artwork from v2\.3\.0/);
});

test('What’s New validation bypass exits successfully with a clear diagnostic', () => {
  const result = spawnSync(process.execPath, [whatsNewScriptPath, 'check'], {
    encoding: 'utf8',
    env: { ...process.env, SKIP_WHATS_NEW_CHECK: '1' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /check skipped via SKIP_WHATS_NEW_CHECK=1/);
});

test('What’s New validation fails when the package version has no exact release entry', () => {
  const result = runWhatsNewFixture({
    version: '9.9.0',
    data: "export const WHATS_NEW = [{ version: '1.0.0', image: '/older.webp' }];\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No exact entry found for v9\.9\.0/);
});
