import { useSyncExternalStore } from 'react';

export const KNOWN_PATHS = ['/', '/pricing', '/privacy', '/terms'] as const;
export type AppPath = typeof KNOWN_PATHS[number];
export const isKnownPath = (path: string): path is AppPath =>
  KNOWN_PATHS.some(known => known === path);

export function navigate(path: AppPath) {
  if (window.location.pathname + window.location.search === path) return;
  // Same page with only a query to drop (for example /?verified=1): replace, so Back does not gain an extra entry.
  if (window.location.pathname === path) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// /pricing/ and /pricing are the same page. Drop a trailing slash before the app reads the path.
export function canonicalizeTrailingSlash() {
  const { pathname, search, hash } = window.location;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    window.history.replaceState(null, '', pathname.replace(/\/+$/, '') + search + hash);
  }
}

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};
export const usePathname = () => useSyncExternalStore(subscribe, () => window.location.pathname);
