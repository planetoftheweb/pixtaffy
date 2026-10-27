import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
type Auth = { uid: string; token: Record<string, unknown> } | undefined;
const cached = new Map<string, { value: unknown; expires: number }>();
export function resetFeatureFlagCache(): void { cached.clear(); }
export function flagEnabled(value: unknown, auth: Auth): boolean {
  if (!auth || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const flag = value as Record<string, unknown>;
  if (![0, 1, 2].includes(flag.stage as number)
    || (flag.allowAdmins !== undefined && typeof flag.allowAdmins !== 'boolean')
    || (flag.allowlistUids !== undefined && (!Array.isArray(flag.allowlistUids) || !flag.allowlistUids.every(uid => typeof uid === 'string')))) return false;
  return flag.stage === 2 || (flag.stage === 1 && ((flag.allowAdmins === true && auth.token.admin === true) || (flag.allowlistUids as string[] | undefined)?.includes(auth.uid) === true));
}
async function getFlag(name = 'serverSideUserKeys'): Promise<unknown> {
  let entry = cached.get(name);
  if (!entry || entry.expires <= Date.now()) {
    const doc = await getFirestore().doc('config/featureFlags').get();
    entry = { value: doc.data()?.[name], expires: Date.now() + (process.env.FUNCTIONS_EMULATOR === 'true' && /^\d+$/.test(process.env.FEATURE_FLAG_CACHE_MS || '') ? Math.min(30000, Number(process.env.FEATURE_FLAG_CACHE_MS)) : 30000) };
    cached.set(name, entry);
  }
  return entry.value;
}
export async function namedFlagEnabled(name: string, auth: Auth): Promise<boolean> {
  return !!auth && flagEnabled(await getFlag(name), auth);
}
export async function serverSideUserKeysEnabled(auth: Auth): Promise<boolean> {
  return !!auth && flagEnabled(await getFlag(), auth);
}
export async function userKeysMode(auth: Auth): Promise<boolean> {
  if (!auth) return false;
  const flag = await getFlag();
  if (flagEnabled(flag, auth)) return true;
  if (flag && typeof flag === 'object' && (flag as Record<string, unknown>).forceLegacy === true) return false;
  const keys = (await getFirestore().doc(`userApiKeys/${auth.uid}`).get()).data()?.keys;
  return !!keys && typeof keys === 'object' && !Array.isArray(keys) && Object.keys(keys).length > 0;
}
export const getKeyStorageMode = onCall(async request => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Sign in required.');
  return { serverKeys: await userKeysMode(request.auth) };
});
