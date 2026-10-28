import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

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
    const show = () => { if (!host.matches(':disabled')) setHostRect(host.getBoundingClientRect()); };
    const showFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) show();
    };
    const hide = () => setHostRect(null);
    host.addEventListener('pointerenter', show);
    host.addEventListener('focusin', showFocus);
    host.addEventListener('focusout', hide);
    host.addEventListener('pointerleave', hide);
    window.addEventListener('scroll', hide, true);
    host.addEventListener('pointerdown', hide); // gestures shouldn't fight the tip
    return () => {
      host.removeEventListener('pointerenter', show);
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
              wide ? 'w-72 max-w-[calc(100vw-16px)] whitespace-normal text-left leading-relaxed' : 'max-w-[calc(100vw-16px)] whitespace-normal'
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

