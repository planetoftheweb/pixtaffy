import { useEffect, useRef } from 'react';

interface UseScrollRevealOptions {
  /** Once visible, stay visible (default true). */
  once?: boolean;
  /** IntersectionObserver rootMargin (default shows a bit early). */
  rootMargin?: string;
  /** Intersection ratio required before revealing. */
  threshold?: number | number[];
}

/**
 * Subtle scroll-reveal for marketing sections. Adds/removes `is-visible` on
 * the element when it enters the viewport. Honors prefers-reduced-motion via
 * CSS (elements with `.pixtaffy-reveal` show instantly under reduce).
 */
export function useScrollReveal<T extends HTMLElement = HTMLElement>(
  options: UseScrollRevealOptions = {},
) {
  const { once = true, rootMargin = '0px 0px -8% 0px', threshold = 0.12 } = options;
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.classList.add('is-visible');
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      node.classList.add('is-visible');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            entry.target.classList.remove('is-visible');
          }
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [once, rootMargin, threshold]);

  return ref;
}
