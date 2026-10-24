import { generateOpenRouterImageCore } from './openRouterProvider';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { GoogleGenAI } from '@google/genai';

export const USER_API_KEYS_ENCRYPTION_KEY = defineSecret('USER_API_KEYS_ENCRYPTION_KEY');
export interface EncryptedKey { iv: string; authTag: string; ciphertext: string; keyVersion: number; last4: string }
export function encryptKey(value: string, secret: string, context: string): EncryptedKey {
  if (!secret) throw new Error('USER_API_KEYS_ENCRYPTION_KEY is required');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'), keyVersion: 1, last4: value.slice(-4) };
}
export function decryptKey(record: EncryptedKey, secret: string, context: string): string {
  if (!secret || record.keyVersion !== 1) throw new Error('Invalid encryption configuration');
  const cipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), Buffer.from(record.iv, 'base64'));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(record.ciphertext, 'base64')), cipher.final()]).toString('utf8');
}
export function legacyKeys(data: Record<string, any>): Record<string, string> {
  const prefs = data.preferences || {};
  const keys: Record<string, string> = {};
  for (const values of [{ gemini: data.geminiApiKey }, data.apiKeys, { gemini: prefs.geminiApiKey }, prefs.apiKeys]) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const [slot, value] of Object.entries(values)) {
      if (/^[a-z0-9:._/-]{1,160}$/i.test(slot) && !['__proto__', 'constructor', 'prototype'].includes(slot) && typeof value === 'string' && value.trim()) keys[slot] = value.trim();
    }
  }
  return keys;
}
export function keyStatus(keys: Record<string, EncryptedKey>) {
  const slots = ['gemini', 'openai', 'openrouter', 'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-lite-image', 'gemini-svg', ...Object.keys(keys)];
  return Object.fromEntries(slots.map(slot => [slot, { hasKey: !!keys[slot], last4: keys[slot]?.last4 || null }]));
}
export async function ensureUserApiKeysMigrated(uid: string): Promise<Record<string, EncryptedKey>> {
  const db = getFirestore();
  return db.runTransaction(async tx => {
    const userRef = db.doc(`users/${uid}`), keyRef = db.doc(`userApiKeys/${uid}`);
    const [user, store] = await Promise.all([tx.get(userRef), tx.get(keyRef)]);
    const data = user.data() || {};
    const keys: Record<string, EncryptedKey> = store.data()?.keys || {};
    const legacy = legacyKeys(data);
    for (const [slot, value] of Object.entries(legacy)) {
      if (!keys[slot]) keys[slot] = encryptKey(value, USER_API_KEYS_ENCRYPTION_KEY.value(), `${uid}:${slot}`);
    }
    if (Object.keys(legacy).length) tx.set(keyRef, { keys });
    if (user.exists && ('apiKeys' in data || 'geminiApiKey' in data || 'apiKeys' in (data.preferences || {}) || 'geminiApiKey' in (data.preferences || {}))) {
      tx.update(userRef, { apiKeys: FieldValue.delete(), geminiApiKey: FieldValue.delete(), 'preferences.apiKeys': FieldValue.delete(), 'preferences.geminiApiKey': FieldValue.delete(), 'preferences.apiKeyStatus': keyStatus(keys) });
    }
    return keys;
  });
}
export async function resolveUserApiKey(uid: string, model: string): Promise<string | undefined> {
  const keys = await ensureUserApiKeysMigrated(uid);
  const provider = model.startsWith('openrouter') ? 'openrouter' : model.startsWith('openai') ? 'openai' : 'gemini';
  const slot = [model, provider, ...(model === 'gemini' ? ['gemini-3.1-flash-image-preview', 'gemini-svg'] : [])].find(k => keys[k]);
  return slot ? decryptKey(keys[slot], USER_API_KEYS_ENCRYPTION_KEY.value(), `${uid}:${slot}`) : undefined;
}
const options = { secrets: [USER_API_KEYS_ENCRYPTION_KEY], timeoutSeconds: 540, memory: '1GiB' as const };
function authenticated(request: CallableRequest): string {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Sign in required.');
  return request.auth.uid;
}
function slotOf(value: unknown): string {
  if (typeof value !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(value) || !/^[a-z0-9:_-][a-z0-9:._/-]{0,159}$/i.test(value)) throw new HttpsError('invalid-argument', 'Invalid key slot.');
  return value;
}
export const getUserApiKeyStatus = onCall(options, async request => keyStatus(await ensureUserApiKeysMigrated(authenticated(request))));
async function mutate(uid: string, slot?: string, value?: string) {
  await ensureUserApiKeysMigrated(uid);
  const db = getFirestore();
  return db.runTransaction(async tx => {
    const ref = db.doc(`userApiKeys/${uid}`);
    const snap = await tx.get(ref);
    const keys = (snap.data()?.keys || {}) as Record<string, EncryptedKey>;
    if (!slot) Object.keys(keys).forEach(k => delete keys[k]);
    else if (value) keys[slot] = encryptKey(value, USER_API_KEYS_ENCRYPTION_KEY.value(), `${uid}:${slot}`);
    else delete keys[slot];
    tx.set(ref, { keys });
    tx.set(db.doc(`users/${uid}`), { preferences: { apiKeyStatus: keyStatus(keys) } }, { mergeFields: ['preferences.apiKeyStatus'] });
    return keyStatus(keys);
  });
}
export const setUserApiKey = onCall(options, async request => {
  const uid = authenticated(request), slot = slotOf(request.data?.slot), value = request.data?.key;
  if (typeof value !== 'string' || value.trim().length < 8 || value.length > 512) throw new HttpsError('invalid-argument', 'Invalid API key.');
  return mutate(uid, slot, value.trim());
});
export const deleteUserApiKey = onCall(options, async request => mutate(authenticated(request), slotOf(request.data?.slot)));
export const clearUserApiKeys = onCall(options, async request => {
  const uid = authenticated(request);
  const target = request.data?.uid || uid;
  if (typeof target !== 'string' || target.includes('/')) throw new HttpsError('invalid-argument', 'Invalid user.');
  if (target !== uid && request.auth?.token.admin !== true) throw new HttpsError('permission-denied', 'Admin required.');
  return mutate(target);
});

export const generateWithUserKey = onCall(options, async request => {
  const uid = authenticated(request);
  const { model = 'gemini', action = 'generate', prompt = '', config = {}, context = {}, image, svg, systemPrompt = '', quality = 'auto', background = 'auto' } = request.data || {};
  if (typeof model !== 'string' || !(['gemini', 'gemini-svg', 'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-lite-image', 'openai', 'openai-2', 'openai-2.5', 'openai-flare', 'openai-mini', 'openrouter'].includes(model) || /^openrouter:[a-z0-9._/-]+$/i.test(model))) {
    throw new HttpsError('invalid-argument', 'Unsupported model.');
  }
  if (!['generate', 'refine', 'style', 'models'].includes(action)) throw new HttpsError('invalid-argument', 'Unsupported operation.');
  const key = await resolveUserApiKey(uid, model);
  if (!key) throw new HttpsError('failed-precondition', 'Configure a provider key in Settings.');
  try {
    const fullPrompt = `${action === 'refine' ? 'Edit the supplied image. Preserve existing content unless the request requires a change.' : ''}\n${request.data?.options?.forceAspectOnlyEdit ? 'Change only the canvas aspect ratio. Preserve the illustration and recompose without padding.' : ''}\n${systemPrompt}\n${prompt || config.prompt || ''}\nDesign settings: ${JSON.stringify(config)}\nDesign context: ${JSON.stringify(context)}${action === 'style' ? '\nUse the attached image as a style reference for a new composition.' : ''}`;
    let base64Data: string | undefined, mimeType = 'image/png';
    if (model.startsWith('openrouter')) {
      if (action === 'models') {
        const response = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${key}` } });
        if (!response.ok) throw new Error('Provider failure');
        const body = await response.json() as any;
        return (body.data || []).map((m: any) => ({ slug: m.id, name: m.name }));
      }
      const result = await generateOpenRouterImageCore({ apiKey: key, modelSlug: model.replace(/^openrouter:/, ''), prompt: fullPrompt, aspectRatio: config.aspectRatio, title: 'PixTaffy' });
      base64Data = result.base64Data; mimeType = result.mimeType;
    } else if (model.startsWith('openai')) {
      const apiModel = ({ 'openai-2.5': 'gpt-image-2.5-sunburst', 'openai-flare': 'gpt-image-2.5-flare', 'openai-2': 'gpt-image-2', 'openai-mini': 'gpt-image-1-mini' } as Record<string, string>)[model] || 'gpt-image-1.5';
      const ratio = String(config.aspectRatio || '1:1').split(':').map(Number);
      const wideSizes: Record<string, string> = { '1:1': '2048x2048', '16:9': '2048x1152', '9:16': '1152x2048', '3:1': '2304x768', '1:3': '768x2304' };
      const size = (apiModel.startsWith('gpt-image-2') && wideSizes[config.aspectRatio]) || (ratio[0] > ratio[1] ? '1536x1024' : ratio[0] < ratio[1] ? '1024x1536' : '1024x1024');
      let body: BodyInit, headers: Record<string, string> = { Authorization: `Bearer ${key}` };
      if (image) {
        const form = new FormData();
        form.set('model', apiModel); form.set('prompt', fullPrompt); form.set('size', size); form.set('quality', quality); form.set('background', background);
        form.set('image', new Blob([new Uint8Array(Buffer.from(image.base64Data, 'base64'))], { type: image.mimeType }), 'source.png');
        body = form;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({ model: apiModel, prompt: fullPrompt, size, quality, background });
      }
      const response = await fetch(`https://api.openai.com/v1/images/${image ? 'edits' : 'generations'}`, { method: 'POST', headers, body });
      if (!response.ok) throw new Error('Provider failure');
      base64Data = ((await response.json()) as any).data?.[0]?.b64_json;
    } else {
      const isSvg = model === 'gemini-svg';
      const parts: any[] = [{ text: isSvg ? `${fullPrompt}\n${svg || ''}\nReturn only a complete SVG document, without scripts or external resources.` : fullPrompt }];
      if (image?.base64Data) parts.push({ inlineData: { data: image.base64Data, mimeType: image.mimeType } });
      const ai = new GoogleGenAI({ apiKey: key });
      const response = await ai.models.generateContent({ model: isSvg ? 'gemini-flash-latest' : model === 'gemini' ? 'gemini-3-pro-image-preview' : model, contents: [{ role: 'user', parts }], config: isSvg ? {} : { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: config.aspectRatio || '1:1' } } });
      if (isSvg) {
        const svgCode = response.text?.match(/<svg[\s\S]*<\/svg>/)?.[0];
        if (!svgCode) throw new Error('Missing SVG');
        return { svgCode, base64Data: Buffer.from(svgCode).toString('base64'), mimeType: 'image/svg+xml' };
      }
      const result = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
      base64Data = result?.data; mimeType = result?.mimeType || mimeType;
    }
    if (!base64Data) throw new Error('Missing image');
    return { base64Data, mimeType };
  } catch {
    // Provider errors can contain credentials or request headers. Never forward them.
    throw new HttpsError('internal', 'The provider could not complete this request. Check your key and model access.');
  }
});

// Admin tables cannot use client collection queries while legacy profiles exist.
export const listUserKeyProfiles = onCall(options, async request => {
  authenticated(request);
  if (request.auth?.token.admin !== true) throw new HttpsError('permission-denied', 'Admin required.');
  const db = getFirestore();
  if (request.data?.countOnly) return { count: (await db.collection('users').count().get()).data().count };
  const uid = request.data?.uid;
  if (uid && (typeof uid !== 'string' || uid.includes('/'))) throw new HttpsError('invalid-argument', 'Invalid user.');
  let query = db.collection('users').orderBy('__name__').limit(100);
  if (request.data?.cursor) {
    const cursor = String(request.data.cursor);
    if (cursor.includes('/')) throw new HttpsError('invalid-argument', 'Invalid cursor.');
    query = query.startAfter(cursor);
  }
  const docs = uid ? [await db.doc(`users/${uid}`).get()] : (await query.get()).docs;
  const rows = await Promise.all(docs.filter(doc => doc.exists).map(async doc => {
    const status = keyStatus(await ensureUserApiKeysMigrated(doc.id));
    const data = doc.data() || {};
    const { apiKeys: _keys, geminiApiKey: _legacy, ...preferences } = data.preferences || {};
    return {
      id: doc.id, name: data.name || '', username: data.username || '', email: data.email || '',
      photoURL: data.photoURL || null, isDisabled: data.isDisabled === true,
      createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
      lastSignInAt: data.lastSignInAt?.toMillis?.() ?? data.lastSignInAt ?? null,
      preferences: { ...preferences, apiKeyStatus: status },
    };
  }));
  return { rows, cursor: !uid && docs.length === 100 ? docs[docs.length - 1].id : null };
});
