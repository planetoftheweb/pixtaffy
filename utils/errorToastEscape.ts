const visibleErrorToasts: Array<{ onDismiss: () => void }> = [];

/** Register mounted toasts so earlier modal listeners can dismiss them first. */
export function registerErrorToast(onDismiss: () => void): () => void {
  const toast = { onDismiss };
  visibleErrorToasts.push(toast);
  return () => {
    const index = visibleErrorToasts.indexOf(toast);
    if (index !== -1) visibleErrorToasts.splice(index, 1);
  };
}

export function hasVisibleErrorToast(): boolean {
  return visibleErrorToasts.length > 0;
}

export function dismissTopErrorToast(): void {
  visibleErrorToasts.at(-1)?.onDismiss();
}

/** Consume Escape before any field, editor, or modal can handle it. */
export function dismissErrorToastOnEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation' | 'stopImmediatePropagation'>,
  visible: boolean,
  onDismiss: () => void,
): boolean {
  if (!visible || event.key !== 'Escape') return false;
  event.preventDefault();
  event.stopPropagation();
  // Other capture listeners on window must not peel another layer.
  event.stopImmediatePropagation();
  onDismiss();
  return true;
}
