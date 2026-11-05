import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, resolveModel, hasAdc, selectBackend, safeError, run } from '../scripts/smoke-image-models.mjs';

const image = { candidates: [{ content: { parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }] } }], usageMetadata: { promptTokenCount: 10 } };
function fixture(extra = {}) {
  const logs = [];
  return { logs, deps: { env: {}, home: '/empty', readFile: async () => { throw new Error('absent'); }, access: async () => { throw new Error('absent'); }, log: value => logs.push(value), mkdir: async () => {}, writeFile: async () => {}, fetch: async () => { throw new Error('Unexpected network call'); }, ...extra } };
}
test('flags, defaults, production guard and model normalization', () => {
  const options = parseArgs(['--vertex', '--project', 'brandoit', '--allow-prod', '--location', 'global', '--dry-run', '--out', '/output', 'gemini']);
  assert.equal(options.vertex, true);
  assert.equal(options.project, 'brandoit');
  assert.equal(options.location, 'global');
  assert.equal(options.dryRun, true);
  assert.equal(options.out, '/output');
  assert.throws(() => parseArgs(['--project', 'brandoit']), /allow-prod/);
  assert.throws(() => parseArgs(['--out']), /Missing/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown/);
  assert.equal(resolveModel('gemini'), 'gemini-3-pro-image');
  assert.equal(resolveModel('gemini-3.1-flash-image-preview'), 'gemini-3.1-flash-image');
  assert.throws(() => resolveModel('gemini-3-pro-image-preview'));
});
test('ADC checks existence only and backend selection prefers API keys unless forced', async () => {
  const paths = [];
  assert.equal(await hasAdc({ GOOGLE_APPLICATION_CREDENTIALS: '/adc' }, '/home', async path => { paths.push(path); }), true);
  assert.deepEqual(paths, ['/adc']);
  assert.equal(await hasAdc({}, '/home', async path => { assert.equal(path, '/home/.config/gcloud/application_default_credentials.json'); }), true);
  assert.equal(await hasAdc({}, '/home', async () => { throw new Error(); }), false);
  assert.equal(selectBackend('gemini', {}, 'key', true), 'gemini-api');
  assert.equal(selectBackend('gemini', {}, undefined, true), 'vertex');
  assert.equal(selectBackend('gemini', {}, undefined, false), 'gemini-api');
  assert.equal(selectBackend('gemini', { vertex: true }, 'key', true), 'vertex');
  assert.equal(selectBackend('openai-2.6', { vertex: true }), 'openai');
});
test('dry-run reads no credentials and performs no network calls', async () => {
  const { deps, logs } = fixture({ readFile: async () => { assert.fail('credential read'); }, access: async () => { assert.fail('ADC check'); } });
  assert.equal(await run(['--vertex', '--dry-run'], deps), 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].dryRun, true);
  for (const key of ['models', 'backend', 'project', 'location', 'out']) assert.ok(key in logs[0]);
});
test('missing credentials fail Gemini and skip OpenAI cleanly', async () => {
  const { deps, logs } = fixture();
  assert.equal(await run(['gemini', 'openai-2.6'], deps), 1);
  assert.deepEqual(logs.map(({ status, reason }) => [status, reason]), [['fail', 'GEMINI_API_KEY unavailable'], ['skip', 'OPENAI_API_KEY unavailable']]);
  assert.equal(await run(['--vertex', 'gemini'], deps), 1);
  assert.equal(logs.at(-1).reason, 'ADC unavailable');
});
test('Vertex SDK receives GA models, project and 1K config with official costs', async () => {
  const requests = [];
  class GoogleGenAI {
    constructor(options) {
      assert.deepEqual(options, { vertexai: true, project: 'pixtaffy-staging', location: 'global' });
      this.models = { generateContent: async request => { requests.push(request); return image; } };
    }
  }
  const { deps, logs } = fixture({ GoogleGenAI, access: async () => {} });
  assert.equal(await run(['gemini-nano-banana-2.1', 'gemini-3.1-flash-image-preview', 'gemini'], deps), 0);
  assert.deepEqual(logs.map(value => value.estCostUsd), [0.0336, 0.067, 0.134]);
  for (const request of requests) {
    assert.ok(!request.model.endsWith('-preview'));
    assert.deepEqual(request.config.imageConfig, { aspectRatio: '1:1', imageSize: '1K' });
  }
  for (const result of logs) { assert.equal(result.backend, 'vertex'); assert.equal(result.project, 'pixtaffy-staging'); }
});
test('REST normalizes aliases and never logs keys or raw provider errors', async () => {
  const requests = [];
  const { deps, logs } = fixture({ env: { GEMINI_API_KEY: 'secret-unit-key' }, fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => image }; } });
  assert.equal(await run(['gemini', 'gemini-3.1-flash-image-preview'], deps), 0);
  assert.ok(requests[0].url.includes('gemini-3-pro-image:'));
  assert.ok(requests[1].url.includes('gemini-3.1-flash-image:'));
  deps.fetch = async () => { throw new Error('secret-unit-key raw body'); };
  assert.equal(await run(['gemini'], deps), 1);
  assert.equal(logs.at(-1).reason, 'Provider request failed');
  assert.ok(!JSON.stringify(logs).includes('secret-unit-key'));
  assert.equal(safeError({ status: 'PERMISSION_DENIED', message: 'token' }, 'vertex'), 'Vertex request failed: PERMISSION_DENIED');
  assert.equal(safeError({ status: 'secret-token', message: 'token' }, 'vertex'), 'Vertex request failed');
  assert.equal(safeError(new Error('HTTP 403'), 'gemini-api'), 'HTTP 403');
  assert.equal(safeError(new Error('Missing image data'), 'vertex'), 'Missing image data');
  const failing = fixture({ access: async () => {}, GoogleGenAI: class { constructor() { throw { status: 'UNAUTHENTICATED', message: 'secret-token' }; } } });
  assert.equal(await run(['--vertex'], failing.deps), 1);
  assert.ok(!JSON.stringify(failing.logs).includes('secret-token'));
});
