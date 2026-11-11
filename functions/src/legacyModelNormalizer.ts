// Retired selections migrate in memory at input boundaries.
const legacySlug = 'openai/' + 'gpt-image-' + '2';
const successorSlug = 'openai/gpt-image-2.6-sunburst';

export const normalizeLegacyOpenRouterSlug = (slug: string): string =>
  slug === legacySlug ? successorSlug : slug;

export const normalizeLegacyModelId = (modelId: string): string => {
  if (modelId === 'openai-2') return 'openai-2.6';
  if (modelId === legacySlug || modelId === `openrouter:${legacySlug}`) return `openrouter:${successorSlug}`;
  return modelId;
};

export const normalizeLegacyOpenRouterModels = (slugs: string[]): string[] =>
  Array.from(new Set(slugs.map(normalizeLegacyOpenRouterSlug)));
