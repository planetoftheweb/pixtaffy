import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FIRST_PAINT_DEADLINE_MS = 10_000;
const WELCOME_MARKER = 'Turn one idea into a whole set of';

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

  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const result = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) candidates.push(result.stdout.trim());
  }

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  throw new Error('Chrome or Chromium is required. Set CHROME_BIN to its executable path.');
};

const waitForServer = async (url) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Local PixTaffy server did not start at ${url}.`);
};

const waitForWelcome = (chrome, url, profilePath) => new Promise((resolveWelcome, reject) => {
  const startedAt = Date.now();
  let dom = '';
  let stderr = '';
  let settled = false;

  const args = [
    '--headless=new',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profilePath}`,
    '--dump-dom',
    url,
  ];
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');

  const browser = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    browser.kill('SIGTERM');
    const forceKillId = setTimeout(() => browser.kill('SIGKILL'), 1_000);
    browser.once('exit', () => {
      clearTimeout(forceKillId);
      if (error) reject(error);
      else resolveWelcome(Date.now() - startedAt);
    });
  };

  browser.stdout.on('data', (chunk) => {
    dom += chunk.toString();
    if (dom.includes(WELCOME_MARKER)) finish(null);
  });
  browser.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  browser.once('error', finish);
  browser.once('exit', (code) => {
    if (!settled) finish(new Error(`Chrome exited before the welcome screen rendered (code ${code}).\n${stderr.slice(-1_000)}`));
  });

  const timeoutId = setTimeout(() => {
    const visibleState = dom.match(/Loading PixTaffy|Opening your studio|Something went wrong/g)?.join(', ') || 'no recognized app state';
    finish(new Error(`Cold profile missed the ${FIRST_PAINT_DEADLINE_MS / 1000}-second welcome deadline (${visibleState}).\n${stderr.slice(-1_000)}`));
  }, FIRST_PAINT_DEADLINE_MS);
});

const profilePath = mkdtempSync(join(tmpdir(), 'pixtaffy-cold-profile-'));
let vite = null;

try {
  const chrome = findChrome();
  let targetUrl = process.env.PIXTAFFY_SMOKE_URL;

  if (!targetUrl) {
    const port = await freePort();
    targetUrl = `http://127.0.0.1:${port}`;
    vite = spawn(resolve('node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServer(targetUrl);
  }

  const elapsedMs = await waitForWelcome(chrome, targetUrl, profilePath);
  console.log(`Cold-profile welcome rendered in ${elapsedMs}ms with extensions disabled and empty browser storage.`);
} finally {
  vite?.kill('SIGTERM');
  rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
