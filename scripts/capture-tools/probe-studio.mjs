import { chromium } from './node_modules/playwright/index.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'public', 'marketing');
const base = 'http://127.0.0.1:3000/';
const profile = path.join(root, '.capture-profile-brave');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { realUi: [], fallback: [], notes: [], missing: [], at: new Date().toISOString() };

async function bodyText(page) {
  return (await page.locator('body').innerText().catch(() => '')) || '';
}

async function shot(page, name) {
  const text = await bodyText(page);
  if (/Opening your studio/i.test(text)) throw new Error('spinner: ' + name);
  const dest = path.join(out, name);
  await page.screenshot({ path: dest, fullPage: false });
  const size = fs.statSync(dest).size;
  const kb = Math.round(size / 1024);
  if (size < 250000) throw new Error(name + ' too small ' + kb + 'KB');
  console.log('saved', name, kb + 'KB');
  report.realUi.push(name);
}

async function clickAria(page, re) {
  const all = page.locator('[aria-label]');
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    const label = await el.getAttribute('aria-label');
    if (label && re.test(label)) {
      await el.click({ timeout: 5000 });
      return label;
    }
  }
  return null;
}

async function dismiss(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(250);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(250);
}

function copy(srcName, destName, why) {
  const src = path.join(out, srcName);
  const dest = path.join(out, destName);
  if (!fs.existsSync(src) || fs.statSync(src).size < 250000) return false;
  fs.copyFileSync(src, dest);
  console.log('fallback', srcName, '->', destName);
  report.fallback.push(destName + ' <- ' + srcName);
  report.notes.push(why);
  return true;
}

async function enterStudio(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const text = await bodyText(page);
    if (/Opening your studio/i.test(text)) { await sleep(500); continue; }
    for (const re of [/Back to the studio/i, /Create your first image/i]) {
      const btn = page.getByRole('button', { name: re });
      if (await btn.count()) {
        await btn.first().click().catch(() => {});
        console.log('enter', String(re));
        await sleep(2000);
      }
    }
    const hasModel = await page.locator('[aria-label^="Model:"]').count();
    const hasTa = await page.locator('textarea').count();
    const ready = /Ready to Create/i.test(await bodyText(page));
    if (hasModel && (hasTa || ready)) {
      await sleep(1500);
      if (/Opening your studio/i.test(await bodyText(page))) continue;
      return;
    }
    await sleep(400);
  }
  throw new Error('studio timeout');
}

async function captureGuest(page) {
  await enterStudio(page);
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label')).filter(Boolean)
  );
  console.log('guest labels', labels);
  report.notes.push('guest labels: ' + labels.join(' | '));

  if (await page.locator('text=Toolbar hidden').count()) {
    await page.mouse.wheel(0, -1200);
    await sleep(400);
  }

  await dismiss(page);
  await shot(page, 'hero-studio-web.png');

  await dismiss(page);
  console.log('model', await clickAria(page, /^Model:/));
  await sleep(1000);
  await shot(page, 'card-scale-byok.png');
  await shot(page, 'benefit-scale-byok.png');
  await dismiss(page);

  const q = await clickAria(page, /^Quality:/);
  console.log('quality', q);
  await dismiss(page);
  const bg = await clickAria(page, /^Background:/);
  console.log('background', bg);
  await dismiss(page);
  if (!q && !bg) report.missing.push('Quality/Background (guest toolbar)');

  // Presets bookmark if present; else Colors (brand) — NEVER Pick a preset count
  await dismiss(page);
  let presets = await clickAria(page, /^Presets:/);
  if (!presets) {
    const bookmark = page.locator('[aria-label^="Presets"], button[title*="Preset" i]');
    if (await bookmark.count()) {
      await bookmark.first().click().catch(() => {});
      presets = 'bookmark';
    }
  }
  if (!presets) {
    console.log('colors for brand', await clickAria(page, /^Colors:/));
    presets = 'colors-fallback';
    report.missing.push('Presets bookmark menu (guest) — used Colors brand menu');
  }
  console.log('presets mode', presets);
  await sleep(1000);
  await shot(page, 'card-presets-brand.png');
  await shot(page, 'benefit-presets-brand.png');
  await dismiss(page);

  await dismiss(page);
  let folder = await clickAria(page, /^Folder:|^Switch folder/i);
  if (!folder) {
    const inbox = page.getByRole('button', { name: /inbox|folder/i });
    if (await inbox.count()) {
      await inbox.first().click().catch(() => {});
      folder = 'inbox';
    }
  }
  console.log('folder', folder);
  await sleep(1000);
  if (folder) {
    await shot(page, 'card-folders.png');
    await shot(page, 'benefit-folder-instructions.png');
  } else {
    report.missing.push('Folder/Inbox open menu (guest)');
  }
  return !!folder;
}

async function tryAuthFolders() {
  if (!fs.existsSync(profile)) {
    report.notes.push('no .capture-profile-brave');
    return false;
  }
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      channel: 'chrome',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      args: ['--disable-session-crashed-bubble', '--no-first-run'],
    });
  } catch (e) {
    report.notes.push('auth profile launch fail: ' + e.message);
    return false;
  }
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await enterStudio(page);
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label')).filter(Boolean)
    );
    console.log('auth labels', labels.slice(0, 40));
    report.notes.push('auth labels: ' + labels.slice(0, 40).join(' | '));

    // Prefer real Presets if signed in
    await dismiss(page);
    const presets = await clickAria(page, /^Presets:/);
    if (presets) {
      await sleep(1000);
      await shot(page, 'card-presets-brand.png');
      await shot(page, 'benefit-presets-brand.png');
      report.notes.push('presets from auth session');
      // remove presets from missing if we got it
      report.missing = report.missing.filter((m) => !/Presets bookmark/i.test(m));
    }
    await dismiss(page);

    let folder = await clickAria(page, /^Folder:|^Switch folder/i);
    if (!folder) {
      const inbox = page.getByRole('button', { name: /inbox|folder/i });
      if (await inbox.count()) {
        await inbox.first().click().catch(() => {});
        folder = 'inbox';
      }
    }
    if (folder) {
      await sleep(1200);
      await shot(page, 'card-folders.png');
      await shot(page, 'benefit-folder-instructions.png');
      report.missing = report.missing.filter((m) => !/Folder\/Inbox/i.test(m));
      await context.close();
      return true;
    }
  } catch (e) {
    report.notes.push('auth path: ' + e.message);
  }
  await context.close().catch(() => {});
  return false;
}

// Guest first
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(15000);
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
const guestHadFolder = await captureGuest(page);
await browser.close();

let authHadFolder = false;
if (!guestHadFolder) {
  authHadFolder = await tryAuthFolders();
}
if (!guestHadFolder && !authHadFolder) {
  copy('card-batch-compare.png', 'card-folders.png', 'folders card fallback — Inbox visible in good batch-compare (menu not open)');
  copy('card-batch-compare.png', 'benefit-folder-instructions.png', 'folder benefit fallback from batch-compare');
}

for (const g of ['card-animation.png', 'card-batch-compare.png', 'card-follow-ups.png']) {
  const fp = path.join(out, g);
  if (fs.existsSync(fp) && fs.statSync(fp).size > 300000) {
    report.notes.push(g + ' kept (' + Math.round(fs.statSync(fp).size / 1024) + 'KB)');
  }
}

fs.writeFileSync(path.join(out, '_capture-report.json'), JSON.stringify(report, null, 2));
console.log('REPORT', JSON.stringify(report, null, 2));
