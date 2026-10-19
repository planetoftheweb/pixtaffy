import { GoogleGenAI } from "@google/genai";
import { GenerationConfig, GeneratedImage, BrandColorDefinition, VisualStyleDefinition, GraphicTypeDefinition, SvgMode } from "../types";
import {
  formatUserFacingGeminiError,
  stringifyGeminiCallError,
} from "./geminiTextModelService";

interface SvgGenerationContext {
  brandColors: BrandColorDefinition[];
  visualStyles: VisualStyleDefinition[];
  graphicTypes: GraphicTypeDefinition[];
}

const looksLikeGeminiKey = (key: string): boolean =>
  /^AIza[A-Za-z0-9_-]+$/.test(key) && key.length >= 30 && key.length <= 60;

const getAiClient = (customKey?: string) => {
  const key = (customKey || '').trim();
  if (!key) throw new Error("API Key Required. Please log in and add your Google Gemini API Key in Settings.");
  if (!looksLikeGeminiKey(key)) {
    // Fail fast with an actionable message instead of sending a 416-char blob
    // (or any other non-Gemini-shaped string) to Google and getting back the
    // misleading "API key not valid" error for every model.
    const head = key.length <= 8 ? key : `${key.slice(0, 4)}…${key.slice(-4)}`;
    throw new Error(
      `The Gemini API key saved for SVG generation doesn't look like a real Gemini key. ` +
      `Got "${head}" (${key.length} chars). Real Gemini keys start with "AIza" and are 39 characters long. ` +
      `Open Settings → API Configuration. If you have a per-model override for "Gemini SVG", clear it ` +
      `(the shared Gemini key will be used). Otherwise paste a fresh Gemini key from ` +
      `https://aistudio.google.com/app/apikey into the shared Gemini slot.`
    );
  }
  return new GoogleGenAI({ apiKey: key });
};

const DANGEROUS_ATTRS = /\bon\w+\s*=/gi;
const SCRIPT_TAG = /<script[\s\S]*?<\/script>/gi;
const FOREIGN_OBJECT = /<foreignObject[\s\S]*?<\/foreignObject>/gi;

export const sanitizeSvg = (svg: string): string =>
  svg
    .replace(SCRIPT_TAG, '')
    .replace(FOREIGN_OBJECT, '')
    .replace(DANGEROUS_ATTRS, '');

const extractSvg = (text: string): string | null => {
  const start = text.indexOf('<svg');
  if (start === -1) return null;
  const end = text.indexOf('</svg>', start);
  if (end === -1) return null;
  return text.slice(start, end + 6);
};

const ensureSvgDimensions = (svg: string): string => {
  const hasWidth = /\bwidth\s*=/.test(svg.slice(0, svg.indexOf('>')));
  const hasHeight = /\bheight\s*=/.test(svg.slice(0, svg.indexOf('>')));
  if (hasWidth && hasHeight) return svg;

  const vbMatch = svg.match(/viewBox\s*=\s*["']([^"']+)["']/);
  let w = '800';
  let h = '600';
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/\s+/);
    if (parts.length >= 4) {
      w = parts[2];
      h = parts[3];
    }
  }

  const insertPos = svg.indexOf('<svg') + 4;
  const attrs = `${!hasWidth ? ` width="${w}"` : ''}${!hasHeight ? ` height="${h}"` : ''}`;
  return svg.slice(0, insertPos) + attrs + svg.slice(insertPos);
};

const modeInstruction = (mode: SvgMode): string => {
  switch (mode) {
    case 'animated':
      return 'Include smooth CSS animations and/or SMIL <animate> elements for key elements. Make the animation loop seamlessly.';
    case 'interactive':
      return 'Add CSS :hover and :focus states for visual interactivity on key elements. Use only CSS, no JavaScript.';
    default:
      return 'Make it fully static with no animations or interactive elements.';
  }
};

const aspectToViewBox = (aspectRatio: string): string => {
  const [w, h] = aspectRatio.split(':').map(Number);
  if (!w || !h) return '0 0 1200 1200';
  const longer = Math.max(w, h);
  const scale = (w >= h ? 1920 : 1080) / longer;
  return `0 0 ${Math.round(w * scale)} ${Math.round(h * scale)}`;
};

const buildSvgPrompt = (
  config: GenerationConfig,
  context: SvgGenerationContext,
  systemPrompt?: string
): string => {
  const colorScheme = context.brandColors.find(c => c.id === config.colorSchemeId);
  const style = context.visualStyles.find(s => s.id === config.visualStyleId);
  const type = context.graphicTypes.find(t => t.id === config.graphicTypeId);

  const colors = colorScheme ? colorScheme.colors.join(', ') : 'standard colors';
  const styleDesc = style ? style.description : 'clean style';
  const typeName = type ? type.name : 'graphic';
  const viewBox = aspectToViewBox(config.aspectRatio || '1:1');
  const mode = config.svgMode || 'static';

  const parts = [
    systemPrompt?.trim() ? `System Instruction: ${systemPrompt.trim()}\n` : '',
    `You are an expert SVG designer. Generate a visually polished, production-quality SVG graphic.`,
    `Output ONLY the raw SVG code — no explanation, no markdown fences, no commentary before or after.`,
    ``,
    `Type: ${typeName}`,
    `Visual Style: ${styleDesc}`,
    `Color Palette: Use ONLY these colors (and their tints/shades): ${colors}`,
    `viewBox: "${viewBox}" — fill the entire viewBox with content, no excessive whitespace.`,
    `Output Mode: ${modeInstruction(mode)}`,
    ``,
    `Content: ${config.prompt}`,
    ``,
    `Quality requirements:`,
    `- Use gradients, patterns, and layered shapes for visual depth`,
    `- Include proper typography with font-family fallbacks (system fonts)`,
    `- Ensure text is legible: minimum 16px equivalent at the viewBox scale`,
    `- Use <defs> for reusable gradients, clip-paths, and filters`,
    `- Optimize paths — prefer basic shapes (<rect>, <circle>, <ellipse>) over complex <path> when possible`,
    `- The SVG must be self-contained, well-formed, and render correctly in all modern browsers`,
  ];

  return parts.filter(Boolean).join('\n');
};

const svgToGeneratedImage = (svgCode: string): GeneratedImage => {
  const base64 = btoa(unescape(encodeURIComponent(svgCode)));
  return {
    imageUrl: `data:image/svg+xml;base64,${base64}`,
    base64Data: base64,
    mimeType: 'image/svg+xml',
  };
};

// Wide candidate list — covers Pro, Flash, and older 1.5/2.0 stable models so
// we work with whatever the user's project has enabled. The list intentionally
// does NOT include image-preview ids; those models reject TEXT-only requests
// (they require IMAGE in responseModalities) and would just add noise.
const SVG_MODEL_CANDIDATES: ReadonlyArray<string> = [
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gemini-pro-latest',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

const isModelAvailabilityError = (err: unknown): boolean =>
  /API_KEY_INVALID|API key not valid|INVALID_ARGUMENT|not found|not supported|is not available|Model .*not|PERMISSION_DENIED|FAILED_PRECONDITION|NOT_FOUND/i.test(
    stringifyGeminiCallError(err)
  );

const fingerprintKey = (key: string): string => {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)} (${trimmed.length} chars)`;
};

interface SvgModelAttempt {
  model: string;
  error: string;
}

class SvgGenerationFailure extends Error {
  attempts: SvgModelAttempt[];
  keyFingerprint: string;
  constructor(message: string, attempts: SvgModelAttempt[], keyFingerprint: string) {
    super(message);
    this.attempts = attempts;
    this.keyFingerprint = keyFingerprint;
  }
}

const callSvgModel = async (
  ai: GoogleGenAI,
  prompt: string,
  label: string,
  apiKey: string
): Promise<{ text: string; modelUsed: string }> => {
  const attempts: SvgModelAttempt[] = [];
  for (let i = 0; i < SVG_MODEL_CANDIDATES.length; i++) {
    const model = SVG_MODEL_CANDIDATES[i];
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: prompt }] },
      });
      const text = response.text ?? '';
      if (!text) {
        attempts.push({ model, error: 'empty text response' });
        console.warn(`${label}: model ${model} returned empty text, trying next`);
        continue;
      }
      return { text, modelUsed: model };
    } catch (error: unknown) {
      const errMsg = formatUserFacingGeminiError(stringifyGeminiCallError(error));
      attempts.push({ model, error: errMsg });
      if (isModelAvailabilityError(error)) {
        console.warn(`${label}: model ${model} unavailable for this key, trying next`, errMsg);
        continue;
      }
      // Non-availability error (rate limit, network, etc.) — bubble up immediately.
      throw error;
    }
  }
  // Every candidate failed. Build a diagnostic error that lists each attempt
  // and the key fingerprint so the user can verify they're sending what they
  // think they're sending. We do NOT just say "API key invalid" because the
  // user has confirmed image generation works with this same key.
  const lines = attempts.map(a => `  • ${a.model}: ${a.error}`).join('\n');
  const fingerprint = fingerprintKey(apiKey);
  const detail =
    `${label} failed for every Gemini text model. Your API key (${fingerprint}) was sent to each, ` +
    `and Google rejected each one. This is almost always a project-side model-enablement issue ` +
    `(your key works for image preview models but not Pro/Flash text models).\n\n` +
    `Per-model attempts:\n${lines}\n\n` +
    `Fix: Open https://aistudio.google.com/app/apikey, click your key, and confirm the linked Google ` +
    `Cloud project has the Generative Language API enabled with no model restrictions. If you have a ` +
    `separate per-model API key saved for "Gemini SVG" in Settings → API Configuration, clear it so ` +
    `the shared Gemini key is used.`;
  throw new SvgGenerationFailure(detail, attempts, fingerprint);
};

const wrapSvgError = (error: unknown, action: 'generate' | 'refine'): Error => {
  if (error instanceof SvgGenerationFailure) {
    return error;
  }
  const raw = stringifyGeminiCallError(error);
  const msg = formatUserFacingGeminiError(raw);
  return new Error(msg || `Failed to ${action} SVG. Please try again.`);
};

export const generateSvg = async (
  config: GenerationConfig,
  context: SvgGenerationContext,
  customApiKey?: string,
  systemPrompt?: string
): Promise<GeneratedImage & { svgCode: string }> => {
  const ai = getAiClient(customApiKey);
  const prompt = buildSvgPrompt(config, context, systemPrompt);

  try {
    const { text } = await callSvgModel(ai, prompt, 'SVG generation', customApiKey || '');
    const raw = extractSvg(text);
    if (!raw) {
      throw new Error('The model did not return valid SVG code. Try refining your prompt.');
    }

    const svgCode = ensureSvgDimensions(sanitizeSvg(raw));
    return { ...svgToGeneratedImage(svgCode), svgCode };
  } catch (error: unknown) {
    console.error("SVG Generation Error:", error);
    throw wrapSvgError(error, 'generate');
  }
};

export const refineSvg = async (
  currentSvgCode: string,
  refinementPrompt: string,
  config: GenerationConfig,
  context: SvgGenerationContext,
  customApiKey?: string,
  systemPrompt?: string
): Promise<GeneratedImage & { svgCode: string }> => {
  const ai = getAiClient(customApiKey);

  const colorScheme = context.brandColors.find(c => c.id === config.colorSchemeId);
  const colors = colorScheme ? colorScheme.colors.join(', ') : '';

  const parts = [
    systemPrompt?.trim() ? `System Instruction: ${systemPrompt.trim()}\n` : '',
    `Here is the current SVG:\n${currentSvgCode}\n`,
    `Apply this change with minimal edits — preserve structure, ids, groups, and geometry unless the request requires replacing them. Do not rewrite the whole document.`,
    `Modification request: ${refinementPrompt}`,
    colors ? `Color Palette: Keep using these colors: ${colors}` : '',
    `Output ONLY the modified SVG code. No explanation, no markdown fences.`,
  ];

  try {
    const { text } = await callSvgModel(ai, parts.filter(Boolean).join('\n'), 'SVG refinement', customApiKey || '');
    const raw = extractSvg(text);
    if (!raw) {
      throw new Error('The model did not return valid SVG code during refinement.');
    }

    const svgCode = ensureSvgDimensions(sanitizeSvg(raw));
    return { ...svgToGeneratedImage(svgCode), svgCode };
  } catch (error: unknown) {
    console.error("SVG Refinement Error:", error);
    throw wrapSvgError(error, 'refine');
  }
};
