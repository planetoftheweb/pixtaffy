import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public', 'marketing');
const base = process.env.PIXTAFFY_CAPTURE_URL || 'http://127.0.0.1:3000/';
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickFirst(page, candidates) {
  for (const c of candidates) {
    try {
      const loc = typeof c === 'string'
        ? page.getByRole('button', { name: new RegExp(c, 'i') })
        : c(page);
      if (await loc.count()) {
        await loc.first().click({ timeout: 4000 });
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}

async function safeShot(page, name, options = {}) {
  const dest = path.join(out, name);
  await page.screenshot({ path: dest, fullPage: false, ...options });
  const st = fs.statSync(dest);
  console.log(`saved ${name} (${st.size} bytes)`);
  return dest;
}

async function enterStudio(page) {
  await sleep(2500);
  const entered = await clickFirst(page, [
    'Back to the studio',
    'Create your first image',
    'Create',
    'Get started',
  ]);
  if (!entered) {
    console.log('Could not find enter-studio button. Visible buttons:',
      (await page.locator('button').allTextContents()).map((t) => t.trim()).filter(Boolean).slice(0, 25));
  }
  await sleep(4000);
  return entered;
}

async function openByAria(page, labelRe) {
  const loc = page.locator(`[aria-label]`).filter({ hasText: /^$/ }); // unused
  const all = page.locator('[aria-label]');
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    const label = await el.getAttribute('aria-label');
    if (label && labelRe.test(label)) {
      try {
        await el.click({ timeout: 3000 });
        return label;
      } catch {
        // continue
      }
    }
  }
  // also try role buttons by name
  try {
    const btn = page.getByRole('button', { name: labelRe });
    if (await btn.count()) {
      await btn.first().click({ timeout: 3000 });
      return 'role:' + labelRe;
    }
  } catch {}
  return null;
}

async function captureWithPage(page) {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  console.log('page title:', await page.title());
  console.log('body snip:', (await page.locator('body').innerText()).slice(0, 400).replace(/\n/g, ' | '));

  const entered = await enterStudio(page);
  const hasTextarea = (await page.locator('textarea').count()) > 0;
  console.log({ entered, hasTextarea });

  // Hero: full studio chrome
  await safeShot(page, 'hero-studio-web.png');

  // Scale / BYOK — try open model picker / QTY / settings
  // Model multi-select toggle often has title about multi-model
  let opened = await openByAria(page, /Variations per prompt|Pick a preset count|Generate image/i);
  console.log('scale open:', opened);
  // Click model area if present
  const modelToggle = page.locator('[title*="multi-model" i], [title*="Toggle multi-model" i]');
  if (await modelToggle.count()) {
    await modelToggle.first().click().catch(() => {});
    await sleep(800);
  }
  // Try opening a model dropdown by clicking model chips/buttons near generate
  const modelBtn = page.getByRole('button').filter({ hasText: /Gemini|GPT|Imagen|Flux|model/i });
  if (await modelBtn.count()) {
    await modelBtn.first().click().catch(() => {});
    await sleep(1000);
  }
  await safeShot(page, 'card-scale-byok.png');
  await safeShot(page, 'benefit-scale-byok.png');
  // close menus with Escape
  await page.keyboard.press('Escape');
  await sleep(400);

  // Folders
  const folderOpened = await openByAria(page, /Folder:|Switch folder/i);
  console.log('folder open:', folderOpened);
  if (!folderOpened) {
    const folderBtn = page.getByRole('button', { name: /folder|inbox/i });
    if (await folderBtn.count()) await folderBtn.first().click().catch(() => {});
  }
  await sleep(1000);
  await safeShot(page, 'card-folders.png');
  await safeShot(page, 'benefit-folder-instructions.png');
  await page.keyboard.press('Escape');
  await sleep(400);

  // Presets
  const presetsOpened = await openByAria(page, /Presets:/i);
  if (!presetsOpened) {
    const presetsBtn = page.getByRole('button', { name: /preset/i });
    if (await presetsBtn.count()) await presetsBtn.first().click().catch(() => {});
  }
  await sleep(1000);
  await safeShot(page, 'card-presets-brand.png');
  await safeShot(page, 'benefit-presets-brand.png');
  await page.keyboard.press('Escape');
  await sleep(400);

  // Follow-ups / refine
  const refineOpened = await openByAria(page, /Refine and recompose/i);
  if (!refineOpened) {
    const refine = page.getByRole('button', { name: /refine|recompose|run analysis/i });
    if (await refine.count()) await refine.first().click().catch(() => {});
  }
  await sleep(1200);
  await safeShot(page, 'card-follow-ups.png');
  await safeShot(page, 'benefit-follow-ups.png');
  await page.keyboard.press('Escape');
  await sleep(400);

  // Animation / Build Studio
  const animate = page.locator('[title*="Build Studio" i], [title="Animate" i], button[aria-label*="Build Studio" i]');
  if (await animate.count()) {
    await animate.first().click().catch(() => {});
    await sleep(2500);
  } else {
    const animBtn = page.getByRole('button', { name: /animate|build studio|motion/i });
    if (await animBtn.count()) {
      await animBtn.first().click().catch(() => {});
      await sleep(2500);
    }
  }
  await safeShot(page, 'card-animation.png');
  await safeShot(page, 'benefit-consistent-animation.png');
  // Close build studio if open
  const closeBuild = page.locator('[aria-label="Close Build Studio"]');
  if (await closeBuild.count()) await closeBuild.first().click().catch(() => {});
  await page.keyboard.press('Escape');
  await sleep(500);

  // Batch / compare / selection
  const selectMode = page.locator('[aria-label*="Select items" i]');
  if (await selectMode.count()) {
    await selectMode.first().click().catch(() => {});
    await sleep(1000);
  } else {
    const compare = page.getByRole('button', { name: /^Compare$/i });
    if (await compare.count()) await compare.first().click().catch(() => {});
    await sleep(1000);
  }
  // Also try QTY / variations
  const qty = page.locator('[aria-label="Variations per prompt"], [aria-label="Pick a preset count"]');
  if (await qty.count()) {
    await qty.first().click().catch(() => {});
    await sleep(800);
  }
  await safeShot(page, 'card-batch-compare.png');
  await safeShot(page, 'benefit-batch-compare.png');

  // Frame exports if Build Studio still reachable — optional second try
  // (reuse animation surface if still open)
  if (!(await fs.promises.access(path.join(out, 'benefit-frame-exports.png')).then(() => true).catch(() => false))) {
    // duplicate animation shot as frame exports starter if export menu not reached
    await safeShot(page, 'benefit-frame-exports.png');
  }

  console.log('capture pass complete');
  return { entered, hasTextarea };
}

async function main() {
  // Prefer Chrome channel for closer real UI chrome
  let browser;
  let context;
  let usedProfile = false;

  const braveProfile = path.join(process.env.HOME, 'Library/Application Support/BraveSoftware/Brave-Browser');
  const chromeProfile = path.join(process.env.HOME, 'Library/Application Support/Google/Chrome');

  // First try clean session (guest / restored localStorage may still help little)
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const result = await captureWithPage(page);
    await browser.close();

    if (!result.hasTextarea) {
      console.log('Studio textarea not found in clean session; trying persistent Brave profile copy...');
      // Copy a lightweight attempt: launchPersistentContext may fail if profile locked.
      // Use a temp dir and skip if locked — report blocker.
      try {
        const userData = path.join(root, '.capture-profile-brave');
        // If we already have a capture profile, reuse; else try persistent on Default via channel is risky.
        // Fall back: report that auth may be needed.
        console.log('BLOCKER: clean session did not reach signed-in studio. Guest path used if available.');
        console.log('Brave/Chrome live profiles are locked while the browser is open; capture used headless clean profile.');
      } catch (e) {
        console.log('profile attempt failed:', e.message);
      }
    }
  } catch (err) {
    console.error('capture failed:', err);
    process.exitCode = 1;
  }
}

await main();
