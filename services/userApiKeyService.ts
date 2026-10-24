import { refineSvg as legacyRefineSvg } from './svgService';
import { generateSvg as legacyGenerateSvg } from './svgService';
import { generateOpenRouterImage as legacyGenerateOpenRouterImage } from './openRouterService';
import { refineOpenAIImage as legacyRefineOpenAIImage } from './openaiService';
import { generateOpenAIImage as legacyGenerateOpenAIImage } from './openaiService';
import { refineGraphic as legacyRefineGraphic } from './geminiService';
import { generateGraphicWithStyleReference as legacyGenerateGraphicWithStyleReference } from './geminiService';
import { generateGraphic as legacyGenerateGraphic } from './geminiService';
import { serverKeysEnabled } from './keyStorageMode';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { GeneratedImage, UserApiKeyStatusMap } from '../types';
import { resolveImageInputForRefinement } from './geminiService';
import { sanitizeSvg } from './svgService';

const call = async <T>(name: string, data: unknown = {}): Promise<T> =>
  (await httpsCallable<unknown, T>(functions, name, { timeout: 540000 })(JSON.parse(JSON.stringify(data)))).data;
export const getUserApiKeyStatus = () => call<UserApiKeyStatusMap>('getUserApiKeyStatus');
export const setUserApiKey = (slot: string, key: string) => call<UserApiKeyStatusMap>('setUserApiKey', { slot, key });
export const deleteUserApiKey = (slot: string) => call<UserApiKeyStatusMap>('deleteUserApiKey', { slot });
export const clearUserApiKeys = (uid?: string) => call<UserApiKeyStatusMap>('clearUserApiKeys', { uid });
export const listUserOpenRouterModels = () => call<Array<{ slug: string; name: string }>>('generateWithUserKey', { model: 'openrouter', action: 'models' });
export async function generateWithUserKey(payload: Record<string, unknown>): Promise<GeneratedImage & { svgCode: string }> {
  const result = await call<GeneratedImage & { svgCode: string }>('generateWithUserKey', payload);
  if (result.svgCode) {
    result.svgCode = sanitizeSvg(result.svgCode);
    result.base64Data = btoa(unescape(encodeURIComponent(result.svgCode)));
  }
  return { ...result, imageUrl: `data:${result.mimeType};base64,${result.base64Data}` };
}
const source = async (image: GeneratedImage) => {
  const resolved = await resolveImageInputForRefinement(image);
  return { base64Data: resolved.base64Data, mimeType: resolved.mimeType };
};
const serverGenerateGraphic: typeof import('./geminiService').generateGraphic = (config, context, _key, systemPrompt, model = 'gemini') =>
  generateWithUserKey({ config, context, systemPrompt, model });
const serverGenerateGraphicWithStyleReference: typeof import('./geminiService').generateGraphicWithStyleReference = async (image, prompt, config, context, _key, systemPrompt, model = 'gemini', options) =>
  generateWithUserKey({ image: await source(image), prompt, config, context, systemPrompt, model, action: 'style', options });
const serverRefineGraphic: typeof import('./geminiService').refineGraphic = async (image, prompt, config, context, _key, systemPrompt, model = 'gemini', previousAspectRatio, options) =>
  generateWithUserKey({ image: await source(image), prompt, config, context, systemPrompt, model, action: 'refine', previousAspectRatio, options });
const serverGenerateOpenAIImage: typeof import('./openaiService').generateOpenAIImage = (prompt, config, _key, options = {}) =>
  generateWithUserKey({ prompt, config, ...options, model: options.modelId || 'openai' });
const serverRefineOpenAIImage: typeof import('./openaiService').refineOpenAIImage = async (image, prompt, config, context, _key, options = {}) =>
  generateWithUserKey({ image: await source(image), prompt, config, context, ...options, model: options.modelId || 'openai', action: 'refine' });
const serverGenerateOpenRouterImage: typeof import('./openRouterService').generateOpenRouterImage = (prompt, config, _key, options) =>
  generateWithUserKey({ prompt, config, ...options, model: `openrouter:${options.modelSlug}` });
const serverGenerateSvg: typeof import('./svgService').generateSvg = (config, context, _key, systemPrompt) =>
  generateWithUserKey({ config, context, systemPrompt, model: 'gemini-svg' });
const serverRefineSvg: typeof import('./svgService').refineSvg = (svg, prompt, config, context, _key, systemPrompt) =>
  generateWithUserKey({ svg, prompt, config, context, systemPrompt, model: 'gemini-svg', action: 'refine' });

export interface SafeUserProfile {
  id: string; name?: string; username?: string; email?: string; photoURL?: string;
  createdAt?: string | number; lastSignInAt?: string | number; isDisabled?: boolean;
  preferences: { apiKeyStatus?: UserApiKeyStatusMap; selectedModel?: string; [key: string]: unknown };
}
export const listUserKeyProfiles = (data: { cursor?: string; uid?: string } = {}) =>
  call<{ rows: SafeUserProfile[]; cursor: string | null }>('listUserKeyProfiles', data);
export const countUserKeyProfiles = async () => (await call<{ count: number }>('listUserKeyProfiles', { countOnly: true })).count;
export async function allUserKeyProfiles(): Promise<SafeUserProfile[]> {
  const rows: SafeUserProfile[] = [];
  let cursor: string | null = null;
  do {
    const page = await listUserKeyProfiles(cursor ? { cursor } : {});
    rows.push(...page.rows); cursor = page.cursor;
  } while (cursor);
  return rows;
}

export const generateGraphic: typeof import('./geminiService').generateGraphic = (...args) => serverKeysEnabled() ? serverGenerateGraphic(...args) : legacyGenerateGraphic(...args);

export const generateGraphicWithStyleReference: typeof import('./geminiService').generateGraphicWithStyleReference = (...args) => serverKeysEnabled() ? serverGenerateGraphicWithStyleReference(...args) : legacyGenerateGraphicWithStyleReference(...args);

export const refineGraphic: typeof import('./geminiService').refineGraphic = (...args) => serverKeysEnabled() ? serverRefineGraphic(...args) : legacyRefineGraphic(...args);

export const generateOpenAIImage: typeof import('./openaiService').generateOpenAIImage = (...args) => serverKeysEnabled() ? serverGenerateOpenAIImage(...args) : legacyGenerateOpenAIImage(...args);

export const refineOpenAIImage: typeof import('./openaiService').refineOpenAIImage = (...args) => serverKeysEnabled() ? serverRefineOpenAIImage(...args) : legacyRefineOpenAIImage(...args);

export const generateOpenRouterImage: typeof import('./openRouterService').generateOpenRouterImage = (...args) => serverKeysEnabled() ? serverGenerateOpenRouterImage(...args) : legacyGenerateOpenRouterImage(...args);

export const generateSvg: typeof import('./svgService').generateSvg = (...args) => serverKeysEnabled() ? serverGenerateSvg(...args) : legacyGenerateSvg(...args);

export const refineSvg: typeof import('./svgService').refineSvg = (...args) => serverKeysEnabled() ? serverRefineSvg(...args) : legacyRefineSvg(...args);
