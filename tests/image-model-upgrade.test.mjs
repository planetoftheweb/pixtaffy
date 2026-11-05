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
