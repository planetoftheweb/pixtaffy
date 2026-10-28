import { GoogleGenAI } from "@google/genai";

// Text/vision helper calls should use Google's always-current Flash alias first.
// Some projects return API_KEY_INVALID when a pinned model id is unavailable,
// even when the key itself works for other Gemini models.
export const GEMINI_TEXT_MODEL_FALLBACKS = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
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
export const shouldRetryGeminiTextModelAfterError = (err: unknown): boolean =>
  /API_KEY_INVALID|INVALID_ARGUMENT|not found|not supported|is not available|Model .*not/i.test(
    stringifyGeminiCallError(err)
  );

export const generateContentWithGeminiTextFallback = async (
  ai: GoogleGenAI,
  request: Omit<GenerateContentRequest, 'model'>,
  label: string
): Promise<GenerateContentResponse> => {
  let lastError: unknown;

  for (let mi = 0; mi < GEMINI_TEXT_MODEL_FALLBACKS.length; mi++) {
    const model = GEMINI_TEXT_MODEL_FALLBACKS[mi];
    try {
      return await ai.models.generateContent({
        ...request,
        model,
      });
    } catch (error: unknown) {
      lastError = error;
      const moreModels = mi < GEMINI_TEXT_MODEL_FALLBACKS.length - 1;
      if (moreModels && shouldRetryGeminiTextModelAfterError(error)) {
        console.warn(`${label}: model ${model} failed, retrying with next Flash id`, error);
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(stringifyGeminiCallError(lastError));
};
