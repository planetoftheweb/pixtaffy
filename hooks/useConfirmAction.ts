import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Inline "click twice to confirm" pattern for destructive actions.
 *
 * The first call to `trigger(key)` arms the button (returns false, the
 * action does NOT fire). The second call within `timeoutMs` for the same
 * key fires `onConfirm(key)` and returns true. The armed state auto-resets
 * after `timeoutMs` so a forgotten arm doesn't linger.
 *
 * Pass `key` as a constant (e.g. `'default'`) for a single button, or as a
 * stable id when several buttons in a list share the hook — only one row
 * can be armed at a time, and arming a new row disarms the previous one.
 */
export interface UseConfirmActionOptions<K extends string> {
  onConfirm: (key: K) => void | Promise<void>;
  timeoutMs?: number;
}

export interface UseConfirmActionResult<K extends string> {
  /** Currently armed key (or null when idle). */
  armedKey: K | null;
  /** Returns true when the action fired (second click), false when it just armed (first click). */
  trigger: (key: K) => boolean;
  /** Clear any armed state without firing. Useful for blur / close events. */
  reset: () => void;
  /** Convenience: is this specific key currently armed? */
  isArmed: (key: K) => boolean;
  /** Disarm this button when focus leaves it. */
  bindDisarmOnBlur: (key: K) => { onBlur: () => void };
}

export const useConfirmAction = <K extends string = string>({
  onConfirm,
  timeoutMs = 3000,
}: UseConfirmActionOptions<K>): UseConfirmActionResult<K> => {
  const [armedKey, setArmedKey] = useState<K | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setArmedKey(null);
  }, [clearTimer]);

  const trigger = useCallback(
    (key: K): boolean => {
      if (armedKey === key) {
        clearTimer();
        setArmedKey(null);
        void Promise.resolve(onConfirm(key)).catch((err) => {
          console.error('[useConfirmAction] onConfirm failed:', err);
        });
        return true;
      }
      clearTimer();
      setArmedKey(key);
      timerRef.current = window.setTimeout(() => {
        setArmedKey(null);
        timerRef.current = null;
      }, timeoutMs);
      return false;
    },
    [armedKey, clearTimer, onConfirm, timeoutMs]
  );

  const isArmed = useCallback((key: K) => armedKey === key, [armedKey]);
  const bindDisarmOnBlur = useCallback((key: K) => ({
    onBlur: () => { if (armedKey === key) reset(); },
  }), [armedKey, reset]);

  return { armedKey, trigger, reset, isArmed, bindDisarmOnBlur };
};
