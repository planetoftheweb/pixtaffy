import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';
import { createKeyStorageModeCache } from './keyStorageModeCache';
const cache = createKeyStorageModeCache(async () =>
  (await httpsCallable<unknown, { serverKeys: boolean }>(functions, 'getKeyStorageMode')({})).data.serverKeys);
export const serverKeysEnabled = (): boolean => cache.enabled(auth.currentUser?.uid);
export const resetKeyStorageMode = (): void => cache.reset();
export function loadKeyStorageMode(): Promise<boolean> {
  const current = auth.currentUser;
  if (!current || current.isAnonymous) { cache.reset(); return Promise.resolve(false); }
  return cache.load(current.uid);
}
