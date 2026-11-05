export const STARTUP_GATE_TIMEOUT_MS = 1_500;
export const LAST_MEMBER_STORAGE_KEY = 'pixtaffy_last_member';

type HintStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function hasSavedMemberHint(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(LAST_MEMBER_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeMemberHint(storage: HintStorage | null, member: boolean): void {
  try {
    if (member) storage?.setItem(LAST_MEMBER_STORAGE_KEY, 'true');
    else storage?.removeItem(LAST_MEMBER_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function shouldShowStartupGate(hasMemberHint: boolean, authResolved: boolean): boolean {
  return hasMemberHint && !authResolved;
}
