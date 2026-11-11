import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeOpenAIImageBackground,
  supportsOpenAIBackground,
  supportsOpenAIBackgroundApiModel,
  supportsOpenAIBackgroundOpenRouterSlug,
} from "./openaiImageBackground";

describe("supportsOpenAIBackground", () => {
  it("includes GPT Image 2 and 2.5 family UI ids", () => {
    assert.equal(supportsOpenAIBackground("openai-2.6"), true);
    assert.equal(supportsOpenAIBackground("openai-2.6-flare"), true);
    assert.equal(supportsOpenAIBackground("openai-2"), true);
    assert.equal(supportsOpenAIBackground("openai-2.5"), true);
    assert.equal(supportsOpenAIBackground("openai-flare"), true);
  });

  it("excludes mini and 1.5", () => {
    assert.equal(supportsOpenAIBackground("openai-mini"), false);
    assert.equal(supportsOpenAIBackground("openai"), false);
  });
});

describe("supportsOpenAIBackgroundApiModel", () => {
  it("accepts 2.5 and 2.6 API ids and rejects retired API ids", () => {
    assert.equal(supportsOpenAIBackgroundApiModel("gpt-image-2.6-sunburst"), true);
    assert.equal(supportsOpenAIBackgroundApiModel("gpt-image-2.6-flare"), true);
    assert.equal(supportsOpenAIBackgroundApiModel("gpt-image-2"), false);
    assert.equal(supportsOpenAIBackgroundApiModel("gpt-image-2.5-sunburst"), true);
    assert.equal(supportsOpenAIBackgroundApiModel("gpt-image-2.5-flare"), true);
    assert.equal(supportsOpenAIBackgroundApiModel("gpt-image-1-mini"), false);
    assert.equal(supportsOpenAIBackgroundApiModel("gpt-image-1.5"), false);
  });
});

describe("openRouter + normalize", () => {
  it("normalizes retired OpenRouter slugs before checking support", () => {
    assert.equal(supportsOpenAIBackgroundOpenRouterSlug("openai/gpt-image-2"), true);
    assert.equal(supportsOpenAIBackground("openrouter:openai/gpt-image-2"), true);
    assert.equal(supportsOpenAIBackgroundOpenRouterSlug("openai/gpt-image-2.6-sunburst"), true);
    assert.equal(supportsOpenAIBackgroundOpenRouterSlug("openai/gpt-image-2.6-flare"), true);
  });

  it("normalizes background values", () => {
    assert.equal(normalizeOpenAIImageBackground("transparent"), "transparent");
    assert.equal(normalizeOpenAIImageBackground("opaque"), "opaque");
    assert.equal(normalizeOpenAIImageBackground("auto"), "auto");
    assert.equal(normalizeOpenAIImageBackground("nope"), "auto");
    assert.equal(normalizeOpenAIImageBackground(undefined), "auto");
  });
});
