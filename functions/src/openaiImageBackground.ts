import { normalizeLegacyModelId, normalizeLegacyOpenRouterSlug } from './legacyModelNormalizer';
/**
 * OpenAI Images API `background` for GPT Image models that support alpha.
 * Docs: gpt-image-2.6-* and gpt-image-2.5-* accept auto | opaque | transparent.
 */

export type OpenAIImageBackground = "auto" | "opaque" | "transparent";

/** UI / requested model ids that may send `background`. */
export const supportsOpenAIBackground = (modelId: string): boolean => {
  modelId = normalizeLegacyModelId(modelId);
  return ['openai-2.6', 'openai-2.6-flare', 'openai-2.5', 'openai-flare'].includes(modelId) ||
    ['gpt-image-2.5-', 'gpt-image-2.6-'].some(prefix => modelId.includes(prefix));
};

/** Native OpenAI API model ids that accept `background`. */
export const supportsOpenAIBackgroundApiModel = (apiModel: string): boolean =>
  (apiModel.startsWith("gpt-image-2.5-") || apiModel.startsWith("gpt-image-2.6-"));

/** OpenRouter model slugs that accept `background`. */
export const supportsOpenAIBackgroundOpenRouterSlug = (modelSlug: string): boolean =>
  ['openai/gpt-image-2.5-', 'openai/gpt-image-2.6-'].some(prefix => normalizeLegacyOpenRouterSlug(modelSlug).startsWith(prefix));

export const normalizeOpenAIImageBackground = (
  value: string | null | undefined,
): OpenAIImageBackground =>
  value === "opaque" || value === "transparent" ? value : "auto";

export const TRANSPARENCY_PROMPT_HINT =
  "Use a fully transparent background (alpha). Do not paint a backdrop, scene, floor, sky, or solid fill behind the subject.";
