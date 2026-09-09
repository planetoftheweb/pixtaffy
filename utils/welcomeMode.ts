/**
 * Prefer the studio/tool on refresh after the user has entered it once.
 * First-visit guests (no flag) still land on the welcome page.
 */

export const PREFER_STUDIO_STORAGE_KEY = 'pixtaffy_prefer_studio';

export type WelcomeModeInitArgs = {
  /** `window.location.search` (with or without leading `?`). */
  search: string;
  /** True when localStorage says the user prefers studio. */
  preferStudio: boolean;
};

/**
 * Deep links (billing / checkout / what's new) always skip welcome.
 * Otherwise prefer studio when the persisted flag is set; first visits stay on welcome.
 */
export function shouldStartInWelcomeMode({
  search,
  preferStudio,
}: WelcomeModeInitArgs): boolean {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );
  if (
    params.has('billing') ||
    params.has('checkout') ||
    params.has('whatsnewpage') ||
    params.has('whatsnew')
  ) {
    return false;
  }
  if (preferStudio) return false;
  return true;
}

export function readPreferStudioFlag(
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(PREFER_STUDIO_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writePreferStudioFlag(
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null
): void {
  if (!storage) return;
  try {
    storage.setItem(PREFER_STUDIO_STORAGE_KEY, 'true');
  } catch {
    // Private mode / quota: view preference is best-effort.
  }
}
