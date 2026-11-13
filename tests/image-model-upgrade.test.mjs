import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
const normalizer = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../functions/src/legacyModelNormalizer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: normalizer });
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
  vm.runInNewContext(backgroundCode, { exports: background.exports, require: () => normalizer });
  const exports = {};
  const code = ts.transpileModule(read('services/openaiService.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    exports, Blob, FormData, Uint8Array, atob, btoa,
    require: name => name.includes('legacyModelNormalizer') ? normalizer : name.includes('geminiService') ? { resolveImageInputForRefinement: async image => image } : background.exports,
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
        const latest = modelId.startsWith('openai-2.6') || modelId === 'openai-2';
        assert.notEqual(body.model, 'gpt-image-2');
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
  vm.runInNewContext(ts.transpileModule(read('functions/src/pricing.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: prices, require: () => normalizer });
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
    const expression = read(path).match(/model: ((?:normalizeLegacyOpenRouterSlug\(options\.modelSlug\)|input\.modelSlug)\.replace\([^\n]+\)),/)[1];
    const resolveRequestModel = new Function('options', 'input', 'normalizeLegacyOpenRouterSlug', `return ${expression}`);
    for (const slug of ['google/gemini-3-pro-image', 'google/gemini-3.1-flash-image']) {
      for (const modelSlug of [slug, `${slug}-preview`]) {
        assert.equal(resolveRequestModel({ modelSlug }, { modelSlug }, normalizer.normalizeLegacyOpenRouterSlug), slug);
      }
    }
    for (const modelSlug of ['other/model-preview', 'google/gemini-text-preview']) {
      assert.equal(resolveRequestModel({ modelSlug }, { modelSlug }, normalizer.normalizeLegacyOpenRouterSlug), modelSlug);
    }
  }
});

test('retired selections normalize without changing current models', () => {
  assert.equal(normalizer.normalizeLegacyModelId('openai-2'), 'openai-2.6');
  assert.equal(normalizer.normalizeLegacyModelId('openai/gpt-image-2'), 'openrouter:openai/gpt-image-2.6-sunburst');
  assert.equal(normalizer.normalizeLegacyOpenRouterSlug('openai/gpt-image-2'), 'openai/gpt-image-2.6-sunburst');
  assert.equal(normalizer.normalizeLegacyModelId('openrouter:openai/gpt-image-2'), 'openrouter:openai/gpt-image-2.6-sunburst');
  for (const id of ['openai-2.6', 'openai-2.6-flare', 'openai-2.5', 'openai-flare', 'openai-mini', 'openai', 'gemini', 'openrouter:other/image']) assert.equal(normalizer.normalizeLegacyModelId(id), id);
  assert.deepEqual(Array.from(normalizer.normalizeLegacyOpenRouterModels(['openai/gpt-image-2', 'other/image', 'openai/gpt-image-2.6-sunburst'])), ['openai/gpt-image-2.6-sunburst', 'other/image']);
  for (const file of ['App.tsx', 'services/authService.ts', 'services/historyService.ts', 'utils/toolbarPresetUtils.ts', 'functions/src/agentGenerateImage.ts', 'functions/src/userApiKeys.ts', 'functions/src/paidAi.ts']) assert.match(read(file), /normalizeLegacyModelId/);
  const constants = read('constants.ts');
  assert.doesNotMatch(constants, /id: 'openai-2'|slug: 'openai\/gpt-image-2'/);
  assert.match(constants, /slug: 'openai\/gpt-image-2\.6-sunburst'/);
  assert.match(constants, /name: 'GPT Image 2\.6 \(OR\)'/);
});

test('legacy preset reads and comparisons migrate in memory without changing saved input', () => {
  const helpers = {};
  vm.runInNewContext(ts.transpileModule(read('utils/toolbarPresetUtils.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: helpers, require: () => normalizer });
  for (const [legacy, current] of [['openai-2', 'openai-2.6'], ['openrouter:openai/gpt-image-2', 'openrouter:openai/gpt-image-2.6-sunburst']]) {
    const saved = { id: 'saved', name: 'Saved preset', createdAt: 1, selectedModel: legacy };
    assert.equal(helpers.sanitizeToolbarPreset(saved).selectedModel, current);
    assert.equal(helpers.presetToolbarDiffersFromSnapshot(saved, { selectedModel: current }), false);
    assert.equal(saved.selectedModel, legacy);
  }
});

test('source contains no retired API model literals or new em dashes', async () => {
  const { execFileSync } = await import('node:child_process');
  const options = { cwd: new URL('..', import.meta.url), env: { ...process.env, GIT_CONFIG_COUNT: '0' }, encoding: 'utf8' };
  const files = execFileSync('git', ['ls-files', '--', '*.ts', '*.tsx', '*.js', '*.mjs', 'README.md', 'AGENTS.md', 'agents.md', 'CLAUDE.md', 'DESIGN.md'], options).trim().split('\n');
  files.push('functions/src/legacyModelNormalizer.ts', 'utils/legacyModelNormalizer.ts');
  for (const file of files) {
    if (/(^|\/)(tests|openspec|node_modules|dist|lib|\.harness-runs)\//.test(file) || file.endsWith('.test.ts') || file === 'data/whatsNew.ts') continue;
    assert.doesNotMatch(read(file), /gpt-image-2(?!\.)/, file);
  }
  const diff = execFileSync('git', ['diff', '--unified=0'], options);
  for (const line of diff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'))) assert.ok(!line.includes(String.fromCharCode(8212)) && !line.includes(String.fromCharCode(92) + 'u' + '2014'), line);
});


test('Functions API maps route normalized legacy IDs to Sunburst', () => {
  for (const file of ['functions/src/agentGenerateImage.ts', 'functions/src/userApiKeys.ts']) {
    const source = read(file);
    const pairs = [...source.matchAll(/["'](openai[^"']*)["']: ["'](gpt-image-[^"']*)["']/g)];
    const map = Object.fromEntries(pairs.map(([, id, api]) => [id, api]));
    assert.equal(map[normalizer.normalizeLegacyModelId('openai-2')], 'gpt-image-2.6-sunburst', file);
    assert.ok(!Object.values(map).includes('gpt-image-2'), file);
  }
});

test('OpenRouter legacy selections use Sunburst for slug extraction and every retry', async () => {
  const client = {};
  vm.runInNewContext(ts.transpileModule(read('services/openRouterService.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: client,
    require: name => name.includes('legacyModelNormalizer') ? normalizer : { OPENROUTER_MODEL_PREFIX: 'openrouter:' },
  });
  assert.equal(client.openRouterSlugFromModelId('openrouter:openai/gpt-image-2'), 'openai/gpt-image-2.6-sunburst');
  assert.equal(client.openRouterSlugFromModelId('openrouter:other/image'), 'other/image');
  assert.equal(client.openRouterSlugFromModelId('openai-2.6'), undefined);

  const requests = [];
  const provider = {};
  const background = {};
  vm.runInNewContext(ts.transpileModule(read('functions/src/openaiImageBackground.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: background, require: () => normalizer });
  vm.runInNewContext(ts.transpileModule(read('functions/src/openRouterProvider.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: provider,
    require: name => name.includes('legacyModelNormalizer') ? normalizer : background,
    fetch: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return requests.length < 3
        ? { ok: false, status: 400, json: async () => ({ error: 'Unsupported size' }) }
        : { ok: true, json: async () => ({ data: [{ b64_json: 'a'.repeat(100) }] }) };
    },
  });
  await provider.generateOpenRouterImageCore({ apiKey: 'mock-key', modelSlug: 'openai/gpt-image-2', prompt: 'test', aspectRatio: '16:9', background: 'transparent' });
  assert.equal(requests.length, 3);
  for (const body of requests) {
    assert.equal(body.model, 'openai/gpt-image-2.6-sunburst');
    assert.equal(body.background, 'transparent');
  }
});

test('helper model candidates use current stable IDs and supported generation settings', () => {
  const cases = [
    ['services/geminiTextModelService.ts', 'GEMINI_TEXT_MODEL_FALLBACKS', ['gemini-4-hydrogen', 'gemini-flash-latest', 'gemini-3.5-flash-lite']],
    ['services/svgService.ts', 'SVG_MODEL_CANDIDATES', ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']],
  ];
  for (const [path, constant, expected] of cases) {
    const source = read(path);
    const array = source.match(new RegExp(`${constant}[^=]*=\\s*\\[([^\\]]+)\\]`))[1];
    assert.deepEqual([...array.matchAll(/'([^']+)'/g)].map(match => match[1]), expected);
    assert.doesNotMatch(array, /gemini-(?:2\.5-(?:flash|pro)|2\.0-flash|1\.5-[^']*|pro-latest|3\.1-pro-preview)/);
  }
  for (const path of [...cases.map(([path]) => path), 'functions/src/paidAi.ts']) {
    assert.doesNotMatch(read(path), /xhigh|temperature|topP|topK|thinkingBudget|thinking_budget/);
  }
  assert.match(read('services/svgService.ts'), /thinkingConfig: \{ thinkingLevel: 'high' as ThinkingLevel \}/);
  assert.doesNotMatch(read('functions/src/paidAi.ts'), /gemini-flash-latest/);
});

function loadHelperServices(generateContent) {
  const text = {};
  const quietConsole = { warn() {}, error() {} };
  vm.runInNewContext(ts.transpileModule(read('services/geminiTextModelService.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: text, Error, console: quietConsole, require: () => ({}),
  });
  const svg = {};
  vm.runInNewContext(ts.transpileModule(read('services/svgService.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: svg, Error, console: quietConsole, btoa, unescape, encodeURIComponent,
    require: name => name === '@google/genai'
      ? { GoogleGenAI: class { models = { generateContent }; } }
      : text,
  });
  return { text, svg };
}

for (const quota of [
  { status: 429 }, { code: '429' }, { error: { status: 'RESOURCE_EXHAUSTED' } },
  new Error('Quota exceeded for this model, limit: 0'),
  new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'),
  Object.assign(new Error('No capacity'), { status: 429 }),
]) {
  test(`BYOK text and SVG advance past model quota failures: ${JSON.stringify(quota)}`, async () => {
    const calls = [];
    const generateContent = async request => {
      calls.push(request);
      if (!['gemini-flash-latest', 'gemini-3.8-flash'].includes(request.model)) throw quota;
      return { text: '<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>' };
    };
    const { text, svg } = loadHelperServices(generateContent);
    await text.generateContentWithGeminiTextFallback({ models: { generateContent } }, { contents: 'test' }, 'test');
    assert.deepEqual(calls.splice(0).map(call => call.model), ['gemini-4-hydrogen', 'gemini-flash-latest']);
    const result = await svg.generateSvg({ prompt: 'test', aspectRatio: '1:1' }, {
      brandColors: [], visualStyles: [], graphicTypes: [],
    }, `AIza${'x'.repeat(35)}`);
    assert.ok(result.svgCode.startsWith('<svg'));
    assert.deepEqual(calls.map(call => call.model), ['gemini-4-hydrogen', 'gemini-3.8-flash']);
    for (const call of calls) assert.equal(call.config.thinkingConfig.thinkingLevel, 'high');
  });
}

test('BYOK helpers stop on unrelated errors and exhaust quota fallbacks once each', async () => {
  for (const failure of [new Error('network disconnected'), { status: 429 }]) {
    const calls = [];
    const generateContent = async request => { calls.push(request.model); throw failure; };
    const { text, svg } = loadHelperServices(generateContent);
    await assert.rejects(text.generateContentWithGeminiTextFallback({ models: { generateContent } }, { contents: 'test' }, 'test'));
    assert.deepEqual(calls.splice(0), failure.status === 429
      ? ['gemini-4-hydrogen', 'gemini-flash-latest', 'gemini-3.5-flash-lite'] : ['gemini-4-hydrogen']);
    await assert.rejects(svg.generateSvg({ prompt: 'test' }, {
      brandColors: [], visualStyles: [], graphicTypes: [],
    }, `AIza${'x'.repeat(35)}`));
    assert.deepEqual(calls, failure.status === 429
      ? ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'] : ['gemini-4-hydrogen']);
  }
});

for (const quota of [{ status: 429 }, { code: '429' }, { error: { status: 'RESOURCE_EXHAUSTED' } }, new Error('quota reached'), Object.assign(new Error('No capacity'), { status: 429 })]) {
  for (const quotaIndex of [0, 2]) {
    test(`SVG exhaustion preserves quota diagnosis at attempt ${quotaIndex}: ${JSON.stringify(quota)}`, async () => {
      const calls = [];
      const { svg } = loadHelperServices(async request => {
        calls.push(request.model);
        throw calls.length - 1 === quotaIndex ? quota : new Error('Model not found');
      });
      await assert.rejects(svg.generateSvg({ prompt: 'test' }, {
        brandColors: [], visualStyles: [], graphicTypes: [],
      }, `AIza${'x'.repeat(35)}`), error => {
        assert.match(error.message, /quota or rate limit/);
        assert.doesNotMatch(error.message, /model-enablement|clear it|model restrictions/);
        for (const model of ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']) assert.ok(error.message.includes(model));
        return true;
      });
      assert.deepEqual(calls, ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    });
  }
}

test('SVG availability exhaustion retains model enablement guidance', async () => {
  const { svg } = loadHelperServices(async () => { throw new Error('Model not found'); });
  await assert.rejects(svg.generateSvg({ prompt: 'test' }, {
    brandColors: [], visualStyles: [], graphicTypes: [],
  }, `AIza${'x'.repeat(35)}`), /model-enablement/);
});
