import { normalizeLegacyModelId } from '../utils/legacyModelNormalizer';
/**
 * OpenAI Images API `background` for GPT Image models that support alpha.
 * Docs: gpt-image-2.6-* and gpt-image-2.5-* accept auto | opaque | transparent.
 * Transparent output must use png or webp (not jpeg).
 */

export type OpenAIImageBackground = 'auto' | 'opaque' | 'transparent';

export const OPENAI_BACKGROUND_VALUES: readonly OpenAIImageBackground[] = [
  'auto',
  'opaque',
  'transparent',
] as const;

export const OPENAI_BACKGROUND_SET = new Set<OpenAIImageBackground>(OPENAI_BACKGROUND_VALUES);

/** UI model ids that expose Background and may send `background` to the API. */
export const supportsOpenAIBackground = (modelId: string): boolean => {
  modelId = normalizeLegacyModelId(modelId);
  return ['openai-2.6', 'openai-2.6-flare', 'openai-2.5', 'openai-flare'].includes(modelId) ||
    ['gpt-image-2.5-', 'gpt-image-2.6-'].some(prefix => modelId.includes(prefix));
};

/** Native OpenAI API model ids that accept `background`. */
export const supportsOpenAIBackgroundApiModel = (apiModel: string): boolean =>
  (apiModel.startsWith('gpt-image-2.5-') || apiModel.startsWith('gpt-image-2.6-'));

export const normalizeOpenAIImageBackground = (
  value: string | null | undefined
): OpenAIImageBackground =>
  value === 'opaque' || value === 'transparent' ? value : 'auto';

export const TRANSPARENCY_PROMPT_HINT =
  'Use a fully transparent background (alpha). Do not paint a backdrop, scene, floor, sky, or solid fill behind the subject.';
