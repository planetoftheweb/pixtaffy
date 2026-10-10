/**
 * Fix incomplete PixTaffy marketing screenshots.
 * Guest studio path; NEVER save frames containing "Opening your studio".
 */
import { chromium } from './node_modules/playwright/index.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'public', 'marketing');
const base = process.env.PIXTAFFY_CAPTURE_URL || 'http://127.0.0.1:3000/';
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { realUi: [], fallback: [], notes: [], at: new Date().toISOString() };

async function bodyText(page) {
  return (await page.locator('body').innerText().catch(() => '')) || '';
}

async function assertNotOpening(page, name) {
  const text = await bodyText(page);
  if (/Opening your studio/i.test(text)) {
    throw new Error(`Refusing to save ${name}: still on "Opening your studio"`);
  }
}

async function safeShot(page, name) {
  await assertNotOpening(page, name);
  const dest = path.join(out, name);
  await page.screenshot({ path: dest, fullPage: false });
  const kb = Math.round(fs.statSync(dest).size / 1024);
  console.log(`saved ${name} (${kb} KB)`);
  return dest;
}

async function clickAria(page, re) {
  const all = page.locator('[aria-label]');
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    const label = await el.getAttribute('aria-label');
    if (label && re.test(label)) {
      try {
        await el.click({ timeout: 5000 });
        return label;
      } catch {
        // continue
      }
    }
  }
  try {
    const btn = page.getByRole('button', { name: re });
    if (await btn.count()) {
      await btn.first().click({ timeout: 5000 });
      return 'role:' + String(re);
    }
  } catch {}
  return null;
}

async function dismiss(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(200);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(200);
}

async function waitForStudio(page) {
  const deadline = Date.now() + 90000;
  let entered = false;
  while (Date.now() < deadline) {
    const text = await bodyText(page);
    if (/Opening your studio/i.test(text)) {
      await sleep(500);
      continue;
    }
    for (const re of [/Back to the studio/i, /Create your first image/i]) {
      const btn = page.getByRole('button', { name: re });
      if (await btn.count()) {
        await btn.first().click().catch(() => {});
        entered = true;
        console.log('clicked enter:', re);
        await sleep(2000);
      }
    }
    const hasModel = (await page.locator('[aria-label^="Model:"]').count()) > 0;
    const hasType = (await page.locator('[aria-label^="Type:"]').count()) > 0;
    const hasStyle = (await page.locator('[aria-label^="Style:"]').count()) > 0;
    const hasInbox = (await page.locator('[aria-label^="Folder:"]').count()) > 0;
    const hasTa = (await page.locator('textarea').count()) > 0;
    const ready = /Ready to Create/i.test(await bodyText(page));
    if ((hasModel || hasType || hasStyle) && (hasTa || ready || hasInbox)) {
      await sleep(1500);
      // final spinner check
      if (/Opening your studio/i.test(await bodyText(page))) {
        await sleep(1000);
        continue;
      }
      return {
        entered,
        hasModel,
        hasType,
        hasStyle,
        hasInbox,
        hasTa,
        ready: /Ready to Create/i.test(await bodyText(page)),
      };
    }
    await sleep(400);
  }
  throw new Error('Timed out waiting for studio chrome');
}

async function openToolbarMenus(page) {
  // Prefer keeping Model, Quality, Background open together if possible.
  // RichSelect typically closes siblings, so open Model first (most important for BYOK),
  // then try Quality + Background quickly before shot — if only one stays open, Model is fine.
  const opened = {};
  opened.model = await clickAria(page, /^Model:/);
  await sleep(600);
  // Try to also open Quality without closing model — if UI is exclusive, re-open model after
  const qualityBtn = page.locator('[aria-label^="Quality:"]');
  const bgBtn = page.locator('[aria-label^="Background:"]');
  // Click Quality — may close Model; then we open Background for the shot if needed
  // User asked: Model / Quality / Background for scale-byok — open Model dropdown primarily,
  // and if menus are exclusive, take Model open (shows multi-model / BYOK scale story).
  // Also try clicking Quality while holding — just document what opened.
  console.log('opened model:', opened.model);
  // Attempt to leave Model open for the scale-byok shot
  if (!opened.model) {
    opened.quality = await clickAria(page, /^Quality:/);
    if (!opened.quality) opened.background = await clickAria(page, /^Background:/);
  }
  return opened;
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.basename(src)} -> ${path.basename(dest)} (${Math.round(fs.statSync(dest).size / 1024)} KB)`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const state = await waitForStudio(page);
  console.log('studio ready', state);
  report.notes.push(`guest studio: ${JSON.stringify(state)}`);

  // Dump labels for debugging
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-label]'))
      .map((e) => e.getAttribute('aria-label'))
      .filter(Boolean)
      .slice(0, 60)
  );
  console.log('labels', labels);
  report.notes.push(`labels: ${labels.slice(0, 30).join(' | ')}`);

  // Reveal toolbar if hidden
  if (await page.locator('text=Toolbar hidden').count()) {
    await page.mouse.wheel(0, -1000);
    await sleep(500);
  }

  await dismiss(page);

  // --- HERO: full studio chrome ---
  try {
    await safeShot(page, 'hero-studio-web.png');
    report.realUi.push('hero-studio-web.png');
  } catch (e) {
    console.warn('hero capture failed:', e.message);
    report.notes.push('hero capture failed: ' + e.message);
  }

  // --- SCALE / BYOK: Model (+ Quality/Background if exclusive UI) ---
  await dismiss(page);
  const scaleOpened = await openToolbarMenus(page);
  await sleep(900);
  try {
    await safeShot(page, 'card-scale-byok.png');
    await safeShot(page, 'benefit-scale-byok.png');
    report.realUi.push('card-scale-byok.png', 'benefit-scale-byok.png');
    report.notes.push(`scale menus: ${JSON.stringify(scaleOpened)}`);
  } catch (e) {
    report.notes.push('scale shot failed: ' + e.message);
  }
  await dismiss(page);

  // Also capture Quality and Background individually into temp for optional collage later
  await dismiss(page);
  const q = await clickAria(page, /^Quality:/);
  console.log('quality', q);
  await sleep(700);
  if (q) {
    await page.screenshot({ path: path.join(out, '_tmp-quality.png'), fullPage: false }).catch(() => {});
  }
  await dismiss(page);
  const bg = await clickAria(page, /^Background:/);
  console.log('background', bg);
  await sleep(700);
  if (bg) {
    await page.screenshot({ path: path.join(out, '_tmp-background.png'), fullPage: false }).catch(() => {});
  }
  await dismiss(page);

  // --- PRESETS ---
  await dismiss(page);
  let presets = await clickAria(page, /^Presets:/);
  if (!presets) {
    const pbtn = page.getByRole('button', { name: /preset|saved/i });
    if (await pbtn.count()) {
      await pbtn.first().click().catch(() => {});
      presets = 'role-presets';
    }
  }
  console.log('presets', presets);
  await sleep(1000);
  try {
    await safeShot(page, 'card-presets-brand.png');
    await safeShot(page, 'benefit-presets-brand.png');
    report.realUi.push('card-presets-brand.png', 'benefit-presets-brand.png');
    report.notes.push(`presets: ${presets || 'none'}`);
  } catch (e) {
    report.notes.push('presets shot failed: ' + e.message);
  }
  await dismiss(page);

  // --- FOLDERS / INBOX ---
  await dismiss(page);
  let folder = await clickAria(page, /^Folder:|^Switch folder/i);
  if (!folder) {
    const inbox = page.getByRole('button', { name: /inbox|folder/i });
    if (await inbox.count()) {
      await inbox.first().click().catch(() => {});
      folder = 'inbox-role';
    }
  }
  console.log('folder', folder);
  await sleep(1200);
  try {
    await safeShot(page, 'card-folders.png');
    await safeShot(page, 'benefit-folder-instructions.png');
    report.realUi.push('card-folders.png', 'benefit-folder-instructions.png');
    report.notes.push(`folder: ${folder || 'none'}`);
  } catch (e) {
    report.notes.push('folder shot failed: ' + e.message);
  }
  await dismiss(page);

  // If hero is still tiny/spinner-ish (< 300KB), derive from good card
  const heroPath = path.join(out, 'hero-studio-web.png');
  const heroSize = fs.existsSync(heroPath) ? fs.statSync(heroPath).size : 0;
  if (heroSize < 300000) {
    const sources = ['card-follow-ups.png', 'card-batch-compare.png', 'card-animation.png'];
    for (const s of sources) {
      const sp = path.join(out, s);
      if (fs.existsSync(sp) && fs.statSync(sp).size > 300000) {
        copyFile(sp, heroPath);
        report.fallback.push('hero-studio-web.png (from ' + s + ')');
        report.realUi = report.realUi.filter((x) => x !== 'hero-studio-web.png');
        report.notes.push(`hero derived from ${s} because capture was ${heroSize} bytes`);
        break;
      }
    }
  }

  // Mark good cards still present
  for (const g of ['card-animation.png', 'card-batch-compare.png', 'card-follow-ups.png']) {
    const p = path.join(out, g);
    if (fs.existsSync(p) && fs.statSync(p).size > 300000) {
      if (!report.realUi.includes(g)) report.realUi.push(g + ' (kept)');
    }
  }

  fs.writeFileSync(path.join(out, '_capture-report.json'), JSON.stringify(report, null, 2));
  console.log('REPORT', JSON.stringify(report, null, 2));

  await browser.close();
}
await main();
