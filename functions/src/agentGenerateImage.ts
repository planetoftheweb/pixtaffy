/**
 * Admin-only HTTPS API: generate image(s) using the signed-in user's BYOK keys
 * and catalog resources — same semantics as the main app toolbar.
 *
 * Auth: Authorization: Bearer <Firebase ID JWT> where token has custom claim admin === true.
 */
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import type { Response } from "express";
import * as admin from "firebase-admin";
import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { verifyApiToken, enforceApiRateLimit, RateLimitError } from "./apiTokens";
import sharp from "sharp";
import { getStorage } from "firebase-admin/storage";
import type { Firestore, DocumentReference } from "firebase-admin/firestore";
import { generateOpenRouterImageCore } from "./openRouterProvider";

const REGION = "us-central1";
const MAX_BATCH_PROMPTS = 15;
const INBOX_FOLDER_ID = "folder-inbox";

const NANO_BANANA_PRO_MODEL = "gemini-3-pro-image-preview";
const NANO_BANANA_2_MODEL = "gemini-3.1-flash-image-preview";
const NANO_BANANA_2_LITE_MODEL = "gemini-3.1-flash-lite-image";

const GEMINI_ALLOWED_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

const OPENAI_ALLOWED_ASPECT_RATIOS = ["1:1", "2:3", "3:2"] as const;
const OPENAI_2_ALLOWED_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "9:16",
  "16:9",
  "1:3",
  "3:1",
] as const;

const API_MODEL_BY_UI_ID: Record<string, string> = {
  "openai-2.5": "gpt-image-2.5-sunburst",
  "openai-flare": "gpt-image-2.5-flare",
  "openai-2": "gpt-image-2",
  "openai-mini": "gpt-image-1-mini",
  openai: "gpt-image-1.5",
};

const GPT_IMAGE_2_SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "2048x2048",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "16:9": "2048x1152",
  "9:16": "1152x2048",
  "3:1": "2304x768",
  "1:3": "768x2304",
};

const LEGACY_SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

/** --- Aspect ratio coercion (subset of client aspectRatioService) --- */

const normalizeAspectRatio = (value?: string): string => {
  const raw = (value || "").trim();
  if (!raw) return "";

  const compact = raw
    .replace(/\s+/g, "")
    .replace(/_/g, ":")
    .replace(/[xX×]/g, ":")
    .replace(/\//g, ":");

  const match = compact.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return compact;

  return `${match[1]}:${match[2]}`;
};

const parseRatio = (value: string): number | null => {
  const normalized = normalizeAspectRatio(value);
  const [width, height] = normalized.split(":").map(Number);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return width / height;
};

const findClosestAspectRatio = (target: string, candidates: string[]): string | null => {
  const targetRatio = parseRatio(target);
  if (!targetRatio || candidates.length === 0) return null;

  let closest = candidates[0];
  let minDiff = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const candidateRatio = parseRatio(candidate);
    if (!candidateRatio) continue;
    const diff = Math.abs(targetRatio - candidateRatio);
    if (diff < minDiff) {
      minDiff = diff;
      closest = candidate;
    }
  }

  return closest;
};

interface AspectRatioRow {
  value: string;
  label?: string;
  name?: string;
}

const getAspectRatiosForModel = (modelId: string, source: AspectRatioRow[]): AspectRatioRow[] => {
  let allowed: readonly string[];
  if (
    modelId === "gemini" ||
    modelId === NANO_BANANA_2_MODEL ||
    modelId === NANO_BANANA_2_LITE_MODEL
  ) {
    allowed = GEMINI_ALLOWED_ASPECT_RATIOS;
  } else if (modelId === "openai-2" || modelId === "openai-2.5" || modelId === "openai-flare") {
    allowed = OPENAI_2_ALLOWED_ASPECT_RATIOS;
  } else if (modelId === "openai" || modelId === "openai-mini") {
    allowed = OPENAI_ALLOWED_ASPECT_RATIOS;
  } else {
    return source.filter((r) => normalizeAspectRatio(r.value));
  }

  const byValue = new Map(source.map((r) => [normalizeAspectRatio(r.value), r]));
  return allowed.map((value) => {
    const existing = byValue.get(value);
    if (existing) {
      return { ...existing, value };
    }
    return {
      value,
      label: value,
      name: value,
    };
  });
};

const getSafeAspectRatioForModel = (
  modelId: string,
  requestedAspectRatio: string,
  allRatios: AspectRatioRow[],
): string => {
  const normalizedRequested = normalizeAspectRatio(requestedAspectRatio);
  const modelRatios = getAspectRatiosForModel(modelId, allRatios);
  const modelValues = modelRatios.map((r) => normalizeAspectRatio(r.value)).filter(Boolean);

  if (normalizedRequested && modelValues.includes(normalizedRequested)) {
    return normalizedRequested;
  }

  const closest = normalizedRequested
    ? findClosestAspectRatio(normalizedRequested, modelValues)
    : null;

  return closest || modelValues[0] || "1:1";
};

/** --- BYOK resolution (parity with services/correctionAnalysisRouter) --- */

type ApiKeyProvider = "gemini" | "openai" | "openrouter";

const normalizeStoredApiKey = (value: string): string =>
  value.replace(/^\uFEFF/, "").trim();

const getProviderForModel = (modelId: string): ApiKeyProvider | undefined => {
  if (
    modelId === "gemini" ||
    modelId === NANO_BANANA_2_MODEL ||
    modelId === NANO_BANANA_2_LITE_MODEL ||
    modelId === "gemini-svg"
  ) {
    return "gemini";
  }
  if (
    modelId === "openai" ||
    modelId === "openai-2" ||
    modelId === "openai-2.5" ||
    modelId === "openai-flare" ||
    modelId === "openai-mini"
  ) {
    return "openai";
  }
  if (modelId.startsWith("openrouter:")) {
    return "openrouter";
  }
  return undefined;
};

const isLikelyOpenAIKey = (value: string): boolean =>
  /^sk-[A-Za-z0-9_-]+$/.test(value) && value.length >= 20 && value.length <= 256 &&
  !value.startsWith("sk-or-");
const isLikelyOpenRouterKey = (value: string): boolean =>
  /^sk-or-[A-Za-z0-9_-]+$/.test(value) && value.length >= 20 && value.length <= 256;
const isLikelyGoogleApiKey = (value: string): boolean =>
  /^AIza[A-Za-z0-9_-]+$/.test(value) && value.length >= 30 && value.length <= 60;

const normalizeProviderKey = (
  value: string | undefined,
  provider: ApiKeyProvider,
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const key = normalizeStoredApiKey(value);
  if (!key) return undefined;

  if (provider === "gemini") return isLikelyGoogleApiKey(key) ? key : undefined;
  if (provider === "openai") return isLikelyOpenAIKey(key) ? key : undefined;
  if (provider === "openrouter") return isLikelyOpenRouterKey(key) ? key : undefined;
  return undefined;
};

interface FolderRow {
  id: string;
  name: string;
  createdAt: number;
}

interface PreferencesShape {
  apiKeys?: Record<string, string>;
  geminiApiKey?: string;
  selectedModel?: string;
  systemPrompt?: string;
  folders?: unknown[];
  settings?: {
    defaultGraphicTypeId?: string;
    defaultVisualStyleId?: string;
    defaultColorSchemeId?: string;
    defaultAspectRatio?: string;
    openaiImageQuality?: "low" | "medium" | "high" | "xhigh" | "max" | "auto";
  };
  presets?: Array<{
    id: string;
    name: string;
    graphicTypeId?: string;
    visualStyleId?: string;
    colorSchemeId?: string;
    aspectRatio?: string;
    svgMode?: string;
    selectedModel?: string;
    openaiImageQuality?: "low" | "medium" | "high" | "xhigh" | "max" | "auto";
  }>;
}

function getApiKeyForModelFromPrefs(modelId: string, prefs?: PreferencesShape): string | undefined {
  if (!prefs) return undefined;
  const provider = getProviderForModel(modelId);
  const slot = prefs.apiKeys?.[modelId];
  if (provider) {
    const t = normalizeProviderKey(slot, provider);
    if (t) return t;
  }

  if (provider === "gemini") {
    const shared = normalizeProviderKey(prefs.apiKeys?.gemini, "gemini");
    if (shared) return shared;
    const legacy = normalizeProviderKey(prefs.geminiApiKey, "gemini");
    if (legacy) return legacy;
    if (modelId === "gemini") {
      const nb2 = normalizeProviderKey(prefs.apiKeys?.[NANO_BANANA_2_MODEL], "gemini");
      if (nb2) return nb2;
    }
  }
  if (provider === "openai") {
    const k = normalizeProviderKey(prefs.apiKeys?.openai, "openai");
    if (k) return k;
  }
  if (provider === "openrouter") {
    const k = normalizeProviderKey(prefs.apiKeys?.openrouter, "openrouter");
    if (k) return k;
  }
  return undefined;
}

/** --- Scoped Firestore catalogs (parity with resourceService.fetchScopedResources) --- */

async function fetchScopedResources(
  db: Firestore,
  collectionName: string,
  userId: string | undefined,
  teamIds: string[],
): Promise<Array<Record<string, unknown> & { id: string }>> {
  const results: Array<Record<string, unknown> & { id: string }> = [];
  const ref = db.collection(collectionName);

  const globalSnap = await ref.where("scope", "in", ["system", "public"]).get();
  globalSnap.docs.forEach((d) =>
    results.push({ id: d.id, ...(d.data() as Record<string, unknown>) }),
  );

  if (userId) {
    const privateSnap = await ref
      .where("scope", "==", "private")
      .where("authorId", "==", userId)
      .get();
    privateSnap.docs.forEach((d) =>
      results.push({ id: d.id, ...(d.data() as Record<string, unknown>) }),
    );

    const safeTeams = teamIds.slice(0, 10);
    if (safeTeams.length > 0) {
      const teamSnap = await ref.where("scope", "==", "team").where("teamId", "in", safeTeams).get();
      teamSnap.docs.forEach((d) =>
        results.push({ id: d.id, ...(d.data() as Record<string, unknown>) }),
      );
    }
  }

  return Array.from(new Map(results.map((item) => [item.id, item])).values());
}

interface BrandColorRow {
  id: string;
  name?: string;
  colors?: string[];
}
interface VisualStyleRow {
  id: string;
  name?: string;
  description?: string;
}
interface GraphicTypeRow {
  id: string;
  name?: string;
}

interface GenerationCtx {
  brandColors: BrandColorRow[];
  visualStyles: VisualStyleRow[];
  graphicTypes: GraphicTypeRow[];
  aspectRatios: AspectRatioRow[];
}

interface GenerationConfig {
  prompt: string;
  colorSchemeId: string;
  visualStyleId: string;
  graphicTypeId: string;
  aspectRatio: string;
}

const pickId = (
  items: { id: string }[],
  preferredId?: string,
  fallbackId?: string,
): string => {
  if (preferredId && items.some((item) => item.id === preferredId)) return preferredId;
  if (fallbackId && items.some((item) => item.id === fallbackId)) return fallbackId;
  return items[0]?.id || "";
};

/** Gemini path (parity with geminiService.constructFullPrompt) */
function constructGeminiPrompt(config: GenerationConfig, ctx: GenerationCtx): string {
  const colorScheme = ctx.brandColors.find((c) => c.id === config.colorSchemeId);
  const style = ctx.visualStyles.find((s) => s.id === config.visualStyleId);
  const type = ctx.graphicTypes.find((t) => t.id === config.graphicTypeId);

  const colors = colorScheme ? colorScheme.colors?.join(", ") || "standard colors" : "standard colors";
  const styleDesc = style ? style.description || style.name || "clean style" : "clean style";
  const typeName = type ? type.name || type.id : "image";

  return `
    Create a ${typeName}.
    Visual Style: ${styleDesc}.
    Color Palette: Strictly use these colors: ${colors}.

    Content Request: ${config.prompt}

    Ensure the output is high quality and adheres to the style constraints.
  `.trim();
}

/** OpenAI path — structured prompt like App.buildStructuredPrompt */
function buildStructuredOpenAIPrompt(
  cfg: GenerationConfig,
  ctx: GenerationCtx,
  modelId: string,
): string {
  const modelRatios = getAspectRatiosForModel(modelId, ctx.aspectRatios);
  const typeLabel =
    ctx.graphicTypes.find((g) => g.id === cfg.graphicTypeId)?.name || cfg.graphicTypeId;
  const styleObj = ctx.visualStyles.find((s) => s.id === cfg.visualStyleId);
  const styleLabel = styleObj?.name || cfg.visualStyleId;
  const styleDesc = styleObj?.description ? ` (${styleObj.description})` : "";
  const colorsObj = ctx.brandColors.find((c) => c.id === cfg.colorSchemeId);
  const colorsLabel = colorsObj
    ? `${colorsObj.name || colorsObj.id}: ${(colorsObj.colors || []).join(", ")}`
    : "";
  const aspectLabel =
    modelRatios.find((a) => normalizeAspectRatio(a.value) === normalizeAspectRatio(cfg.aspectRatio))
      ?.label ||
    cfg.aspectRatio;

  const expanded = [
    `Generate a ${typeLabel}`,
    aspectLabel ? `at ${aspectLabel} aspect ratio` : "",
    styleLabel ? `in the ${styleLabel}${styleDesc}` : "",
    colorsLabel ? `using palette ${colorsLabel}` : "",
    `Subject/Content: ${cfg.prompt}`,
  ]
    .filter(Boolean)
    .join(". ");

  return [
    `Original Prompt: ${cfg.prompt}`,
    `Structured Prompt: ${expanded}`,
    `Type: ${typeLabel}`,
    styleLabel ? `Style: ${styleLabel}${styleDesc}` : "",
    colorsLabel ? `Colors: ${colorsLabel}` : "",
    aspectLabel ? `Size: ${aspectLabel}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const resolveOpenAiApiModel = (uiModelId?: string): string => {
  if (uiModelId && API_MODEL_BY_UI_ID[uiModelId]) return API_MODEL_BY_UI_ID[uiModelId];
  return API_MODEL_BY_UI_ID.openai;
};

function usesWideOpenAISizes(apiModel: string): boolean {
  return (
    apiModel === "gpt-image-2" ||
    apiModel === "gpt-image-2.5-sunburst" ||
    apiModel === "gpt-image-2.5-flare" ||
    apiModel.startsWith("gpt-image-2.5-")
  );
}

function aspectToOpenAISize(apiModel: string, aspect: string): string {
  if (usesWideOpenAISizes(apiModel)) {
    return GPT_IMAGE_2_SIZE_BY_RATIO[aspect] || "1024x1024";
  }
  return LEGACY_SIZE_BY_RATIO[aspect] || "1024x1024";
}

async function generateOpenAIImage(
  structuredPrompt: string,
  cfg: GenerationConfig,
  apiKey: string,
  opts: { modelId?: string; quality?: "low" | "medium" | "high" | "xhigh" | "max" | "auto"; systemPrompt?: string },
): Promise<{ base64Data: string; mimeType: string }> {
  const apiModel = resolveOpenAiApiModel(opts.modelId);
  const size = aspectToOpenAISize(apiModel, normalizeAspectRatio(cfg.aspectRatio));

  const quality = opts.quality || "auto";
  const systemPrompt = opts.systemPrompt?.trim();

  let fullPrompt = structuredPrompt;
  if (systemPrompt) {
    fullPrompt = `${systemPrompt}\n\n${structuredPrompt}`;
  }

  const body: Record<string, unknown> = {
    model: apiModel,
    prompt: fullPrompt,
    size,
  };
  if (apiModel !== "gpt-image-1.5" && quality !== "auto") {
    body.quality = quality;
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.warn("OpenAI generations error", { status: response.status, errText: errText.slice(0, 500) });
    throw new Error(`OpenAI rejected the request (${response.status}). Check your key and quotas.`);
  }

  const json = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const data = json?.data?.[0];
  if (!data) throw new Error("OpenAI image generation returned no image data");

  let base64Data: string | undefined;
  let mimeType = "image/png";
  if (data.b64_json) {
    base64Data = data.b64_json;
  } else if (data.url) {
    const r = await fetch(data.url);
    if (!r.ok) throw new Error("Failed to fetch OpenAI image URL");
    const buf = Buffer.from(await r.arrayBuffer());
    base64Data = buf.toString("base64");
    mimeType = r.headers.get("content-type") || "image/png";
  } else {
    throw new Error("OpenAI returned neither b64_json nor url");
  }

  return { base64Data: base64Data!, mimeType };
}

function shouldRetryGeminiImageModel(error: unknown): boolean {
  const raw = `${error}`;
  return /API_KEY_INVALID|INVALID_ARGUMENT|not found|not supported|Model .*not/i.test(raw);
}

const extractImageFromGeminiResponse = (
  response: { candidates?: Array<{ content?: { parts?: unknown[] } }> },
): { base64Data: string; mimeType: string } => {
  const parts = response.candidates?.[0]?.content?.parts as Array<Record<string, unknown>> | undefined;
  if (!parts?.length) throw new Error("No candidates returned from Gemini.");

  let imagePart: Record<string, unknown> | null = null;
  for (const part of parts) {
    const inlineData = part?.inlineData as { data?: string; mimeType?: string } | undefined;
    if (inlineData?.data) {
      imagePart = part;
      break;
    }
  }

  if (!imagePart) {
    const textPart = parts.find((p: Record<string, unknown>) => p.text) as {
      text?: string;
    } | undefined;
    if (textPart?.text) {
      throw new Error(`Gemini returned text instead of image: ${textPart.text}`);
    }
    throw new Error("No image data in Gemini response.");
  }

  const inlineData = imagePart.inlineData as { data: string; mimeType?: string };
  return {
    base64Data: inlineData.data,
    mimeType: inlineData.mimeType || "image/png",
  };
};

const getGeminiImageModelCandidates = (selectedModel?: string): readonly string[] => {
  if (selectedModel === NANO_BANANA_2_LITE_MODEL)
    return [NANO_BANANA_2_LITE_MODEL, NANO_BANANA_PRO_MODEL];
  if (selectedModel === NANO_BANANA_2_MODEL)
    return [NANO_BANANA_2_MODEL, NANO_BANANA_PRO_MODEL];
  return [NANO_BANANA_PRO_MODEL];
};

async function generateGeminiImage(
  fullPrompt: string,
  cfg: GenerationConfig,
  apiKey: string,
  systemPromptEffective: string | undefined,
  selectedModel: string,
  allAspectRatios: AspectRatioRow[],
): Promise<{ base64Data: string; mimeType: string }> {
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const safeAspectRatio = getSafeAspectRatioForModel(selectedModel, cfg.aspectRatio, allAspectRatios);
  const generationModels = getGeminiImageModelCandidates(selectedModel);
  let lastError: unknown;

  for (let mi = 0; mi < generationModels.length; mi++) {
    const generationModel = generationModels[mi];
    try {
      const baseConfig = {
        responseModalities: ["TEXT", "IMAGE"] as unknown as string[],
        imageConfig: { aspectRatio: safeAspectRatio },
      };
      const configWithSi =
        systemPromptEffective && systemPromptEffective.trim()
          ? { ...baseConfig, systemInstruction: systemPromptEffective.trim() }
          : baseConfig;

      const response = await ai.models.generateContent({
        model: generationModel,
        contents: {
          parts: [{ text: fullPrompt }],
        },
        config: configWithSi as never,
      });
      return extractImageFromGeminiResponse(response as never);
    } catch (error: unknown) {
      lastError = error;
      const moreModels = mi < generationModels.length - 1;
      if (moreModels && shouldRetryGeminiImageModel(error)) {
        logger.warn(`Gemini generation: ${generationModel} failed, retrying`, { message: `${error}` });
        continue;
      }
      logger.error("Gemini generation failed", error);
      throw error instanceof Error
        ? error
        : new Error(`Gemini image generation failed: ${String(error)}`);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Gemini image generation failed: ${String(lastError)}`);
}

/** --- Version labels (parity with services/versionUtils) --- */

const ROMAN_MAP: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

const toRomanNumeral = (num: number): string => {
  if (num <= 0) return "";
  let result = "";
  let remaining = num;
  for (const [value, numeral] of ROMAN_MAP) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
};

const toMarkLabel = (versionNumber: number): string =>
  `Mark ${toRomanNumeral(versionNumber)}`;

/** ---------- Storage upload (Firebase download URL parity with client) ---------- */

function extensionForMime(mimeType: string): string {
  const m = (mimeType || "").toLowerCase();
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("svg")) return "svg";
  if (m.includes("gif")) return "gif";
  return "png";
}

function stripBase64Payload(raw: string): string {
  const m = raw.match(/^data:[^;]+;base64,(.+)$/);
  return (m?.[1] || raw).replace(/\s+/g, "");
}

/** ---------- Output format conversion ---------- */

type OutputFormat = "webp" | "png" | "jpeg";

const OUTPUT_FORMATS: readonly OutputFormat[] = ["webp", "png", "jpeg"];

/**
 * Convert to the requested format at identical pixel dimensions. webp is
 * encoded lossless (exact pixels, smaller than PNG); jpeg is quality 95.
 * Keeps the original when it is already smaller or conversion fails.
 */
async function convertImageFormat(
  image: { base64Data: string; mimeType: string },
  format: OutputFormat,
): Promise<{ base64Data: string; mimeType: string }> {
  const current = (image.mimeType || "").toLowerCase();
  if (current.includes(format) || (format === "jpeg" && current.includes("jpg"))) {
    return image;
  }
  try {
    const input = Buffer.from(stripBase64Payload(image.base64Data), "base64");
    let out: Buffer;
    if (format === "webp") {
      out = await sharp(input).webp({ lossless: true, effort: 4 }).toBuffer();
    } else if (format === "png") {
      out = await sharp(input).png().toBuffer();
    } else {
      out = await sharp(input).jpeg({ quality: 95 }).toBuffer();
    }
    if (out.length >= input.length) return image;
    return { base64Data: out.toString("base64"), mimeType: `image/${format}` };
  } catch (e: unknown) {
    logger.warn("Output format conversion failed; keeping original", {
      format,
      msg: e instanceof Error ? e.message : String(e),
    });
    return image;
  }
}


/** ---- OpenRouter Images API (mirrors client services/openRouterService) --- */

async function generateOpenRouterImage(
  prompt: string,
  config: GenerationConfig,
  apiKey: string,
  options: { modelSlug: string; systemPrompt?: string },
): Promise<{ base64Data: string; mimeType: string }> {
  const fullPrompt = options.systemPrompt?.trim()
    ? `${options.systemPrompt.trim()}\n\n${prompt}`
    : prompt;
  const generated = await generateOpenRouterImageCore({
    apiKey,
    modelSlug: options.modelSlug,
    prompt: fullPrompt,
    aspectRatio: config.aspectRatio,
    title: "PixTaffy API",
  });
  return { base64Data: generated.base64Data, mimeType: generated.mimeType };
}

async function uploadGenerationImageAdmin(
  userId: string,
  generationId: string,
  versionId: string,
  base64Data: string,
  mimeType: string,
): Promise<{ storagePath: string; downloadUrl: string }> {
  const bucket = getStorage().bucket();
  const clean = stripBase64Payload(base64Data);
  if (!clean || clean.length < 100) throw new Error("Empty image payload for upload.");
  const extension = extensionForMime(mimeType || "image/png");
  const storagePath = `users/${userId}/history/${generationId}/${versionId}.${extension}`;
  const buffer = Buffer.from(clean, "base64");
  const safeMime = mimeType || "image/png";
  const token = randomUUID();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: {
      contentType: safeMime,
      metadata: {
        firebaseStorageDownloadTokens: token,
        generationId,
        versionId,
      },
    },
  });

  const encodedPath = encodeURIComponent(storagePath);
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
  return { storagePath, downloadUrl };
}

/** ---------- Folders ---------- */

const sanitizeFolder = (raw: unknown): FolderRow | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = o.id;
  const name = o.name;
  if (typeof id !== "string" || typeof name !== "string") return null;
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  return {
    id,
    name: trimmedName,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
  };
};

const ensureInbox = (folders: FolderRow[]): FolderRow[] => {
  if (folders.some((f) => f.id === INBOX_FOLDER_ID)) return folders;
  return [
    { id: INBOX_FOLDER_ID, name: "Inbox", createdAt: Date.now() },
    ...folders,
  ];
};

const generateFolderId = (): string => `folder-${randomUUID()}`;

const generateGenerationId = (): string =>
  `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** ---------- Request body ---------- */

interface AgentBody {
  prompt?: string;
  /** Alternative to repeating `prompt`; max length enforced server-side */
  prompts?: string[];
  presetId?: string;
  presetName?: string;
  settings?: Partial<{
    graphicTypeId: string;
    visualStyleId: string;
    colorSchemeId: string;
    aspectRatio: string;
    selectedModel: string;
    svgMode: string;
    openaiImageQuality: "low" | "medium" | "high" | "xhigh" | "max" | "auto";
    /** Delivered file format; defaults to "webp" (lossless, same resolution, smaller). */
    outputFormat: OutputFormat;
  }>;
  systemPromptOverride?: string;
  systemPromptAppend?: string;
  /** When true, persists each tile to Firestore history + Firebase Storage under the user's account. */
  saveToGallery?: boolean;
  /** Mutually exclusive: target folder id, or match by folder name (CI exact), or create a brand-new folder */
  folderId?: string;
  folderName?: string;
  createFolderWithName?: string;
  /** When saving, omit large base64 in JSON unless true (defaults: true when not saving). */
  returnImageBase64?: boolean;
}

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function mergeSystemPrompt(base: string, append?: string): string | undefined {
  const b = base.trim();
  const a = (append || "").trim();
  if (!b && !a) return undefined;
  if (!b) return a;
  if (!a) return b;
  return `${b}\n\n${a}`;
}

function sendJson(res: Response, status: number, body: Record<string, unknown>): void {
  res.status(status).json(body);
}

type SavedPreset = NonNullable<PreferencesShape["presets"]>[number];

type ResolveFolderOutcome =
  | { ok: true; folderId: string }
  | { ok: false; status: number; body: Record<string, unknown> };

const foldersFromPreferences = (
  prefs: PreferencesShape | undefined,
): FolderRow[] =>
  ensureInbox(
    Array.isArray(prefs?.folders)
      ? prefs!.folders!.map(sanitizeFolder).filter((f): f is FolderRow => f !== null)
      : [],
  );

async function resolveGalleryFolderTarget(params: {
  db: Firestore;
  userRef: DocumentReference;
  prefs?: PreferencesShape;
  folderIdBody?: string;
  folderNameBody?: string;
  createFolderWithNameBody?: string;
}): Promise<ResolveFolderOutcome> {
  const { db, userRef } = params;
  const folderIdTrim = typeof params.folderIdBody === "string" ? params.folderIdBody.trim() : "";
  const folderNameTrim =
    typeof params.folderNameBody === "string" ? params.folderNameBody.trim() : "";
  const createNameTrim =
    typeof params.createFolderWithNameBody === "string"
      ? params.createFolderWithNameBody.trim()
      : "";

  const selected = [folderIdTrim, folderNameTrim, createNameTrim].filter(Boolean).length;
  if (selected > 1) {
    return {
      ok: false,
      status: 400,
      body: { error: "Use only one of folderId, folderName, or createFolderWithName." },
    };
  }

  if (!createNameTrim && !folderNameTrim && !folderIdTrim) {
    return { ok: true, folderId: INBOX_FOLDER_ID };
  }

  if (folderIdTrim) {
    if (folderIdTrim === INBOX_FOLDER_ID) {
      return { ok: true, folderId: INBOX_FOLDER_ID };
    }
    const folders = foldersFromPreferences(params.prefs);
    const found = folders.find((f) => f.id === folderIdTrim);
    if (!found) {
      return {
        ok: false,
        status: 400,
        body: { error: `Unknown folderId "${folderIdTrim}".` },
      };
    }
    return { ok: true, folderId: folderIdTrim };
  }

  if (folderNameTrim) {
    const folders = foldersFromPreferences(params.prefs);
    const want = folderNameTrim.toLowerCase();
    const matches = folders.filter((f) => f.name.trim().toLowerCase() === want);
    if (matches.length === 0) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `No folder named "${folderNameTrim}" (case-insensitive exact match).`,
        },
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `Several folders named "${folderNameTrim}". Pass folderId instead.`,
          matchingIds: matches.map((m) => m.id),
        },
      };
    }
    return { ok: true, folderId: matches[0]!.id };
  }

  // createFolderWithName — append with latest folders snapshot
  try {
    let newId = "";
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(userRef);
      const p = snap.data()?.preferences as PreferencesShape | undefined;
      const folders = foldersFromPreferences(p);
      const id = generateFolderId();
      const neu: FolderRow = { id, name: createNameTrim, createdAt: Date.now() };
      newId = id;
      txn.update(userRef, {
        "preferences.folders": [...folders, neu],
      });
    });
    return { ok: true, folderId: newId };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("resolveGalleryFolderTarget transaction failed", { msg });
    return {
      ok: false,
      status: 500,
      body: { error: `Failed to create folder: ${msg}` },
    };
  }
}

export const agentGenerateImage = onRequest(
  {
    cors: true,
    region: REGION,
    memory: "1GiB",
    timeoutSeconds: 540,
    invoker: "public",
  },
  async (req, res) => {
    const out = res as Response;
    try {
      if (req.method === "OPTIONS") {
        out.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        sendJson(out, 405, { error: "Use POST." });
        return;
      }

      const token = parseBearer(req.headers.authorization);
      if (!token) {
        sendJson(out, 401, { error: "Missing Authorization bearer token." });
        return;
      }

      // Two credential kinds:
      //  - `bdi_…` personal API token (created in Settings) — any account in
      //    good standing; rate-limited per account below.
      //  - Firebase ID token — the original path, still admin-only.
      let authUid: string;
      let authVia: "idToken" | "apiToken";
      if (token.startsWith("bdi_")) {
        const verified = await verifyApiToken(admin.firestore(), token);
        if (!verified) {
          sendJson(out, 401, { error: "Invalid or revoked API token." });
          return;
        }
        authUid = verified.uid;
        authVia = "apiToken";
      } else {
        let decoded: admin.auth.DecodedIdToken;
        try {
          decoded = await admin.auth().verifyIdToken(token);
        } catch {
          sendJson(out, 401, { error: "Invalid or expired Firebase ID token." });
          return;
        }
        if (!(decoded as { admin?: boolean }).admin) {
          sendJson(out, 403, { error: "Admin claim required (or use a personal API token)." });
          return;
        }
        authUid = decoded.uid;
        authVia = "idToken";
      }

      let body: AgentBody;
      try {
        body =
          typeof req.body === "string"
            ? (JSON.parse(req.body as string) as AgentBody)
            : ((req.body as AgentBody | undefined) || {});
      } catch {
        sendJson(out, 400, { error: "Malformed JSON." });
        return;
      }

      const promptsFromArr = Array.isArray(body.prompts)
        ? body.prompts
            .map((p) => (typeof p === "string" ? p.trim() : ""))
            .filter(Boolean)
        : [];
      const promptSingle =
        typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : "";

      let promptsToRun: string[] =
        promptsFromArr.length > 0 ? promptsFromArr : promptSingle ? [promptSingle] : [];

      if (promptsFromArr.length > 0 && promptSingle) {
        sendJson(out, 400, { error: "Use either `prompt` or `prompts`, not both." });
        return;
      }

      if (promptsToRun.length === 0) {
        sendJson(out, 400, { error: "`prompt` or non-empty `prompts[]` is required." });
        return;
      }

      if (promptsToRun.length > MAX_BATCH_PROMPTS) {
        sendJson(out, 400, {
          error: `At most ${MAX_BATCH_PROMPTS} prompts per request.`,
        });
        return;
      }

      if (authVia === "apiToken") {
        try {
          await enforceApiRateLimit(admin.firestore(), authUid, promptsToRun.length);
        } catch (e) {
          if (e instanceof RateLimitError) {
            sendJson(out, 429, { error: e.message });
            return;
          }
          throw e;
        }
      }

      const saveToGallery = body.saveToGallery === true;

      if (body.presetId && body.presetName) {
        sendJson(out, 400, { error: "Use only one of presetId or presetName." });
        return;
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(authUid);
      const userSnap = await userRef.get();
      const userData = userSnap.data();
      if (!userData) {
        sendJson(out, 404, { error: "User profile not found." });
        return;
      }
      if (userData.isDisabled === true) {
        sendJson(out, 403, { error: "Account suspended." });
        return;
      }

      let prefs = userData.preferences as PreferencesShape | undefined;
      const teamIds = (userData.teamIds as string[] | undefined) || [];

      let targetFolderId: string = INBOX_FOLDER_ID;
      if (saveToGallery) {
        const folderRes = await resolveGalleryFolderTarget({
          db,
          userRef,
          prefs,
          folderIdBody: body.folderId,
          folderNameBody: body.folderName,
          createFolderWithNameBody: body.createFolderWithName,
        });
        if (!folderRes.ok) {
          sendJson(out, folderRes.status, folderRes.body);
          return;
        }
        targetFolderId = folderRes.folderId;
      }

      const [graphicSnap, ratiosSnap, stylesSnap, colorsSnap] = await Promise.all([
        fetchScopedResources(db, "graphic_types", authUid, teamIds),
        fetchScopedResources(db, "aspect_ratios", authUid, teamIds),
        fetchScopedResources(db, "visual_styles", authUid, teamIds),
        fetchScopedResources(db, "brand_colors", authUid, teamIds),
      ]);

      const ctx: GenerationCtx = {
        graphicTypes: graphicSnap as GraphicTypeRow[],
        visualStyles: stylesSnap as VisualStyleRow[],
        brandColors: colorsSnap as BrandColorRow[],
        aspectRatios: ratiosSnap
          .map((r) => {
            const row = r as Record<string, unknown>;
            const value = typeof row.value === "string" ? row.value : "";
            return {
              id: String(r.id),
              value,
              label: typeof row.label === "string" ? row.label : value,
              name: typeof row.name === "string" ? row.name : value,
            };
          })
          .filter((r) => normalizeAspectRatio(r.value)),
      };

      if (
        ctx.graphicTypes.length === 0 ||
        ctx.brandColors.length === 0 ||
        ctx.visualStyles.length === 0 ||
        ctx.aspectRatios.length === 0
      ) {
        sendJson(out, 500, {
          error:
            "Could not resolve catalog assets from Firestore. Ensure resources are seeded and accessible.",
        });
        return;
      }

      const presets = prefs?.presets || [];
      let presetMatch: SavedPreset | null = null;
      if (body.presetId) {
        const id = String(body.presetId).trim();
        presetMatch = presets.find((p) => p.id === id) || null;
        if (!presetMatch) {
          sendJson(out, 400, { error: `No preset with id "${id}".` });
          return;
        }
      } else if (body.presetName) {
        const want = body.presetName.trim().toLowerCase();
        const candidates = presets.filter((p) => p.name.trim().toLowerCase() === want);
        if (candidates.length === 0) {
          sendJson(out, 400, {
            error: `No preset named "${body.presetName}" (case-insensitive exact match).`,
          });
          return;
        }
        if (candidates.length > 1) {
          sendJson(out, 400, {
            error: `Several presets named "${body.presetName}". Pass presetId instead.`,
            matchingIds: candidates.map((p) => p.id),
          });
          return;
        }
        presetMatch = candidates[0];
      }

      const st = prefs?.settings || {};
      const ov = body.settings || {};

      const graphicTypeId = pickId(
        ctx.graphicTypes,
        ov.graphicTypeId || presetMatch?.graphicTypeId,
        st.defaultGraphicTypeId,
      );
      const visualStyleId = pickId(
        ctx.visualStyles,
        ov.visualStyleId || presetMatch?.visualStyleId,
        st.defaultVisualStyleId,
      );
      let colorSchemeId = pickId(
        ctx.brandColors,
        ov.colorSchemeId || presetMatch?.colorSchemeId,
        st.defaultColorSchemeId,
      );
      if (!colorSchemeId) {
        colorSchemeId = ctx.brandColors[0]!.id;
      }

      const aspectDraft = (
        ov.aspectRatio ||
        presetMatch?.aspectRatio ||
        st.defaultAspectRatio ||
        ctx.aspectRatios[0]?.value ||
        "16:9"
      ).trim();

      const selectedModel = (
        ov.selectedModel ||
        presetMatch?.selectedModel ||
        prefs?.selectedModel ||
        NANO_BANANA_2_MODEL
      ).trim();

      if (selectedModel === "gemini-svg") {
        sendJson(out, 400, { error: "gemini-svg is not supported via this endpoint." });
        return;
      }

      const openAIQuality =
        ov.openaiImageQuality ||
        presetMatch?.openaiImageQuality ||
        prefs?.settings?.openaiImageQuality ||
        "auto";

      const outputFormatRaw = String(ov.outputFormat || "webp").toLowerCase();
      if (!OUTPUT_FORMATS.includes(outputFormatRaw as OutputFormat)) {
        sendJson(out, 400, {
          error: `Unsupported outputFormat "${ov.outputFormat}". Use "webp", "png", or "jpeg".`,
        });
        return;
      }
      const outputFormat = outputFormatRaw as OutputFormat;

      const apiKey = getApiKeyForModelFromPrefs(selectedModel, prefs);
      if (!apiKey) {
        sendJson(out, 400, {
          error: `No API key configured for "${selectedModel}" (BYOK in Settings).`,
        });
        return;
      }

      const safeAspectRatio = getSafeAspectRatioForModel(
        selectedModel,
        aspectDraft,
        ctx.aspectRatios,
      );

      const storedPrompt = prefs?.systemPrompt?.trim() || "";
      const overridePrompt =
        typeof body.systemPromptOverride === "string" ? body.systemPromptOverride.trim() : "";
      const appendPrompt =
        typeof body.systemPromptAppend === "string" ? body.systemPromptAppend.trim() : "";
      const effectiveBase = overridePrompt || storedPrompt;
      const systemCombined = mergeSystemPrompt(effectiveBase, appendPrompt);

      /** Base64 omitted by default when saving (bandwidth); pass returnImageBase64: true to include. */
      let wantBase64: boolean;
      if (typeof body.returnImageBase64 === "boolean") {
        wantBase64 = body.returnImageBase64;
      } else if (saveToGallery) {
        wantBase64 = false;
      } else {
        wantBase64 = true;
      }

      const results: Record<string, unknown>[] = [];

      for (let i = 0; i < promptsToRun.length; i++) {
        const promptRaw = promptsToRun[i]!;
        const config: GenerationConfig = {
          prompt: promptRaw,
          graphicTypeId,
          visualStyleId,
          colorSchemeId,
          aspectRatio: safeAspectRatio,
        };

        let resultImage: { base64Data: string; mimeType: string };
        try {
          if (
            selectedModel === "openai" ||
            selectedModel === "openai-2" ||
            selectedModel === "openai-2.5" ||
            selectedModel === "openai-flare" ||
            selectedModel === "openai-mini"
          ) {
            const structured = buildStructuredOpenAIPrompt(config, ctx, selectedModel);
            resultImage = await generateOpenAIImage(structured, config, apiKey, {
              modelId: selectedModel,
              quality: openAIQuality,
              systemPrompt: systemCombined,
            });
          } else if (
            selectedModel === "gemini" ||
            selectedModel === NANO_BANANA_2_MODEL ||
            selectedModel === NANO_BANANA_2_LITE_MODEL
          ) {
            const geminiPrompt = constructGeminiPrompt(config, ctx);
            resultImage = await generateGeminiImage(
              geminiPrompt,
              config,
              apiKey,
              systemCombined,
              selectedModel,
              ctx.aspectRatios,
            );
          } else if (selectedModel.startsWith("openrouter:")) {
            const structured = buildStructuredOpenAIPrompt(config, ctx, selectedModel);
            resultImage = await generateOpenRouterImage(structured, config, apiKey, {
              modelSlug: selectedModel.slice("openrouter:".length),
              systemPrompt: systemCombined,
            });
          } else {
            sendJson(out, 400, { error: `Unsupported model "${selectedModel}".` });
            return;
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ index: i, prompt: promptRaw, ok: false, error: msg });
          continue;
        }

        resultImage = await convertImageFormat(resultImage, outputFormat);

        const hasBytes = Boolean(resultImage.base64Data && resultImage.base64Data.length > 100);
        if (!hasBytes) {
          results.push({
            index: i,
            prompt: promptRaw,
            ok: false,
            error: "Model returned unusable empty image payload.",
          });
          continue;
        }

        const entry: Record<string, unknown> = {
          index: i,
          prompt: promptRaw,
          ok: true,
          mimeType: resultImage.mimeType,
          aspectRatio: safeAspectRatio,
          modelId: selectedModel,
        };

        if (wantBase64) {
          entry.imageBase64 = resultImage.base64Data;
        }

        if (saveToGallery) {
          const generationId =
            promptsToRun.length > 1
              ? `${generateGenerationId()}-${i}-${randomUUID().slice(0, 8)}`
              : generateGenerationId();
          const versionId = `v-${generationId}-1`;
          const createdAt = Date.now();

          try {
            const uploaded = await uploadGenerationImageAdmin(
              authUid,
              generationId,
              versionId,
              resultImage.base64Data,
              resultImage.mimeType,
            );

            const historyPayload = JSON.parse(JSON.stringify({
              id: generationId,
              folderId: targetFolderId,
              createdAt,
              modelId: selectedModel,
              config: config,
              currentVersionIndex: 0,
              versions: [
                {
                  id: versionId,
                  number: 1,
                  label: toMarkLabel(1),
                  timestamp: createdAt,
                  type: "generation",
                  imageData: "",
                  imageUrl: uploaded.downloadUrl,
                  imageStoragePath: uploaded.storagePath,
                  mimeType: resultImage.mimeType,
                  aspectRatio: safeAspectRatio,
                  modelId: selectedModel,
                },
              ],
            }));

            const historyCol = db.collection("users").doc(authUid).collection("history");
            const docRef = await historyCol.add(historyPayload);
            entry.generationId = generationId;
            entry.versionId = versionId;
            entry.imageUrl = uploaded.downloadUrl;
            entry.historyDocId = docRef.id;
          } catch (persistErr: unknown) {
            const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
            logger.error("agentGenerateImage persistence failed", { generationIdHint: "[new]", msg });
            results.push({
              index: i,
              prompt: promptRaw,
              ok: false,
              error: `Generated image OK but failed to save: ${msg}`,
            });
            continue;
          }
        }

        results.push(entry);
      }

      const allFailed = results.length > 0 && results.every((r) => r.ok === false);
      if (allFailed && results.length === promptsToRun.length) {
        sendJson(out, 502, {
          error:
            promptsToRun.length === 1
              ? String(results[0]!.error || "Generation failed.")
              : "Every prompt in the batch failed.",
          results,
        });
        return;
      }

      const response: Record<string, unknown> = {
        results,
        targetFolderId: saveToGallery ? targetFolderId : undefined,
        preset: presetMatch ? { id: presetMatch.id, name: presetMatch.name } : null,
        aspectRatio: safeAspectRatio,
        modelId: selectedModel,
      };

      /** Back-compat: single-image, no-gallery response shape */
      if (!saveToGallery && promptsToRun.length === 1 && results.length === 1 && results[0]!.ok) {
        const r = results[0] as Record<string, unknown>;
        response.mimeType = r.mimeType;
        response.aspectRatio = r.aspectRatio;
        response.modelId = r.modelId;
        response.imageBase64 = r.imageBase64;
        response.prompt = promptsToRun[0];
      }

      sendJson(out, 200, response);
    } catch (err: unknown) {
      logger.error("agentGenerateImage error", err);
      const msg = err instanceof Error ? err.message : "Internal error.";
      sendJson(out, 500, { error: msg });
    }
  },
);
