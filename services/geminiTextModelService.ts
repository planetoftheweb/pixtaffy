import { GoogleGenAI } from "@google/genai";

// Text/vision helpers prefer Hydrogen, then the current Flash alias and Flash Lite.
export const GEMINI_TEXT_MODEL_FALLBACKS = [
  'gemini-4-hydrogen',
  'gemini-flash-latest',
  'gemini-3.5-flash-lite',
] as const;

type GenerateContentRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];
type GenerateContentResponse = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

export const stringifyGeminiCallError = (err: unknown): string => {
  if (err instanceof Error && err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

/** Prefer a short API message over a huge JSON blob in UI toasts. */
export const formatUserFacingGeminiError = (raw: string): string => {
  const s = raw.trim();
  try {
    const j = JSON.parse(s) as { message?: string; error?: { message?: string } };
    const inner = j?.error?.message || j?.message;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
  } catch {
    /* not JSON */
  }
  return s.length > 900 ? `${s.slice(0, 900)}…` : s;
};

/** True when retrying with another text model id might succeed. */
export const shouldRetryGeminiTextModelAfterError = (err: unknown): boolean => {
  const details = err as { status?: unknown; code?: unknown; error?: { status?: unknown; code?: unknown } } | null;
  const quotaStatus = [details?.status, details?.code, details?.error?.status, details?.error?.code]
    .some(status => status === 429 || status === '429' || status === 'RESOURCE_EXHAUSTED');
  return quotaStatus || /\b429\b|RESOURCE_EXHAUSTED|quota exceeded|API_KEY_INVALID|INVALID_ARGUMENT|not found|not supported|is not available|Model .*not/i.test(
    stringifyGeminiCallError(err)
  );
};

export const generateContentWithGeminiTextFallback = async (
  ai: GoogleGenAI,
  request: Omit<GenerateContentRequest, 'model'>,
  label: string
): Promise<GenerateContentResponse> => {
  let lastError: unknown;
  let hadQuotaError = false;

  for (let mi = 0; mi < GEMINI_TEXT_MODEL_FALLBACKS.length; mi++) {
    const model = GEMINI_TEXT_MODEL_FALLBACKS[mi];
    try {
      return await ai.models.generateContent({
        ...request,
        model,
      });
    } catch (error: unknown) {
      lastError = error;
      const details = error as { status?: unknown; code?: unknown; error?: { status?: unknown; code?: unknown } } | null;
      const isQuotaError = [details?.status, details?.code, details?.error?.status, details?.error?.code]
        .some(status => status === 429 || status === '429' || status === 'RESOURCE_EXHAUSTED') ||
        /\b429\b|RESOURCE_EXHAUSTED|quota\s+(?:exceeded|reached|exhausted)\b/i.test(stringifyGeminiCallError(error));
      hadQuotaError ||= isQuotaError;
      if (!isQuotaError && !shouldRetryGeminiTextModelAfterError(error)) throw error;
      const moreModels = mi < GEMINI_TEXT_MODEL_FALLBACKS.length - 1;
      if (moreModels) {
        console.warn(`${label}: model ${model} failed, retrying with next Flash id`, error);
        continue;
      }
      if (hadQuotaError) break;
      throw error;
    }
  }

  if (hadQuotaError) {
    throw new Error(`${label} failed after trying every Gemini text model. Google reported a quota or rate limit. ` +
      `Wait and try again, or check your project's quota and billing in Google AI Studio.`);
  }
  throw lastError instanceof Error ? lastError : new Error(stringifyGeminiCallError(lastError));
};
