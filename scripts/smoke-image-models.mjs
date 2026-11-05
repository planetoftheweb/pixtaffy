#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = resolve((outIndex >= 0 ? args.splice(outIndex, 2)[1] : './model-smoke').replace(/^~(?=\/)/, homedir()));
const models = args.length ? args : ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image'];
let fileKeys;
async function keyFor(name) {
  if (process.env[name]) return process.env[name];
  if (!fileKeys) {
    fileKeys = {};
    try {
      const text = await readFile(new URL('../.env', import.meta.url), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*(GEMINI_API_KEY|OPENAI_API_KEY)\s*=\s*(.*?)\s*$/);
        if (match) fileKeys[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read root key file'); }
  }
  return fileKeys[name];
}
const prompt = 'Create a glossy teal candy sculpture on a cream background, no text.';
for (const model of models) {
  const start = performance.now();
  const openai = model.startsWith('openai') || model.startsWith('gpt-image');
  const key = await keyFor(openai ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY');
  if (!key) { if (!openai) process.exitCode = 1; console.log(JSON.stringify({ model, status: openai ? 'skip' : 'fail', reason: `${openai ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} unavailable`, latencyMs: 0, usageTokens: null, estCostUsd: null })); continue; }
  try {
    const apiModel = ({ 'openai-2.6': 'gpt-image-2.6-sunburst', 'openai-2.6-flare': 'gpt-image-2.6-flare' })[model] || model;
    const response = await fetch(openai ? 'https://api.openai.com/v1/images/generations' : `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: openai ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } : { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(openai ? { model: apiModel, prompt, size: '2048x2048' } : { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } } }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const inline = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData)?.inlineData;
    const base64 = openai ? data.data?.[0]?.b64_json : inline?.data;
    if (!base64) throw new Error('Missing image data');
    await mkdir(out, { recursive: true });
    await writeFile(resolve(out, `${model}.${inline?.mimeType === 'image/jpeg' ? 'jpg' : inline?.mimeType === 'image/webp' ? 'webp' : 'png'}`), Buffer.from(base64, 'base64'));
    const usage = data.usage || data.usageMetadata || {};
    const input = usage.input_tokens || usage.promptTokenCount || 0;
    const output = usage.output_tokens || usage.candidatesTokenCount || 0;
    console.log(JSON.stringify({ model, status: 'ok', latencyMs: Math.round(performance.now() - start), usageTokens: usage, estCostUsd: openai ? (input * 5 + output * 30) / 1e6 : model === 'gemini-nano-banana-2.1' ? 0.0336 : model === 'gemini-3-pro-image' ? 0.134 : 0.067 }));
  } catch (error) {
    console.log(JSON.stringify({ model, status: 'fail', latencyMs: Math.round(performance.now() - start), usageTokens: null, estCostUsd: null, reason: /^HTTP \d+$|^Missing image data$/.test(error.message) ? error.message : 'Provider request failed' }));
    process.exitCode = 1;
  }
}
