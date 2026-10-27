import type { AiAssistBackend } from "./aiAssistBackend";

// Paid standard rates per million tokens, including thinking in output:
// https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
// https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash
// Alias family mapping: https://ai.google.dev/gemini-api/docs/models
// gemini-flash-latest resolves to 3.8 Flash; 3.5 (routed to 3.6) shares these rates.
const knownModel = (model: string): boolean =>
  /^(gemini-flash-latest|gemini-3\.[568]-flash(?:-\d{3})?)$/.test(model);

export function geminiAssistCost(input: {
  backend: AiAssistBackend;
  location?: string;
  model: string;
  modelVersion?: string;
  requestedAt: number;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}): { actualCostUsd: number; unknownModel: boolean; inputRate: number; outputRate: number } {
  const model = input.modelVersion && knownModel(input.modelVersion) ? input.modelVersion : input.model;
  const unknownModel = !knownModel(model);
  const later = input.requestedAt >= Date.parse("2027-01-01T00:00:00Z");
  const regional = input.backend === "vertex" && input.location !== "global";
  // Unknown models use the highest rates across all dates and endpoint types.
  const inputRate = unknownModel ? 1.65 : (regional ? 0.825 : 0.75) * (later ? 2 : 1);
  const outputRate = unknownModel ? 8.25 : (regional ? 4.125 : 3.75) * (later ? 2 : 1);
  const usage = input.usage;
  return {
    actualCostUsd: ((usage?.promptTokenCount ?? 0) * inputRate
      + ((usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0)) * outputRate) / 1_000_000,
    unknownModel, inputRate, outputRate,
  };
}
