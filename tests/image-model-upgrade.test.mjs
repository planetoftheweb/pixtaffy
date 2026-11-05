import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function geminiHelpers(path) {
  const source = read(path);
  const constants = [...source.matchAll(/^const NANO_BANANA_\w+ = [^;]+;/gm)].map(m => m[0]).join('\n');
  const candidates = source.match(/const getGeminiImageModelCandidates = [\s\S]*?\n};/)[0];
  const ui = source.match(/const getUiModelIdForGeminiImageModel = [\s\S]*?\n};/)?.[0] || '';
  const code = ts.transpile(`${constants}\n${candidates}\n${ui}\nglobalThis.helpers = { getGeminiImageModelCandidates${ui ? ', getUiModelIdForGeminiImageModel' : ''} };`);
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return context.helpers;
}
for (const path of ['services/geminiService.ts', 'functions/src/agentGenerateImage.ts']) {
  test(`${path} resolves GA models and preserves fallback order`, () => {
    const { getGeminiImageModelCandidates: candidates, getUiModelIdForGeminiImageModel: ui } = geminiHelpers(path);
    for (const [picker, api] of [['gemini-nano-banana-2.1', 'gemini-nano-banana-2.1'], ['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image'], ['gemini-3.1-flash-image', 'gemini-3.1-flash-image'], ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-lite-image']]) {
      assert.deepEqual(Array.from(candidates(picker)), [api, 'gemini-3-pro-image']);
    }
    assert.deepEqual(Array.from(candidates('gemini')), ['gemini-3-pro-image']);
    if (ui) {
      assert.equal(ui('gemini-3.1-flash-image'), 'gemini-3.1-flash-image-preview');
      assert.equal(ui('gemini-nano-banana-2.1'), 'gemini-nano-banana-2.1');
      assert.equal(ui('gemini-3-pro-image'), 'gemini');
    }
  });
}
test('toolbar limits extra quality to 2.6 and all request paths guard quality and complexity', () => {
  assert.match(read('components/ControlPanel.tsx'), /filter\(q => \(q.id !== 'xhigh' && q.id !== 'max'\) \|\| selectedModel === 'openai-2.6' \|\| selectedModel === 'openai-2.6-flare'\)/);
  for (const path of ['services/openaiService.ts', 'functions/src/agentGenerateImage.ts', 'functions/src/userApiKeys.ts']) {
    const source = read(path);
    assert.match(source, /gpt-image-2\.6-sunburst/);
    assert.match(source, /gpt-image-2\.6-flare/);
    assert.match(source, /complexity/);
    assert.match(source, /startsWith\(['"]gpt-image-2\.6-['"]\)/);
    assert.match(source, /\? ['"]high['"] :/);
  }
});

test('generation and edits send 2.6 controls and normalize older model quality', async () => {
  const requests = [];
  const backgroundCode = ts.transpileModule(read('utils/openaiImageBackground.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const background = { exports: {} };
  vm.runInNewContext(backgroundCode, { exports: background.exports });
  const exports = {};
  const code = ts.transpileModule(read('services/openaiService.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    exports, Blob, FormData, Uint8Array, atob, btoa,
    require: name => name.includes('geminiService') ? { resolveImageInputForRefinement: async image => image } : background.exports,
    fetch: async (url, request) => {
      requests.push({ url, body: typeof request.body === 'string' ? JSON.parse(request.body) : Object.fromEntries(request.body.entries()) });
      return { ok: true, json: async () => ({ data: [{ b64_json: 'aW1hZ2U=' }] }) };
    },
  });
  const config = { aspectRatio: '16:9' };
  for (const modelId of ['openai-2.6', 'openai-2.6-flare', 'openai-2.5', 'openai-flare', 'openai-2', 'openai-mini', 'openai']) {
    for (const quality of ['xhigh', 'max']) {
      const options = { modelId, quality, complexity: 'medium', background: 'transparent' };
      await exports.generateOpenAIImage('test prompt', config, 'mock-key', options);
      await exports.refineOpenAIImage({ base64Data: 'aW1hZ2U=', mimeType: 'image/png' }, 'edit', config, { brandColors: [], visualStyles: [] }, 'mock-key', options);
      for (const { body } of requests.splice(0)) {
        const latest = modelId.startsWith('openai-2.6');
        assert.equal(body.complexity, latest ? 'medium' : undefined);
        assert.equal(body.quality, modelId === 'openai' ? undefined : latest ? quality : 'high');
        if (latest) {
          assert.equal(body.size, '2048x1152');
          assert.equal(body.background, 'transparent');
          assert.equal(body.output_format, 'png');
          assert.equal(body.input_fidelity, undefined);
        }
      }
    }
  }
  for (const complexity of [undefined, 'invalid']) {
    await exports.generateOpenAIImage('test', config, 'mock-key', { modelId: 'openai-2.6', complexity });
    assert.equal(requests.pop().body.complexity, undefined);
  }
});

test('every Gemini picker resolves only GA API and OpenRouter model strings', async () => {
  const { resolveModel } = await import('../scripts/smoke-image-models.mjs');
  const pickers = ['gemini', 'gemini-nano-banana-2.1', 'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'];
  const prices = {};
  vm.runInNewContext(ts.transpileModule(read('functions/src/pricing.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: prices });
  const keySource = read('functions/src/userApiKeys.ts');
  const expression = keySource.match(/generateContent\(\{ model: (isSvg[^,]+), contents:/)[1];
  const keyModel = new Function('model', 'isSvg', `return ${expression}`);
  for (const picker of pickers) {
    const resolved = [resolveModel(picker), keyModel(picker, false)];
    for (const path of ['services/geminiService.ts', 'functions/src/agentGenerateImage.ts']) resolved.push(...geminiHelpers(path).getGeminiImageModelCandidates(picker));
    // GA Flash is not a stored paid picker; the saved alias owns its price slot.
    const price = prices.getPaidModelPrice(picker === 'gemini-3.1-flash-image' ? 'gemini-3.1-flash-image-preview' : picker);
    assert.ok(price);
    resolved.push(price.openRouterModelId);
    for (const model of resolved) assert.ok(!model.endsWith('-preview'), `${picker} resolved to ${model}`);
  }
  const constants = read('constants.ts');
  assert.match(constants, /id: 'gemini-3\.1-flash-image-preview'/);
  assert.ok(!/model:\s*['"]gemini-[^'"]*-preview['"]/.test(constants));
  // Each runtime occurrence has a reviewed alias role. New occurrences require review.
  const { execFileSync } = await import('node:child_process');
  const audit = execFileSync('git', ['grep', '-n', 'image-preview', '--', '*.ts', '*.tsx', '*.js', '*.mjs', ':!tests/*', ':!.harness-runs/*'], { cwd: new URL('..', import.meta.url), env: { ...process.env, GIT_CONFIG_COUNT: '0' }, encoding: 'utf8' });
  const allowed = new Set(['App.tsx', 'constants.ts', 'components/AdminPage.tsx', 'components/ControlPanel.tsx', 'components/ImageDisplay.tsx', 'components/RecentGenerations.tsx', 'functions/src/agentGenerateImage.ts', 'functions/src/pricing.ts', 'functions/src/pricing.test.ts', 'functions/src/userApiKeys.ts', 'mcp/index.js', 'services/aspectRatioService.ts', 'services/billingService.ts', 'services/correctionAnalysisRouter.ts', 'services/geminiService.ts', 'services/svgService.ts', 'services/timeEstimationService.ts', 'scripts/smoke-image-models.mjs']);
  for (const line of audit.trim().split('\n')) {
    assert.ok(allowed.has(line.split(':')[0]), line);
    assert.ok(!/model:\s*['"]gemini-[^'"]*-preview['"]/.test(line), line);
    assert.ok(!line.includes('gemini-3-pro-image-preview'), line);
  }
});

test('OpenRouter request models normalize legacy Gemini image slugs', () => {
  for (const path of ['services/openRouterService.ts', 'functions/src/openRouterProvider.ts']) {
    const expression = read(path).match(/model: ((?:options|input)\.modelSlug\.replace\([^\n]+\)),/)[1];
    const resolveRequestModel = new Function('options', 'input', `return ${expression}`);
    for (const slug of ['google/gemini-3-pro-image', 'google/gemini-3.1-flash-image']) {
      for (const modelSlug of [slug, `${slug}-preview`]) {
        assert.equal(resolveRequestModel({ modelSlug }, { modelSlug }), slug);
      }
    }
    for (const modelSlug of ['openai/gpt-image-2', 'other/model-preview', 'google/gemini-text-preview']) {
      assert.equal(resolveRequestModel({ modelSlug }, { modelSlug }), modelSlug);
    }
  }
});
