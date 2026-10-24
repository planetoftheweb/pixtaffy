import type { User } from '../types';
import { OPENROUTER_MODEL_PREFIX } from '../constants';

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
  if (
    modelId === 'openai' ||
    modelId === 'openai-2' ||
    modelId === 'openai-2.5' ||
    modelId === 'openai-flare' ||
    modelId === 'openai-mini'
  ) {
    return 'openai';
  }
  if (modelId.startsWith(OPENROUTER_MODEL_PREFIX)) {
    return 'openrouter';
  }
  return undefined;
};

/** A routing marker, never a provider credential. */
export function getApiKeyForModelFromUser(user: User | null | undefined, modelId: string): string | undefined {
  const provider = getProviderForModel(modelId);
  const status = user?.preferences.apiKeyStatus || {};
  const slots = [modelId, provider || '', ...(modelId === 'gemini' ? ['gemini-3.1-flash-image-preview', 'gemini-svg'] : [])];
  return slots.some(slot => status[slot]?.hasKey) ? 'server-managed' : undefined;
}
export function getOpenRouterKeyFromUser(user: User | null | undefined): string | undefined {
  return user?.preferences.apiKeyStatus?.openrouter?.hasKey ? 'server-managed' : undefined;
}
export function getGeminiApiKeyForAnalysis(user: User | null | undefined): string | undefined {
  return getApiKeyForModelFromUser(user, 'gemini') || getApiKeyForModelFromUser(user, 'gemini-svg');
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
    selectedModel === 'openai-2.5' ||
    selectedModel === 'openai-flare' ||
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
