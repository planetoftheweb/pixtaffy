import { useSyncExternalStore } from 'react';

export const KNOWN_PATHS = ['/', '/pricing', '/privacy', '/terms'] as const;
export type AppPath = typeof KNOWN_PATHS[number];
export const isKnownPath = (path: string): path is AppPath =>
  KNOWN_PATHS.some(known => known === path);

export function navigate(path: AppPath) {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};
export const usePathname = () => useSyncExternalStore(subscribe, () => window.location.pathname);
