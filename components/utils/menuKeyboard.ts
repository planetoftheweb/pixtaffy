// Portaled menus follow the trigger's tab order rather than their body position.
const focusableSelector = 'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
export const menuFocusables = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);

export function handleMenuKeyboard(
  event: KeyboardEvent,
  trigger: HTMLElement,
  panel: HTMLElement,
  close: () => void,
): void {
  const target = event.target;
  if (!(target instanceof Node) || (!trigger.contains(target) && !panel.contains(target))) return;
  const items = menuFocusables(panel);
  const index = items.indexOf(target as HTMLElement);
  const fromTrigger = trigger.contains(target);
  if (event.key === 'Tab') {
    event.preventDefault();
    if (fromTrigger && event.shiftKey || !fromTrigger && !event.shiftKey && index === items.length - 1 || items.length === 0) {
      const outside = menuFocusables(document).filter(element => !panel.contains(element));
      const next = outside[outside.indexOf(trigger) + (event.shiftKey ? -1 : 1)];
      // Move focus before unmounting the panel, with a trigger fallback at page edges.
      (next || trigger).focus();
      close();
    } else if (!fromTrigger && event.shiftKey && index === 0) {
      trigger.focus();
    } else {
      (items[fromTrigger ? 0 : index + (event.shiftKey ? -1 : 1)] || trigger).focus();
    }
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = fromTrigger ? (direction === 1 ? 0 : items.length - 1) : (index + direction + items.length) % items.length;
    (items[nextIndex] || trigger).focus();
  }
}
