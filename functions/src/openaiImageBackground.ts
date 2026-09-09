/**
 * OpenAI Images API `background` for GPT Image models that support alpha.
 * Docs: gpt-image-2 and gpt-image-2.5-* accept auto | opaque | transparent.
 */

export type OpenAIImageBackground = "auto" | "opaque" | "transparent";

/** UI / requested model ids that may send `background`. */
export const supportsOpenAIBackground = (modelId: string): boolean =>
  modelId === "openai-2" ||
  modelId === "openai-2.5" ||
  modelId === "openai-flare" ||
  modelId === "openrouter:openai/gpt-image-2" ||
  /(?:^|\/)gpt-image-2(?:$|[.-])/.test(modelId);

/** Native OpenAI API model ids that accept `background`. */
export const supportsOpenAIBackgroundApiModel = (apiModel: string): boolean =>
  apiModel === "gpt-image-2" || apiModel.startsWith("gpt-image-2.5-");

/** OpenRouter model slugs that accept `background`. */
export const supportsOpenAIBackgroundOpenRouterSlug = (modelSlug: string): boolean =>
  modelSlug === "openai/gpt-image-2" ||
  modelSlug.endsWith("/gpt-image-2") ||
  /gpt-image-2\.5/.test(modelSlug);

export const normalizeOpenAIImageBackground = (
  value: string | null | undefined,
): OpenAIImageBackground =>
  value === "opaque" || value === "transparent" ? value : "auto";

export const TRANSPARENCY_PROMPT_HINT =
  "Use a fully transparent background (alpha). Do not paint a backdrop, scene, floor, sky, or solid fill behind the subject.";
