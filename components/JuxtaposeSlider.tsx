import { FOCUS_RING } from '../utils/focusRing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tip } from './settings/Tip';
import { ArrowLeftRight, Download, X } from 'lucide-react';

export interface JuxtaposeSliderProps {
  /** Side A (shown underneath; revealed on the LEFT of the handle). */
  imageA: string;
  /** Side B (shown on top; visible on the RIGHT of the handle). */
  imageB: string;
  labelA: string;
  labelB: string;
  /**
   * Fallback aspect ratio for the container when we can't measure the sources
   * yet (e.g. `"16:9"`, `"1:1"`). Once both images load the slider locks to the
   * larger native ratio to avoid distorting either side.
   */
  aspectRatio?: string;
  /** When true, render a close button that invokes this. */
  onClose?: () => void;
  /** Extra class names for the outer wrapper. */
  className?: string;
  /** Starting handle position as a percent 0..100. Defaults to 50. */
  initialPercent?: number;
  /**
   * Optional CSS max-height for the slider surface (e.g. `"75vh"`). When set
   * the slider also caps its max-width to `max-height * ratio` so that tall
   * portrait images don't blow past the viewport — width shrinks first and
   * the aspect ratio is preserved, instead of the browser silently breaking
   * aspect-ratio when max-height is the binding constraint.
   */
  maxHeight?: string;
  /**
   * When true, the Swap / Side-by-side / Close controls overlay the slider
   * surface (bottom-right) instead of sitting in a row beneath it. Keeps the
   * comparison footprint equal to a plain image preview so the main viewport
   * doesn't feel like it's shrinking the moment the user enters compare mode.
   */
  toolbarOverlay?: boolean;
  /**
   * Notifies the parent whenever the user starts/stops dragging the divider.
   * The main viewport uses this to mute every other overlay (rail, action
   * buttons, labels, etc.) while the user is actively scrubbing — so they
   * see ONLY the two images and the divider during the drag, and the chrome
   * fades back in as soon as they release.
   */
  onDraggingChange?: (dragging: boolean) => void;
}

const parseAspectRatio = (value?: string): number | null => {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)[:xX](\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const w = parseFloat(match[1]);
  const h = parseFloat(match[2]);
  if (!w || !h) return null;
  return w / h;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

interface ImageSize {
  width: number;
  height: number;
}

const loadImageSize = (src: string): Promise<ImageSize> =>
  new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('Empty image source'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });

export const JuxtaposeSlider: React.FC<JuxtaposeSliderProps> = ({
  imageA,
  imageB,
  labelA,
  labelB,
  aspectRatio,
  onClose,
  className = '',
  initialPercent = 50,
  maxHeight,
  toolbarOverlay = false,
  onDraggingChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [percent, setPercent] = useState<number>(() => clamp(initialPercent, 0, 100));
  const [swapped, setSwapped] = useState(false);
  const [sizes, setSizes] = useState<{ a?: ImageSize; b?: ImageSize }>({});
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadImageSize(imageA).catch(() => undefined),
      loadImageSize(imageB).catch(() => undefined),
    ]).then(([a, b]) => {
      if (cancelled) return;
      setSizes({ a, b });
    });
    return () => {
      cancelled = true;
    };
  }, [imageA, imageB]);

  const effectiveRatio = (() => {
    const ratioA = sizes.a ? sizes.a.width / sizes.a.height : null;
    const ratioB = sizes.b ? sizes.b.width / sizes.b.height : null;
    if (ratioA && ratioB) {
      // Lock container to the wider of the two ratios so the taller image
      // letterboxes instead of being cropped.
      return Math.max(ratioA, ratioB);
    }
    return ratioA || ratioB || parseAspectRatio(aspectRatio) || 1;
  })();

  const sizesDiffer = (() => {
    if (!sizes.a || !sizes.b) return false;
    const ratioA = sizes.a.width / sizes.a.height;
    const ratioB = sizes.b.width / sizes.b.height;
    return Math.abs(ratioA - ratioB) > 0.02;
  })();

  const updatePercentFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPercent(clamp(next, 0, 100));
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    setIsDragging(true);
    onDraggingChange?.(true);
    updatePercentFromClientX(event.clientX);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updatePercentFromClientX(event.clientX);
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    setIsDragging(false);
    onDraggingChange?.(false);
  };

  // Belt-and-braces: if the parent unmounts the slider while the user is
  // mid-drag (e.g. they hit Escape and the comparison closes), the
  // pointerup we'd otherwise rely on never fires — so the parent would
  // stay stuck thinking the user is still scrubbing. Reset on unmount.
  useEffect(() => {
    return () => {
      if (isDragging) {
        onDraggingChange?.(false);
      }
    };
    // We intentionally only fire on unmount; reading the latest
    // `isDragging` via closure is fine because the cleanup runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPercent((p) => clamp(p - (event.shiftKey ? 5 : 1), 0, 100));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPercent((p) => clamp(p + (event.shiftKey ? 5 : 1), 0, 100));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPercent(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setPercent(100);
    } else if (event.key === 'Escape' && onClose) {
      onClose();
    }
  };

  const swap = () => setSwapped((prev) => !prev);

  // Left side (underneath) and right side (on top with clip). When swapped we
  // render B on the left and A on the right; labels follow.
  const leftSrc = swapped ? imageB : imageA;
  const rightSrc = swapped ? imageA : imageB;
  const leftLabel = swapped ? labelB : labelA;
  const rightLabel = swapped ? labelA : labelB;

  const handleDownloadSideBySide = async () => {
    try {
      const [a, b] = await Promise.all([
        loadImageElement(imageA),
        loadImageElement(imageB),
      ]);
      const height = Math.max(a.naturalHeight, b.naturalHeight);
      const scaleA = height / a.naturalHeight;
      const scaleB = height / b.naturalHeight;
      const widthA = Math.round(a.naturalWidth * scaleA);
      const widthB = Math.round(b.naturalWidth * scaleB);
      const gap = 8;
      const canvas = document.createElement('canvas');
      canvas.width = widthA + widthB + gap;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(a, 0, 0, widthA, height);
      ctx.drawImage(b, widthA + gap, 0, widthB, height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `compare-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      }, 'image/png');
    } catch (err) {
      console.error('Side-by-side export failed:', err);
    }
  };

  // When a max-height is provided, ALSO cap max-width so the aspect ratio
  // survives the clamp. With just `max-height`, the browser keeps width at
  // 100% and shrinks height — visually breaking the ratio. Clamping width to
  // `maxHeight * ratio` lets width shrink first, preserving the shape.
  const surfaceStyle: React.CSSProperties = { aspectRatio: `${effectiveRatio}` };
  if (maxHeight) {
    surfaceStyle.maxHeight = maxHeight;
    surfaceStyle.maxWidth = `calc(${maxHeight} * ${effectiveRatio})`;
    surfaceStyle.marginLeft = 'auto';
    surfaceStyle.marginRight = 'auto';
  }

  return (
    <div className={`relative w-full ${className}`}>
      <div
        ref={containerRef}
        tabIndex={0}
        role="slider"
        aria-label={`Comparison slider between ${labelA} and ${labelB}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="relative w-full overflow-hidden rounded-xl bg-[#0d1117] select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
        style={surfaceStyle}
      >
        <img
          src={leftSrc}
          alt={leftLabel}
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />
        <img
          src={rightSrc}
          alt={rightLabel}
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          style={{ clipPath: `inset(0 0 0 ${percent}%)` }}
        />

        {/* Divider + handle */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none"
          style={{ left: `${percent}%`, transform: 'translateX(-50%)' }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-lg pointer-events-none"
          style={{ left: `${percent}%`, transform: 'translate(-50%, -50%)' }}
        >
          <ArrowLeftRight size={16} className="text-slate-700" />
        </div>

        {/* Corner chips — fade out while the user is actively scrubbing so
            the divider read is unobstructed; back to full opacity when the
            pointer is released. */}
        <div className={`absolute top-3 left-3 px-2 py-1 rounded-md bg-black/60 text-white text-[11px] font-semibold backdrop-blur-sm transition-opacity duration-150 ${isDragging ? 'opacity-0' : 'opacity-100'}`}>
          {leftLabel}
        </div>
        <div className={`absolute top-3 right-3 px-2 py-1 rounded-md bg-black/60 text-white text-[11px] font-semibold backdrop-blur-sm transition-opacity duration-150 ${isDragging ? 'opacity-0' : 'opacity-100'}`}>
          {rightLabel}
        </div>
        {sizesDiffer && (
          <div className={`absolute ${toolbarOverlay ? 'bottom-16' : 'bottom-3'} left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-amber-500 text-[#0d1117] text-[11px] font-medium backdrop-blur-sm transition-opacity duration-150 ${isDragging ? 'opacity-0' : 'opacity-100'}`}>
            Sizes differ: letterboxed
          </div>
        )}

        {/* Overlay toolbar — lives INSIDE the slider surface so the card
            footprint equals a plain image preview. Toggled by the parent when
            the comparison viewer is inlined into the main viewport. Hidden
            while the user drags so the toolbar doesn't compete with the
            divider for attention. */}
        {toolbarOverlay && (
          <div className={`absolute bottom-3 right-3 flex items-center gap-2 pointer-events-auto transition-opacity duration-150 ${isDragging ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <button
              type="button"
              onClick={swap}
              aria-label="Swap A and B"
              className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-white bg-black/60 hover:bg-black/75 backdrop-blur-sm transition-colors ${FOCUS_RING}`}
            >
              <ArrowLeftRight size={13} />
              Swap
              <Tip title="Swap" text="Swap A and B" side="top" align="right" />
            </button>
            <button
              type="button"
              onClick={handleDownloadSideBySide}
              aria-label="Download both images side-by-side as PNG"
              className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-white bg-black/60 hover:bg-black/75 backdrop-blur-sm transition-colors ${FOCUS_RING}`}
            >
              <Download size={13} />
              Side-by-side
              <Tip title="Side-by-side" text="Download both images side-by-side as PNG" side="top" align="right" />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close comparison viewer"
                className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-white bg-black/60 hover:bg-black/75 backdrop-blur-sm transition-colors ${FOCUS_RING}`}
              >
                <X size={13} />
                Close
                <Tip title="Close" text="Close comparison viewer" side="top" align="right" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Below-surface toolbar — original layout used when the slider is not
          inlined into the main viewport (e.g. potential future uses). */}
      {!toolbarOverlay && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-[12px] text-slate-500 dark:text-slate-400">
            Drag or use the arrow keys to move the handle. Shift-arrow moves faster.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={swap}
              aria-label="Swap A and B"
              className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 bg-gray-100 dark:bg-[#21262d] hover:bg-gray-200 dark:hover:bg-[#30363d] transition-colors ${FOCUS_RING}`}
            >
              <ArrowLeftRight size={14} />
              Swap
              <Tip title="Swap" text="Swap A and B" side="top" align="right" />
            </button>
            <button
              type="button"
              onClick={handleDownloadSideBySide}
              aria-label="Download both images side-by-side as PNG"
              className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 bg-gray-100 dark:bg-[#21262d] hover:bg-gray-200 dark:hover:bg-[#30363d] transition-colors ${FOCUS_RING}`}
            >
              <Download size={14} />
              Side-by-side
              <Tip title="Side-by-side" text="Download both images side-by-side as PNG" side="top" align="right" />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close comparison viewer"
                className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 bg-gray-100 dark:bg-[#21262d] hover:bg-gray-200 dark:hover:bg-[#30363d] transition-colors ${FOCUS_RING}`}
              >
                <X size={14} />
                Close
                <Tip title="Close" text="Close comparison viewer" side="top" align="right" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
