import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Tip } from './settings/Tip';
import { dismissErrorToastOnEscape, dismissTopErrorToast, hasVisibleErrorToast, registerErrorToast } from '../utils/errorToastEscape';

export const ErrorToast: React.FC<{
  message: string;
  onDismiss: () => void;
  dismissLabel?: string;
}> = ({ message, onDismiss, dismissLabel = 'Dismiss AI assist error' }) => {
  const onDismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useLayoutEffect(() => {
    const unregister = registerErrorToast(() => onDismissRef.current());
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
    <div role="alert" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[400] w-max max-w-[calc(100vw-2rem)] flex items-center gap-2 rounded-lg bg-red-900 border border-brand-red/70 text-white text-sm px-4 py-2 shadow-lg">
      <span className="font-medium">{message}</span>
      <button type="button" aria-label={dismissLabel} onClick={onDismiss} className="group/tip relative min-h-11 min-w-11 shrink-0 rounded-lg hover:bg-white/10 flex items-center justify-center">
        <X size={18} />
        <Tip text="Dismiss" side="top" />
      </button>
    </div>,
    document.body,
  );
};
