import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../scripts/smoke-image-models.mjs', import.meta.url), 'utf8'))
  .replace(/^#!.*\n/, '')
  .replace(/^import .*;\n/gm, '')
  .replace('import.meta.url', "'file:///project/scripts/smoke-image-models.mjs'");

test('provider smoke generates three Gemini images and skips OpenAI without exposing keys', async () => {
  const requests = [];
  const files = [];
  const logs = [];
  const fakeKey = 'fake-unit-test-key';
  const models = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image'];
  const context = {
    process: { argv: ['node', 'smoke', '--out', '/output', ...models, 'openai-2.6', 'openai-2.6-flare'], env: { GEMINI_API_KEY: fakeKey } },
    resolve: (...parts) => parts.join('/'), homedir: () => '/fake-home', URL, Buffer,
    performance: { now: () => 1 }, AbortSignal,
    readFile: async () => { const error = new Error('No fixture file'); error.code = 'ENOENT'; throw error; },
    mkdir: async () => {}, writeFile: async (path, bytes) => files.push({ path, bytes }),
    console: { log: line => logs.push(JSON.parse(line)) },
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('fixture-image').toString('base64') } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } }) };
    },
  };
  await vm.runInNewContext(`(async () => {${source}\n})()`, context);
  assert.equal(requests.length, 3);
  for (const [index, model] of models.entries()) {
    assert.ok(requests[index].url.endsWith(`/models/${model}:generateContent`));
    assert.deepEqual(requests[index].body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } });
    assert.ok(files[index].path.endsWith(`${model}.png`));
    assert.ok(files[index].bytes.length > 0);
    assert.equal(logs[index].status, 'ok');
    assert.equal(logs[index].usageTokens.promptTokenCount, 10);
    assert.equal(typeof logs[index].estCostUsd, 'number');
  }
  assert.deepEqual(logs.slice(3).map(log => log.status), ['skip', 'skip']);
  assert.ok(!JSON.stringify(logs).includes(fakeKey));
  assert.equal(context.process.exitCode, undefined);
});
