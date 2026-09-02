import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const targetUrl = process.env.PIXTAFFY_SMOKE_URL || 'https://pixtaffy.com/';
const profile = mkdtempSync(join(tmpdir(), 'pixtaffy-render-check-'));
const port = await new Promise((resolve) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const browser = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-extensions', '--disable-default-apps', '--no-first-run',
  '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
browser.stderr.resume();
let socket;
const errors = [];
try {
  let page;
  const startupDeadline = Date.now() + 15_000;
  while (!page && Date.now() < startupDeadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = targets.find((item) => item.type === 'page');
    } catch {}
    if (!page) await wait(100);
  }
  assert.ok(page, 'Chrome did not start');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, 'Page evaluation failed');
    return result.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const started = Date.now();
  await send('Page.navigate', { url: targetUrl });
  let welcome = false;
  while (Date.now() - started < 10_000) {
    welcome = await evaluate(`document.body.innerText.replace(/\\s+/g, ' ').includes('Turn one idea into a whole set of')`);
    if (welcome || errors.length) break;
    await wait(100);
  }
  assert.deepEqual(errors, [], 'Uncaught browser errors');
  assert.ok(welcome, 'Welcome screen did not render within 10 seconds');
  const elapsedMs = Date.now() - started;
  assert.ok(await evaluate(`Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Log In'))`), 'Login trigger is missing');
  const assetsDeadline = Date.now() + 10_000;
  let assetsReady = false;
  while (Date.now() < assetsDeadline) {
    assetsReady = await evaluate(`document.fonts.status === 'loaded' && Array.from(document.images).filter(img => { const rect = img.getBoundingClientRect(); return rect.width && rect.height && rect.top < innerHeight && rect.bottom > 0; }).every(img => img.complete && img.naturalWidth > 0)`);
    if (assetsReady) break;
    await wait(100);
  }
  assert.ok(assetsReady, 'Visible images or fonts did not finish loading');
  if (process.env.PIXTAFFY_SMOKE_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(process.env.PIXTAFFY_SMOKE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Log In').click()`);
  const loginDeadline = Date.now() + 5_000;
  let login = false;
  while (Date.now() < loginDeadline) {
    login = await evaluate(`document.body.innerText.includes('Forgot password?') && Boolean(document.querySelector('input[type="password"]'))`);
    if (login || errors.length) break;
    await wait(100);
  }
  assert.deepEqual(errors, [], 'Uncaught browser errors while opening login');
  assert.ok(login, 'Login modal and password recovery did not render');
  console.log(JSON.stringify({ url: targetUrl, emptyProfile: true, extensionsDisabled: true, welcomeRenderedMs: elapsedMs, loginModal: 'rendered', forgotPassword: 'rendered', uncaughtErrors: errors.length }));
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await new Promise((resolve) => {
    if (browser.exitCode !== null) return resolve();
    const timer = setTimeout(() => browser.kill('SIGKILL'), 2_000);
    browser.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
