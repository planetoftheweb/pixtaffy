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
const authModalSource = read('components/AuthModal.tsx');
const authServiceSource = read('services/authService.ts');
const firebaseSource = read('services/firebase.ts');
const indexSource = read('index.tsx');
const errorBoundarySource = read('components/ErrorBoundary.tsx');
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

test('cold visitors see public content before Firebase auth settles', () => {
  assert.match(appSource, /const STARTUP_GATE_TIMEOUT_MS = 9_000/);
  assert.match(appSource, /billingMode \? \([\s\S]*?\) : welcomeMode \? \([\s\S]*?\) : whatsNewMode \? \([\s\S]*?\) : !isAuthResolved \? \(/);
  assert.match(appSource, /Session connection issue/);
  assert.match(appSource, /Retry connection/);
  assert.match(appSource, /releaseGate\('guest session'\)/);
  assert.match(appSource, /releaseGate\('authenticated session'\)[\s\S]*?void \(async \(\) =>/);
  assert.doesNotMatch(appSource, /setWelcomeMode\(false\);\s*\}\, \[isAuthResolved, user\?\.id\]\)/);
});

test('App Check and Firebase Installations stay off the first-paint path', () => {
  assert.match(firebaseSource, /scheduleFirebaseBackgroundWork\(\(\) => \{[\s\S]*?initializeAppCheck/);
  assert.match(firebaseSource, /requestIdleCallback/);
  assert.match(firebaseSource, /Firebase Installations record/);
  assert.match(firebaseSource, /Firebase App Check token/);
  assert.match(firebaseSource, /protected endpoints remain server-enforced/);
  assert.match(authServiceSource, /Firebase Auth observer: settled/);
  assert.match(authServiceSource, /onError\?\.\(error\)/);
});

test('top-level render failures surface through the visible error boundary', () => {
  assert.match(indexSource, /<ErrorBoundary>[\s\S]*?<App \/>[\s\S]*?<\/ErrorBoundary>/);
  assert.match(errorBoundarySource, /componentDidCatch/);
  assert.match(errorBoundarySource, /role="alert"/);
  assert.match(errorBoundarySource, /Reload PixTaffy/);
});

test('signup copy only promises to save an image when one is pending', () => {
  assert.match(authModalSource, /hasPendingImage/);
  assert.match(authModalSource, /hasPendingImage[\s\S]*?Save your image, then verify your email/);
  assert.match(authModalSource, /Create your account, then verify your email to receive 5 starter credits/);
  assert.match(appSource, /hasPendingImage=\{!user && \(Boolean\(currentGeneration\) \|\| history\.length > 0\)\}/);
});

test('welcome exposes pricing without requiring an authenticated billing query', () => {
  assert.match(landingSource, /onViewPricing/);
  assert.match(landingSource, />\s*Pricing\s*<\/button>/);
  assert.match(pricingSource, /user: User \| null/);
  assert.match(pricingSource, /if \(!user\) \{[\s\S]*?setLoading\(false\)/);
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

test('What’s New keeps only substantial public launches with modern distinct artwork', () => {
  const versions = extractPaths(whatsNewData, /version:\s*'([^']+)'/g);
  assert.deepEqual(versions, [
    '0.29.0',
    '0.26.1',
    '0.26.0',
    '0.25.0',
    '0.24.0',
    '0.22.0',
    '0.21.0',
    '0.15.0',
    '0.8.0',
    '0.6.0',
    '0.5.0',
    '0.1.0',
  ]);
  assert.doesNotMatch(whatsNewData, /version:\s*'0\.29\.3'/);

  const images = extractPaths(whatsNewData, /image:\s*'([^']+)'/g);
  assert.equal(images.length, versions.length);
  assert.ok(images.every((image) => image.endsWith('.webp')), 'launch artwork should use optimized WebP files');
  const hashes = images.map((image) => {
    const bytes = readFileSync(new URL(`../public${image}`, import.meta.url));
    return createHash('sha256').update(bytes).digest('hex');
  });
  assert.equal(new Set(images).size, images.length, 'launch image paths must be unique');
  assert.equal(new Set(hashes).size, hashes.length, 'launch image bytes must be unique');
  assert.match(appSource, /params\.has\('whatsnewpage'\) \|\| params\.has\('whatsnew'\)/);
  assert.match(appSource, /new URLSearchParams\(window\.location\.search\)\.get\('whatsnew'\)/);
});

test('What’s New validation allows changelog-only patch releases', () => {
  const result = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.0', image: '/launch.webp' }];\n",
    files: { '/launch.webp': 'launch artwork' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v2\.4\.1 stays changelog-only/);
});

test('What’s New validation recognizes a curated launch for the current version', () => {
  const result = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.1', featured: true, image: '/current.webp' }];\n",
    files: { '/current.webp': 'current artwork' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v2\.4\.1 has a public launch card/);
});

test('What’s New validation rejects any curated launch without artwork', () => {
  const result = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.1', featured: true }];\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /1 launch card\(s\) have no image field/);
});

test('What’s New validation rejects reused paths and identical image bytes', () => {
  const reusedPath = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.1', image: '/same.webp' }, { version: '2.3.0', image: '/same.webp' }];\n",
    files: { '/same.webp': 'current artwork' },
  });
  assert.equal(reusedPath.status, 1);
  assert.match(reusedPath.stderr, /v2\.4\.1 reuses launch artwork from v2\.3\.0/);

  const reusedBytes = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.1', image: '/current.webp' }, { version: '2.3.0', image: '/older.webp' }];\n",
    files: { '/current.webp': 'same artwork bytes', '/older.webp': 'same artwork bytes' },
  });
  assert.equal(reusedBytes.status, 1);
  assert.match(reusedBytes.stderr, /v2\.4\.1 reuses launch artwork from v2\.3\.0/);
});

test('What’s New validation rejects duplicate launch versions', () => {
  const result = runWhatsNewFixture({
    version: '2.4.1',
    data: "export const WHATS_NEW = [{ version: '2.4.0', image: '/one.webp' }, { version: '2.4.0', image: '/two.webp' }];\n",
    files: { '/one.webp': 'first artwork', '/two.webp': 'second artwork' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /v2\.4\.0 appears 2 times/);
});

test('What’s New validation bypass exits successfully with a clear diagnostic', () => {
  const result = spawnSync(process.execPath, [whatsNewScriptPath, 'check'], {
    encoding: 'utf8',
    env: { ...process.env, SKIP_WHATS_NEW_CHECK: '1' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /check skipped via SKIP_WHATS_NEW_CHECK=1/);
});
