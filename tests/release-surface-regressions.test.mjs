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
const billingCoreSource = read('functions/src/billingCore.ts');
const paidAiSource = read('functions/src/paidAi.ts');
const guestCreditsSource = read('functions/src/guestCredits.ts');
const recentSource = read('components/RecentGenerations.tsx');
const constantsSource = read('constants.ts');
const correctionAnalysisRouterSource = read('services/correctionAnalysisRouter.ts');
const imageDisplaySource = read('components/ImageDisplay.tsx');
const cssSource = read('index.css');
const whatsNewData = read('data/whatsNew.ts');
const whatsNewScript = read('scripts/whats-new.mjs');
const guestGenerationSmokeSource = read('scripts/guest-generation-smoke.mjs');
const whatsNewScriptPath = fileURLToPath(new URL('../scripts/whats-new.mjs', import.meta.url));

const extractPaths = (source, pattern) => [...source.matchAll(pattern)].map((match) => match[1]);

test('production builds reject missing Firebase configuration before bundling', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'pixtaffy-build-config-'));
  const required = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID'];
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_FIREBASE_')));
  try {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      'build', '--config', fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    ], { cwd: fixtureRoot, env: cleanEnv, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    const output = result.stdout + result.stderr;
    assert.match(output, /Production build blocked: missing Firebase configuration/);
    for (const key of required) assert.ok(output.includes(`VITE_FIREBASE_${key}`));
    assert.equal(existsSync(join(fixtureRoot, 'dist')), false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

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
  assert.match(appSource, /guest image is stored in this browser/);
  assert.match(appSource, /this browser could not store it\. Download it now/);
  assert.match(appSource, /This browser could not store your guest image\./);
  assert.match(appSource, /Create account for future work/);
  assert.match(appSource, /create a free account to sync it across browsers/i);
  assert.match(landingSource, /Your work stays in this browser, ready to download/);
  assert.match(pricingSource, /Registration is free and moves the guest image into cloud history/);
  assert.match(landingSource, /isMember \? 'Back to the studio' : 'Create your first image'/);
});

test('cold visitors see public content before Firebase auth settles', () => {
  assert.match(appSource, /const STARTUP_GATE_TIMEOUT_MS = 9_000/);
  assert.match(appSource, /billingMode \? \([\s\S]*?\) : welcomeMode \? \([\s\S]*?\) : whatsNewMode \? \([\s\S]*?\) : !isAuthResolved \? \(/);
  assert.match(appSource, /Guest credits are temporarily unavailable/);
  assert.match(appSource, /> Try again/);
  assert.match(appSource, /releaseGate\('guest session'\)/);
  assert.match(appSource, /releaseGate\('authenticated session'\)[\s\S]*?void \(async \(\) =>/);
  assert.doesNotMatch(appSource, /setWelcomeMode\(false\);\s*\}\, \[isAuthResolved, user\?\.id\]\)/);
});

test('App Check and Firebase Installations stay off the first-paint path', () => {
  assert.match(firebaseSource, /scheduleFirebaseBackgroundWork\(\(\) => \{[\s\S]*?initializeAppCheck/);
  assert.match(firebaseSource, /requestIdleCallback/);
  assert.match(firebaseSource, /Firebase Installations record/);
  assert.match(firebaseSource, /Firebase App Check token/);
  assert.match(firebaseSource, /VITE_FIREBASE_APPCHECK_DEBUG_TOKEN/);
  assert.match(firebaseSource, /isLocalDevelopmentPreview && !useEmulators && localAppCheckDebugToken/);
  assert.match(firebaseSource, /FIREBASE_APPCHECK_DEBUG_TOKEN/);
  assert.match(firebaseSource, /protected endpoints remain server-enforced/);
  assert.match(authServiceSource, /Firebase Auth observer: settled/);
  assert.match(authServiceSource, /onError\?\.\(error\)/);
});

test('guest generation times out blocked prerequisites and replaces fake countdowns with an overdue state', () => {
  assert.match(authServiceSource, /const ANONYMOUS_SESSION_TIMEOUT_MS = 10_000/);
  assert.match(authServiceSource, /guest\/session-timeout/);
  assert.match(authServiceSource, /temporary session needed for guest credits/);
  assert.match(billingServiceSource, /const GUEST_GENERATION_TIMEOUT_MS = 120_000/);
  assert.match(billingServiceSource, /functions\/deadline-exceeded/);
  assert.match(billingServiceSource, /Firebase rejected this local preview's secure development pass/);
  assert.doesNotMatch(billingServiceSource, /privacy blocker or VPN/);
  assert.match(appSource, /Guest credits are temporarily unavailable/);
  assert.match(appSource, /Taking longer than expected/);
  assert.doesNotMatch(appSource, /Math\.max\(Math\.round\(projected - elapsedSec\), 3\)/);
  assert.match(guestGenerationSmokeSource, /Network\.setBlockedURLs/);
  assert.match(guestGenerationSmokeSource, /PIXTAFFY_EXPECT_BLOCKED_GUEST_SESSION/);
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
  assert.match(authModalSource, /Create your account, then verify your email to receive 10 starter credits/);
  assert.match(appSource, /hasPendingImage=\{!user && \(Boolean\(currentGeneration\) \|\| history\.length > 0\)\}/);
});

test('login throttling is explained and offers a password reset recovery path', () => {
  assert.match(authServiceSource, /code === 'auth\/too-many-requests'/);
  assert.match(authServiceSource, /Sign-in is temporarily blocked on this browser after too many attempts/);
  assert.doesNotMatch(authServiceSource, /throw new Error\(error\.message \|\| "Failed to login\."\)/);
  assert.match(authServiceSource, /requestPasswordReset:[\s\S]*?sendPasswordResetEmail/);
  assert.match(authModalSource, /isSubmittingRef\.current/);
  assert.match(authModalSource, /Forgot password\?/);
  assert.match(authModalSource, /Check your email for a password reset link\./);
  assert.match(authModalSource, /role="alert"/);
  assert.match(authModalSource, /role="status"/);
});

test('welcome exposes pricing without requiring an authenticated billing query', () => {
  assert.match(landingSource, /onViewPricing/);
  assert.match(landingSource, />\s*Pricing\s*<\/button>/);
  assert.match(pricingSource, /user: User \| null/);
  assert.match(pricingSource, /if \(!user\) \{[\s\S]*?setLoading\(false\)/);
});

test('the logged-out pricing balance opens the login flow instead of looking inert', () => {
  assert.match(pricingSource, /onLogin: \(\) => void/);
  assert.match(pricingSource, /!user \? \([\s\S]*?<button[\s\S]*?onClick=\{onLogin\}[\s\S]*?aria-label="Sign in to view your PixTaffy credit balance"/);
  assert.match(appSource, /<PricingPage[\s\S]*?onLogin=\{\(\) => openAuthModal\('login'\)\}/);
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
  assert.match(pricingSource, /Guest images[\s\S]*Free account[\s\S]*Any credit pack[\s\S]*Taffy Studio/);
});

test('unregistered visitors get three credits with GPT Image 2.5 selected by default', () => {
  assert.match(appSource, /const DEFAULT_MODEL_ID = 'openai-2\.5'/);
  assert.match(appSource, /const GUEST_GRANT_MILLICREDITS = 3_000/);
  assert.match(appSource, /GUEST_MODEL_DEFAULT_MIGRATION_KEY/);
  assert.match(appSource, /setGuestBalanceMilliCredits\(result\.balanceMilliCredits\)/);
  assert.match(controlPanelSource, /Guest balance: \{guestBalanceMilliCredits \/ 1_000\} credit/);
  assert.match(appSource, /allowedModelIds=\{!user \? Object\.keys\(SITE_FUNDED_MODEL_MILLICREDITS\) : undefined\}/);
  assert.match(guestCreditsSource, /DEFAULT_GUEST_MODEL_ID = "openai-2\.5"/);
  assert.match(guestCreditsSource, /GUEST_GRANT_MILLICREDITS = 3_000/);
  assert.match(paidAiSource, /canReserveGuestCredits\(spent, input\.milliCredits\)/);
  assert.match(billingServiceSource, /localStorage\.removeItem\(GUEST_REQUEST_ID_KEY\)/);
  assert.match(billingServiceSource, /pixtaffy_guest_request_id_v2/);
});

test('verified accounts receive ten starter credits', () => {
  assert.match(billingCoreSource, /STARTER_GRANT_MILLICREDITS = 10_000/);
  assert.match(authServiceSource, /selectedModel: 'openai-2\.5'/);
  assert.match(landingSource, /10 starter credits/);
});

test('client and server model credit catalogs stay in sync', () => {
  const clientPairs = [...billingServiceSource.matchAll(/['"]?([^'"\n:]+(?::[^'"\n]+)?)['"]?:\s*([123]_000)/g)]
    .map(([, model, cost]) => `${model.trim()}=${cost}`)
    .filter((pair) => pair.startsWith('openrouter:') || pair.startsWith('gemini=') || pair.startsWith('gemini-') || pair.startsWith('openai-2=') || pair.startsWith('openai-2.5=') || pair.startsWith('openai-flare='));
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
    '0.31.0',
    '0.30.0',
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


test('GPT Image 2.5 provider resolution and model snap-back guards stay wired', () => {
  // Client BYOK must treat openai-2.5 / openai-flare as OpenAI-family models.
  // Missing them made getApiKeyForModel return undefined, and App's no-key
  // fallback then snapped the toolbar to the first model with a key (gemini).
  assert.match(
    correctionAnalysisRouterSource,
    /modelId === 'openai-2\.5'[\s\S]*?modelId === 'openai-flare'[\s\S]*?return 'openai'/
  );
  assert.match(
    correctionAnalysisRouterSource,
    /selectedModel === 'openai-2\.5'[\s\S]*?selectedModel === 'openai-flare'/
  );

  // Credit-funded selections must not be auto-switched away when another
  // provider key exists.
  assert.match(
    appSource,
    /SITE_FUNDED_MODEL_MILLICREDITS\[selectedModel\] && hasUsableCredits\)\s*return/
  );

  // Refine sync must prefer keeping selectedModel over SUPPORTED_MODELS[0]
  // when version/tile model ids are unrecognized.
  assert.match(
    imageDisplaySource,
    /Keep a valid toolbar selection when version\/tile model ids are unknown/
  );
  assert.match(
    imageDisplaySource,
    /return selectedModel \|\| refineModelOptions\[0\]\?\.id \|\| ''/
  );
  assert.doesNotMatch(
    imageDisplaySource,
    /return refineModelOptions\[0\]\?\.id \|\| selectedModel;/
  );
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
