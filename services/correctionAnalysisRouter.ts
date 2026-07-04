import type { User } from '../types';
import { OPENROUTER_MODEL_PREFIX } from '../constants';

const normalizeStoredApiKey = (value: string): string =>
  value.replace(/^\uFEFF/, '').trim();

type ApiKeyProvider = 'gemini' | 'openai' | 'openrouter';

const getProviderForModel = (modelId: string): ApiKeyProvider | undefined => {
  if (
    modelId === 'gemini' ||
    modelId === 'gemini-3.1-flash-image-preview' ||
    modelId === 'gemini-3.1-flash-lite-image' ||
    modelId === 'gemini-svg'
  ) {
    return 'gemini';
  }
  if (modelId === 'openai' || modelId === 'openai-2' || modelId === 'openai-mini') {
    return 'openai';
  }
  if (modelId.startsWith(OPENROUTER_MODEL_PREFIX)) {
    return 'openrouter';
  }
  return undefined;
};

// Real Gemini keys start with `AIza` and are 39 characters long. Real OpenAI
// keys start with `sk-` (project keys ~164 chars). OpenRouter keys start with
// `sk-or-`. We use length bounds so a pasted .env file or config blob can't
// slip through as a "valid" key.
const isLikelyOpenAIKey = (value: string): boolean =>
  /^sk-[A-Za-z0-9_-]+$/.test(value) && value.length >= 20 && value.length <= 256 &&
  !value.startsWith('sk-or-');
export const isLikelyOpenRouterKey = (value: string): boolean =>
  /^sk-or-[A-Za-z0-9_-]+$/.test(value) && value.length >= 20 && value.length <= 256;
const isLikelyGoogleApiKey = (value: string): boolean =>
  /^AIza[A-Za-z0-9_-]+$/.test(value) && value.length >= 30 && value.length <= 60;

const normalizeProviderKey = (
  value: string | undefined,
  provider: ApiKeyProvider
): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const key = normalizeStoredApiKey(value);
  if (!key) return undefined;

  // Strict provider check — only accept keys that look like the right provider's
  // format. Anything else (cross-provider paste, .env dump, Firebase config
  // blob, raw JSON, etc.) is rejected so the resolver can fall through to the
  // next slot instead of sending garbage to the API.
  if (provider === 'gemini') return isLikelyGoogleApiKey(key) ? key : undefined;
  if (provider === 'openai') return isLikelyOpenAIKey(key) ? key : undefined;
  if (provider === 'openrouter') return isLikelyOpenRouterKey(key) ? key : undefined;
  return undefined;
};

/**
 * BYOK resolution (per-model override, then shared Gemini / OpenAI slots).
 * Kept in sync with App `getApiKeyForModel` / Settings trimming behavior.
 */
export function getApiKeyForModelFromUser(
  user: User | null | undefined,
  modelId: string
): string | undefined {
  if (!user) return undefined;
  const provider = getProviderForModel(modelId);
  const slot = user.preferences.apiKeys?.[modelId];
  if (provider) {
    const t = normalizeProviderKey(slot, provider);
    if (t) return t;
  }

  if (provider === 'gemini') {
    const shared = normalizeProviderKey(user.preferences.apiKeys?.gemini, 'gemini');
    if (shared) return shared;
    const legacy = normalizeProviderKey(user.preferences.geminiApiKey, 'gemini');
    if (legacy) return legacy;
    // Nano Banana Pro — if only NB2 per-model override exists, use it (same Google project/key).
    if (modelId === 'gemini') {
      const nb2 = normalizeProviderKey(user.preferences.apiKeys?.['gemini-3.1-flash-image-preview'], 'gemini');
      if (nb2) return nb2;
    }
  }
  if (provider === 'openai') {
    const k = normalizeProviderKey(user.preferences.apiKeys?.openai, 'openai');
    if (k) return k;
  }
  if (provider === 'openrouter') {
    const k = normalizeProviderKey(user.preferences.apiKeys?.openrouter, 'openrouter');
    if (k) return k;
  }
  return undefined;
}

/** The user's shared OpenRouter key, if a valid-looking one is configured. */
export function getOpenRouterKeyFromUser(user: User | null | undefined): string | undefined {
  return normalizeProviderKey(user?.preferences.apiKeys?.openrouter, 'openrouter');
}

/**
 * Any Google Gemini key usable for Flash/vision helper calls (option image analyze,
 * dropped-image style/content). Matches toolbar resolution plus SVG-only accounts.
 */
export function getGeminiApiKeyForAnalysis(user: User | null | undefined): string | undefined {
  const shared = getApiKeyForModelFromUser(user, 'gemini');
  if (shared) return shared;
  return getApiKeyForModelFromUser(user, 'gemini-svg');
}

/**
 * Picks OpenAI vs Gemini BYOK for auxiliary calls (Run analysis, Expand prompt):
 * prefer the same provider as the toolbar when that key exists; otherwise
 * whichever key is configured.
 */
export function resolveAuxiliaryByokProvider(
  selectedModel: string,
  getApiKeyForModel: (modelId: string) => string | undefined
): { provider: 'gemini' | 'openai'; apiKey: string } | null {
  const openaiKey = getApiKeyForModel('openai');
  const geminiKey = getApiKeyForModel('gemini');

  const openaiToolbar =
    selectedModel === 'openai' ||
    selectedModel === 'openai-2' ||
    selectedModel === 'openai-mini';
  const geminiToolbar =
    selectedModel === 'gemini' ||
    selectedModel === 'gemini-3.1-flash-image-preview' ||
    selectedModel === 'gemini-3.1-flash-lite-image' ||
    selectedModel === 'gemini-svg';

  if (openaiToolbar && openaiKey) return { provider: 'openai', apiKey: openaiKey };
  if (geminiToolbar && geminiKey) return { provider: 'gemini', apiKey: geminiKey };
  if (geminiKey) return { provider: 'gemini', apiKey: geminiKey };
  if (openaiKey) return { provider: 'openai', apiKey: openaiKey };
  return null;
}
