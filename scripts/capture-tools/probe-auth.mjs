import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'public', 'marketing');
const profile = path.join(root, '.capture-profile-brave');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: 'chrome',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  args: ['--disable-session-crashed-bubble', '--no-first-run'],
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(20000);
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('console.error', msg.text().slice(0, 200));
});

await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(2000);

for (let i = 0; i < 25; i++) {
  try {
    await sleep(1500);
    const url = page.url();
    const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 800).replace(/\n/g, ' | ');
    console.log(`t=${i} url=${url}`);
    console.log('text', text.slice(0, 280));
    await page.screenshot({ path: path.join(out, `_auth-${i}.png`), fullPage: false });

    if (/Back to the studio/i.test(text)) {
      await page.getByRole('button', { name: /Back to the studio/i }).first().click({ timeout: 5000 }).catch(() => {});
      console.log('clicked back');
      await sleep(3000);
    }
    if (await page.locator('[aria-label^="Model:"], [aria-label^="Folder:"]').count()) {
      console.log('STUDIO CONTROLS');
      const labels = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label')).slice(0, 40));
      console.log(labels);
      break;
    }
  } catch (e) {
    console.log('loop err', e.message);
  }
}
await context.close();
