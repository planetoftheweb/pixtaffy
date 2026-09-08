export interface PaidModelPrice {
  requestedModelId: string;
  openRouterModelId: string;
  milliCredits: 1_000 | 2_000 | 3_000;
  costCeilingUsd: number;
  label: string;
}

const PRICES: Record<string, Omit<PaidModelPrice, "requestedModelId">> = {
  "openrouter:bytedance-seed/seedream-4.5": {
    openRouterModelId: "bytedance-seed/seedream-4.5",
    milliCredits: 1_000,
    costCeilingUsd: 0.07,
    label: "Seedream 4.5",
  },
  "openrouter:x-ai/grok-imagine-image-quality": {
    openRouterModelId: "x-ai/grok-imagine-image-quality",
    milliCredits: 1_000,
    costCeilingUsd: 0.07,
    label: "Grok Imagine",
  },
  "openrouter:black-forest-labs/flux.2-pro": {
    openRouterModelId: "black-forest-labs/flux.2-pro",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "FLUX.2 Pro",
  },
  "openrouter:recraft/recraft-v4.1-pro": {
    openRouterModelId: "recraft/recraft-v4.1-pro",
    milliCredits: 3_000,
    costCeilingUsd: 0.22,
    label: "Recraft V4.1 Pro",
  },
  "openrouter:google/gemini-3-pro-image": {
    openRouterModelId: "google/gemini-3-pro-image",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "Nano Banana Pro",
  },
  "openrouter:openai/gpt-image-2": {
    openRouterModelId: "openai/gpt-image-2",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "GPT Image 2",
  },
  "gemini": {
    openRouterModelId: "google/gemini-3-pro-image",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "Nano Banana Pro",
  },
  "gemini-3.1-flash-image-preview": {
    openRouterModelId: "google/gemini-3.1-flash-image-preview",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "Nano Banana 2",
  },
  "gemini-3.1-flash-lite-image": {
    openRouterModelId: "google/gemini-3.1-flash-image-preview",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "Nano Banana 2 Lite",
  },
  // Credit-funded fulfillment still uses OpenRouter gpt-image-2 until OR publishes
  // gpt-image-2.5-sunburst / gpt-image-2.5-flare. BYOK uses the native API ids.
  "openai-2.5": {
    openRouterModelId: "openai/gpt-image-2",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "GPT Image 2.5",
  },
  "openai-flare": {
    openRouterModelId: "openai/gpt-image-2",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "GPT Image 2.5 Flare",
  },
  "openai-2": {
    openRouterModelId: "openai/gpt-image-2",
    milliCredits: 2_000,
    costCeilingUsd: 0.14,
    label: "GPT Image 2",
  },
};

export const paidModelPrices = (): PaidModelPrice[] =>
  Object.entries(PRICES).map(([requestedModelId, price]) => ({ requestedModelId, ...price }));

export const getPaidModelPrice = (modelId: string): PaidModelPrice | null => {
  const price = PRICES[modelId];
  return price ? { requestedModelId: modelId, ...price } : null;
};

export type AiAssistAction =
  | "expand_prompt"
  | "ai_name"
  | "image_analysis"
  | "correction_analysis"
  | "style_extraction"
  | "region_detection"
  | "image_description"
  | "brand_guidelines_image"
  | "brand_guidelines_pdf";

export const AI_ASSIST_MILLICREDITS: Record<AiAssistAction, number> = {
  expand_prompt: 100,
  ai_name: 100,
  image_analysis: 200,
  correction_analysis: 200,
  style_extraction: 200,
  region_detection: 200,
  image_description: 200,
  brand_guidelines_image: 200,
  brand_guidelines_pdf: 500,
};
