export const STARTUP_GATE_TIMEOUT_MS = 1_500;
export const LAST_MEMBER_STORAGE_KEY = 'pixtaffy_last_member';

type HintStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function hasSavedMemberHint(storage?: (Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'key' | 'length'>>) | null): boolean {
  try {
    const hintStorage = storage === undefined ? window.localStorage : storage;
    if (hintStorage?.getItem(LAST_MEMBER_STORAGE_KEY) === 'true') return true;
    for (let index = 0; index < (hintStorage?.length ?? 0); index++) {
      const key = hintStorage?.key?.(index);
      if (!key?.startsWith('firebase:authUser:')) continue;
      try {
        const savedUser = JSON.parse(hintStorage?.getItem(key) ?? 'null');
        if (savedUser?.uid && savedUser.isAnonymous === false) return true;
      } catch {
        // Ignore malformed cached users and continue checking other entries.
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function writeMemberHint(storage: HintStorage | null | undefined, member: boolean): void {
  try {
    const hintStorage = storage === undefined ? window.localStorage : storage;
    if (member) hintStorage?.setItem(LAST_MEMBER_STORAGE_KEY, 'true');
    else hintStorage?.removeItem(LAST_MEMBER_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function shouldShowStartupGate(hasMemberHint: boolean, authResolved: boolean): boolean {
  return hasMemberHint && !authResolved;
}

export function shouldResolveMemberSession(hasMemberHint: boolean, authObserved: boolean): boolean {
  return hasMemberHint && !authObserved;
}
