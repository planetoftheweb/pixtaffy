import { FOCUS_RING } from '../utils/focusRing';
import React, { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Tip } from './settings/Tip';
import { dismissErrorToastOnEscape, dismissTopErrorToast, hasVisibleErrorToast, registerErrorToast } from '../utils/errorToastEscape';
import { errorToastStore } from '../utils/errorToastStore';

export const ErrorToastHost: React.FC = () => {
  const { message } = useSyncExternalStore(errorToastStore.subscribe, errorToastStore.getSnapshot, errorToastStore.getSnapshot);
  return message === null ? null : <ErrorToast message={message} onDismiss={errorToastStore.dismiss} onHeightChange={errorToastStore.setHeight} dismissLabel="Dismiss error" />;
};

export const ErrorToast: React.FC<{
  message: string;
  onDismiss: (restoreFocus?: boolean) => void;
  onHeightChange: (height: number) => void;
  dismissLabel?: string;
}> = ({ message, onDismiss, onHeightChange, dismissLabel = 'Dismiss AI assist error' }) => {
  const toastRef = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useLayoutEffect(() => {
    const toast = toastRef.current;
    if (!toast) return;
    const measure = () => onHeightChange(toast.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toast);
    return () => observer.disconnect();
  }, [message, onHeightChange]);

  useLayoutEffect(() => {
    const unregister = registerErrorToast((restoreFocus) => onDismissRef.current(restoreFocus));
    const onKeyDown = (event: KeyboardEvent) => {
      dismissErrorToastOnEscape(event, hasVisibleErrorToast(), dismissTopErrorToast);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      unregister();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, []);

  return createPortal(
    <div ref={toastRef} role="alert" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[400] w-max max-w-[calc(100vw-2rem)] flex items-center gap-2 rounded-lg bg-red-900 border border-brand-red/70 text-white text-sm px-4 py-2 shadow-2xl">
      <span className="min-w-0 break-words font-medium">{message}</span>
      <button type="button" aria-label={dismissLabel} onClick={() => onDismiss()} className={`group/tip relative min-h-11 min-w-11 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center ${FOCUS_RING}`}>
        <X size={18} />
        <Tip text="Dismiss" side="top" />
      </button>
    </div>,
    document.body,
  );
};
