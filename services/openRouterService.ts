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

  const base: Record<string, unknown> = {
    model: options.modelSlug,
    prompt: fullPrompt,
    output_format: 'png'
  };

  // Aspect handling, verified empirically (Seedream 4.5, July 2026):
  //  - a bare `aspect_ratio` is silently IGNORED by some providers → square
  //    output despite a 16:9 request;
  //  - `resolution: '2K'` maps to dims below some providers' minimum pixel
  //    count (Seedream requires ≥3.69MP) → 400;
  //  - an explicit pixel `size` works.
  // So: try an explicit ~4MP size for the requested ratio, fall back to a
  // ~2MP size for providers with lower maximums, then to the bare
  // `aspect_ratio` hint. Failed size attempts return 400 and don't bill.
  const SIZE_BY_ASPECT: Record<string, [string, string]> = {
    '1:1': ['2048x2048', '1024x1024'],
    '16:9': ['2560x1440', '1920x1080'],
    '9:16': ['1440x2560', '1080x1920'],
    '4:3': ['2304x1728', '1600x1200'],
    '3:4': ['1728x2304', '1200x1600'],
    '3:2': ['2448x1632', '1728x1152'],
    '2:3': ['1632x2448', '1152x1728'],
    '5:4': ['2160x1728', '1600x1280'],
    '4:5': ['1728x2160', '1280x1600'],
    '21:9': ['2940x1260', '2520x1080'],
    '9:21': ['1260x2940', '1080x2520'],
    '2:1': ['2720x1360', '2048x1024'],
    '1:2': ['1360x2720', '1024x2048'],
    '3:1': ['3330x1110', '2496x832'],
  };
  const aspect = (config.aspectRatio || '')
    .trim()
    .replace(/_/g, ':')
    .replace(/\s+/g, '');
  const sizes = SIZE_BY_ASPECT[aspect];
  const attempts: Record<string, unknown>[] = [];
  if (sizes) {
    attempts.push({ ...base, size: sizes[0] }, { ...base, size: sizes[1] });
  }
  attempts.push(aspect ? { ...base, aspect_ratio: aspect } : { ...base });

  let json: any = null;
  let lastError = '';
  for (const body of attempts) {
    const resp = await fetch(`${OPENROUTER_API_BASE}/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'X-Title': 'PixTaffy'
      },
      body: JSON.stringify(body)
    });
    json = await resp.json().catch(() => null);
    if (resp.ok) break;
    lastError = json?.error?.message || json?.error || `HTTP ${resp.status}`;
    json = null;
    // Only size/parameter rejections are worth retrying with the next shape;
    // auth/quota/moderation errors would fail every attempt identically.
    if (resp.status !== 400) break;
  }
  if (!json) {
    throw new Error(`OpenRouter (${options.modelSlug}): ${lastError || 'request failed'}`);
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
