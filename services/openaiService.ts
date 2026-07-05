import { GenerationConfig, GeneratedImage } from '../types';
import type { ImageCorrectionPlan } from './geminiService';
import { resolveImageInputForRefinement } from './geminiService';
import {
  buildCorrectionAuditUserPrompt,
  parseStructuredJsonFromModelText,
  buildExpandPromptInstructions,
  type CorrectionAnalysisContext,
  type ExpandPromptContext,
} from './correctionAnalysisShared';

const base64ToImageBlob = (base64Data: string, mimeType: string): Blob => {
  const normalized = base64Data.replace(/\s+/g, '');
  const binary = atob(normalized);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'image/png' });
};

const buildOpenAiRefineEditPrompt = (
  refinementText: string,
  config: GenerationConfig,
  context: CorrectionAnalysisContext
): string => {
  const colorScheme = context.brandColors.find((c) => c.id === config.colorSchemeId);
  const style = context.visualStyles.find((s) => s.id === config.visualStyleId);
  const colors = colorScheme ? colorScheme.colors.join(', ') : '';
  const styleDesc = style
    ? `${style.name}${style.description ? ` — ${style.description}` : ''}`
    : '';

  return `
Edit the input image with minimal, localized changes. The output should read as the same picture after a focused revision — not a brand-new image or scene.

Preserve unless the user explicitly asks to change them: composition, framing, subjects, poses, recognizable identity, layout, logos, lighting, rendering style, and all on-image text (same wording, language, spelling, and placement).

Apply only what this request requires. Do not redraw, "improve", or restyle unrelated areas.

User request: ${refinementText}

For any pixels you must alter, stay coherent with:
${styleDesc ? `- Visual style: ${styleDesc}` : '- Visual style: match the source image exactly'}
${colors ? `- Brand palette (hex — colors to paint WITH, never to be drawn as visible codes or swatches): ${colors}` : ''}
`.trim();
};

export type OpenAIImageQuality = 'low' | 'medium' | 'high' | 'auto';

/**
 * Error thrown when OpenAI's /v1/images/generations endpoint rejects a call.
 * Includes structured fields so the batch runner can:
 *   - decide whether to retry / back off (transient, e.g. rate-limit)
 *   - decide whether to short-circuit (fatal, e.g. billing hard limit)
 *   - surface a clean human-readable message (not the raw JSON body)
 */
export class OpenAIGenerationError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly errorType?: string;
  /**
   * True when no amount of retrying will help this batch (billing cap hit,
   * quota exhausted, API key invalid, etc). The batch runner uses this flag
   * to stop taking new jobs for this model instead of failing every queued
   * call with the same message.
   */
  readonly fatal: boolean;

  constructor(opts: {
    message: string;
    status?: number;
    code?: string;
    errorType?: string;
    fatal?: boolean;
  }) {
    super(opts.message);
    this.name = 'OpenAIGenerationError';
    this.status = opts.status;
    this.code = opts.code;
    this.errorType = opts.errorType;
    this.fatal = !!opts.fatal;
  }
}

/**
 * Map OpenAI error codes/types to a short user-facing message and a `fatal`
 * flag. Falls back to OpenAI's own message if we don't have a friendlier one.
 */
const describeOpenAIError = (
  status: number,
  code: string | undefined,
  errorType: string | undefined,
  rawMessage: string
): { message: string; fatal: boolean } => {
  const c = (code || '').toLowerCase();
  const t = (errorType || '').toLowerCase();

  if (c === 'billing_hard_limit_reached' || t === 'billing_limit_user_error') {
    return {
      message:
        'OpenAI billing hard limit reached. Raise the monthly limit in your OpenAI dashboard (Settings → Limits) and try again.',
      fatal: true
    };
  }
  if (c === 'insufficient_quota' || t === 'insufficient_quota') {
    return {
      message:
        'Your OpenAI account has no remaining quota. Add a payment method or raise your budget in the OpenAI dashboard.',
      fatal: true
    };
  }
  if (c === 'invalid_api_key' || status === 401) {
    return {
      message: 'OpenAI rejected the API key. Check or rotate it in Settings → API keys.',
      fatal: true
    };
  }
  if (status === 403) {
    return {
      message:
        'OpenAI refused this request (403). The account or key may not have access to this model.',
      fatal: true
    };
  }
  if (c === 'rate_limit_exceeded' || status === 429) {
    // Retryable — the batch runner already has cooldown handling for 429.
    return { message: 'OpenAI rate limit hit — slow down and retry.', fatal: false };
  }
  if (c === 'content_policy_violation' || c === 'moderation_blocked') {
    return {
      message: 'OpenAI blocked this prompt (content policy). Adjust wording and retry.',
      fatal: false
    };
  }
  return {
    message: rawMessage || `OpenAI request failed (HTTP ${status}).`,
    fatal: false
  };
};

// Map our UI model IDs to OpenAI API model identifiers.
// Everything under this OpenAI family shares one API key slot (`apiKeys.openai`).
const API_MODEL_BY_UI_ID: Record<string, string> = {
  'openai-2': 'gpt-image-2',
  'openai-mini': 'gpt-image-1-mini',
  openai: 'gpt-image-1.5'
};

const resolveApiModel = (uiModelId?: string): string => {
  if (uiModelId && API_MODEL_BY_UI_ID[uiModelId]) return API_MODEL_BY_UI_ID[uiModelId];
  return API_MODEL_BY_UI_ID.openai;
};

// gpt-image-1.5 and gpt-image-1-mini only produce the three sizes below.
// gpt-image-2 accepts a much wider set; we pick sensible defaults per aspect
// ratio that satisfy OpenAI's constraints (edges are multiples of 16 and the
// long:short ratio is <= 3:1).
const LEGACY_SIZE_BY_RATIO: Record<string, string> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536'
};

const GPT_IMAGE_2_SIZE_BY_RATIO: Record<string, string> = {
  '1:1': '2048x2048',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '16:9': '2048x1152',
  '9:16': '1152x2048',
  '3:1': '2304x768',
  '1:3': '768x2304'
};

const aspectToSize = (apiModel: string, aspect: string): string => {
  if (apiModel === 'gpt-image-2') {
    return GPT_IMAGE_2_SIZE_BY_RATIO[aspect] || '1024x1024';
  }
  return LEGACY_SIZE_BY_RATIO[aspect] || '1024x1024';
};

const fetchToBase64 = async (url: string): Promise<{ base64: string; mime: string }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch image from URL');
  const blob = await res.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  return { base64, mime: blob.type || 'image/png' };
};

export interface OpenAIGenerateOptions {
  /** UI model id: 'openai-2' | 'openai-mini' | 'openai'. Defaults to 'openai'. */
  modelId?: string;
  /** low | medium | high | auto. Defaults to 'auto'. */
  quality?: OpenAIImageQuality;
  systemPrompt?: string;
}

/**
 * Generate an image via OpenAI's GPT Image family (gpt-image-2,
 * gpt-image-1-mini, or gpt-image-1.5). Callers bring their own API key.
 */
export const generateOpenAIImage = async (
  prompt: string,
  config: GenerationConfig,
  apiKey: string,
  options: OpenAIGenerateOptions = {}
): Promise<GeneratedImage> => {
  const apiModel = resolveApiModel(options.modelId);

  if (!apiKey?.trim()) {
    throw new Error(`OpenAI API key is required for ${apiModel}`);
  }

  const size = aspectToSize(apiModel, config.aspectRatio);
  const quality: OpenAIImageQuality = options.quality || 'auto';
  const systemPrompt = options.systemPrompt;

  const fullPrompt = systemPrompt && systemPrompt.trim()
    ? `${systemPrompt.trim()}\n\n${prompt}`
    : prompt;

  const body: Record<string, unknown> = {
    model: apiModel,
    prompt: fullPrompt,
    size
  };
  // Only gpt-image-2 and gpt-image-1-mini accept a `quality` parameter.
  // gpt-image-1.5 rejects it, so we only send it when explicitly set to
  // non-auto on a supported model.
  if (apiModel !== 'gpt-image-1.5' && quality !== 'auto') {
    body.quality = quality;
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    // OpenAI almost always returns JSON on error; fall back to raw text only
    // if parsing fails (proxies, HTML error pages, etc).
    const errText = await response.text();
    let code: string | undefined;
    let errorType: string | undefined;
    let rawMessage = errText;
    try {
      const parsed = JSON.parse(errText);
      const errObj = parsed?.error || parsed;
      code = errObj?.code || undefined;
      errorType = errObj?.type || undefined;
      rawMessage = errObj?.message || errText;
    } catch {
      // Not JSON — keep errText as the raw message.
    }
    const { message, fatal } = describeOpenAIError(response.status, code, errorType, rawMessage);
    throw new OpenAIGenerationError({
      message,
      status: response.status,
      code,
      errorType,
      fatal
    });
  }

  const json = await response.json();
  const data = json?.data?.[0];
  if (!data) {
    throw new Error('OpenAI image generation returned no image data');
  }

  let base64Data: string | undefined;
  let mimeType = 'image/png';
  if (data.b64_json) {
    base64Data = data.b64_json;
  } else if (data.url) {
    const fetched = await fetchToBase64(data.url);
    base64Data = fetched.base64;
    mimeType = fetched.mime;
  } else {
    throw new Error('OpenAI image generation returned neither b64_json nor url');
  }

  const imageUrl = `data:${mimeType};base64,${base64Data}`;

  return {
    imageUrl,
    base64Data: base64Data!,
    mimeType
  };
};

/**
 * Refine an existing raster using OpenAI's image edits endpoint so the model receives the source pixels
 * (text-only /generations refinement tends to produce unrelated new images).
 */
export const refineOpenAIImage = async (
  currentImage: GeneratedImage,
  refinementText: string,
  config: GenerationConfig,
  context: CorrectionAnalysisContext,
  apiKey: string,
  options: OpenAIGenerateOptions = {}
): Promise<GeneratedImage> => {
  const apiModel = resolveApiModel(options.modelId);

  if (!apiKey?.trim()) {
    throw new Error(`OpenAI API key is required for ${apiModel}`);
  }

  const sourceImage = await resolveImageInputForRefinement(currentImage);
  const size = aspectToSize(apiModel, config.aspectRatio);
  const quality: OpenAIImageQuality = options.quality || 'auto';
  const systemPrompt = options.systemPrompt?.trim();

  const editInstructions = buildOpenAiRefineEditPrompt(refinementText, config, context);
  const prompt =
    systemPrompt && systemPrompt.length > 0
      ? `${systemPrompt}\n\n${editInstructions}`
      : editInstructions;

  const formData = new FormData();
  formData.append('model', apiModel);
  formData.append('prompt', prompt);
  formData.append('size', size);
  formData.append('n', '1');

  if (apiModel !== 'gpt-image-1.5' && quality !== 'auto') {
    formData.append('quality', quality);
  }

  if (apiModel === 'gpt-image-1.5' || apiModel === 'gpt-image-1-mini') {
    formData.append('input_fidelity', 'high');
  }

  const blob = base64ToImageBlob(sourceImage.base64Data, sourceImage.mimeType);
  const ext =
    sourceImage.mimeType.includes('jpeg') || sourceImage.mimeType.includes('jpg')
      ? 'jpg'
      : 'png';
  formData.append('image[]', blob, `source.${ext}`);

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    let code: string | undefined;
    let errorType: string | undefined;
    let rawMessage = errText;
    try {
      const parsed = JSON.parse(errText);
      const errObj = parsed?.error || parsed;
      code = errObj?.code || undefined;
      errorType = errObj?.type || undefined;
      rawMessage = errObj?.message || errText;
    } catch {
      // keep errText
    }
    const { message, fatal } = describeOpenAIError(response.status, code, errorType, rawMessage);
    throw new OpenAIGenerationError({
      message,
      status: response.status,
      code,
      errorType,
      fatal
    });
  }

  const json = await response.json();
  const data = json?.data?.[0];
  if (!data) {
    throw new Error('OpenAI image edit returned no image data');
  }

  let base64Data: string | undefined;
  let mimeType = 'image/png';
  if (data.b64_json) {
    base64Data = data.b64_json;
  } else if (data.url) {
    const fetched = await fetchToBase64(data.url);
    base64Data = fetched.base64;
    mimeType = fetched.mime;
  } else {
    throw new Error('OpenAI image edit returned neither b64_json nor url');
  }

  const imageUrl = `data:${mimeType};base64,${base64Data}`;

  return {
    imageUrl,
    base64Data: base64Data!,
    mimeType
  };
};

/** Fast vision model for image audit JSON (not GPT Image). BYOK OpenAI key from Settings. */
const CORRECTION_VISION_CHAT_MODEL = 'gpt-4o-mini';

/**
 * Same structured correction plan as Gemini's analyzer, via Chat Completions + vision.
 */
export const analyzeImageForCorrectionPromptOpenAI = async (
  currentImage: GeneratedImage,
  config: GenerationConfig,
  context: CorrectionAnalysisContext,
  apiKey: string,
  systemPrompt?: string
): Promise<ImageCorrectionPlan> => {
  if (!apiKey?.trim()) {
    throw new Error('OpenAI API key required for image analysis.');
  }

  const sourceImage = await resolveImageInputForRefinement(currentImage);
  const instructions = buildCorrectionAuditUserPrompt(config, context);
  const dataUrl = `data:${sourceImage.mimeType};base64,${sourceImage.base64Data}`;

  const messages: Record<string, unknown>[] = [];
  if (systemPrompt?.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: instructions },
      {
        type: 'image_url',
        image_url: {
          url: dataUrl,
          detail: 'low',
        },
      },
    ],
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: CORRECTION_VISION_CHAT_MODEL,
      messages,
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let code: string | undefined;
    let errorType: string | undefined;
    let rawMessage = errText;
    try {
      const parsed = JSON.parse(errText);
      const errObj = parsed?.error || parsed;
      code = errObj?.code || undefined;
      errorType = errObj?.type || undefined;
      rawMessage = errObj?.message || errText;
    } catch {
      // keep errText
    }
    const { message, fatal } = describeOpenAIError(response.status, code, errorType, rawMessage);
    throw new OpenAIGenerationError({
      message,
      status: response.status,
      code,
      errorType,
      fatal,
    });
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = json?.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    throw new Error('OpenAI returned no analysis text.');
  }

  let parsed: Partial<ImageCorrectionPlan>;
  try {
    parsed = parseStructuredJsonFromModelText<Partial<ImageCorrectionPlan>>(text);
  } catch {
    throw new Error(
      'Could not read the analysis response. Try Run analysis again, or shorten your Settings system prompt if it conflicts with JSON output.'
    );
  }

  return {
    analysisSummary: (parsed.analysisSummary || '').trim(),
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.map((issue) => String(issue).trim()).filter(Boolean)
      : [],
    fixPrompt: (parsed.fixPrompt || '').trim(),
  };
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:')) {
        reject(new Error('Unexpected image read result.'));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });

const callOpenAIVisionJson = async (
  apiKey: string,
  systemPrompt: string | undefined,
  instruction: string,
  imageDataUrl: string
): Promise<string> => {
  const messages: Record<string, unknown>[] = [];
  if (systemPrompt?.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: instruction },
      { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
    ],
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: CORRECTION_VISION_CHAT_MODEL,
      messages,
      response_format: { type: 'json_object' },
      max_completion_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let code: string | undefined;
    let errorType: string | undefined;
    let rawMessage = errText;
    try {
      const parsed = JSON.parse(errText);
      const errObj = parsed?.error || parsed;
      code = errObj?.code || undefined;
      errorType = errObj?.type || undefined;
      rawMessage = errObj?.message || errText;
    } catch { /* keep errText */ }
    const { message, fatal } = describeOpenAIError(response.status, code, errorType, rawMessage);
    throw new OpenAIGenerationError({ message, status: response.status, code, errorType, fatal });
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = json?.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error('OpenAI returned no analysis text.');
  return text;
};

/**
 * OpenAI vision fallback for the prompt-drop "Use image style" action.
 * Mirrors the JSON shape returned by Gemini's `analyzeImageForOption(..., 'style')`.
 */
export const analyzeImageStyleOpenAI = async (
  file: File,
  apiKey: string,
  systemPrompt?: string
): Promise<{ name: string; description: string }> => {
  if (!apiKey?.trim()) {
    throw new Error('OpenAI API key required for image style analysis.');
  }

  const dataUrl = await fileToDataUrl(file);
  const instruction = `Analyze the visual style of the attached image.

Return strict JSON shaped exactly:
{
  "name": "<short, catchy style name, e.g. Neon Cyberpunk>",
  "description": "<one paragraph (1-3 sentences) describing lighting, texture, line weight, composition cues that could be reused to generate similar images>"
}

Respond with ONLY the JSON object — no markdown, no preamble.`;

  const text = await callOpenAIVisionJson(apiKey, systemPrompt, instruction, dataUrl);
  let parsed: { name?: unknown; description?: unknown };
  try {
    parsed = parseStructuredJsonFromModelText<{ name?: unknown; description?: unknown }>(text);
  } catch {
    throw new Error('Could not read OpenAI style analysis response.');
  }

  return {
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Image style',
    description:
      typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.trim()
        : 'Use the dropped image as a visual style reference.',
  };
};

/**
 * OpenAI vision fallback for the prompt-drop "Generate content prompt" action.
 * Returns a single paragraph describing only the content (toolbar menus stay
 * authoritative for layout, style, palette, aspect ratio).
 */
export const describeImageContentPromptOpenAI = async (
  base64Data: string,
  mimeType: string,
  apiKey: string,
  systemPrompt?: string
): Promise<string> => {
  if (!apiKey?.trim()) {
    throw new Error('OpenAI API key required to describe image content.');
  }

  const dataUrl = `data:${mimeType || 'image/png'};base64,${base64Data}`;
  const instruction = `Describe only the content of the attached image as a prompt fragment for an image-generation tool.

Include:
- Main subject matter and important objects
- Visible text, labels, logos, or symbols if present
- Concrete attributes needed to identify the content (species, product type, clothing, props, setting category, action)
- Relationships between subjects only when they matter to the idea

Exclude anything that is controlled by separate toolbar menus:
- No layout, composition, camera angle, framing, depth of field, or aspect ratio
- No visual style, art medium, rendering technique, texture, lighting mood, or color palette
- No brand/style adjectives such as minimalist, photorealistic, hand-drawn, cinematic, neon, isometric, poster, editorial, infographic, or 3D

Return strict JSON shaped exactly:
{ "prompt": "<one concise paragraph>" }

Respond with ONLY the JSON object — no markdown, no preamble.`;

  const text = await callOpenAIVisionJson(apiKey, systemPrompt, instruction, dataUrl);
  let parsed: { prompt?: unknown };
  try {
    parsed = parseStructuredJsonFromModelText<{ prompt?: unknown }>(text);
  } catch {
    throw new Error('Could not read OpenAI content prompt response.');
  }

  const promptText = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
  if (!promptText) {
    throw new Error('OpenAI returned no content prompt.');
  }
  return promptText;
};

/** Text-only chat model for prompt expansion (not GPT Image). */
const EXPAND_PROMPT_CHAT_MODEL = 'gpt-4o-mini';

/**
 * Expand short refine text using OpenAI Chat Completions (same instruction block as Gemini Flash).
 */
export const expandPromptOpenAI = async (
  prompt: string,
  config: GenerationConfig,
  context: ExpandPromptContext,
  apiKey: string,
  userSystemPrompt?: string
): Promise<string> => {
  if (!apiKey?.trim()) {
    throw new Error('OpenAI API key required to expand prompts.');
  }

  const expansionInstructions = buildExpandPromptInstructions(config, context);
  const userContent = `${expansionInstructions}

Original prompt to expand:
${prompt}

Respond with ONLY the expanded image-generation prompt as plain text (2–4 vivid sentences). No title line, no preamble, no markdown code fences.`;

  const messages: Record<string, unknown>[] = [];
  if (userSystemPrompt?.trim()) {
    messages.push({ role: 'system', content: userSystemPrompt.trim() });
  }
  messages.push({ role: 'user', content: userContent });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: EXPAND_PROMPT_CHAT_MODEL,
      messages,
      max_completion_tokens: 2048,
      temperature: 0.75,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let code: string | undefined;
    let errorType: string | undefined;
    let rawMessage = errText;
    try {
      const parsed = JSON.parse(errText);
      const errObj = parsed?.error || parsed;
      code = errObj?.code || undefined;
      errorType = errObj?.type || undefined;
      rawMessage = errObj?.message || errText;
    } catch {
      // keep errText
    }
    const { message, fatal } = describeOpenAIError(response.status, code, errorType, rawMessage);
    throw new OpenAIGenerationError({
      message,
      status: response.status,
      code,
      errorType,
      fatal,
    });
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  let text = json?.choices?.[0]?.message?.content?.trim() || '';
  if (!text) {
    throw new Error('OpenAI returned no expanded prompt.');
  }
  const fence = /^```(?:\w+)?\s*\n([\s\S]*?)```\s*$/m.exec(text);
  if (fence) text = fence[1].trim();
  return text;
};
