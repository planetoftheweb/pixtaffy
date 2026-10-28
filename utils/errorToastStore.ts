import { useSyncExternalStore } from 'react';

/** One slot, including its original focus target, survives message replacements. */
export function createErrorToastStore(getDocument: () => Document | undefined = () => typeof document === 'undefined' ? undefined : document) {
  let snapshot: { message: string | null; height: number } = { message: null, height: 0 };
  let returnTarget: HTMLElement | null = null;
  let returnContainer: Element | null = null;
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const canFocus = (element: HTMLElement | null): element is HTMLElement => {
    if (!element?.isConnected || typeof element.focus !== 'function' ||
      element.matches(':disabled, [aria-disabled="true"]') ||
      element.closest('[hidden], [inert], [aria-hidden="true"]') || !element.getClientRects().length) return false;
    const style = getDocument()?.defaultView?.getComputedStyle(element);
    return style?.visibility !== 'hidden' && style?.visibility !== 'collapse' && style?.display !== 'none';
  };

  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    getClearance: () => snapshot.message && snapshot.height ? snapshot.height + 24 : 0,
    show(message: string) {
      if (snapshot.message === message) return;
      if (snapshot.message === null) {
        returnTarget = getDocument()?.activeElement as HTMLElement | null;
        returnContainer = returnTarget?.closest('[role="dialog"], [data-error-toast-scope], form') || returnTarget?.parentElement || null;
      }
      snapshot = { ...snapshot, message };
      publish();
    },
    dismiss(restoreFocus = true) {
      if (snapshot.message === null) return;
      const target = returnTarget;
      const container = returnContainer;
      returnTarget = null;
      returnContainer = null;
      snapshot = { message: null, height: 0 };
      publish();
      if (!restoreFocus) return;
      if (canFocus(target)) target.focus({ preventScroll: true });
      else if (container?.isConnected) {
        const fallback = Array.from(container.querySelectorAll<HTMLElement>('textarea, input, select, [contenteditable="true"], button, a[href]')).find(canFocus);
        fallback?.focus({ preventScroll: true });
      }
    },
    setHeight(height: number) {
      if (snapshot.message === null || snapshot.height === height) return;
      snapshot = { ...snapshot, height };
      publish();
    },
  };
  return store;
}

export const errorToastStore = createErrorToastStore();

// Starting a new call dismisses the shared slot, including another caller's error.
export function setErrorToast(message: string | null): void {
  if (message === null) errorToastStore.dismiss();
  else errorToastStore.show(message);
}

export function useErrorToastClearance(): number {
  return useSyncExternalStore(errorToastStore.subscribe, errorToastStore.getClearance, () => 0);
}
