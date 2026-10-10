import { GenerationConfig, BrandColor, VisualStyle, GraphicType, AspectRatioOption } from '../types';

/** Context slice needed for correction audit (matches refine/generation context). */
export interface CorrectionAnalysisContext {
  brandColors: BrandColor[];
  visualStyles: VisualStyle[];
  graphicTypes: GraphicType[];
}

/** Context for prompt expansion (includes aspect ratio labels). */
export interface ExpandPromptContext {
  brandColors: BrandColor[];
  visualStyles: VisualStyle[];
  graphicTypes: GraphicType[];
  aspectRatios: AspectRatioOption[];
}

/** User task text for vision models auditing an image for correction prompts. */
export function buildCorrectionAuditUserPrompt(
  config: GenerationConfig,
  context: CorrectionAnalysisContext
): string {
  const colorScheme = context.brandColors.find((c) => c.id === config.colorSchemeId);
  const style = context.visualStyles.find((s) => s.id === config.visualStyleId);
  const type = context.graphicTypes.find((t) => t.id === config.graphicTypeId);
  const contextHint = [
    `Original request: ${config.prompt || 'N/A'}`,
    `Graphic type: ${type?.name || config.graphicTypeId || 'N/A'}`,
    `Visual style: ${style?.name || config.visualStyleId || 'N/A'}${style?.description ? ` (${style.description})` : ''}`,
    `Color palette: ${colorScheme ? `${colorScheme.name} [${colorScheme.colors.join(', ')}]` : 'N/A'}`,
    `Aspect ratio: ${config.aspectRatio || 'N/A'}`,
  ].join('\n');

  return `
    You are auditing a generated image for correctness and usability.

    Tasks:
    1. Detect textual problems: spelling, grammar, punctuation, capitalization, awkward wording.
    2. Detect factual/semantic inaccuracies and visual mismatches (for example labels pointing to wrong parts, contradictory annotations, impossible claims).
    3. Produce a single detailed image-edit prompt that corrects the issues while preserving the overall composition, style, and palette.

    Context:
    ${contextHint}

    Output requirements:
    - Return strict JSON only (no markdown fences).
    - "analysisSummary": 1-2 concise sentences.
    - "issues": array of concrete issue lines ("what is wrong -> what to change").
    - "fixPrompt": a specific, ready-to-run editing prompt for a high-quality image model.
    - In "fixPrompt", include: text correction instructions, factual correction instructions, label/annotation alignment, readability improvements.
    - Keep the image concept intact; do not introduce unrelated new content.
  `.trim();
}

/** Strip optional \`\`\`json fences so structured-output parsing doesn't throw. */
export function parseStructuredJsonFromModelText<T>(raw: string): T {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)```\s*$/im.exec(s);
  if (fence) s = fence[1].trim();
  return JSON.parse(s) as T;
}

/** Instructions block shared by Gemini Flash and OpenAI expand-prompt. */
export function buildExpandPromptInstructions(
  config: GenerationConfig,
  context: ExpandPromptContext
): string {
  const typeLabel = context.graphicTypes.find((g) => g.id === config.graphicTypeId)?.name || config.graphicTypeId;
  const style = context.visualStyles.find((s) => s.id === config.visualStyleId);
  const styleLabel = style?.name || config.visualStyleId;
  const palette = context.brandColors.find((c) => c.id === config.colorSchemeId);
  const colors = palette ? `${palette.name}: ${palette.colors.join(', ')}` : '';
  const aspect =
    context.aspectRatios?.find((a) => a.value === config.aspectRatio)?.label || config.aspectRatio;

  // Expansion enriches CONTENT only. Style, palette, aspect, and type are
  // supplied by the app's dropdowns and appended to the generation prompt
  // separately — when the expansion also specified fonts, layout, and
  // colors it fought those settings (and swapping a dropdown afterwards
  // did nothing because the prompt text had already baked the old look in).
  return `
    You expand short text prompts into richer image prompts by deepening the CONTENT — the ideas, facts, and concrete things to depict. The user's separate tool settings control the look, so your job is only the substance.

    Include and amplify:
    - The core concept and what makes it click for a viewer (the "aha")
    - The key sub-ideas, steps, or comparisons worth showing (for a ${typeLabel || 'graphic'}: what sections or callouts earn their place)
    - Concrete subjects, objects, and moments that illustrate each idea
    - Short label/annotation WORDING where text helps teach (keep labels few and brief)
    - Relationships between elements (causes, flows, before/after)
    - Mood or energy in plain terms (playful, calm, dramatic) if it serves the topic

    STRICTLY OMIT — these are controlled by the user's tool settings, not the prompt:
    - Colors, palettes, hex codes, or color adjectives tied to specific elements
    - Art style, medium, rendering technique, or texture descriptions
    - Typography: fonts, lettering styles, text sizes, bold/weight
    - Layout and composition: left/right/top placement, panel arrangements, aspect ratio
    - Camera, lens, lighting, or depth-of-field language

    Keep it 2-4 sentences, concrete and idea-dense. Do not mention any reference image.
    (For your awareness only — do NOT restate these in the prompt: Type=${typeLabel}, Style=${styleLabel}, Palette=${colors || 'set by user'}, Aspect=${aspect}.)
  `.trim();
}
