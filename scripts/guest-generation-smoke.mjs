import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targetUrl = process.env.PIXTAFFY_SMOKE_URL || 'https://pixtaffy.com/';
const phaseDeadlineMs = Number(process.env.PIXTAFFY_GUEST_PHASE_TIMEOUT_MS || 20_000);
const resultDeadlineMs = Number(process.env.PIXTAFFY_GUEST_RESULT_TIMEOUT_MS || 120_000);
const expectBlockedGuestSession = process.env.PIXTAFFY_EXPECT_BLOCKED_GUEST_SESSION === '1';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    server.close((error) => error ? reject(error) : resolvePort(port));
  });
});

const findChrome = () => {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  throw new Error('Chrome or Chromium is required. Set CHROME_BIN to its executable path.');
};

const waitForTarget = async (port) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await wait(100);
  }
  throw new Error('Chrome DevTools endpoint did not become ready.');
};

class CdpSession {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const profilePath = mkdtempSync(join(tmpdir(), 'pixtaffy-guest-smoke-'));
const chrome = findChrome();
const port = await freePort();
const browser = spawn(chrome, [
  '--headless=new',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profilePath}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let session;
try {
  session = new CdpSession(await waitForTarget(port));
  await session.open();
  const requests = [];
  const consoleLines = [];
  session.on('Network.requestWillBeSent', ({ request }) => {
    try {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.origin}${url.pathname}`);
    } catch {
      requests.push(`${request.method} ${request.url.split('?')[0]}`);
    }
  });
  session.on('Runtime.consoleAPICalled', ({ type, args }) => {
    const line = args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
    consoleLines.push(`${type}: ${line}`);
  });
  await Promise.all([
    session.send('Page.enable'),
    session.send('Runtime.enable'),
    session.send('Network.enable'),
  ]);
  if (expectBlockedGuestSession) {
    await session.send('Network.setBlockedURLs', {
      urls: ['*identitytoolkit.googleapis.com/*'],
    });
  }
  await session.send('Page.navigate', { url: targetUrl });

  const evaluate = async (expression) => {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
    return result.result.value;
  };

  const waitFor = async (expression, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await wait(100);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  };

  await waitFor(
    `document.body?.innerText.includes('Turn one idea into a whole set of')`,
    10_000,
    'the welcome screen',
  );
  await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Create free image'))?.click()`);
  await waitFor(`Boolean(document.querySelector('textarea'))`, 10_000, 'the guest studio prompt');
  await evaluate(`document.querySelector('textarea')?.focus()`);
  await session.send('Input.insertText', {
    text: 'A friendly robot mascot holding a paintbrush, flat vector style, teal and orange',
  });
  await waitFor(
    `Boolean(document.querySelector('button[aria-label="Create your first image free"]:not(:disabled)'))`,
    5_000,
    'the enabled Generate button',
  );

  const requestStartIndex = requests.length;
  const clickedAt = Date.now();
  await evaluate(`document.querySelector('button[aria-label="Create your first image free"]:not(:disabled)')?.click()`);

  const phaseDeadline = clickedAt + phaseDeadlineMs;
  while (Date.now() < phaseDeadline) {
    const recent = requests.slice(requestStartIndex);
    if (recent.some((request) => request.includes('/generateGuestImage'))) break;
    const failed = await evaluate(`document.body?.innerText.includes('Needs attention')`);
    if (failed) break;
    await wait(250);
  }

  const recentRequests = requests.slice(requestStartIndex);
  const phases = {
    identityToolkit: recentRequests.some((request) => request.includes('identitytoolkit.googleapis.com')),
    appCheckExchange: recentRequests.some((request) => request.includes('firebaseappcheck.googleapis.com')),
    guestFunction: recentRequests.some((request) => request.includes('/generateGuestImage')),
  };
  const browserState = await evaluate(`({
    failed: document.body?.innerText.includes('Needs attention'),
    friendlySessionError: document.body?.innerText.includes("couldn't start the temporary session"),
    stillGenerating: document.body?.innerText.includes('Generating 0/1'),
  })`);
  console.log(JSON.stringify({ phaseElapsedMs: Date.now() - clickedAt, phases, browserState, recentRequests, consoleLines }, null, 2));
  if (expectBlockedGuestSession) {
    if (phases.guestFunction || !browserState.failed || !browserState.friendlySessionError || browserState.stillGenerating) {
      process.exitCode = 4;
    }
  } else if (!phases.guestFunction) process.exitCode = 2;
  else {
    const resultDeadline = Date.now() + resultDeadlineMs;
    let resultSettled = false;
    while (Date.now() < resultDeadline) {
      const state = await evaluate(`({
        complete: document.body?.innerText.includes('Your image is ready'),
        failed: document.body?.innerText.includes('Needs attention'),
      })`);
      if (state.complete || state.failed) {
        resultSettled = true;
        console.log(JSON.stringify({ resultElapsedMs: Date.now() - clickedAt, ...state }));
        if (state.failed) process.exitCode = 3;
        break;
      }
      await wait(500);
    }
    if (!resultSettled) {
      console.error(`Guest generation did not settle within ${resultDeadlineMs / 1000} seconds.`);
      process.exitCode = 5;
    }
  }
} finally {
  session?.close();
  if (browser.exitCode == null) {
    const exited = new Promise((resolve) => browser.once('exit', resolve));
    browser.kill('SIGTERM');
    await Promise.race([exited, wait(2_000)]);
  }
  try {
    rmSync(profilePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    console.warn(`Could not remove temporary Chrome profile ${profilePath}:`, error);
  }
}
