import { GenerationConfig, GeneratedImage } from '../types';
import { OPENROUTER_MODEL_PREFIX } from '../constants';

/**
 * OpenRouter image generation (BYOK). Uses the dedicated Images API
 * (https://openrouter.ai/docs — POST /api/v1/images), which routes to 30+
 * image models (Seedream, FLUX, Recraft, Riverflow, …) with one key.
 *
 * Model ids in the app are namespaced `openrouter:<vendor/slug>` — see
 * OPENROUTER_MODEL_PREFIX in constants.ts. Direct provider keys always win
 * over OpenRouter routing (enforced at the roster-merge in App.tsx).
 */

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

export const openRouterSlugFromModelId = (modelId: string): string | undefined =>
  modelId.startsWith(OPENROUTER_MODEL_PREFIX)
    ? modelId.slice(OPENROUTER_MODEL_PREFIX.length)
    : undefined;

export interface OpenRouterImageModel {
  slug: string;
  name: string;
}

const MODEL_LIST_CACHE_KEY = 'brandoit_openrouter_image_models_v1';
const MODEL_LIST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * List of image-capable model slugs on OpenRouter (public endpoint, no key
 * needed). Cached for 24h; used by Settings to validate custom slugs.
 */
export const listOpenRouterImageModels = async (): Promise<OpenRouterImageModel[]> => {
  try {
    const raw = localStorage.getItem(MODEL_LIST_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; models: OpenRouterImageModel[] };
      if (cached?.models?.length && Date.now() - cached.at < MODEL_LIST_TTL_MS) {
        return cached.models;
      }
    }
  } catch { /* cache miss — fall through to fetch */ }

  const resp = await fetch(`${OPENROUTER_API_BASE}/images/models`);
  if (!resp.ok) throw new Error(`OpenRouter model list failed (HTTP ${resp.status})`);
  const json = await resp.json();
  const data: any[] = Array.isArray(json) ? json : json?.data || [];
  const models: OpenRouterImageModel[] = data
    .filter((m) => m && typeof m.id === 'string')
    .map((m) => ({ slug: m.id, name: typeof m.name === 'string' ? m.name : m.id }));
  try {
    localStorage.setItem(MODEL_LIST_CACHE_KEY, JSON.stringify({ at: Date.now(), models }));
  } catch { /* quota — skip caching */ }
  return models;
};

interface OpenRouterGenerateOptions {
  modelSlug: string;
  systemPrompt?: string;
}

export const generateOpenRouterImage = async (
  prompt: string,
  config: GenerationConfig,
  apiKey: string,
  options: OpenRouterGenerateOptions
): Promise<GeneratedImage> => {
  if (!apiKey?.trim()) {
    throw new Error(`OpenRouter API key is required for ${options.modelSlug}`);
  }

  const fullPrompt = options.systemPrompt?.trim()
    ? `${options.systemPrompt.trim()}\n\n${prompt}`
    : prompt;

  const body: Record<string, unknown> = {
    model: options.modelSlug,
    prompt: fullPrompt,
    output_format: 'png'
  };
  if (config.aspectRatio) body.aspect_ratio = config.aspectRatio;

  const resp = await fetch(`${OPENROUTER_API_BASE}/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'X-Title': 'BranDoIt'
    },
    body: JSON.stringify(body)
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const message =
      json?.error?.message || json?.error || `HTTP ${resp.status}`;
    throw new Error(`OpenRouter (${options.modelSlug}): ${message}`);
  }

  const entry = json?.data?.[0];
  const base64Data: string | undefined = entry?.b64_json;
  if (!base64Data) {
    throw new Error(`OpenRouter (${options.modelSlug}) returned no image data`);
  }
  const mimeType: string = entry?.media_type || 'image/png';

  return {
    imageUrl: `data:${mimeType};base64,${base64Data}`,
    base64Data,
    mimeType,
    modelId: `${OPENROUTER_MODEL_PREFIX}${options.modelSlug}`
  };
};
