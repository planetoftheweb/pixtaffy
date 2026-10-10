import React from 'react';
import { useScrollReveal } from '../hooks/useScrollReveal';

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  /** Stagger delay in ms for grid/card sequences. */
  delayMs?: number;
  as?: keyof React.JSX.IntrinsicElements;
  id?: string;
}

/**
 * Lightweight fade + translate-y reveal on scroll. Prefer wrapping
 * below-the-fold marketing blocks; keep hero content unwrapped.
 */
export const ScrollReveal: React.FC<ScrollRevealProps> = ({
  children,
  className = '',
  delayMs = 0,
  as = 'div',
  id,
}) => {
  const ref = useScrollReveal<HTMLElement>();
  const Tag = as as React.ElementType;

  return (
    <Tag
      ref={ref}
      id={id}
      className={`pixtaffy-reveal ${className}`.trim()}
      style={delayMs > 0 ? ({ ['--pixtaffy-reveal-delay' as string]: `${delayMs}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
};
