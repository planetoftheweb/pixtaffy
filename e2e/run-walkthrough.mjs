import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function runWalkthrough({ name, baseUrl, outDir, headed = false, env = process.env }) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid walkthrough name');
  await mkdir(outDir, { recursive: true });
  const steps = [], requests = [], responses = [], pendingResponses = new Set(), secrets = [];
  const sanitize = error => {
    let message = error instanceof Error ? error.message : 'Unknown failure';
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      for (const value of [secret, encodeURIComponent(secret)]) message = message.split(value).join('[REDACTED]');
    }
    return message.replace(/AIza[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/([?&](?:key|token|password)=)[^&\s]+/gi, '$1[REDACTED]').replace(/\u2014/g, '-');
  };
  let browser;
  const result = { name, baseUrl, pass: false, steps };
  try {
    browser = await chromium.launch({ headless: !headed, ...(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    context.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    // Bodies remain in memory for assertions and are never serialized or logged.
    context.on('response', response => {
      const pending = response.text().then(body => responses.push({ url: response.url(), status: response.status(), body })).catch(() => {}).finally(() => pendingResponses.delete(pending));
      pendingResponses.add(pending);
    });
    const step = async (name, fn) => {
      const record = { name, pass: false, detail: '', screenshot: null };
      steps.push(record);
      try { await fn(); record.pass = true; record.detail = 'Passed'; }
      catch (error) { record.detail = sanitize(error); }
      // Mask all input areas on both success and failure, including passwords.
      const screenshot = `${steps.length}.png`;
      try { await page.screenshot({ path: resolve(outDir, screenshot), mask: [page.locator('input, textarea'), ...secrets.map(secret => page.getByText(secret, { exact: false }))] }); record.screenshot = screenshot; } catch { record.pass = false; record.detail += '; Screenshot capture failed'; }
      if (!record.pass) throw new Error('Walkthrough step failed');
    };
    const walkthrough = (await import(`./walkthroughs/${name}.mjs`)).default;
    await walkthrough({ page, context, browser, baseUrl, outDir, env, step, requests, responses, protect: value => { if (typeof value === 'string' && value) secrets.push(value); }, flushResponses: () => Promise.allSettled([...pendingResponses]) });
    result.pass = steps.length > 0 && steps.every(s => s.pass);
  } catch (error) {
    if (!steps.length) steps.push({ name: 'Launch', pass: false, detail: sanitize(error), screenshot: null });
  } finally {
    await browser?.close();
    await writeFile(resolve(outDir, 'result.json'), JSON.stringify(result, null, 2));
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
  if (!args.includes('--base-url') || !args.includes('--out')) throw new Error('Usage: <name> --base-url <url> --out <dir> [--headed]');
  const result = await runWalkthrough({ name: args[0], baseUrl: option('--base-url'), outDir: option('--out'), headed: args.includes('--headed') });
  process.exitCode = result.pass ? 0 : 1;
}
