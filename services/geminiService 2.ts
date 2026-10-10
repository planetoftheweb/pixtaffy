import { GoogleGenAI, Type } from "@google/genai";
import { GenerationConfig, GeneratedImage, BrandColor, VisualStyle, GraphicType, BrandGuidelinesAnalysis, PromptImageStyleInfluenceMode } from "../types";
import { getSafeAspectRatioForModel, normalizeAspectRatio } from "./aspectRatioService";
import {
  buildCorrectionAuditUserPrompt,
  parseStructuredJsonFromModelText,
  buildExpandPromptInstructions,
  type CorrectionAnalysisContext,
  type ExpandPromptContext,
} from "./correctionAnalysisShared";
import {
  formatUserFacingGeminiError,
  generateContentWithGeminiTextFallback,
  stringifyGeminiCallError,
} from "./geminiTextModelService";

const NANO_BANANA_PRO_MODEL = 'gemini-3-pro-image-preview';
const NANO_BANANA_2_MODEL = 'gemini-3.1-flash-image-preview';
const NANO_BANANA_2_LITE_MODEL = 'gemini-3.1-flash-lite-image';

/** True when another Gemini image model may still work for the same key/project. */
const shouldRetryImageModelAfterError = (err: unknown): boolean =>
  /API_KEY_INVALID|INVALID_ARGUMENT|not found|not supported|is not available|Model .*not/i.test(
    stringifyGeminiCallError(err)
  );

const SUPPORTED_INPUT_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif'
]);

type GenerationContext = CorrectionAnalysisContext;

export interface ImageCorrectionPlan {
  analysisSummary: string;
  issues: string[];
  fixPrompt: string;
}

export interface RefineGraphicOptions {
  forceAspectOnlyEdit?: boolean;
  forceFillCanvas?: boolean;
}

// Helper to get the client
const getAiClient = (customKey?: string) => {
  // BYOK Enforcement: Only accept customKey.
  const key = (customKey || '').trim();
  if (!key) throw new Error("API Key Required. Please log in and add your Google Gemini API Key in Settings.");
  return new GoogleGenAI({ apiKey: key });
}

// Merges the user's Settings > System Prompt into a generateContent config via
// the SDK's dedicated `systemInstruction` field. This is stronger than a plain
// text-prefix: the model treats it as a higher-priority directive, so per-call
// task instructions (like expandPrompt's "return ONLY the brief") can't silently
// outrank the user's brand-voice/safety constraints.
const withSystemInstruction = <T extends Record<string, any>>(
  baseConfig: T | undefined,
  systemPrompt?: string
): (T & { systemInstruction?: string }) | undefined => {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) return baseConfig;
  return { ...(baseConfig || {} as T), systemInstruction: trimmed };
};

const getGeminiImageModelCandidates = (selectedModel?: string): readonly string[] => {
  if (selectedModel === NANO_BANANA_2_LITE_MODEL)
    return [NANO_BANANA_2_LITE_MODEL, NANO_BANANA_PRO_MODEL];
  if (selectedModel === NANO_BANANA_2_MODEL)
    return [NANO_BANANA_2_MODEL, NANO_BANANA_PRO_MODEL];
  return [NANO_BANANA_PRO_MODEL];
};

const getUiModelIdForGeminiImageModel = (generationModel: string): string => {
  if (generationModel === NANO_BANANA_2_LITE_MODEL) return NANO_BANANA_2_LITE_MODEL;
  if (generationModel === NANO_BANANA_2_MODEL) return NANO_BANANA_2_MODEL;
  return 'gemini';
};

const withActualGeminiModel = (image: GeneratedImage, generationModel: string): GeneratedImage => ({
  ...image,
  modelId: getUiModelIdForGeminiImageModel(generationModel),
});

/**
 * Constructs the engineered prompt based on selected presets and dynamic context
 */
const constructFullPrompt = (config: GenerationConfig, context: GenerationContext): string => {
  const colorScheme = context.brandColors.find(c => c.id === config.colorSchemeId);
  const style = context.visualStyles.find(s => s.id === config.visualStyleId);
  const type = context.graphicTypes.find(t => t.id === config.graphicTypeId);

  const colors = colorScheme ? colorScheme.colors.join(', ') : 'standard colors';
  const styleDesc = style ? style.description : 'clean style';
  const typeName = type ? type.name : 'image';

  return `
    Create a ${typeName}.
    Visual Style: ${styleDesc}.
    Color Palette: Strictly paint with these colors: ${colors}. The hex codes are paint-mixing instructions only — never draw the codes, palette names, or color swatches as visible elements in the image.
    
    Content Request: ${config.prompt}
    
    Ensure the output is high quality and adheres to the style constraints.
  `.trim();
};

export const generateGraphic = async (
  config: GenerationConfig,
  context: GenerationContext,
  customApiKey?: string,
  systemPrompt?: string,
  selectedModel: string = 'gemini'
): Promise<GeneratedImage> => {
  const ai = getAiClient(customApiKey);
  const fullPrompt = constructFullPrompt(config, context);
  const safeAspectRatio = getSafeAspectRatioForModel(selectedModel, config.aspectRatio, []);
  const generationModels = getGeminiImageModelCandidates(selectedModel);
  let lastError: unknown;

  for (let mi = 0; mi < generationModels.length; mi++) {
    const generationModel = generationModels[mi];
    try {
      const response = await ai.models.generateContent({
        model: generationModel,
        contents: {
          parts: [{ text: fullPrompt }],
        },
        config: withSystemInstruction({
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: safeAspectRatio,
          }
        }, systemPrompt),
      });

      return withActualGeminiModel(extractImageFromResponse(response), generationModel);
    } catch (error: unknown) {
      lastError = error;
      const moreModels = mi < generationModels.length - 1;
      if (moreModels && shouldRetryImageModelAfterError(error)) {
        console.warn(`Gemini generation: model ${generationModel} failed, retrying with Nano Banana Pro`, error);
        continue;
      }
      console.error("Gemini Generation Error:", error);
      const raw = stringifyGeminiCallError(error);
      if (/API_KEY_INVALID|API key not valid/i.test(raw)) {
        throw new Error(
          'Google rejected the selected Gemini image model/key combination. If this key worked before, switch to Nano Banana Pro or confirm the selected Gemini image model is enabled for that Google Cloud project.'
        );
      }
      const formatted = formatUserFacingGeminiError(raw);
      throw new Error(formatted || "Failed to generate image. Please try again.");
    }
  }

  console.error("Gemini Generation Error:", lastError);
  const raw = stringifyGeminiCallError(lastError);
  const formatted = formatUserFacingGeminiError(raw);
  throw new Error(formatted || "Failed to generate image. Please try again.");
};

interface StyleReferenceGenerationOptions {
  influenceMode?: PromptImageStyleInfluenceMode;
  imageStyleDescription?: string;
}

// Generate a fresh composition while using an input image as style reference only.
export const generateGraphicWithStyleReference = async (
  styleReferenceImage: GeneratedImage,
  conceptPrompt: string,
  config: GenerationConfig,
  context: GenerationContext,
  customApiKey?: string,
  systemPrompt?: string,
  selectedModel: string = 'gemini',
  options: StyleReferenceGenerationOptions = {}
): Promise<GeneratedImage> => {
  const ai = getAiClient(customApiKey);
  const colorScheme = context.brandColors.find(c => c.id === config.colorSchemeId);
  const style = context.visualStyles.find(s => s.id === config.visualStyleId);
  const type = context.graphicTypes.find(t => t.id === config.graphicTypeId);
  const colors = colorScheme ? colorScheme.colors.join(', ') : 'source palette tones';
  const styleDesc = style ? style.description : 'consistent illustrated style';
  const typeName = type ? type.name : 'infographic';
  const safeAspectRatio = getSafeAspectRatioForModel(selectedModel, config.aspectRatio, []);
  const generationModels = getGeminiImageModelCandidates(selectedModel);
  const imageStyleDescription = options.imageStyleDescription?.trim();
  const styleReferenceInstruction =
    options.influenceMode === 'menus'
      ? `
    The selected menu style is authoritative: ${styleDesc}.
    Use the attached image only as a soft secondary style reference.
    If the attached image conflicts with the selected menu style, follow the menu style.
      `.trim()
      : `
    The attached image is the authoritative visual style reference.
    Use its line quality, rendering texture, visual motifs, and palette behavior.
    ${imageStyleDescription ? `Image style summary: ${imageStyleDescription}` : ''}
    If the attached image conflicts with the selected Style menu, follow the attached image.
      `.trim();

  const prompt = `
    Create a brand-new ${typeName} composition.
    ${styleReferenceInstruction}
    Do NOT copy the exact layout, framing, element positions, wording, or arrows from the reference image.
    Build a fresh composition that fully uses the ${safeAspectRatio} canvas with no side padding or centered poster effect.
    Keep palette direction: ${colors}.
    Ensure text is legible and spelled correctly.

    Request:
    ${conceptPrompt}
  `.trim();

  const sourceImage = await resolveImageInputForRefinement(styleReferenceImage);
  let lastError: unknown;

  for (let mi = 0; mi < generationModels.length; mi++) {
    const generationModel = generationModels[mi];
    try {
      const response = await ai.models.generateContent({
        model: generationModel,
        contents: {
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: sourceImage.base64Data,
                mimeType: sourceImage.mimeType,
              },
            }
          ]
        },
        config: withSystemInstruction({
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: safeAspectRatio,
          }
        }, systemPrompt)
      });

      return withActualGeminiModel(extractImageFromResponse(response), generationModel);
    } catch (error: unknown) {
      lastError = error;
      const moreModels = mi < generationModels.length - 1;
      if (moreModels && shouldRetryImageModelAfterError(error)) {
        console.warn(`Gemini style reference generation: model ${generationModel} failed, retrying with Nano Banana Pro`, error);
        continue;
      }
      console.error("Gemini Style Reference Generation Error:", error);
      const raw = stringifyGeminiCallError(error);
      const formatted = formatUserFacingGeminiError(raw);
      throw new Error(formatted || "Failed to generate from style reference.");
    }
  }

  console.error("Gemini Style Reference Generation Error:", lastError);
  throw new Error(
    formatUserFacingGeminiError(stringifyGeminiCallError(lastError)) ||
      "Failed to generate from style reference."
  );
};

export const refineGraphic = async (
  currentImage: GeneratedImage, 
  refinementPrompt: string, 
  config: GenerationConfig,
  context: GenerationContext,
  customApiKey?: string,
  systemPrompt?: string,
  selectedModel: string = 'gemini',
  previousAspectRatio?: string,
  options?: RefineGraphicOptions
): Promise<GeneratedImage> => {
  const ai = getAiClient(customApiKey);
  const colorScheme = context.brandColors.find(c => c.id === config.colorSchemeId);
  const style = context.visualStyles.find(s => s.id === config.visualStyleId);
  const safeAspectRatio = getSafeAspectRatioForModel(selectedModel, config.aspectRatio, []);
  const generationModels = getGeminiImageModelCandidates(selectedModel);
  
  const colors = colorScheme ? colorScheme.colors.join(', ') : '';
  const styleDesc = style ? style.description : '';
  const previousRatio = normalizeAspectRatio(previousAspectRatio || '');
  const nextRatio = normalizeAspectRatio(safeAspectRatio || config.aspectRatio || '');
  const aspectRatioChanged = Boolean(previousRatio && nextRatio && previousRatio !== nextRatio);
  const ratioPattern = /\d+(?:\.\d+)?\s*(?:[:xX×/])\s*\d+(?:\.\d+)?/;
  const ratioKeywordPattern = /\b(?:aspect\s*ratio|ratio|landscape|portrait|square|ultra[\s-]?wide|widescreen|canvas size)\b/i;
  const ratioRequestedInPrompt = ratioPattern.test(refinementPrompt) || ratioKeywordPattern.test(refinementPrompt);
  const reducedPrompt = refinementPrompt
    .toLowerCase()
    .replace(ratioPattern, ' ')
    .replace(/\b(?:change|adjust|set|make|to|the|aspect|ratio|size|canvas|image|from|into|landscape|portrait|square|ultrawide|widescreen|please|just|only)\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();
  const forceAspectOnlyEdit = Boolean(options?.forceAspectOnlyEdit);
  const likelyAspectOnlyRequest = forceAspectOnlyEdit || (ratioRequestedInPrompt && reducedPrompt.length <= 6);

  const ratioDirective = aspectRatioChanged
    ? `
    Aspect ratio instruction: change canvas from ${previousRatio} to ${nextRatio}.
    Use outpainting/canvas extension to preserve the existing design and scene.
    Do not redraw or replace the main subject, layout, or text blocks.
  `.trim()
    : '';

  const strictPreservationDirective = likelyAspectOnlyRequest
    ? `
    This is an aspect-ratio-only edit.
    Keep all text wording, label positions, typography style, and illustration details as close as possible to the source.
    Only extend/reframe and minimally reposition elements for fit; do not invent new sections, detached icons, or rewrite copy.
    Keep the same central subject scale and placement logic from the original composition.
  `.trim()
    : `
    Treat the attached raster as the only source of truth — edit it in place, do not re-imagine or replace the whole piece.
    Apply the smallest change that satisfies the request; prefer local adjustments only where needed.
    Preserve composition, framing, subjects, poses, facial identity, layout, logos, icons, lighting, and the established art style unless the request explicitly changes them.
    Keep all on-image text: same wording, language, spelling, and relative placement unless the user explicitly asks to change or remove text.
    Do not "upgrade", beautify, or redraw unrelated regions; do not change genre or start a new scene.
  `.trim();

  const fillCanvasDirective = options?.forceFillCanvas
    ? `
    The new composition must visually occupy almost the full canvas.
    Do not return a centered poster surrounded by empty margins, decorative border frames, or padded sidebars.
    Use only a very small safe margin near edges (about 2-4%).
  `.trim()
    : '';

  const fullRefinementPrompt = `
    Refine this exact image — same picture after a focused edit, not a new image.
    User request: ${refinementPrompt}
    For any new or adjusted pixels, stay coherent with the existing style (${styleDesc}) and palette (${colors}).
    ${ratioDirective}
    ${strictPreservationDirective}
    ${fillCanvasDirective}
  `.trim();

  const sourceImage = await resolveImageInputForRefinement(currentImage);
  let lastError: unknown;

  for (let mi = 0; mi < generationModels.length; mi++) {
    const generationModel = generationModels[mi];
    try {
      const response = await ai.models.generateContent({
        model: generationModel,
        contents: {
          parts: [
            {
              text: fullRefinementPrompt,
            },
            {
              inlineData: {
                data: sourceImage.base64Data,
                mimeType: sourceImage.mimeType,
              },
            },
          ],
        },
        config: withSystemInstruction({
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: safeAspectRatio,
          }
        }, systemPrompt),
      });

      return withActualGeminiModel(extractImageFromResponse(response), generationModel);
    } catch (error: unknown) {
      lastError = error;
      const moreModels = mi < generationModels.length - 1;
      if (moreModels && shouldRetryImageModelAfterError(error)) {
        console.warn(`Gemini refinement: model ${generationModel} failed, retrying with Nano Banana Pro`, error);
        continue;
      }
      console.error("Gemini Refinement Error:", error);
      const raw = stringifyGeminiCallError(error);
      const formatted = formatUserFacingGeminiError(raw);
      throw new Error(formatted || "Failed to refine image. Please try again.");
    }
  }

  console.error("Gemini Refinement Error:", lastError);
  throw new Error(
    formatUserFacingGeminiError(stringifyGeminiCallError(lastError)) ||
      "Failed to refine image. Please try again."
  );
};

/**
 * Analyzes a brand guideline document (PDF or Image) to extract colors, styles, and types.
 */
export const analyzeBrandGuidelines = async (
  file: File,
  customApiKey?: string,
  systemPrompt?: string
): Promise<BrandGuidelinesAnalysis> => {
  const ai = getAiClient(customApiKey);
  const base64Data = await fileToBase64(file);
  const mimeType = file.type;

  const prompt = `
    Analyze this brand guideline document. 
    Extract the following structured data:
    1. Brand Colors: Extract up to 5 distinct color palettes found. Provide a descriptive name for each palette (e.g., "Primary Brand", "Secondary Accents") and a list of hex codes.
    2. Visual Styles: Identify up to 5 distinct visual styles described or implied (e.g., "Line Art", "Isometric", "Photorealistic"). Provide a name and a short description for each.
    3. Graphic Types: Identify the types of graphics mentioned (e.g., "Icons", "Banners").

    Return the result as a strict JSON object matching the schema.
  `.trim();

  try {
    const response = await generateContentWithGeminiTextFallback(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          { text: prompt }
        ]
      },
      config: withSystemInstruction({
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            brandColors: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  colors: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
              }
            },
            visualStyles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING }
                }
              }
            },
            graphicTypes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING }
                }
              }
            }
          }
        }
      }, systemPrompt)
    }, "Brand analysis");

    if (!response.text) throw new Error("No analysis result generated");
    
    return JSON.parse(response.text) as BrandGuidelinesAnalysis;
  } catch (error) {
    console.error("Brand Analysis Error:", error);
    throw new Error("Failed to analyze brand guidelines.");
  }
};

/**
 * Analyzes a single image to extract a specific option type (Style or Color).
 */
export const analyzeImageForOption = async (
  file: File, 
  type: 'style' | 'color', 
  customApiKey?: string,
  systemPrompt?: string
): Promise<{ name: string; description?: string; colors?: string[] }> => {
  const ai = getAiClient(customApiKey);
  const base64Data = await fileToBase64(file);
  const mimeType = file.type;

  let prompt = '';
  let responseSchema: any = {};

  if (type === 'style') {
    prompt = `
      Analyze the visual style of this image.
      Provide a short, catchy Name for this style (e.g. "Neon Cyberpunk", "Minimal Line Art").
      Provide a concise Description of the visual characteristics (e.g. lighting, texture, line weight, composition) that could be used to generate similar images.
    `;
    responseSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        description: { type: Type.STRING }
      },
      required: ["name", "description"]
    };
  } else if (type === 'color') {
    prompt = `
      Analyze the color palette of this image.
      Provide a descriptive Name for this palette (e.g. "Sunset Vibes", "Corporate Blue").
      Extract the 4-5 dominant colors as HEX codes.
    `;
    responseSchema = {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        colors: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING } 
        }
      },
      required: ["name", "colors"]
    };
  }

  const jsonConfig = withSystemInstruction(
    {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
    },
    systemPrompt
  );

  try {
    const response = await generateContentWithGeminiTextFallback(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          { text: prompt },
        ],
      },
      config: jsonConfig,
    }, "Option analysis");

    if (!response.text) throw new Error("No analysis result generated");

    return JSON.parse(response.text);
  } catch (error: unknown) {
    console.error("Option Analysis Error:", error);
    const msg = formatUserFacingGeminiError(stringifyGeminiCallError(error));
    throw new Error(msg || `Failed to analyze image for ${type}.`);
  }
};

// Describe an image to produce a rich recreation prompt
export const describeImagePrompt = async (
  base64Data: string,
  mimeType: string,
  customApiKey?: string
): Promise<string> => {
  const ai = getAiClient(customApiKey);

  const prompt = `
    Provide a concise but richly detailed generation prompt (2-4 sentences) that fully describes this image with no need to reference another image. Include:
    - Subject and key objects
    - Composition and camera/view (angle, framing, depth of field)
    - Lighting (type, direction, mood), color palette highlights
    - Style cues (art style, texture, rendering approach)
    - Any notable text, logos, or graphic elements (if present)
    Respond with a single paragraph optimized for image generation (self-contained).
  `;

  const contents = {
    parts: [
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      { text: prompt },
    ],
  };

  try {
    const response = await generateContentWithGeminiTextFallback(ai, { contents }, "Image describe");

    if (!response.text) throw new Error("No description generated");
    return response.text.trim();
  } catch (error: unknown) {
    console.error('Image describe error:', error);
    const msg = formatUserFacingGeminiError(stringifyGeminiCallError(error));
    throw new Error(msg || 'No description generated');
  }
};

// Describe an image for the prompt box while leaving toolbar-controlled choices
// (layout, style, palette, aspect ratio) to the existing menus.
export const describeImageContentPrompt = async (
  base64Data: string,
  mimeType: string,
  customApiKey?: string,
  systemPrompt?: string
): Promise<string> => {
  const ai = getAiClient(customApiKey);

  const prompt = `
    Describe only the content of this image as a prompt fragment for an image-generation tool.

    Include:
    - Main subject matter and important objects
    - Visible text, labels, logos, or symbols if present
    - Concrete attributes needed to identify the content, such as species, product type, clothing, props, setting category, or action
    - Relationships between subjects only when they matter to the idea

    Exclude anything controlled by separate menus:
    - No layout, composition, camera angle, framing, depth of field, or aspect ratio
    - No visual style, art medium, rendering technique, texture, lighting mood, or color palette
    - No brand/style adjectives such as minimalist, photorealistic, hand-drawn, cinematic, neon, isometric, poster, editorial, infographic, or 3D

    Respond with one concise paragraph. No title, no markdown, no bullets.
  `.trim();

  const contents = {
    parts: [
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      { text: prompt },
    ],
  };

  const config = withSystemInstruction({}, systemPrompt);

  try {
    const response = await generateContentWithGeminiTextFallback(
      ai,
      { contents, config },
      "Content-only image describe"
    );

    if (!response.text) throw new Error("No content prompt generated");
    return response.text.trim();
  } catch (error: unknown) {
    console.error('Content-only image describe error:', error);
    const msg = formatUserFacingGeminiError(stringifyGeminiCallError(error));
    throw new Error(msg || "No content prompt generated");
  }
};

export const analyzeImageForCorrectionPrompt = async (
  currentImage: GeneratedImage,
  config: GenerationConfig,
  context: GenerationContext,
  customApiKey?: string,
  systemPrompt?: string
): Promise<ImageCorrectionPlan> => {
  const ai = getAiClient(customApiKey);
  const sourceImage = await resolveImageInputForRefinement(currentImage);

  const prompt = buildCorrectionAuditUserPrompt(config, context);

  const jsonConfig = withSystemInstruction({
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        analysisSummary: { type: Type.STRING },
        issues: { type: Type.ARRAY, items: { type: Type.STRING } },
        fixPrompt: { type: Type.STRING }
      },
      required: ["analysisSummary", "issues", "fixPrompt"]
    }
  }, systemPrompt);

  try {
    const response = await generateContentWithGeminiTextFallback(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              data: sourceImage.base64Data,
              mimeType: sourceImage.mimeType,
            },
          },
          { text: prompt }
        ]
      },
      config: jsonConfig
    }, "Correction analysis");

    if (!response.text) throw new Error("No correction analysis generated");
    let parsed: Partial<ImageCorrectionPlan>;
    try {
      parsed = parseStructuredJsonFromModelText<Partial<ImageCorrectionPlan>>(response.text);
    } catch {
      throw new Error(
        "Could not read the analysis response. Try Run analysis again, or shorten your Settings system prompt if it conflicts with JSON output."
      );
    }

    return {
      analysisSummary: (parsed.analysisSummary || '').trim(),
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map(issue => String(issue).trim()).filter(Boolean)
        : [],
      fixPrompt: (parsed.fixPrompt || '').trim()
    };
  } catch (error: unknown) {
    console.error("Image Correction Analysis Error:", error);
    const msg = formatUserFacingGeminiError(stringifyGeminiCallError(error));
    throw new Error(
      msg || "Failed to analyze image for correction."
    );
  }
};

// Expand a short prompt into a richer, visual-focused description (text-only, no reference image)
export const expandPrompt = async (
  prompt: string,
  config: GenerationConfig,
  context: ExpandPromptContext,
  customApiKey?: string,
  userSystemPrompt?: string
): Promise<string> => {
  const ai = getAiClient(customApiKey);

  const expansionInstructions = buildExpandPromptInstructions(config, context);

  // Pass the user's Settings > System Prompt via the SDK's dedicated
  // `systemInstruction` field so it outranks the expansion task's own
  // "return ONLY the brief" rule. The task-specific instructions stay in the
  // prompt body where the model expects them.
  const response = await generateContentWithGeminiTextFallback(ai, {
    contents: {
      parts: [
        { text: expansionInstructions },
        { text: `Original prompt: ${prompt}` }
      ]
    },
    config: withSystemInstruction(undefined, userSystemPrompt)
  }, "Expand prompt");

  if (!response.text) throw new Error("No expanded prompt generated");
  return response.text.trim();
};

const parseDataUrl = (value?: string | null): { base64Data: string; mimeType: string } | null => {
  if (!value) return null;
  const match = value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) return null;

  return {
    mimeType: (match[1] || '').toLowerCase(),
    base64Data: match[2]
  };
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const parsed = parseDataUrl(result);
      if (!parsed?.base64Data) {
        reject(new Error('Failed to convert image blob to base64.'));
        return;
      }
      resolve(parsed.base64Data);
    };
    reader.onerror = () => reject(new Error('Failed to read image blob.'));
    reader.readAsDataURL(blob);
  });
};

const fetchImageAsBase64 = async (imageUrl: string): Promise<{ base64Data: string; mimeType: string }> => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch source image (${response.status}).`);
  }

  const blob = await response.blob();
  const base64Data = await blobToBase64(blob);
  const mimeType = (blob.type || 'image/png').toLowerCase();
  return { base64Data, mimeType };
};

export const resolveImageInputForRefinement = async (
  currentImage: GeneratedImage
): Promise<{ base64Data: string; mimeType: string }> => {
  let base64Data = (currentImage.base64Data || '').trim();
  let mimeType = (currentImage.mimeType || '').trim().toLowerCase();

  // Some persisted records accidentally carry a full data URL in `base64Data`.
  const parsedInline = parseDataUrl(base64Data);
  if (parsedInline) {
    base64Data = parsedInline.base64Data;
    mimeType = parsedInline.mimeType || mimeType;
  }

  const imageUrl = (currentImage.imageUrl || '').trim();
  if ((!base64Data || !mimeType) && imageUrl) {
    const parsedUrl = parseDataUrl(imageUrl);
    if (parsedUrl) {
      base64Data = base64Data || parsedUrl.base64Data;
      mimeType = mimeType || parsedUrl.mimeType;
    } else {
      const fetched = await fetchImageAsBase64(imageUrl);
      base64Data = base64Data || fetched.base64Data;
      mimeType = mimeType || fetched.mimeType;
    }
  }

  if (!base64Data) {
    throw new Error(
      "Source image data is unavailable for refinement. Please restore a recent image or generate it again."
    );
  }

  // Base64 payloads should not contain whitespace/newlines.
  base64Data = base64Data.replace(/\s+/g, '');
  if (!mimeType) mimeType = 'image/png';

  if (!SUPPORTED_INPUT_IMAGE_MIME_TYPES.has(mimeType)) {
    console.warn(`Refine input image mime type may be unsupported: ${mimeType}`);
  }

  return { base64Data, mimeType };
};

// Helper to parse the response structure
const extractImageFromResponse = (response: any): GeneratedImage => {
  if (!response.candidates || response.candidates.length === 0) {
    throw new Error("No candidates returned from API.");
  }

  const parts = response.candidates[0].content.parts;
  let imagePart = null;

  for (const part of parts) {
    if (part.inlineData) {
      imagePart = part;
      break;
    }
  }

  if (!imagePart) {
     // Sometimes errors come back as text in the part
     const textPart = parts.find((p: any) => p.text);
     if (textPart) {
         throw new Error(`Model returned text instead of image: ${textPart.text}`);
     }
    throw new Error("No image data found in response.");
  }

  const base64Data = imagePart.inlineData.data;
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  const imageUrl = `data:${mimeType};base64,${base64Data}`;

  return {
    imageUrl,
    base64Data,
    mimeType
  };
};

// Helper to convert File to Base64 string (without data URL prefix)
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data:application/pdf;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
};
