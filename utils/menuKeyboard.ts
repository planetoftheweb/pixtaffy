export function nextMenuItemIndex(current: number, count: number, key: string, shiftKey = false): number | null {
  if (count === 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown' || (key === 'Tab' && !shiftKey)) return (current + 1) % count;
  if (key === 'ArrowUp' || (key === 'Tab' && shiftKey)) return (current < 0 ? count - 1 : current + count - 1) % count;
  return null;
}
