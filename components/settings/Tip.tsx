import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

// Tracks whether the most recent input was a key press, so focus tips only appear for keyboard users.
let lastInputWasKeyboard = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => { lastInputWasKeyboard = true; }, true);
  window.addEventListener('pointerdown', () => { lastInputWasKeyboard = false; }, true);
}

// Portal tooltip adapted from the studio's Tip component.
export const Tip: React.FC<{
  text: string;
  /** Optional bold headline - use title+text for anything needing a real explanation. */
  title?: string;
  side?: 'top' | 'bottom' | 'left'; // 'left' is legacy - treated as 'top'
  align?: 'center' | 'right'; // kept for call-site compat; clamping handles edges
  wide?: boolean;
}> = ({ text, title, side = 'bottom', wide }) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const host = anchorRef.current?.parentElement;
    if (!host) return;
    // An open menu owns the space under its trigger, so the tip stays hidden while it is expanded.
    // A neighbouring toolbar trigger's tip would land on top of the open panel, so toolbar tips wait until it closes.
    const expanded = () => host.getAttribute('aria-expanded') === 'true'
      || (host.matches('[data-toolbar-dropdown-trigger]') && !!document.querySelector('[data-toolbar-dropdown-trigger][aria-expanded="true"]'));
    const show = () => { if (!expanded() && !host.matches(':disabled') && !host.querySelector(':disabled')) setHostRect(host.getBoundingClientRect()); };
    const showPointer = (event: PointerEvent) => { if (event.pointerType !== 'touch') show(); };
    const showFocus = (event: FocusEvent) => {
      // Focus tips are for keyboard users. Focus that follows a pointer press (for example a menu handing focus back) stays quiet.
      if (lastInputWasKeyboard && event.target instanceof HTMLElement && event.target.matches(':focus-visible')) show();
    };
    const hide = () => setHostRect(null);
    const observer = new MutationObserver(() => { if (expanded()) hide(); });
    observer.observe(host, { attributes: true, attributeFilter: ['aria-expanded'] });
    host.addEventListener('click', hide);
    host.addEventListener('pointerenter', showPointer);
    host.addEventListener('focusin', showFocus);
    host.addEventListener('focusout', hide);
    host.addEventListener('pointerleave', hide);
    window.addEventListener('scroll', hide, true);
    host.addEventListener('pointerdown', hide); // gestures shouldn't fight the tip
    return () => {
      observer.disconnect();
      host.removeEventListener('click', hide);
      host.removeEventListener('pointerenter', showPointer);
      host.removeEventListener('focusin', showFocus);
      host.removeEventListener('focusout', hide);
      host.removeEventListener('pointerleave', hide);
      window.removeEventListener('scroll', hide, true);
      host.removeEventListener('pointerdown', hide);
    };
  }, []);

  // After the tip renders, clamp it inside the viewport.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !hostRect) return;
    const r = el.getBoundingClientRect();
    let x = hostRect.left + hostRect.width / 2 - r.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - r.width - 8, x));
    const below = side !== 'top';
    let y = below ? hostRect.bottom + 6 : hostRect.top - r.height - 6;
    if (y < 8) y = hostRect.bottom + 6;
    if (y + r.height > window.innerHeight - 8) y = hostRect.top - r.height - 6;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.visibility = 'visible';
  }, [hostRect, side]);

  return (
    <span ref={anchorRef} className="hidden" aria-hidden>
      {hostRect &&
        createPortal(
          <span
            ref={tipRef}
            style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden', zIndex: 500 }}
            className={`pointer-events-none ${
              wide ? 'w-72 whitespace-normal text-left leading-relaxed' : 'max-w-[calc(100vw-16px)] whitespace-normal'
            } text-[13px] font-medium px-3 py-1.5 rounded-lg bg-black/90 text-white shadow-xl`}
          >
            {title ? (
              <>
                <span className="block font-semibold">{title}</span>
                <span className="block text-slate-300 font-normal mt-0.5">{text}</span>
              </>
            ) : (
              text
            )}
          </span>,
          document.body
        )}
    </span>
  );
};

