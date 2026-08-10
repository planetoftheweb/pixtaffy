import test from "node:test";
import assert from "node:assert/strict";
import { AI_ASSIST_MILLICREDITS, getPaidModelPrice } from "./pricing";

test("custom OpenRouter models remain BYOK only", () => {
  assert.equal(getPaidModelPrice("openrouter:some/new-model"), null);
});

test("curated models use the intended 1, 2, and 3-credit bands", () => {
  assert.equal(getPaidModelPrice("openrouter:bytedance-seed/seedream-4.5")?.milliCredits, 1_000);
  assert.equal(getPaidModelPrice("gemini-3.1-flash-image-preview")?.milliCredits, 2_000);
  assert.equal(getPaidModelPrice("openai-2")?.milliCredits, 2_000);
  assert.equal(getPaidModelPrice("openrouter:recraft/recraft-v4.1-pro")?.milliCredits, 3_000);
});

test("credit-pack image estimates round down against the generation bands", () => {
  const standard = getPaidModelPrice("openrouter:bytedance-seed/seedream-4.5")?.milliCredits;
  const pro = getPaidModelPrice("openrouter:black-forest-labs/flux.2-pro")?.milliCredits;
  const premium = getPaidModelPrice("openrouter:recraft/recraft-v4.1-pro")?.milliCredits;
  assert.deepEqual([standard, pro, premium], [1_000, 2_000, 3_000]);

  const estimates = (credits: number) => [standard, pro, premium].map((cost) =>
    Math.floor((credits * 1_000) / (cost ?? Number.POSITIVE_INFINITY))
  );
  assert.deepEqual(estimates(25), [25, 12, 8]);
  assert.deepEqual(estimates(100), [100, 50, 33]);
  assert.deepEqual(estimates(300), [300, 150, 100]);
});

test("AI assist pricing uses fractional millicredits", () => {
  assert.equal(AI_ASSIST_MILLICREDITS.expand_prompt, 100);
  assert.equal(AI_ASSIST_MILLICREDITS.image_analysis, 200);
  assert.equal(AI_ASSIST_MILLICREDITS.brand_guidelines_pdf, 500);
});
