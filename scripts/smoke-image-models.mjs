#!/usr/bin/env node
/*
 * node scripts/smoke-image-models.mjs [models...] [--out ./model-smoke]
 * Use --dry-run for a credential-free plan, or --vertex --project pixtaffy-staging
 * --location global for ADC. Production project brandoit requires --allow-prod.
 */
import { readFile, access, mkdir, writeFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function resolveModel(model) {
  const resolved = ({ gemini: 'gemini-3-pro-image', 'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image', 'openai-2.6': 'gpt-image-2.6-sunburst', 'openai-2.6-flare': 'gpt-image-2.6-flare' })[model] || model;
  if (!/^[a-z0-9.-]+$/.test(resolved) || (resolved.startsWith('gemini') && resolved.endsWith('-preview'))) throw new Error('Unsupported model');
  return resolved;
}
export function parseArgs(args) {
  const options = { models: [], vertex: false, project: 'pixtaffy-staging', location: 'global', allowProd: false, dryRun: false, out: resolve('./model-smoke') };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--out', '--project', '--location'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing flag value');
      options[arg.slice(2)] = arg === '--out' ? resolve(value.replace(/^~(?=\/)/, homedir())) : value;
    } else if (arg === '--vertex') options.vertex = true;
    else if (arg === '--allow-prod') options.allowProd = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--')) throw new Error('Unknown flag');
    else { resolveModel(arg); options.models.push(arg); }
  }
  if (options.project === 'brandoit' && !options.allowProd) throw new Error('Production project requires --allow-prod');
  if (!options.models.length) options.models = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image'];
  return options;
}
export async function hasAdc(env, home, exists = access) {
  for (const path of [env.GOOGLE_APPLICATION_CREDENTIALS, resolve(home, '.config/gcloud/application_default_credentials.json')].filter(Boolean)) {
    try { await exists(path); return true; } catch { /* File existence only. */ }
  }
  return false;
}
export function selectBackend(model, options, key, adc) {
  return /^(openai|gpt-image)/.test(model) ? 'openai' : options.vertex || (!key && adc) ? 'vertex' : 'gemini-api';
}
async function loadGoogleGenAI() {
  for (const base of [new URL('../package.json', import.meta.url), new URL('../functions/package.json', import.meta.url), resolve(process.cwd(), 'package.json'), resolve(process.cwd(), 'functions/package.json')]) {
    try { return createRequire(base)('@google/genai').GoogleGenAI; } catch { /* Try the next installation. */ }
  }
  throw new Error('Vertex request failed');
}
const codes = new Set(['PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL']);
export function safeError(error, backend) {
  if (/^HTTP \d{3}$|^Missing image data$/.test(error?.message)) return error.message;
  if (backend === 'vertex') {
    const code = [error?.status, error?.code, error?.error?.status].find(value => codes.has(value));
    return `Vertex request failed${code ? `: ${code}` : ''}`;
  }
  return 'Provider request failed';
}
export async function run(args, deps = {}) {
  const options = parseArgs(args);
  const log = deps.log || (value => console.log(JSON.stringify(value)));
  const env = deps.env || process.env;
  let fileKeys;
  async function keyFor(name) {
    if (name in env) return env[name] || undefined;
    if (!fileKeys) {
      fileKeys = {};
      try {
        const text = await (deps.readFile || readFile)(new URL('../.env', import.meta.url), 'utf8');
        for (const line of text.split(/\r?\n/)) {
          const match = line.match(/^\s*(GEMINI_API_KEY|OPENAI_API_KEY)\s*=\s*(.*?)\s*$/);
          if (match) fileKeys[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
        }
      } catch { /* Missing key files leave credentials unavailable. */ }
    }
    return fileKeys[name];
  }
  if (options.dryRun) {
    const key = options.vertex ? undefined : await keyFor('GEMINI_API_KEY');
    const adc = !options.vertex && !key ? await hasAdc(env, deps.home || homedir(), deps.access || access) : false;
    log({ dryRun: true, models: options.models.map(resolveModel), backend: options.models.map(model => selectBackend(model, options, key, adc)), project: options.project, location: options.location, out: options.out });
    return 0;
  }
  let exitCode = 0;
  for (const model of options.models) {
    const start = performance.now();
    const apiModel = resolveModel(model);
    const openai = /^(openai|gpt-image)/.test(model);
    const key = options.vertex && !openai ? undefined : await keyFor(openai ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY');
    const adc = !openai && !key ? await hasAdc(env, deps.home || homedir(), deps.access || access) : false;
    const backend = selectBackend(model, options, key, adc);
    const result = { model, backend, ...(backend === 'vertex' ? { project: options.project } : {}), status: 'fail', latencyMs: 0, usageTokens: null, estCostUsd: null };
    if (backend === 'vertex' ? !adc : !key) {
      log({ ...result, status: openai ? 'skip' : 'fail', reason: backend === 'vertex' ? 'ADC unavailable' : `${openai ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} unavailable` });
      if (!openai) exitCode = 1;
      continue;
    }
    try {
      const prompt = 'Create a glossy teal candy sculpture on a cream background, no text.';
      const contents = [{ role: 'user', parts: [{ text: prompt }] }];
      const config = { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } };
      let data;
      if (backend === 'vertex') {
        const GoogleGenAI = deps.GoogleGenAI || await loadGoogleGenAI();
        const ai = new GoogleGenAI({ vertexai: true, project: options.project, location: options.location });
        data = await ai.models.generateContent({ model: apiModel, contents, config });
      } else {
        const response = await (deps.fetch || fetch)(openai ? 'https://api.openai.com/v1/images/generations' : `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent`, {
          method: 'POST', signal: AbortSignal.timeout(180000),
          headers: openai ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } : { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify(openai ? { model: apiModel, prompt, size: '2048x2048' } : { contents, generationConfig: config }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      }
      const inline = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData;
      const base64 = openai ? data.data?.[0]?.b64_json : inline?.data;
      if (!base64) throw new Error('Missing image data');
      await (deps.mkdir || mkdir)(options.out, { recursive: true });
      await (deps.writeFile || writeFile)(resolve(options.out, `${model}.${inline?.mimeType === 'image/jpeg' ? 'jpg' : inline?.mimeType === 'image/webp' ? 'webp' : 'png'}`), Buffer.from(base64, 'base64'));
      const usage = data.usage || data.usageMetadata || {};
      const input = usage.input_tokens || usage.promptTokenCount || 0;
      const output = usage.output_tokens || usage.candidatesTokenCount || 0;
      log({ ...result, status: 'ok', latencyMs: Math.round(performance.now() - start), usageTokens: usage, estCostUsd: openai ? (input * 5 + output * 30) / 1e6 : ({ 'gemini-nano-banana-2.1': 0.0336, 'gemini-3-pro-image': 0.134 })[apiModel] || 0.067 });
    } catch (error) {
      log({ ...result, latencyMs: Math.round(performance.now() - start), reason: safeError(error, backend) });
      exitCode = 1;
    }
  }
  return exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href) {
  try { process.exitCode = await run(process.argv.slice(2)); }
  catch { console.log(JSON.stringify({ status: 'fail', reason: 'Invalid arguments or production project requires --allow-prod' })); process.exitCode = 1; }
}
