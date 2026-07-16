import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Minus, Trash2, Play, Pause, Repeat, Route, Crosshair,
  Film, Pencil, Loader2, Maximize, Minimize,
  ChevronLeft, ChevronRight, Square, PenTool, Brush, Ruler,
  PanelRightClose, PanelRightOpen, GripVertical,
  Wand2, Focus, Sparkles, Images, Presentation,
  type LucideIcon,
} from 'lucide-react';
import type {
  Generation, GenerationVersion, ImageBuild, BuildStep, BuildPoint,
  BuildZoomFrom, BuildShape,
} from '../types';
import { CLEANUP_FOR_ANIMATION_PROMPT } from '../constants';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { createBlobUrlFromImage } from '../services/imageSourceService';
import { getCachedImageBlobUrl } from '../services/imageCache';
import {
  renderFrame, renderFrameFromState, frameStateAt, lerpFrameState, easeOut, sampleImageBackground,
  totalDurationMs, stepStartTimes, stepStopTimes,
  effectiveDurationMs, renderStepLayer, defaultBuild, netRegionBounds,
  type FrameState,
} from '../services/buildAnimator';
import { loadBuildSync, loadRemoteBuild, saveLocalBuild, saveBuild } from '../services/buildStore';

type BuildTool = 'freeform' | 'rectangle' | 'brush';

interface BuildStudioProps {
  generation: Generation;
  version: GenerationVersion;
  onClose: () => void;
  /** Signed-in user id, if any — enables Firestore-backed sync so a build
   * survives beyond this browser's localStorage (cleared storage, a
   * different device, etc). Guests get local-only persistence. */
  userId?: string;
  /** BYOK Gemini key for the AI auto-select pass (same key the app's other
   * auxiliary vision calls use). Absent → the wand explains what to set up. */
  geminiApiKey?: string;
  /** The app's refine pipeline aimed at THIS studio's generation/version —
   * powers the "Clean up for animation" pass. Creates a new Mark and swaps
   * the studio to it; resolves true on success, false on failure. The
   * studio stays open either way and reports progress/failure itself. */
  onCleanupRefine?: (refinementText: string) => Promise<boolean>;
}

const MAX_RENDER_W = 1600; // cap on-screen canvas resolution for smooth playback

const newId = (i: number): string => `step-${i}-${Math.round(performance.now())}`;

/** Largest contain-fit box for an image aspect inside an available area. */
const fitBox = (availW: number, availH: number, imgW: number, imgH: number) => {
  if (availW <= 0 || availH <= 0 || imgW <= 0 || imgH <= 0) return { w: 0, h: 0 };
  const scale = Math.min(availW / imgW, availH / imgH);
  return { w: Math.round(imgW * scale), h: Math.round(imgH * scale) };
};

/** Shoelace area of a normalized polygon (absolute value). */
const polygonArea = (pts: BuildPoint[]): number => {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

/** Centroid (average of vertices) — good enough for placing a step badge. */
const centroidOf = (pts: BuildPoint[]): BuildPoint => {
  if (pts.length === 0) return { x: 0.5, y: 0.5 };
  const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
};

/** Normalized points → an SVG points string against a (vbW × vbH) viewBox.
 * The viewBox matches the IMAGE aspect (not a stretched square) so circles
 * stay circles and stroke thickness is uniform in every direction. */
const svgPoints = (pts: BuildPoint[], vbW: number, vbH: number): string =>
  pts.map((p) => `${(p.x * vbW).toFixed(2)},${(p.y * vbH).toFixed(2)}`).join(' ');

/** Ray-cast point-in-polygon test (normalized coords). */
const pointInPolygon = (p: BuildPoint, pts: BuildPoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

/** Distance (in image px) from a point to a segment — for brush-stroke hit tests. */
const segDistPx = (p: BuildPoint, a: BuildPoint, b: BuildPoint, imgW: number, imgH: number): number => {
  const ax = a.x * imgW, ay = a.y * imgH;
  const bx = b.x * imgW, by = b.y * imgH;
  const px = p.x * imgW, py = p.y * imgH;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** Normalized bounding box of a step's painted (add) region, brush radii
 * included — what Focus mode zooms to. Null for an empty/degenerate step. */
const stepBounds = (
  step: BuildStep,
  imgW: number,
  imgH: number
): { x: number; y: number; w: number; h: number } | null => {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const sh of step.shapes) {
    if (sh.op !== 'add') continue;
    const rx = sh.kind === 'brush' ? (sh.radius * Math.min(imgW, imgH)) / imgW : 0;
    const ry = sh.kind === 'brush' ? (sh.radius * Math.min(imgW, imgH)) / imgH : 0;
    for (const p of sh.points) {
      minX = Math.min(minX, p.x - rx);
      maxX = Math.max(maxX, p.x + rx);
      minY = Math.min(minY, p.y - ry);
      maxY = Math.max(maxY, p.y + ry);
    }
  }
  const x = Math.max(0, minX);
  const y = Math.max(0, minY);
  const w = Math.min(1, maxX) - x;
  const h = Math.min(1, maxY) - y;
  return w > 0.001 && h > 0.001 ? { x, y, w, h } : null;
};

/** Translate every shape of a step (adds AND erase cutouts move together). */
const translateStep = (step: BuildStep, dx: number, dy: number): BuildStep => ({
  ...step,
  shapes: step.shapes.map((sh) => ({
    ...sh,
    points: sh.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  })),
});

/** Scale every shape of a step so its bounding box maps `from` → `to`
 * (resize about the box corners). Brush radii scale by the mean factor. */
const scaleStepToBounds = (
  step: BuildStep,
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number }
): BuildStep => {
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  const rScale = (sx + sy) / 2;
  return {
    ...step,
    shapes: step.shapes.map((sh) => {
      const points = sh.points.map((p) => ({
        x: to.x + (p.x - from.x) * sx,
        y: to.y + (p.y - from.y) * sy,
      }));
      return sh.kind === 'brush'
        ? { ...sh, points, radius: Math.max(0.002, sh.radius * rScale) }
        : { ...sh, points };
    }),
  };
};

/** Whether a point falls inside one of a shape's painted region (add-shapes
 * only — used by the eraser to find which item is under the pointer). */
const shapeContainsPoint = (sh: BuildShape, p: BuildPoint, imgW: number, imgH: number): boolean => {
  if (sh.kind === 'poly') return sh.points.length >= 3 && pointInPolygon(p, sh.points);
  const r = sh.radius * Math.min(imgW, imgH);
  if (sh.points.length === 1) return segDistPx(p, sh.points[0], sh.points[0], imgW, imgH) <= r;
  for (let i = 0; i < sh.points.length - 1; i++) {
    if (segDistPx(p, sh.points[i], sh.points[i + 1], imgW, imgH) <= r) return true;
  }
  return false;
};

/**
 * Load the generation's image as a CORS-clean HTMLImageElement (so the canvas
 * can be exported). Preference order keeps pixels untainted and VPN-resilient:
 * inline base64 → IndexedDB cache → fetched remote blob → raw remote URL.
 * SVG is rasterized from its source markup.
 */
async function loadBuildImage(
  generation: Generation,
  version: GenerationVersion
): Promise<HTMLImageElement> {
  const load = (src: string, crossOrigin?: boolean): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new window.Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    });

  // SVG → rasterize from markup.
  if (version.svgCode) {
    const blob = new Blob([version.svgCode], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      return await load(url);
    } finally {
      // Keep URL alive until the image decoded; revoke after a tick.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  // Inline base64 (fresh generations) — clean, no network. GenerationVersion
  // keeps its bytes in `imageData`; map it to the `base64Data` field the
  // image-source helper reads.
  const inlineUrl = createBlobUrlFromImage({
    imageUrl: version.imageUrl,
    base64Data: version.imageData,
    mimeType: version.mimeType,
  });
  if (inlineUrl) {
    try {
      return await load(inlineUrl);
    } catch {
      /* fall through */
    } finally {
      setTimeout(() => URL.revokeObjectURL(inlineUrl), 2000);
    }
  }

  // IndexedDB cache (clean + survives VPN/Storage blocks).
  const cachedUrl = await getCachedImageBlobUrl(generation.id, version.id);
  if (cachedUrl) {
    try {
      return await load(cachedUrl);
    } catch {
      /* fall through */
    } finally {
      setTimeout(() => URL.revokeObjectURL(cachedUrl), 2000);
    }
  }

  // Remote: fetch to a same-origin blob (clean if CORS ok), else raw URL.
  if (version.imageUrl) {
    try {
      const res = await fetch(version.imageUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        return await load(url);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch {
      return load(version.imageUrl, true);
    }
  }

  throw new Error('No image source available for this version.');
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2];

/** A single icon button for the floating Photoshop-style tool bar, with a
 * hover tooltip below (the bar itself docks to the top of the canvas). */
const ToolBarButton: React.FC<{
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
  label: string;
  activeClassName?: string;
  disabled?: boolean;
}> = ({ icon: Icon, active, onClick, label, activeClassName, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    disabled={disabled}
    className={`group/tb relative w-9 h-9 shrink-0 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 ${
      active ? activeClassName || 'bg-brand-teal text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
    }`}
  >
    <Icon size={18} />
    {!disabled && (
      <span className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[13px] font-medium px-3 py-1.5 rounded-lg bg-black/90 text-white shadow-xl opacity-0 group-hover/tb:opacity-100 transition-opacity z-30">
        {label}
      </span>
    )}
  </button>
);

/** Rich tooltip — the styled overlay every control uses instead of a native
 * `title`. Host element needs `group/tip relative`. Pick a `side` that has
 * open space: tips inside scroll containers get clipped vertically, so row
 * controls use side="left". `wide` wraps longer descriptions. */
/** Rendered through a portal with fixed positioning, so no ancestor —
 * overflow clip, scroll container, transform — can ever crop it. It appears
 * above or below its host (never to the side), clamped to the viewport. */
const Tip: React.FC<{
  text: string;
  /** Optional bold headline — use title+text for anything needing a real explanation. */
  title?: string;
  side?: 'top' | 'bottom' | 'left'; // 'left' is legacy — treated as 'top'
  align?: 'center' | 'right'; // kept for call-site compat; clamping handles edges
  wide?: boolean;
}> = ({ text, title, side = 'bottom', wide }) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const host = anchorRef.current?.parentElement;
    if (!host) return;
    const show = () => setHostRect(host.getBoundingClientRect());
    const hide = () => setHostRect(null);
    host.addEventListener('mouseenter', show);
    host.addEventListener('mouseleave', hide);
    host.addEventListener('pointerdown', hide); // gestures shouldn't fight the tip
    return () => {
      host.removeEventListener('mouseenter', show);
      host.removeEventListener('mouseleave', hide);
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
              wide ? 'w-72 whitespace-normal text-left leading-relaxed' : 'whitespace-nowrap'
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

/** Settings row: quiet label left, control right — one line each. */
const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-2 min-h-[26px]">
    <span className="text-xs text-slate-400 shrink-0">{label}</span>
    {children}
  </div>
);

/** Compact segmented pill. Options carry their own rich-tip text. */
const Seg: React.FC<{
  options: { key: string; label: string; tip: string }[];
  value: string;
  onChange: (key: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="inline-flex rounded-md border border-[#30363d]">
    {options.map((o) => (
      <button
        key={o.key}
        onClick={() => onChange(o.key)}
        className={`group/tip relative px-2 py-0.5 text-[11px] font-semibold first:rounded-l-md last:rounded-r-md ${
          value === o.key ? 'bg-brand-teal text-white' : 'text-slate-300 hover:bg-[#21262d]'
        }`}
      >
        {o.label}
        <Tip text={o.tip} />
      </button>
    ))}
  </div>
);

/** Tiny switch. */
const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; tip: string }> = ({ checked, onChange, tip }) => (
  <button
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`group/tip relative w-8 h-[18px] rounded-full transition-colors ${checked ? 'bg-brand-teal' : 'bg-[#30363d]'}`}
  >
    <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${checked ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} style={{ left: 0 }} />
    <Tip text={tip} />
  </button>
);

/** A value readout that IS the control: drag to scrub, click to type. */
const ScrubValue: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  perPx: number; // value units per pixel of horizontal drag
  format: (v: number) => string;       // readout text
  toInput: (v: number) => string;      // edit-box text
  fromInput: (s: string) => number;    // edit-box text → value
  onChange: (v: number) => void;
  tip: string;
}> = ({ value, min, max, step, perPx, format, toInput, fromInput, onChange, tip }) => {
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const clampStep = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  if (editing) {
    return (
      <input
        type="number"
        defaultValue={toInput(value)}
        autoFocus
        onBlur={(e) => {
          const v = fromInput(e.target.value);
          if (Number.isFinite(v)) onChange(clampStep(v));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
        }}
        className="w-14 bg-[#0d1117] border border-brand-teal/60 rounded px-1 py-0.5 text-[11px] text-white text-right"
      />
    );
  }
  return (
    <span
      onPointerDown={(e) => {
        e.preventDefault();
        try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* uncaptured */ }
        drag.current = { x: e.clientX, v: value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 3) d.moved = true;
        if (d.moved) onChange(clampStep(d.v + dx * perPx));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) setEditing(true);
      }}
      onPointerCancel={() => { drag.current = null; }}
      className="group/tip relative text-[11px] font-semibold text-slate-200 tabular-nums select-none touch-none px-1 py-0.5 rounded hover:bg-white/10"
      style={{ cursor: 'ew-resize' }}
    >
      {format(value)}
      <Tip text={tip} />
    </span>
  );
};

/** Collapsible sidebar section — closed by default so the panel reads as a
 * short list of headings; the chevron reveals controls only when wanted. The
 * grid-rows trick animates open/closed without measuring content height. */
const SidebarSection: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title, defaultOpen = false, children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[#30363d]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-200 transition-colors"
      >
        <ChevronRight size={12} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        {title}
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="px-3 pb-3 space-y-2">{children}</div>
        </div>
      </div>
    </div>
  );
};

export const BuildStudio: React.FC<BuildStudioProps> = ({ generation, version, onClose, userId, geminiApiKey, onCleanupRefine }) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);

  const [build, setBuild] = useState<ImageBuild>(
    () => loadBuildSync(generation.id, version.id) || defaultBuild()
  );
  const [mode, setMode] = useState<'edit' | 'play'>('edit');
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [cleanMode, setCleanMode] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [cleaning, setCleaning] = useState(false);
  const [exportingPngs, setExportingPngs] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // In-flight stroke/polygon. The REF is the source of truth for geometry —
  // pointer events can arrive faster than React re-renders (pointermove is
  // continuous-priority, so its updates may still be pending when pointerup
  // fires), and reading the state closure at commit time would drop the tail
  // of the stroke. State mirrors the ref purely to drive the preview render.
  const draftRef = useRef<BuildPoint[] | null>(null);
  const [draft, setDraft] = useState<BuildPoint[] | null>(null);
  const setDraftSynced = (pts: BuildPoint[] | null) => {
    draftRef.current = pts;
    setDraft(pts);
  };
  const [hoverPt, setHoverPt] = useState<BuildPoint | null>(null); // rubber band / brush ring cursor
  // `sub` = this marquee subtracts from the selected item (⌥ held, live-updated
  // mid-drag) instead of adding. Like `draftRef`, the REF is the geometry
  // source of truth (pointer events outpace renders; committing from the
  // state closure at pointerup drops the drag's tail); state mirrors it for
  // the preview render.
  const rectDragRef = useRef<{ x0: number; y0: number; x1: number; y1: number; sub?: boolean } | null>(null);
  const [rectDrag, setRectDrag] = useState<{ x0: number; y0: number; x1: number; y1: number; sub?: boolean } | null>(null);
  const setRectDragSynced = (v: { x0: number; y0: number; x1: number; y1: number; sub?: boolean } | null) => {
    rectDragRef.current = v;
    setRectDrag(v);
  };
  const [tool, setTool] = useState<BuildTool>('freeform');
  const [brushRadius, setBrushRadius] = useState(0.03); // fraction of min image side
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Sidebar width — drag its left edge to resize; persisted.
  const SIDEBAR_W_KEY = 'brandoit.buildstudio.sidebarWidth';
  const [sidebarW, setSidebarW] = useState(() => {
    try {
      const v = Number(window.localStorage.getItem(SIDEBAR_W_KEY));
      return v >= 220 && v <= 520 ? v : 288;
    } catch { return 288; }
  });
  const sideDragRef = useRef<{ startX: number; startW: number; lastW: number } | null>(null);
  const onSideResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* uncaptured */ }
    sideDragRef.current = { startX: e.clientX, startW: sidebarW, lastW: sidebarW };
  };
  const onSideResizeMove = (e: React.PointerEvent) => {
    const d = sideDragRef.current;
    if (!d) return;
    const w = Math.max(220, Math.min(520, d.startW - (e.clientX - d.startX)));
    d.lastW = w;
    setSidebarW(w);
  };
  const onSideResizeUp = () => {
    const d = sideDragRef.current;
    sideDragRef.current = null;
    if (!d) return;
    try { window.localStorage.setItem(SIDEBAR_W_KEY, String(d.lastW)); } catch { /* session-only */ }
  };
  // Editor viewport (edit mode only): CSS transform over the stage so you can
  // zoom into the image for fine eraser/brush work. Drawing coordinates stay
  // exact under any zoom because normFromEvent reads the TRANSFORMED bounding
  // rect. Playback ignores this entirely (enterPlay resets it).
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  // Focus mode (see the isolate/zoom helpers below): while set, only this
  // item's overlay/badge renders and the rest of the image dims.
  const [isolatedStepId, setIsolatedStepId] = useState<string | null>(null);
  // Move/resize gesture preview bbox (declared here so the overlay effect can
  // watch it; the transform handlers live further down).
  const xformPreviewRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [xformPreview, setXformPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false); // hold Space to pan while zoomed
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const eraseTargetRef = useRef<string | null>(null); // step receiving the in-flight eraser stroke
  const strokeOpRef = useRef<'add' | 'sub'>('add'); // op the in-flight stroke locked in at pointerdown
  // Undo/redo over step-structure mutations (draw, erase, delete, reorder).
  // Stacks live in refs (StrictMode-safe: no side effects inside state
  // updaters); histSize mirrors their lengths so buttons re-render.
  const undoStackRef = useRef<BuildStep[][]>([]);
  const redoStackRef = useRef<BuildStep[][]>([]);
  const [histSize, setHistSize] = useState({ undo: 0, redo: 0 });
  const stepsRef = useRef<BuildStep[]>([]);
  const statusTimerRef = useRef<number | null>(null);
  const [straightLine, setStraightLine] = useState(true);
  const [altHeld, setAltHeld] = useState(false); // for render-time hints only; gestures read e.altKey directly
  const isCurveGestureRef = useRef(false); // true while the current freeform drag is a curvy (non-vertex-click) trace
  const freshShapeRef = useRef(false); // true if that curvy drag started a brand-new shape (vs. continuing one)
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stopIndex, setStopIndex] = useState(0);
  const timeMsRef = useRef(0);
  // While non-null, the canvas draws THIS explicit state instead of the state
  // computed from `timeMs` — used to interpolate directly between two stops
  // during a manual seek (arrow-key stepping), bypassing the raw timeline so
  // any "hold" gap between them can't eat into the seek's short duration.
  const [seekOverride, setSeekOverride] = useState<FrameState | null>(null);

  const total = useMemo(() => totalDurationMs(build), [build]);
  const starts = useMemo(() => stepStartTimes(build), [build]);
  const stops = useMemo(() => stepStopTimes(build), [build]);

  // Masked-image layer per step. Cached PER STEP (keyed by that step's own
  // shapes signature) so editing one item re-rasterizes only that item —
  // rebuilding all layers at full image resolution on every stroke made
  // editing lag as builds grew.
  const shapesKey = useMemo(() => JSON.stringify(build.steps.map((s) => s.shapes)), [build.steps]);
  const layerCacheRef = useRef(
    new Map<string, { sig: string; image: HTMLImageElement; layer: HTMLCanvasElement }>()
  );
  const layers = useMemo(() => {
    if (!image || !imgDims.w) return [];
    const cache = layerCacheRef.current;
    const seen = new Set<string>();
    const out = build.steps.map((s) => {
      if (!s.shapes.length) return null;
      seen.add(s.id);
      const sig = JSON.stringify(s.shapes);
      const hit = cache.get(s.id);
      if (hit && hit.sig === sig && hit.image === image) return hit.layer;
      const layer = renderStepLayer(image, imgDims.w, imgDims.h, s.shapes);
      cache.set(s.id, { sig, image, layer });
      return layer;
    });
    for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k); // drop deleted steps
    return out;
    // build is read but intentionally keyed via shapesKey to avoid rebuilds on timing tweaks.
  }, [shapesKey, image, imgDims.w, imgDims.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { timeMsRef.current = timeMs; }, [timeMs]);
  useEffect(() => { stepsRef.current = build.steps; }, [build.steps]);
  // Keep the selected item's row visible in the layers list (matters when a
  // number key or canvas badge selects a row scrolled out of view).
  useEffect(() => {
    if (!selectedStepId) return;
    document.querySelector(`[data-step-row="${selectedStepId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedStepId]);
  useEffect(() => () => { if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current); }, []);

  /** Status line that clears itself — for gesture hints, not export progress. */
  const flashStatus = (msg: string, ms = 2500) => {
    setStatus(msg);
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => setStatus(null), ms);
  };

  // --- Undo/redo (step-structure edits only) -------------------------------
  const pushHistory = (steps: BuildStep[]) => {
    const st = undoStackRef.current;
    st.push(steps);
    if (st.length > 50) st.shift();
    redoStackRef.current = [];
    setHistSize({ undo: st.length, redo: 0 });
  };
  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(stepsRef.current);
    setBuild((b) => ({ ...b, steps: prev }));
    setHistSize({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  }, []);
  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(stepsRef.current);
    setBuild((b) => ({ ...b, steps: next }));
    setHistSize({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  }, []);

  // The image's own background color (border-pixel mode). 'blank' preview
  // frames and the play-mode stage render on it so an isolated frame sits on
  // the same color it was drawn on instead of reading as a cutout.
  const bgColor = useMemo(
    () => (image && imgDims.w ? sampleImageBackground(image, imgDims.w, imgDims.h) : '#ffffff'),
    [image, imgDims.w, imgDims.h]
  );

  // --- Load the image once ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setImage(null);
    loadBuildImage(generation, version)
      .then((img) => {
        if (cancelled) return;
        setImage(img);
        setImgDims({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message || 'Could not load the image.');
      });
    return () => {
      cancelled = true;
    };
  }, [generation.id, version.id]);

  // --- Recover a build from Firestore on a fresh browser/device ------------
  // Only checks Firestore when the LOCAL cache came up empty on mount (a
  // different device/browser, or local storage having been cleared) — if
  // local already had something, we trust it and skip the network round-trip.
  //
  // `hasHydrated` gates the PERSIST effect below: without it, that effect's
  // first fire (with the still-empty initial `build`) can race ahead of this
  // async fetch and win, overwriting a perfectly good remote copy with an
  // empty one. Persistence only starts once we know for certain whether
  // there's a remote copy to adopt.
  const [hasHydrated, setHasHydrated] = useState(() => build.steps.length > 0 || !userId);
  useEffect(() => {
    if (hasHydrated) return;
    let cancelled = false;
    loadRemoteBuild(userId!, generation.id, version.id)
      .then((remote) => {
        if (cancelled || !remote || remote.steps.length === 0) return;
        saveLocalBuild(generation.id, version.id, remote); // warm the local cache
        setBuild(remote);
      })
      .catch((err) => console.warn('[BuildStudio] Failed to check for a cloud-saved build:', err))
      .finally(() => { if (!cancelled) setHasHydrated(true); });
    return () => { cancelled = true; };
    // Deliberately mount-only: this instance's local/hydration snapshot was
    // taken once at mount; re-running on every `build`/`hasHydrated` change
    // would just refetch pointlessly (or reintroduce the race above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.id, version.id, userId]);

  // --- Persist the build (debounced-ish: on every change) -----------------
  // Gated on `hasHydrated` so we never write the still-empty initial state
  // over a real remote copy before the recovery check above has resolved.
  // Also skipped for the mount echo (build === the object we just loaded):
  // re-saving what was just read is never useful, and it's how a stale
  // instance (second tab, HMR remount) can clobber newer saves with old data.
  const initialBuildRef = useRef(build);
  useEffect(() => {
    if (!hasHydrated) return;
    if (build === initialBuildRef.current) return;
    saveBuild(userId, generation.id, version.id, build);
  }, [build, generation.id, version.id, userId, hasHydrated]);

  // --- Fit the stage to the available area --------------------------------
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || !imgDims.w) return;
    const measure = () => {
      // Fit within the CONTENT box — measuring the padded rect used to yield a
      // box wider than the available space, which flex then shrank width-only,
      // breaking the aspect: the SVG viewBox letterboxed and the brush cursor
      // landed a few px off the pointer.
      const cs = window.getComputedStyle(el);
      const availW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const availH = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setBox(fitBox(availW, availH, imgDims.w, imgDims.h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [imgDims.w, imgDims.h]);

  // --- Size the canvas backing store to the image aspect ------------------
  const renderDims = useMemo(() => {
    if (!imgDims.w) return { w: 0, h: 0 };
    const w = Math.min(imgDims.w, MAX_RENDER_W);
    return { w, h: Math.round((w * imgDims.h) / imgDims.w) };
  }, [imgDims]);

  // --- Draw a frame -------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (mode === 'edit') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    } else if (seekOverride) {
      // Mid-seek: draw the interpolated state directly (no partial wipe —
      // we're moving between two already-settled stops, not mid-reveal).
      renderFrameFromState(ctx, build, image, layers, imgDims.w, imgDims.h, seekOverride, 1, bgColor);
    } else {
      renderFrame(ctx, build, image, layers, imgDims.w, imgDims.h, timeMs, bgColor);
    }
  }, [image, mode, build, layers, timeMs, seekOverride, imgDims.w, imgDims.h, bgColor]);

  useEffect(() => {
    draw();
  }, [draw, renderDims.w, renderDims.h]);

  // --- Editor region overlay (edit mode) ------------------------------------
  // Each item renders as its NET region — adds minus erases, composited in
  // order via the same per-step layer canvases playback uses — so erasing
  // visibly RESHAPES the selection instead of leaving a stroke on top of it.
  // Drawn as ring + interior tint derived from the layer's alpha mask.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (mode !== 'edit') return;
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!W || !layers.length) return;
    const tint = document.createElement('canvas');   // solid-color silhouette
    const ring = document.createElement('canvas');   // silhouette edge only
    tint.width = ring.width = W;
    tint.height = ring.height = H;
    const tc = tint.getContext('2d');
    const rc = ring.getContext('2d');
    if (!tc || !rc) return;
    const o = Math.max(1.5, W / 700); // ring thickness, px
    const OFFSETS = [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]];
    // Focus mode, at rest: hide everything outside the focused item — a pure
    // cutout floating on the studio backdrop, no ring, no tint. While a
    // gesture is live (drawing, erasing, moving, resizing) the cover lifts so
    // the full image shows with the item as a tinted overlay shape — you can
    // see context while you work; release, and the cutout returns.
    const gestureLive = !!draft || !!rectDrag || !!xformPreview;
    if (isolatedStepId && !gestureLive) {
      const idx = build.steps.findIndex((s) => s.id === isolatedStepId);
      const layer = idx >= 0 ? layers[idx] : null;
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, W, H);
      if (layer) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(layer, 0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      return; // no outlines in idle focus — the cutout IS the selection
    }
    build.steps.forEach((s, i) => {
      if (isolatedStepId && s.id !== isolatedStepId) return;
      const layer = layers[i];
      if (!layer) return;
      const sel = s.id === selectedStepId;
      // Silhouette of the net mask, in solid brand color.
      tc.globalCompositeOperation = 'source-over';
      tc.clearRect(0, 0, W, H);
      tc.drawImage(layer, 0, 0, W, H);
      tc.globalCompositeOperation = 'source-in';
      tc.fillStyle = sel ? '#14b8a6' : '#dc3c28';
      tc.fillRect(0, 0, W, H);
      // Edge ring: stamp the silhouette at 8 offsets, then punch out the interior.
      rc.globalCompositeOperation = 'source-over';
      rc.clearRect(0, 0, W, H);
      for (const [dx, dy] of OFFSETS) rc.drawImage(tint, dx, dy);
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(tint, 0, 0);
      ctx.globalAlpha = sel ? 0.95 : 0.75;
      ctx.drawImage(ring, 0, 0);
      ctx.globalAlpha = sel ? 0.2 : 0.1;
      ctx.drawImage(tint, 0, 0);
    });
    ctx.globalAlpha = 1;
  }, [
    mode, layers, selectedStepId, isolatedStepId, build.steps, renderDims.w, renderDims.h,
    // Booleans, not the objects — the effect re-runs on gesture start/end,
    // not on every pointermove.
    !!draft, !!rectDrag, !!xformPreview, // eslint-disable-line react-hooks/exhaustive-deps
  ]);

  // --- Auto-play: continuous advance (optionally looping) -----------------
  useEffect(() => {
    if (mode !== 'play' || !build.autoPlay || !playing || !image) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) * speed;
      last = now;
      setTimeMs((prev) => {
        let next = prev + dt;
        if (next >= total) {
          if (loop && total > 0) next = next % total;
          else {
            setPlaying(false);
            return total;
          }
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, build.autoPlay, playing, speed, loop, total, image]);

  // --- Manual: animate to the current stop when it changes (←/→ stepping) --
  // This is a SEEK (jump to a step), not a replay of that step's reveal — it
  // always takes the same short, fixed time to get there, however far away
  // the target is.
  //
  // Critically, it interpolates the RESOLVED VISUAL STATE (camera + reveal
  // alpha) directly between the "from" and "to" stops — NOT the raw `timeMs`
  // value. Two consecutive stops are usually separated by a "hold" gap (the
  // time between a step's reveal finishing and the next step's reveal
  // starting); seeking through raw timeMs compresses that whole gap into the
  // seek's short duration, so most of it was spent sitting on a static frame
  // before any visible motion began — the actual "delay before the
  // animation" that was reported, not the transition itself being slow.
  // Interpolating the STATE skips the gap entirely: motion starts on frame one.
  const MANUAL_SEEK_MS = 150;
  useEffect(() => {
    if (mode !== 'play' || build.autoPlay || !image) return;
    const target = stops[Math.min(stopIndex, stops.length - 1)] ?? 0;
    const from = timeMsRef.current;
    if (Math.abs(target - from) < 1) {
      setTimeMs(target);
      setSeekOverride(null);
      return;
    }
    const stateFrom = frameStateAt(build, from);
    const stateTo = frameStateAt(build, target);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = easeOut((now - start) / MANUAL_SEEK_MS);
      if (k >= 1) {
        // Land exactly on the real timeline position so the NEXT seek's
        // "from" state (and anything else reading timeMs) is authoritative.
        timeMsRef.current = target;
        setTimeMs(target);
        setSeekOverride(null);
        return;
      }
      setSeekOverride(lerpFrameState(stateFrom, stateTo, k));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally excludes timeMs (read via ref) so it animates once per step.
  }, [stopIndex, mode, build, build.autoPlay, image, stops]);

  // --- Fullscreen (for recording) -----------------------------------------
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  };

  // --- Editor viewport zoom/pan (edit mode) --------------------------------
  const MAX_EDIT_ZOOM = 8;
  const clampView = (v: { scale: number; tx: number; ty: number }) => {
    const scale = Math.min(MAX_EDIT_ZOOM, Math.max(1, v.scale));
    if (scale === 1) return { scale: 1, tx: 0, ty: 0 }; // fit view is always centered
    const maxTx = (box.w * scale) / 2;
    const maxTy = (box.h * scale) / 2;
    return {
      scale,
      tx: Math.min(maxTx, Math.max(-maxTx, v.tx)),
      ty: Math.min(maxTy, Math.max(-maxTy, v.ty)),
    };
  };
  /** Zoom keeping the image point under (clientX, clientY) stationary. */
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = clientX - (r.left + r.width / 2);
    const cy = clientY - (r.top + r.height / 2);
    setView((v) => {
      const scale = Math.min(MAX_EDIT_ZOOM, Math.max(1, v.scale * factor));
      if (scale === 1) return { scale: 1, tx: 0, ty: 0 };
      const k = scale / v.scale;
      return clampView({ scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k });
    });
  };
  const zoomBy = (factor: number) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };

  // --- Focus mode: isolate + zoom one item ---------------------------------
  // While an item is focused, every other region overlay and badge is hidden,
  // the image outside the item dims, and the viewport zooms to its bounds —
  // pure editing tunnel vision. ⌥1-9 focuses that item, double-tap ⌥ toggles
  // focus on the current selection, Esc / 0 / Preview exit. Selecting another
  // item while focused re-aims the focus at it.
  const resetView = () => {
    setView({ scale: 1, tx: 0, ty: 0 });
    setIsolatedStepId(null);
  };
  // Zoom readout in the toolbar: drag horizontally to zoom (about the view
  // center), plain click resets — same interaction language as durations.
  const zoomScrubRef = useRef<{ startX: number; startScale: number; moved: boolean } | null>(null);
  const onZoomScrubDown = (e: React.PointerEvent) => {
    e.preventDefault();
    capturePointer(e);
    zoomScrubRef.current = { startX: e.clientX, startScale: view.scale, moved: false };
  };
  const onZoomScrubMove = (e: React.PointerEvent) => {
    const d = zoomScrubRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    if (!d.moved) return;
    const scale = Math.max(1, Math.min(MAX_EDIT_ZOOM, d.startScale * Math.exp(dx * 0.008)));
    setView((v) => {
      if (scale === 1) return { scale: 1, tx: 0, ty: 0 };
      const k = scale / v.scale;
      return clampView({ scale, tx: v.tx * k, ty: v.ty * k });
    });
  };
  const onZoomScrubUp = () => {
    const d = zoomScrubRef.current;
    zoomScrubRef.current = null;
    if (d && !d.moved) resetView(); // plain click = reset
  };
  const isolateStep = (id: string) => {
    const step = build.steps.find((s) => s.id === id);
    if (!step) return;
    // Net region (erase cutouts included) so focus frames what's actually left.
    const b = netRegionBounds(step) ?? stepBounds(step, imgDims.w, imgDims.h);
    if (!b) return;
    setSelectedStepId(id);
    setIsolatedStepId(id);
    const FIT = 0.78; // item occupies ~78% of the stage — margin to work around edges
    const scale = Math.min(MAX_EDIT_ZOOM, Math.max(1, Math.min(FIT / b.w, FIT / b.h)));
    const dx = (b.x + b.w / 2 - 0.5) * box.w;
    const dy = (b.y + b.h / 2 - 0.5) * box.h;
    setView(clampView({ scale, tx: -dx * scale, ty: -dy * scale }));
  };
  const toggleIsolation = (id: string) => {
    if (isolatedStepId === id) resetView();
    else isolateStep(id);
  };
  // Focus follows the selection: pick another item while focused → re-aim;
  // deselect (or delete the focused item) → back out to the full view.
  useEffect(() => {
    if (!isolatedStepId) return;
    if (!selectedStepId) { resetView(); return; }
    if (selectedStepId !== isolatedStepId) isolateStep(selectedStepId);
    // isolateStep/resetView are stable-enough render closures; re-running on
    // their identities would re-zoom on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStepId]);

  // Wheel over the stage: pinch / ⌘-scroll zooms at the cursor; with the
  // brush or eraser active, plain scroll RESIZES the tool; otherwise plain
  // scroll pans the zoomed view. Always preventDefault so the wheel never
  // falls through and scrolls the gallery underneath this overlay. Native
  // listener (passive: false) because browsers won't let a React onWheel
  // preventDefault page zoom/scroll. Latest-ref pattern keeps closures fresh
  // while attaching exactly once.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (e: WheelEvent) => {
    e.preventDefault();
    if (mode !== 'edit') return;
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022));
    } else if (tool === 'brush') {
      setBrushRadius((r) => Math.min(0.25, Math.max(0.005, r * Math.exp(-e.deltaY * 0.002))));
    } else if (view.scale > 1) {
      setView((v) => clampView({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
    }
  };
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelHandlerRef.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // Wheel events must never escape this overlay: the app underneath listens
  // for wheel on WINDOW to dock/undock its toolbar (App.tsx), which reflows
  // the whole gallery — visible through the translucent backdrop as the
  // "background moving" while e.g. scroll-resizing the brush. preventDefault
  // can't stop a JS listener, so stop propagation at the overlay root.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop);
    return () => el.removeEventListener('wheel', stop);
  }, []);

  // --- Repositionable toolbar ----------------------------------------------
  // The pill keeps its reserved strip above the image but can be dragged
  // anywhere via its grip (double-click resets). The offset persists so the
  // preferred spot survives closing the studio.
  const TB_POS_KEY = 'brandoit.buildstudio.toolbarOffset';
  const [tbOffset, setTbOffset] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = window.localStorage.getItem(TB_POS_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v?.x === 'number' && typeof v?.y === 'number') return v;
      }
    } catch { /* default */ }
    return { x: 0, y: 0 };
  });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const tbDragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const tbLastRef = useRef(tbOffset);
  const saveTbOffset = (v: { x: number; y: number }) => {
    try { window.localStorage.setItem(TB_POS_KEY, JSON.stringify(v)); } catch { /* session-only */ }
  };
  const onTbGripDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* drag uncaptured */ }
    tbDragRef.current = { px: e.clientX, py: e.clientY, ox: tbOffset.x, oy: tbOffset.y };
  };
  const onTbGripMove = (e: React.PointerEvent) => {
    const d = tbDragRef.current;
    if (!d) return;
    const next = { x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) };
    // Keep the pill inside the overlay so it can't be lost offscreen.
    const rootR = rootRef.current?.getBoundingClientRect();
    const pill = toolbarRef.current?.getBoundingClientRect();
    if (rootR && pill) {
      const natL = pill.left - tbOffset.x;
      const natT = pill.top - tbOffset.y;
      next.x = Math.min(rootR.right - pill.width - natL - 8, Math.max(rootR.left - natL + 8, next.x));
      next.y = Math.min(rootR.bottom - pill.height - natT - 8, Math.max(rootR.top - natT + 8, next.y));
    }
    tbLastRef.current = next;
    setTbOffset(next);
  };
  const onTbGripUp = () => {
    if (!tbDragRef.current) return;
    tbDragRef.current = null;
    saveTbOffset(tbLastRef.current);
  };
  const resetTbOffset = () => {
    const origin = { x: 0, y: 0 };
    tbLastRef.current = origin;
    setTbOffset(origin);
    saveTbOffset(origin);
  };

  // --- Item transform: move (drag the badge) & resize (corner handles) ------
  // Marquee-style: the gesture drags a dashed preview of the item's bounding
  // box; the real transform commits once on release (recomputing the region
  // masks per pointermove would jank). Geometry lives in refs — pointer events
  // outpace renders, and state closures at pointerup drop the gesture's tail.
  const xformRef = useRef<
    | {
        stepId: string;
        kind: 'move' | 'resize';
        fixed?: { x: number; y: number }; // resize: the opposite, anchored corner
        start: BuildPoint;
        bbox: { x: number; y: number; w: number; h: number };
        moved: boolean;
      }
    | null
  >(null);
  // (xformPreview state lives in the main state block — the overlay effect
  // reads it to lift focus mode's cover during transforms.)
  const setXformPreviewSynced = (v: { x: number; y: number; w: number; h: number } | null) => {
    xformPreviewRef.current = v;
    setXformPreview(v);
  };
  const badgeDragRef = useRef(false); // suppresses the badge's click-to-select after a drag

  const beginBadgeDrag = (e: React.PointerEvent, stepId: string) => {
    if (mode !== 'edit') return;
    const step = build.steps.find((s) => s.id === stepId);
    const b = step ? stepBounds(step, imgDims.w, imgDims.h) : null;
    if (!b) return;
    badgeDragRef.current = false;
    capturePointer(e);
    xformRef.current = { stepId, kind: 'move', start: normFromEvent(e), bbox: b, moved: false };
  };
  const beginResize = (e: React.PointerEvent, corner: number) => {
    if (!selectedStep) return;
    const b = stepBounds(selectedStep, imgDims.w, imgDims.h);
    if (!b) return;
    e.preventDefault();
    capturePointer(e);
    const corners = [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x, y: b.y + b.h },
      { x: b.x + b.w, y: b.y + b.h },
    ];
    xformRef.current = {
      stepId: selectedStep.id,
      kind: 'resize',
      fixed: corners[3 - corner], // diagonally opposite corner stays put
      start: normFromEvent(e),
      bbox: b,
      moved: false,
    };
  };
  const onXformMove = (e: React.PointerEvent) => {
    const g = xformRef.current;
    if (!g) return;
    const p = normFromEvent(e);
    if (g.kind === 'move') {
      // Clamp so the item can't be dragged off the image.
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      dx = Math.min(1 - (g.bbox.x + g.bbox.w), Math.max(-g.bbox.x, dx));
      dy = Math.min(1 - (g.bbox.y + g.bbox.h), Math.max(-g.bbox.y, dy));
      if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) {
        g.moved = true;
        badgeDragRef.current = true;
      }
      setXformPreviewSynced({ x: g.bbox.x + dx, y: g.bbox.y + dy, w: g.bbox.w, h: g.bbox.h });
    } else {
      const f = g.fixed!;
      const px = Math.min(1, Math.max(0, p.x));
      const py = Math.min(1, Math.max(0, p.y));
      g.moved = true;
      setXformPreviewSynced({
        x: Math.min(f.x, px),
        y: Math.min(f.y, py),
        w: Math.max(0.01, Math.abs(px - f.x)),
        h: Math.max(0.01, Math.abs(py - f.y)),
      });
    }
  };
  const endXform = () => {
    const g = xformRef.current;
    const nb = xformPreviewRef.current;
    xformRef.current = null;
    setXformPreviewSynced(null);
    if (!g || !nb || !g.moved) return;
    pushHistory(build.steps);
    setSelectedStepId(g.stepId); // moving an unselected badge also selects it
    setBuild((b) => ({
      ...b,
      steps: b.steps.map((s) =>
        s.id !== g.stepId
          ? s
          : g.kind === 'move'
            ? translateStep(s, nb.x - g.bbox.x, nb.y - g.bbox.y)
            : scaleStepToBounds(s, g.bbox, nb)
      ),
    }));
  };

  // Space-drag (or middle-button drag) pans the zoomed view.
  const onStagePanDown = (e: React.PointerEvent) => {
    if (mode !== 'edit' || !(spaceHeld || e.button === 1)) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch { /* pan uncaptured */ }
    panRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  };
  const onStagePanMove = (e: React.PointerEvent) => {
    const pan = panRef.current;
    if (!pan) return;
    setView((v) => clampView({ ...v, tx: pan.tx + (e.clientX - pan.x), ty: pan.ty + (e.clientY - pan.y) }));
  };
  const endPan = () => { panRef.current = null; };

  // --- Box drawing (edit mode) --------------------------------------------
  const normFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const el = stageRef.current?.querySelector('[data-stage-inner]') as HTMLElement | null;
    const rect = (el || stageRef.current)!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  // Pointer capture keeps a drag alive when it leaves the canvas. It can
  // throw (InvalidPointerId) for exotic/synthetic pointers — losing capture
  // is survivable; losing the whole gesture to the exception is not.
  const capturePointer = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* draw uncaptured */
    }
  };

  // Add a shape to the selected step, or start a new step when none is
  // selected. Drawing tools always ADD — erasing is the eraser tool's job.
  const addShape = (shape: BuildShape) => {
    pushHistory(build.steps);
    if (selectedStepId) {
      setBuild((b) => ({
        ...b,
        steps: b.steps.map((s) =>
          s.id === selectedStepId ? { ...s, shapes: [...s.shapes, shape] } : s
        ),
      }));
    } else {
      // No selection → each draw starts a NEW item (stays deselected so the
      // next draw is also a new item). Select an item to add/erase to it.
      const step: BuildStep = { id: newId(build.steps.length), shapes: [shape] };
      setBuild((b) => ({ ...b, steps: [...b.steps, step] }));
    }
  };
  const finishPoly = (pts: BuildPoint[]) => {
    if (pts.length < 3 || polygonArea(pts) < 0.003) return; // ignore tiny/accidental shapes
    addShape({ kind: 'poly', op: 'add', points: pts });
  };
  const finishBrush = (pts: BuildPoint[]) => {
    if (pts.length < 1) return;
    addShape({ kind: 'brush', op: 'add', points: pts, radius: brushRadius });
  };

  /** Topmost step whose NET region (adds minus erases, in order) contains the
   * point — how the eraser picks its target when nothing is selected. Sampled
   * from the composited layer masks so already-erased holes don't count;
   * geometric add-shape test is the fallback when a layer isn't built yet. */
  const hitStepAt = (p: BuildPoint): string | null => {
    for (let i = build.steps.length - 1; i >= 0; i--) {
      const s = build.steps[i];
      const layer = layers[i];
      let alpha: number | null = null;
      if (layer && layer.width > 0) {
        try {
          const lx = Math.min(layer.width - 1, Math.max(0, Math.round(p.x * layer.width)));
          const ly = Math.min(layer.height - 1, Math.max(0, Math.round(p.y * layer.height)));
          alpha = layer.getContext('2d')?.getImageData(lx, ly, 1, 1).data[3] ?? 0;
        } catch {
          alpha = null; // tainted canvas (CORS-fallback image) — use geometry
        }
      }
      if (alpha !== null) {
        if (alpha > 16) return s.id;
      } else if (s.shapes.some((sh) => sh.op === 'add' && shapeContainsPoint(sh, p, imgDims.w, imgDims.h))) {
        return s.id;
      }
    }
    return null;
  };
  const cancelDraft = () => {
    setDraftSynced(null);
    setRectDragSynced(null);
    setHoverPt(null);
    isCurveGestureRef.current = false;
    eraseTargetRef.current = null;
  };

  // Render-time hint of what a click would do right now (straight vertex vs.
  // curvy trace) — actual gesture decisions always read the live e.altKey
  // instead of this, since that can't go stale mid-drag.
  const usesStraightLine = tool === 'freeform' && straightLine !== altHeld;

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (mode !== 'edit') return;
    if (spaceHeld || e.button === 1) return; // pan gesture — bubbles to the stage handler
    const p = normFromEvent(e);
    if (tool === 'rectangle') {
      // ⌥ + a selected item → this marquee SUBTRACTS from it. ⌥ with nothing
      // selected can't subtract — say so, and draw additively as usual.
      if (e.altKey && !selectedStepId) {
        flashStatus('Select a frame first to subtract a rectangle from it.');
      }
      capturePointer(e);
      setRectDragSynced({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, sub: e.altKey && !!selectedStepId });
      return;
    }
    if (tool === 'brush') {
      // One tool, two modes: plain strokes ADD, ⌥ strokes ERASE. The mode
      // locks in at pointerdown (releasing ⌥ mid-stroke doesn't change it).
      const erase = e.altKey;
      if (erase) {
        // Erase from the selected item; with nothing selected, pick up
        // whichever item is under the pointer (and select it, so the target
        // is visible).
        const targetId = selectedStepId ?? hitStepAt(p);
        if (!targetId) {
          flashStatus('Nothing to erase here — start on a frame, or select one first.');
          return;
        }
        if (targetId !== selectedStepId) setSelectedStepId(targetId);
        eraseTargetRef.current = targetId;
      }
      strokeOpRef.current = erase ? 'sub' : 'add';
      capturePointer(e);
      setDraftSynced([p]);
      return;
    }
    // Freeform: Option/Alt held INVERTS the current straight/curvy mode for
    // just this one click-or-drag — hold it mid-polygon to trace a smooth
    // "tough spot", or hold it from the very first click to get the classic
    // single-drag freeform lasso even when straight lines is the default.
    const wantStraight = straightLine !== e.altKey;
    if (wantStraight) {
      isCurveGestureRef.current = false;
      // Click to place a vertex; double-click / Enter closes the shape.
      setDraftSynced(draftRef.current ? [...draftRef.current, p] : [p]);
      return;
    }
    isCurveGestureRef.current = true;
    freshShapeRef.current = !draftRef.current || draftRef.current.length === 0;
    setHoverPt(null);
    capturePointer(e);
    setDraftSynced(draftRef.current ? [...draftRef.current, p] : [p]);
  };
  const onStagePointerMove = (e: React.PointerEvent) => {
    if (panRef.current) return; // mid-pan — ignore drawing
    const p = normFromEvent(e);
    if (tool === 'rectangle') {
      const d = rectDragRef.current;
      if (!d) return;
      // ⌥ can be pressed/released mid-drag — the marquee re-colors live.
      setRectDragSynced({ ...d, x1: p.x, y1: p.y, sub: e.altKey && !!selectedStepId });
      return;
    }
    if (tool === 'brush') {
      setHoverPt(p); // ring cursor follows even between strokes
      const pts = draftRef.current;
      if (!pts) return;
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.004) setDraftSynced([...pts, p]);
      return;
    }
    // Freeform.
    if (isCurveGestureRef.current) {
      const pts = draftRef.current;
      if (!pts) return;
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.008) setDraftSynced([...pts, p]);
      return;
    }
    if (draftRef.current) setHoverPt(p); // rubber-band preview to the cursor while placing vertices
  };
  const onStagePointerUp = () => {
    if (tool === 'rectangle') {
      const d = rectDragRef.current;
      if (!d) return;
      const { x0, y0, x1, y1, sub } = d;
      setRectDragSynced(null);
      const x = Math.min(x0, x1), y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      const pts: BuildPoint[] = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
      if (sub && selectedStepId) {
        if (polygonArea(pts) < 0.003) return; // ignore accidental slivers
        pushHistory(build.steps);
        const targetId = selectedStepId;
        setBuild((b) => ({
          ...b,
          steps: b.steps.map((s) =>
            s.id === targetId ? { ...s, shapes: [...s.shapes, { kind: 'poly', op: 'sub', points: pts }] } : s
          ),
        }));
        return;
      }
      finishPoly(pts);
      return;
    }
    if (tool === 'brush') {
      const pts = draftRef.current;
      const targetId = eraseTargetRef.current;
      setDraftSynced(null);
      eraseTargetRef.current = null;
      if (!pts) return;
      if (strokeOpRef.current === 'sub') {
        if (!targetId) return;
        pushHistory(build.steps);
        setBuild((b) => ({
          ...b,
          steps: b.steps.map((s) =>
            s.id === targetId
              ? { ...s, shapes: [...s.shapes, { kind: 'brush', op: 'sub', points: pts, radius: brushRadius }] }
              : s
          ),
        }));
      } else {
        finishBrush(pts);
      }
      return;
    }
    // Freeform.
    if (isCurveGestureRef.current) {
      isCurveGestureRef.current = false;
      if (freshShapeRef.current) {
        // Started fresh as a curvy drag (classic single-shot lasso) — finish now.
        const pts = draftRef.current;
        if (!pts) return;
        setDraftSynced(null);
        finishPoly(pts);
      }
      // Otherwise this was just a curvy segment mid-polygon: stop tracing but
      // leave the shape open — more clicks/drags can follow, closed via
      // double-click or Enter.
      return;
    }
    // Straight-vertex mode: vertices commit on pointerdown; nothing to do here.
  };
  const onStageDoubleClick = () => {
    const pts = draftRef.current;
    if (tool === 'freeform' && pts) {
      setDraftSynced(null);
      setHoverPt(null);
      finishPoly(pts);
    }
  };

  // --- Keyboard --------------------------------------------------------------
  // Capture phase + stopImmediatePropagation so arrow keys don't also drive the
  // gallery/carousel mounted underneath this overlay. Latest-ref pattern: the
  // handler body re-binds every render (fresh closures over all state), while
  // the window listener attaches exactly once.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    // Build Studio is a modal — keys must never leak to the app's global
    // shortcuts underneath (e.g. holding a digit arms the gallery's
    // "next click adds N Marks"). We listen in the capture phase, so
    // stopping propagation here starves every bubble-phase app listener.
    e.stopPropagation();
    const typing = !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      // While typing in a field, Escape just leaves the field — it must never
      // fall through and close the studio (capture phase runs before the
      // input's own handlers).
      if (typing) {
        (e.target as HTMLElement).blur?.();
        return;
      }
      // Peel back one layer at a time: draft → play/clean → zoom → selection
      // → close.
      if (draft || rectDrag) { cancelDraft(); return; }
      if (mode === 'play' || cleanMode) { exitToEdit(); return; }
      if (isolatedStepId || view.scale > 1) { resetView(); return; } // focus or zoom → back to full view
      if (selectedStepId) { setSelectedStepId(null); return; }
      if (!document.fullscreenElement) onClose();
      return;
    }
    if (mode === 'edit') {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (typing) return;
      // ⌥1-9 — focus (isolate + zoom) that item; same combo again exits. Match
      // on e.code: on macOS Option+digit produces symbol characters ("¡™£…"),
      // so e.key never reads as the digit.
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const digit = /^Digit([1-9])$/.exec(e.code);
        if (digit) {
          const step = build.steps[Number(digit[1]) - 1];
          if (step) {
            e.preventDefault();
            toggleIsolation(step.id);
          }
          return;
        }
      }
      if (e.key === ' ') { e.preventDefault(); setSpaceHeld(true); return; }
      if (e.key === '[') { e.preventDefault(); setBrushRadius((r) => Math.max(0.005, r - 0.006)); return; }
      if (e.key === ']') { e.preventDefault(); setBrushRadius((r) => Math.min(0.25, r + 0.006)); return; }
      if (e.key === 'Enter' && tool === 'freeform' && draft) { e.preventDefault(); onStageDoubleClick(); return; }
      if (e.key === 'Enter') {
        // Return starts the preview — from the selected item, or the top.
        e.preventDefault();
        enterPlay(selectedIdx >= 0 ? selectedIdx : undefined);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Arrows walk the item list (wraps; follows into focus mode if active).
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        if (build.steps.length === 0) return;
        e.preventDefault();
        const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        const cur = build.steps.findIndex((st) => st.id === selectedStepId);
        const next = cur < 0
          ? (dir > 0 ? 0 : build.steps.length - 1)
          : (cur + dir + build.steps.length) % build.steps.length;
        setSelectedStepId(build.steps[next].id);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f') setTool('freeform');
      else if (k === 'r') setTool('rectangle');
      else if (k === 'b') setTool('brush');
      else if (k === 'e') setTool('brush'); // legacy eraser key — same tool, ⌥ erases
      else if (k === 'l' && tool === 'freeform') setStraightLine((s) => !s);
      else if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-') zoomBy(0.8);
      else if (e.key === '0') resetView();
      else if (/^[1-9]$/.test(e.key)) {
        // Number key jumps to that item; a quick double-tap (1-1) focuses it.
        if (e.repeat) return;
        const step = build.steps[Number(e.key) - 1];
        if (step) {
          e.preventDefault();
          const now = performance.now();
          const last = lastDigitTapRef.current;
          lastDigitTapRef.current = { key: e.key, t: now };
          if (last && last.key === e.key && now - last.t < 400) {
            isolateStep(step.id); // double-tap → focus mode
          } else {
            setSelectedStepId((cur) => (cur === step.id ? null : step.id));
          }
        }
      }
      return;
    }
    // Play mode. Enter toggles back into editing (it started the preview from
    // the editor) — like E, it edits the item on screen; Esc also exits.
    if (e.key === 'e' || e.key === 'E' || e.key === 'Enter') {
      e.preventDefault();
      editCurrentItem();
      return;
    }
    if (e.key === ' ' && build.autoPlay) {
      e.preventDefault();
      setPlaying((p) => !p);
    } else if (!build.autoPlay && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setStopIndex((i) => Math.min(i + 1, stops.length - 1));
    } else if (!build.autoPlay && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setStopIndex((i) => Math.max(i - 1, 0));
    } else if (!build.autoPlay && /^[1-9]$/.test(e.key)) {
      // Jump straight to item N's stop (stop 0 is the blank start).
      e.preventDefault();
      e.stopImmediatePropagation();
      setStopIndex(Math.min(Number(e.key), stops.length - 1));
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // Double-tap ⌥ — toggle Focus on the current selection. Latest-ref callback
  // so the once-attached listener always sees fresh state.
  const altDoubleTapRef = useRef<() => void>(() => {});
  altDoubleTapRef.current = () => {
    if (mode !== 'edit' || !selectedStepId) return;
    toggleIsolation(selectedStepId);
  };
  const lastAltTapRef = useRef(0);
  const lastDigitTapRef = useRef<{ key: string; t: number } | null>(null);

  // Track Option/Alt purely for render-time hints (cursor/hint text) — the
  // actual gesture logic above reads the live PointerEvent.altKey instead,
  // since that can't desync from focus loss the way a keydown/keyup pair can.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      if (!e.repeat) {
        const now = performance.now();
        if (now - lastAltTapRef.current < 350) {
          lastAltTapRef.current = 0;
          altDoubleTapRef.current();
        } else {
          lastAltTapRef.current = now;
        }
      }
      setAltHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(false);
      if (e.key === ' ') { setSpaceHeld(false); panRef.current = null; }
    };
    const onBlur = () => { setAltHeld(false); setSpaceHeld(false); panRef.current = null; };
    // Capture phase: the modal key handler stopPropagation()s everything so
    // app shortcuts underneath stay dead — same-node capture listeners still
    // fire (only stopImmediatePropagation would kill them), bubble ones don't.
    window.addEventListener('keydown', onDown, { capture: true });
    window.addEventListener('keyup', onUp, { capture: true });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown, { capture: true });
      window.removeEventListener('keyup', onUp, { capture: true });
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // --- Step list mutations ------------------------------------------------
  const updateStep = (id: string, patch: Partial<BuildStep>) =>
    setBuild((b) => ({ ...b, steps: b.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const deleteStep = (id: string) => {
    pushHistory(build.steps);
    setBuild((b) => ({ ...b, steps: b.steps.filter((s) => s.id !== id) }));
    setSelectedStepId((cur) => (cur === id ? null : cur));
  };
  /** Reorder by drag: move a step so it lands at `insertIndex` (an index in
   * the pre-removal list, as produced by the drop indicator). */
  const moveStepTo = (id: string, insertIndex: number) => {
    const from = build.steps.findIndex((s) => s.id === id);
    if (from < 0) return;
    let to = insertIndex > from ? insertIndex - 1 : insertIndex;
    to = Math.max(0, Math.min(build.steps.length - 1, to));
    if (to === from) return;
    pushHistory(build.steps);
    setBuild((b) => {
      const steps = [...b.steps];
      const [s] = steps.splice(from, 1);
      steps.splice(to, 0, s);
      return { ...b, steps };
    });
  };

  // --- Sidebar row gestures --------------------------------------------------
  // Duration: drag the "1.8s" readout horizontally to scrub; a plain click
  // opens a small inline edit box. Rows: drag vertically to reorder.
  const [editingDurId, setEditingDurId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null); // double-click a name → rename in place
  // Header trash arms, second tap clears (shared inline-confirm hook).
  const clearAllConfirm = useConfirmAction({
    onConfirm: () => {
      pushHistory(build.steps);
      setBuild((b) => ({ ...b, steps: [] }));
      setSelectedStepId(null);
      resetView();
      flashStatus('Cleared all frames — ⌘Z restores them.', 6000);
    },
  });
  const confirmClear = clearAllConfirm.isArmed('clear-all');
  const armClearAll = () => clearAllConfirm.trigger('clear-all');
  const durDragRef = useRef<{ id: string; startX: number; startMs: number; moved: boolean; alt: boolean } | null>(null);
  const onDurDown = (e: React.PointerEvent, id: string, currentMs: number) => {
    e.preventDefault();
    e.stopPropagation();
    capturePointer(e);
    durDragRef.current = { id, startX: e.clientX, startMs: currentMs, moved: false, alt: e.altKey };
  };
  const onDurMove = (e: React.PointerEvent) => {
    const d = durDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > 3) d.moved = true;
    if (!d.moved) return;
    const ms = Math.max(300, Math.min(20000, Math.round((d.startMs + dx * 20) / 100) * 100));
    updateStep(d.id, { durationMs: ms });
  };
  const onDurUp = () => {
    const d = durDragRef.current;
    durDragRef.current = null;
    if (!d || d.moved) return;
    if (d.alt) updateStep(d.id, { durationMs: undefined }); // ⌥-click → back to the global default
    else setEditingDurId(d.id); // plain click → inline edit
  };

  const rowDragRef = useRef<{ id: string; startY: number; moved: boolean } | null>(null);
  const rowDroppedRef = useRef(false); // suppress the row's click-select after a drag
  const dropIndexRef = useRef<number | null>(null);
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [rowDropIndex, setRowDropIndex] = useState<number | null>(null);
  const onRowDown = (e: React.PointerEvent, id: string) => {
    if ((e.target as HTMLElement).closest('input, [data-no-row-drag]')) return;
    capturePointer(e);
    rowDragRef.current = { id, startY: e.clientY, moved: false };
  };
  const onRowMove = (e: React.PointerEvent) => {
    const d = rowDragRef.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.startY) > 6) d.moved = true;
    if (!d.moved) return;
    setDraggingRowId(d.id);
    const rows = Array.from(document.querySelectorAll('li[data-step-row]'));
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { idx = i; break; }
    }
    dropIndexRef.current = idx;
    setRowDropIndex(idx);
  };
  const onRowUp = () => {
    const d = rowDragRef.current;
    rowDragRef.current = null;
    const drop = dropIndexRef.current;
    dropIndexRef.current = null;
    setDraggingRowId(null);
    setRowDropIndex(null);
    if (d?.moved) {
      rowDroppedRef.current = true;
      if (drop != null) moveStepTo(d.id, drop);
    }
  };

  /** Open the preview. `startAtStep` (a step index) starts playback AT that
   * item — Enter in the editor passes the selected item. */
  const enterPlay = (startAtStep?: number) => {
    focusReturnRef.current = isolatedStepId; // restore focus when Esc returns to editing
    setMode('play');
    resetView(); // playback owns the camera; editor zoom must not compound it
    setHoverPt(null);
    const fromStep = typeof startAtStep === 'number' && startAtStep >= 0 && startAtStep < build.steps.length
      ? startAtStep
      : null;
    const t0 = fromStep != null && build.autoPlay ? (starts[fromStep] ?? 0) : 0;
    timeMsRef.current = t0;
    setTimeMs(t0);
    setSeekOverride(null);
    // Manual mode: 'first' lands straight on frame 1 (skips the blank
    // pre-reveal state); 'blank' sits on "Start" until the first →/space.
    // (Auto-play ignores stopIndex entirely — it free-runs from t0 — so this
    // is harmless there.)
    const startOnFirst = build.startMode === 'first' && build.steps.length > 0;
    setStopIndex(fromStep != null ? Math.min(fromStep + 1, stops.length - 1) : startOnFirst ? 1 : 0);
    setPlaying(build.autoPlay); // manual opens paused; auto starts playing
    // Previewing is meant to be watched, not edited — hide the chrome and go
    // fullscreen automatically instead of requiring the clean-mode/fullscreen
    // buttons separately. Keyboard shortcuts (arrows/space/Escape) still work;
    // Escape backs out to editing (see exitToEdit) if needed.
    setCleanMode(true);
    const el = stageRef.current;
    if (el && !document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    }
  };

  // The single way back from an immersive (clean/fullscreen) Preview to the
  // editing screen with the layers/steps sidebar — used by Escape, the
  // hover-X button, and the Edit tab, so all three land in the same place.
  const exitToEdit = () => {
    setMode('edit');
    setPlaying(false);
    setCleanMode(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  /** From the slideshow straight into editing whatever is on screen: selects
   * the current item (and re-aims focus mode at it, if focus was on). */
  const editCurrentItem = () => {
    const idx = build.autoPlay
      ? frameStateAt(build, timeMsRef.current).activeStep
      : stopIndex - 1; // stop 0 is the blank start; the tail stop has no single item
    const step = build.steps[idx];
    if (step) {
      setSelectedStepId(step.id);
      if (focusReturnRef.current) focusReturnRef.current = step.id; // keep focus, re-aimed
    }
    exitToEdit();
  };

  // Preview entered from focus mode returns to focus mode: the stage resizes
  // when the chrome comes back, so re-isolate once the box has settled.
  const focusReturnRef = useRef<string | null>(null);
  useEffect(() => {
    const id = focusReturnRef.current;
    if (!id || mode !== 'edit') return;
    focusReturnRef.current = null;
    isolateStep(id);
    // isolateStep is a render closure; box/mode are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.w, box.h, mode]);

  // --- AI auto-select pass (lazy-loaded service) ----------------------------
  // One click: Gemini proposes an ordered set of regions that explain the
  // infographic (title → content blocks in reading order → conclusion). The
  // result REPLACES the current items but is a single undo away, and every
  // region is a normal rectangle step the existing tools can fine-tune.
  const [autoSelecting, setAutoSelecting] = useState(false);

  // "AI name items" — one cheap Flash call that labels the existing regions.
  // Explicit button only, never automatic.
  const [naming, setNaming] = useState(false);
  const handleAutoName = async () => {
    if (!image || naming || build.steps.length === 0) return;
    if (!geminiApiKey) {
      flashStatus('AI naming needs a Google Gemini API key — add one in Settings.');
      return;
    }
    setNaming(true);
    setStatus('AI is naming the frames…');
    const stepsBefore = build.steps;
    try {
      const { nameBuildRegions } = await import('../services/buildAutoSelect');
      const regions = build.steps
        .map((s, i) => ({ index: i, rect: stepBounds(s, imgDims.w, imgDims.h) }))
        .filter((r): r is { index: number; rect: NonNullable<ReturnType<typeof stepBounds>> } => !!r.rect);
      const names = await nameBuildRegions(image, imgDims.w, imgDims.h, geminiApiKey, regions);
      pushHistory(stepsBefore);
      setBuild((b) => ({
        ...b,
        steps: b.steps.map((s, i) => (names.get(i) ? { ...s, label: names.get(i) } : s)),
      }));
      flashStatus(`Named ${names.size} frames — edit any name in the list, or ⌘Z to undo.`, 6000);
    } catch (err) {
      console.error('[BuildStudio] auto-name failed:', err);
      flashStatus(err instanceof Error ? err.message : 'AI naming failed — try again.', 8000);
    } finally {
      setNaming(false);
    }
  };
  const handleAutoSelect = async () => {
    if (!image || autoSelecting) return;
    if (!geminiApiKey) {
      flashStatus('AI auto-select needs a Google Gemini API key — add one in Settings.');
      return;
    }
    setAutoSelecting(true);
    setStatus('AI is reading the infographic and proposing frames…');
    // Snapshot the steps being replaced NOW, from this render's closure — the
    // ref mirror can be stale across the multi-second await (it burned us:
    // an empty snapshot made ⌘Z after an AI pass wipe the build).
    const stepsBeforeAi = build.steps;
    try {
      const { autoDetectBuildRegions } = await import('../services/buildAutoSelect');
      const regions = await autoDetectBuildRegions(image, imgDims.w, imgDims.h, geminiApiKey);
      pushHistory(stepsBeforeAi);
      const steps: BuildStep[] = regions.map((r, i) => ({
        id: newId(i),
        label: r.label,
        shapes: [{
          kind: 'poly',
          op: 'add',
          // Freeform outline traced from the AI's segmentation mask when it
          // came back usable; the bounding rectangle otherwise.
          points: r.poly ?? [
            { x: r.rect.x, y: r.rect.y },
            { x: r.rect.x + r.rect.w, y: r.rect.y },
            { x: r.rect.x + r.rect.w, y: r.rect.y + r.rect.h },
            { x: r.rect.x, y: r.rect.y + r.rect.h },
          ],
        }],
      }));
      setBuild((b) => ({ ...b, steps }));
      setSelectedStepId(null);
      flashStatus(`AI replaced your frames with ${steps.length} proposals — ⌘Z brings yours back.`, 7000);
    } catch (err) {
      console.error('[BuildStudio] auto-select failed:', err);
      flashStatus(err instanceof Error ? err.message : 'AI auto-select failed — try again.', 8000);
    } finally {
      setAutoSelecting(false);
    }
  };

  // --- MP4 export (lazy-loaded service) -----------------------------------
  const handleExport = async () => {
    if (!image || build.steps.length === 0) return;
    setExporting(true);
    setExportProgress(0);
    setStatus('Preparing export…');
    try {
      const mod = await import('../services/buildExportService');
      if (!mod.canExportMp4()) {
        setStatus('MP4 export needs a Chromium/Safari browser with WebCodecs. Use the player + screen-record instead.');
        setExporting(false);
        return;
      }
      const blob = await mod.exportBuildToMp4(build, image, imgDims.w, imgDims.h, {
        onProgress: (p) => setExportProgress(p),
        bgColor,
      });
      const { downloadBlobAsFile } = await import('../services/batchExportService');
      const safe = (generation.config.prompt || 'build').slice(0, 40).replace(/[^a-z0-9]+/gi, '-');
      downloadBlobAsFile(blob, `${safe || 'build'}-v${version.number}.mp4`);
      setStatus('MP4 downloaded.');
    } catch (err) {
      console.error('[BuildStudio] export failed:', err);
      setStatus('Export failed. You can still screen-record the player.');
    } finally {
      setExporting(false);
    }
  };

  // PNG-per-step export for slide decks (Google Slides / PowerPoint /
  // Keynote): one still per walkthrough stop, zipped. Fast — no encoder gate.
  const handleExportPngs = async () => {
    if (!image || build.steps.length === 0 || exportingPngs) return;
    setExportingPngs(true);
    setStatus('Rendering one PNG per frame…');
    try {
      const mod = await import('../services/buildExportService');
      const blob = await mod.exportBuildToPngZip(build, image, imgDims.w, imgDims.h, { bgColor });
      const { downloadBlobAsFile } = await import('../services/batchExportService');
      const safe = (generation.config.prompt || 'build').slice(0, 40).replace(/[^a-z0-9]+/gi, '-');
      downloadBlobAsFile(blob, `${safe || 'build'}-v${version.number}-slides.zip`);
      flashStatus('PNGs downloaded — add one per slide with a Fade transition.', 6000);
    } catch (err) {
      console.error('[BuildStudio] PNG export failed:', err);
      flashStatus('PNG export failed.', 5000);
    } finally {
      setExportingPngs(false);
    }
  };

  // Native .pptx export: one slide, each frame a picture shape with a real
  // "Fade in on click" entrance. Opens animated in PowerPoint/Keynote and
  // imports into Google Slides with the builds intact.
  const handleExportPptx = async () => {
    if (!image || build.steps.length === 0 || exportingPptx) return;
    setExportingPptx(true);
    setStatus('Building the PowerPoint deck…');
    try {
      const mod = await import('../services/buildPptxExport');
      const blob = await mod.exportBuildToPptx(build, image, imgDims.w, imgDims.h, {
        bgColor,
        title: generation.config.prompt?.slice(0, 80),
      });
      const { downloadBlobAsFile } = await import('../services/batchExportService');
      const safe = (generation.config.prompt || 'build').slice(0, 40).replace(/[^a-z0-9]+/gi, '-');
      downloadBlobAsFile(blob, `${safe || 'build'}-v${version.number}.pptx`);
      flashStatus('PPTX downloaded — in Google Slides use File → Import slides to keep the animations.', 8000);
    } catch (err) {
      console.error('[BuildStudio] PPTX export failed:', err);
      flashStatus('PowerPoint export failed.', 5000);
    } finally {
      setExportingPptx(false);
    }
  };

  const selectedStep = build.steps.find((s) => s.id === selectedStepId) || null;
  const selectedIdx = selectedStepId ? build.steps.findIndex((s) => s.id === selectedStepId) : -1;
  const stageInner = box.w > 0 ? { width: box.w, height: box.h } : { width: '100%', height: '100%' };
  const exportSupported = build.steps.length > 0;
  // Editor-overlay viewBox in the IMAGE's aspect (height fixed at 100 units)
  // so the mapping to screen is uniform: the brush cursor renders as a true
  // circle and matches the painted stroke exactly (radius × min image side).
  const vbH = 100;
  const vbW = imgDims.h > 0 ? (100 * imgDims.w) / imgDims.h : 100;
  const brushR = imgDims.h > 0 ? (brushRadius * Math.min(imgDims.w, imgDims.h) * 100) / imgDims.h : brushRadius * 100;
  // Whether the brush/eraser is currently in ERASE mode: the tool's own mode,
  // inverted while ⌥ is held. Mid-stroke it reflects the op the stroke locked
  // in at pointerdown (so releasing ⌥ can't recolor an in-flight stroke).
  const brushErasing = draft ? strokeOpRef.current === 'sub' : tool === 'brush' && altHeld;

  return (
    <div ref={rootRef} className="fixed inset-0 z-[300] flex flex-col bg-[#0d1117]/95 backdrop-blur-sm">
      {/* Header */}
      {!cleanMode && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#30363d] shrink-0">
          <Film size={18} className="text-brand-teal" />
          <h2 className="text-sm font-bold text-white">Build Studio</h2>
          <span className="text-xs text-slate-400 hidden sm:inline truncate max-w-[30vw]">
            {generation.config.prompt}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {/* Edit/Preview live in the toolbar (Play) and on Return/Esc —
                the header only carries what the toolbar doesn't: export, close. */}
            <button
              onClick={handleExportPptx}
              disabled={!exportSupported || exportingPptx}
              aria-label="Export PowerPoint with builds"
              className="group/tip relative min-w-9 h-9 px-1 rounded-lg flex items-center justify-center gap-1 text-slate-300 text-[11px] font-semibold disabled:opacity-40 hover:bg-[#21262d] hover:text-white"
            >
              {exportingPptx ? <Loader2 size={15} className="animate-spin" /> : <Presentation size={16} />}
              <Tip side="bottom" align="right" wide title="Export PowerPoint (.pptx)" text={exportSupported ? 'One slide with every frame as a native click-to-reveal fade build. Opens animated in PowerPoint & Keynote; in Google Slides use File → Import slides and the animations come along.' : 'Add at least one frame first, then export an animated deck.'} />
            </button>
            <button
              onClick={handleExportPngs}
              disabled={!exportSupported || exportingPngs}
              aria-label="Export PNGs for slides"
              className="group/tip relative min-w-9 h-9 px-1 rounded-lg flex items-center justify-center gap-1 text-slate-300 text-[11px] font-semibold disabled:opacity-40 hover:bg-[#21262d] hover:text-white"
            >
              {exportingPngs ? <Loader2 size={15} className="animate-spin" /> : <Images size={16} />}
              <Tip side="bottom" align="right" wide title="Export PNGs for slides" text={exportSupported ? 'A zip with one still per frame (plus start & end). Drop into Google Slides, PowerPoint, or Keynote — one per slide with a Fade transition — for click-to-advance builds.' : 'Add at least one frame first, then export stills for your slide deck.'} />
            </button>
            <button
              onClick={handleExport}
              disabled={!exportSupported || exporting}
              aria-label="Export MP4"
              className="group/tip relative min-w-9 h-9 px-1 rounded-lg flex items-center justify-center gap-1 bg-brand-red text-white text-[11px] font-semibold disabled:opacity-40 hover:bg-red-700"
            >
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <Film size={16} />}
              {exporting && `${Math.round(exportProgress * 100)}%`}
              <Tip side="bottom" align="right" wide title="Export MP4" text={exportSupported ? 'H.264 video that plays everywhere (QuickTime, PowerPoint, socials). Rendered locally in your browser.' : 'Add at least one frame first, then export the animation as a video.'} />
            </button>
            <button
              onClick={onClose}
              className="group/tip relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#21262d]"
              aria-label="Close Build Studio"
            >
              <X size={18} />
              <Tip side="bottom" align="right" text="Close Build Studio" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Stage */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Tool bar — its own strip ABOVE the image, never covering it. */}
          {mode === 'edit' && !cleanMode && image && !loadError && (
            <div className="shrink-0 flex justify-center pt-3 px-4">
              <div
                ref={toolbarRef}
                className="relative z-30 flex items-center gap-0.5 px-1.5 py-1.5 rounded-xl bg-[#161b22]/95 border border-white/10 shadow-xl"
                style={{ transform: tbOffset.x || tbOffset.y ? `translate(${tbOffset.x}px, ${tbOffset.y}px)` : undefined }}
              >
                <button
                  type="button"
                  onPointerDown={onTbGripDown}
                  onPointerMove={onTbGripMove}
                  onPointerUp={onTbGripUp}
                  onPointerCancel={onTbGripUp}
                  onDoubleClick={resetTbOffset}
                  className="w-5 h-8 shrink-0 flex items-center justify-center text-slate-500 hover:text-slate-300 cursor-grab active:cursor-grabbing touch-none"
                  title="Drag to move the toolbar · double-click to reset"
                  aria-label="Move toolbar"
                >
                  <GripVertical size={14} />
                </button>
                <ToolBarButton icon={PenTool} active={tool === 'freeform'} onClick={() => setTool('freeform')} label="Freeform selection (F)" />
                <ToolBarButton icon={Square} active={tool === 'rectangle'} onClick={() => setTool('rectangle')} label="Rectangle selection (R) · hold ⌥ to subtract from the selected frame" />
                {/* One brush: plain = add (teal), hold ⌥ = erase (red —
                    the icon flips to a minus live). */}
                <ToolBarButton
                  icon={tool === 'brush' && altHeld ? Minus : Brush}
                  active={tool === 'brush'}
                  onClick={() => setTool('brush')}
                  label="Brush (B) · scroll on image resizes · hold ⌥ to erase"
                  activeClassName={tool === 'brush' && altHeld ? 'bg-brand-red text-white' : undefined}
                />
                {tool === 'freeform' && <div className="w-px h-6 bg-white/10 mx-1" />}
                {tool === 'freeform' && (
                  <ToolBarButton icon={Ruler} active={straightLine} onClick={() => setStraightLine((s) => !s)} label="Straight lines (L) · hold Alt/Option to draw freehand" />
                )}
                <div className="w-px h-6 bg-white/10 mx-1" />
                <button
                  type="button"
                  onClick={() => void handleAutoSelect()}
                  disabled={autoSelecting}
                  aria-label="AI auto-select"
                  className="group/tip relative h-9 shrink-0 px-1.5 rounded-lg flex items-center gap-1 transition-colors text-brand-teal hover:bg-brand-teal/15 disabled:opacity-60"
                >
                  {autoSelecting ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                  <span className="text-[10px] font-bold tracking-wide">AI</span>
                  <Tip
                    side="bottom"
                    wide
                    title="AI auto-select"
                    text="Proposes the frames from the image, in reveal order. Replaces the current frames (⌘Z restores) · one call on your Gemini key · for busy art, run “Clean up image” first."
                  />
                </button>


                {onCleanupRefine && (
                  <button
                    onClick={async () => {
                      if (cleaning) return;
                      setCleaning(true);
                      // Persistent status (no auto-clear) — the redraw takes a
                      // while. Success swaps the studio to the new Mark (fresh
                      // mount clears this); failure flashes below.
                      if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
                      setStatus('AI is redrawing the image for animation — usually 30–60s…');
                      try {
                        const ok = await onCleanupRefine(CLEANUP_FOR_ANIMATION_PROMPT);
                        if (!ok) {
                          flashStatus('Clean up failed — check your API key and image model, then try again.', 6000);
                        }
                      } catch {
                        flashStatus('Clean up failed — check your API key and image model, then try again.', 6000);
                      }
                      setCleaning(false);
                    }}
                    aria-label="Clean up image for animation"
                    className={`group/tip relative w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-brand-teal ${
                      cleaning ? 'bg-brand-teal/15 cursor-default' : 'hover:bg-brand-teal/15'
                    }`}
                  >
                    {cleaning ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                    <Tip side="bottom" wide title="Clean up for animation" text="AI redraws this image with each block isolated on a solid background, so frames are easy to select. The cleaned image opens right here as a new Mark (your original stays) · uses your image model." />
                  </button>
                )}
                <div className="w-px h-6 bg-white/10 mx-1" />
                <span
                  onPointerDown={onZoomScrubDown}
                  onPointerMove={onZoomScrubMove}
                  onPointerUp={onZoomScrubUp}
                  onPointerCancel={onZoomScrubUp}
                  className="group/tip relative h-9 min-w-[3.2rem] px-1 rounded-lg flex items-center justify-center text-[11px] font-semibold tabular-nums text-slate-300 hover:bg-white/10 hover:text-white transition-colors select-none touch-none"
                  style={{ cursor: 'ew-resize' }}
                >
                  {Math.round(view.scale * 100)}%
                  <Tip side="bottom" text="Drag to zoom · click to reset · pinch/⌘-scroll on image · Space-drag pans" />
                </span>

                {selectedIdx >= 0 && (
                  <>
                    <div className="w-px h-6 bg-white/10 mx-1" />
                    <button
                      type="button"
                      onClick={() => setSelectedStepId(null)}
                      className="group/tip relative w-6 h-6 shrink-0 rounded-full bg-brand-teal text-white font-bold text-center tabular-nums hover:bg-teal-600 transition-colors"
                      style={{ fontSize: selectedIdx + 1 >= 10 ? 10 : 11, lineHeight: '24px' }}
                    >
                      {selectedIdx + 1}
                      <Tip side="bottom" text={`Editing frame ${selectedIdx + 1} — click to finish`} />
                    </button>
                    <ToolBarButton
                      icon={Focus}
                      active={isolatedStepId === selectedStepId}
                      onClick={() => selectedStepId && toggleIsolation(selectedStepId)}
                      label="Focus — isolate & zoom this frame (⌥number · double-tap ⌥ · Esc exits)"
                    />
                  </>
                )}

                <div className="w-px h-6 bg-white/10 mx-1" />
                <ToolBarButton
                  icon={Play}
                  onClick={() => enterPlay(selectedIdx >= 0 ? selectedIdx : undefined)}
                  disabled={build.steps.length === 0}
                  label="Play the slideshow (Return) — starts at the selected frame"
                  activeClassName="bg-brand-teal text-white"
                />
                <ToolBarButton
                  icon={sidebarOpen ? PanelRightClose : PanelRightOpen}
                  onClick={() => setSidebarOpen((o) => !o)}
                  label={sidebarOpen ? 'Hide the panel' : 'Show the panel'}
                />
              </div>
            </div>
          )}
          <div
            ref={stageRef}
            onPointerDown={onStagePanDown}
            onPointerMove={onStagePanMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            className={`flex-1 min-h-0 flex items-center justify-center p-4 relative overflow-hidden ${isFullscreen ? 'bg-black' : ''} ${spaceHeld && mode === 'edit' ? 'cursor-grab active:cursor-grabbing' : ''}`}
            // In Preview on a 'blank' build, the whole stage (letterbox bars
            // included) takes the image's own background color — a frame shown
            // in isolation then sits on the color it was drawn on instead of
            // floating on black/white like a cutout. Recordings inherit it too.
            style={mode === 'play' && build.background === 'blank' ? { background: bgColor } : undefined}
          >
            {loadError ? (
              <div className="text-center text-slate-300">
                <p className="font-semibold mb-1">Couldn’t load this image.</p>
                <p className="text-xs text-slate-500">{loadError}</p>
              </div>
            ) : !image ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 size={16} className="animate-spin" /> Loading image…
              </div>
            ) : (
              <div
                data-stage-inner
                // In Preview on a 'blank' build the stage matches the image's
                // background — the canvas shadow/rounding would redraw exactly
                // the cutout rectangle we're hiding, so drop them there.
                className={`relative shrink-0 overflow-hidden ${
                  mode === 'play' && build.background === 'blank' ? '' : 'shadow-2xl shadow-black rounded-md'
                }`}
                style={{
                  ...stageInner,
                  transform: view.scale !== 1 ? `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` : undefined,
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={renderDims.w}
                  height={renderDims.h}
                  className="block w-full h-full"
                />
                {/* Editor overlay: freeform lasso + existing shapes (SVG so
                    polygons map 1:1 to the normalized 0..100 viewBox). */}
                {mode === 'edit' && (
                  <>
                    <canvas
                      ref={overlayRef}
                      width={renderDims.w}
                      height={renderDims.h}
                      className="absolute inset-0 w-full h-full pointer-events-none"
                    />
                    <svg
                      viewBox={`0 0 ${vbW} ${vbH}`}
                      className={`absolute inset-0 w-full h-full touch-none ${spaceHeld ? 'cursor-grab' : 'cursor-crosshair'}`}
                      onPointerDown={onStagePointerDown}
                      onPointerMove={onStagePointerMove}
                      onPointerUp={onStagePointerUp}
                      onPointerLeave={() => setHoverPt(null)}
                      onDoubleClick={onStageDoubleClick}
                    >
                      {/* Committed shapes render on the region-overlay canvas
                          underneath (as each item's NET reshaped region) — the
                          SVG carries only live drafts and cursors, and never
                          intercepts pointer events for existing regions.
                          Selecting an item happens via its numbered badge
                          (below) or the sidebar list instead. */}
                      {/* Live draft */}
                      {draft && draft.length > 0 && tool === 'brush' && (
                        <polyline
                          points={svgPoints(draft.length > 1 ? draft : [draft[0], draft[0]], vbW, vbH)}
                          fill="none" strokeLinecap="round" strokeLinejoin="round"
                          className={brushErasing ? 'stroke-brand-red' : 'stroke-brand-teal'}
                          style={{ strokeWidth: brushR * 2, opacity: 0.5 }}
                        />
                      )}
                      {draft && draft.length > 0 && tool === 'freeform' && (
                        <polyline
                          points={svgPoints(usesStraightLine && hoverPt ? [...draft, hoverPt] : draft, vbW, vbH)}
                          fill="rgba(20,184,166,0.12)"
                          className="stroke-brand-teal"
                          vectorEffect="non-scaling-stroke"
                          style={{ strokeWidth: 2, strokeDasharray: '3 2' }}
                        />
                      )}
                      {/* Ring cursor previews the brush/eraser footprint — a
                          true circle matching the painted stroke exactly, with
                          a center +/− showing add vs erase (⌥ flips it). */}
                      {tool === 'brush' && hoverPt && !spaceHeld && (() => {
                        const cx = hoverPt.x * vbW;
                        const cy = hoverPt.y * vbH;
                        // ± glyph scales WITH the brush and disappears when the
                        // ring is too small to host it — the fill color still
                        // says add (teal) vs erase (red).
                        const g = Math.min(2.2, brushR * 0.4);
                        const cls = brushErasing ? 'stroke-brand-red' : 'stroke-brand-teal';
                        return (
                          <g pointerEvents="none">
                            <circle
                              cx={cx} cy={cy} r={brushR}
                              fill={brushErasing ? 'rgba(220,60,40,0.35)' : 'rgba(20,184,166,0.35)'}
                              className={cls}
                              vectorEffect="non-scaling-stroke"
                              style={{ strokeWidth: 1 }}
                            />
                            {g >= 0.45 && (
                              <line x1={cx - g} y1={cy} x2={cx + g} y2={cy} className={cls} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1.25 }} />
                            )}
                            {g >= 0.45 && !brushErasing && (
                              <line x1={cx} y1={cy - g} x2={cx} y2={cy + g} className={cls} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1.25 }} />
                            )}
                          </g>
                        );
                      })()}
                      {/* Move/resize gesture preview — dashed bounding box. */}
                      {xformPreview && (
                        <rect
                          x={xformPreview.x * vbW}
                          y={xformPreview.y * vbH}
                          width={xformPreview.w * vbW}
                          height={xformPreview.h * vbH}
                          fill="rgba(20,184,166,0.08)"
                          className="stroke-brand-teal"
                          vectorEffect="non-scaling-stroke"
                          style={{ strokeWidth: 1.5, strokeDasharray: '4 3' }}
                          pointerEvents="none"
                        />
                      )}
                      {rectDrag && (
                        <rect
                          x={Math.min(rectDrag.x0, rectDrag.x1) * vbW}
                          y={Math.min(rectDrag.y0, rectDrag.y1) * vbH}
                          width={Math.abs(rectDrag.x1 - rectDrag.x0) * vbW}
                          height={Math.abs(rectDrag.y1 - rectDrag.y0) * vbH}
                          fill={rectDrag.sub ? 'rgba(220,60,40,0.12)' : 'rgba(20,184,166,0.12)'}
                          className={rectDrag.sub ? 'stroke-brand-red' : 'stroke-brand-teal'}
                          vectorEffect="non-scaling-stroke"
                          style={{ strokeWidth: 2, strokeDasharray: '3 2' }}
                        />
                      )}
                    </svg>
                    {/* Step number badges at each region's centroid. */}
                    {build.steps.map((s, i) => {
                      if (isolatedStepId && s.id !== isolatedStepId) return null; // Focus mode
                      const addPts = s.shapes.filter((sh) => sh.op === 'add').flatMap((sh) => sh.points);
                      const c = addPts.length ? centroidOf(addPts) : { x: 0.5, y: 0.5 };
                      const sel = s.id === selectedStepId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            if (badgeDragRef.current) { badgeDragRef.current = false; return; } // was a move-drag
                            setSelectedStepId((cur) => (cur === s.id ? null : s.id));
                          }}
                          onPointerDown={(e) => beginBadgeDrag(e, s.id)}
                          onPointerMove={onXformMove}
                          onPointerUp={endXform}
                          onPointerCancel={endXform}
                          onDoubleClick={(e) => { e.stopPropagation(); toggleIsolation(s.id); }}
                          title={sel ? 'Selected — drag to move · double-click to focus' : 'Click to select · drag to move · double-click to focus'}
                          className={`absolute w-5 h-5 rounded-full text-[10px] font-bold text-center tabular-nums text-white ring-2 ring-transparent hover:ring-white/60 cursor-move touch-none ${sel ? 'bg-brand-teal' : 'bg-brand-red'}`}
                          style={{
                            left: `${c.x * 100}%`,
                            top: `${c.y * 100}%`,
                            lineHeight: '20px',
                            // Counter-scale so badges stay screen-size while the
                            // stage zooms underneath them.
                            transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
                          }}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                    {/* Resize handles — corner squares on the selected item's
                        bounding box (for a rectangle step, its actual corners).
                        Dragging scales about the opposite corner. */}
                    {selectedStep && !draft && !rectDrag && (() => {
                      const hb = xformPreview ?? stepBounds(selectedStep, imgDims.w, imgDims.h);
                      if (!hb) return null;
                      const corners = [
                        { x: hb.x, y: hb.y, cursor: 'nwse-resize' },
                        { x: hb.x + hb.w, y: hb.y, cursor: 'nesw-resize' },
                        { x: hb.x, y: hb.y + hb.h, cursor: 'nesw-resize' },
                        { x: hb.x + hb.w, y: hb.y + hb.h, cursor: 'nwse-resize' },
                      ];
                      return corners.map((cn, ci) => (
                        <button
                          key={ci}
                          type="button"
                          onPointerDown={(e) => beginResize(e, ci)}
                          onPointerMove={onXformMove}
                          onPointerUp={endXform}
                          onPointerCancel={endXform}
                          aria-label="Resize frame"
                          title="Drag to resize (anchors the opposite corner)"
                          className="absolute w-2.5 h-2.5 bg-brand-teal ring-1 ring-white rounded-[2px] touch-none hover:bg-teal-400"
                          style={{
                            left: `${cn.x * 100}%`,
                            top: `${cn.y * 100}%`,
                            transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
                            cursor: cn.cursor,
                          }}
                        />
                      ));
                    })()}
                    {build.steps.length === 0 && !draft && !rectDrag && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="px-3 py-1.5 rounded-full bg-black/70 text-white text-xs font-medium flex items-center gap-1.5">
                          <Plus size={13} />
                          {tool === 'rectangle'
                            ? 'Drag a box around your first frame'
                            : tool === 'brush'
                              ? 'Paint over your first frame'
                              : usesStraightLine
                                  ? 'Click to place corners (double-click to close) — hold Alt/Option to draw freehand'
                                  : 'Drag to draw freehand — hold Alt/Option for straight corners'}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {cleanMode && (
                  <button
                    onClick={exitToEdit}
                    className="group/tip absolute top-2 right-2 p-1.5 rounded-md bg-black/50 text-white/80 hover:text-white opacity-0 hover:opacity-100 transition-opacity"
                    aria-label="Exit to editing"
                  >
                    <Tip text="Back to editing (Esc)" />
                    <X size={14} />
                  </button>
                )}
                {/* Transport — playback controls for the preview. Auto-hides
                    (opacity-0) so the immersive view stays clean/unobstructed
                    for recording; hovering the bottom edge reveals it, same
                    pattern as the exit button above. Lives INSIDE the stage so
                    it overlays the image rather than taking up its own
                    permanent strip of screen space below it. */}
                {mode === 'play' && (
                  <div className="group/transport absolute bottom-0 inset-x-0">
                    <div className="h-6" /> {/* larger hover target than the bar alone */}
                    <div className="px-4 py-3 border-t border-white/10 bg-black/70 backdrop-blur-sm flex items-center gap-3 flex-wrap opacity-0 group-hover/transport:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
                      {build.autoPlay ? (
                        <>
                          <button onClick={() => setPlaying((p) => !p)} className="p-2 rounded-lg bg-brand-teal text-white hover:bg-teal-600" aria-label={playing ? 'Pause' : 'Play'}>
                            {playing ? <Pause size={16} /> : <Play size={16} />}
                          </button>
                          <input
                            type="range" min={0} max={Math.max(1, total)} step={1} value={Math.min(timeMs, total)}
                            onChange={(e) => { setPlaying(false); setTimeMs(Number(e.target.value)); }}
                            className="flex-1 min-w-[8rem] accent-brand-teal"
                            aria-label="Scrub timeline"
                          />
                          <span className="text-xs text-slate-300 tabular-nums w-16 text-right">
                            {(Math.min(timeMs, total) / 1000).toFixed(1)}s / {(total / 1000).toFixed(1)}s
                          </span>
                          <button onClick={() => setLoop((l) => !l)} className={`p-2 rounded-lg ${loop ? 'text-brand-teal bg-brand-teal/10' : 'text-slate-300 hover:bg-white/10'}`} aria-label="Loop" title="Loop">
                            <Repeat size={15} />
                          </button>
                          <div className="inline-flex rounded-lg border border-white/15 overflow-hidden">
                            {SPEED_OPTIONS.map((sp) => (
                              <button key={sp} onClick={() => setSpeed(sp)} className={`px-2 py-1 text-xs font-semibold ${speed === sp ? 'bg-brand-teal text-white' : 'text-slate-300 hover:bg-white/10'}`}>
                                {sp}×
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setStopIndex((i) => Math.max(0, i - 1))} disabled={stopIndex <= 0} className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-30" aria-label="Previous frame" title="Previous (←)">
                            <ChevronLeft size={16} />
                          </button>
                          <span className="text-xs text-slate-300 font-medium tabular-nums min-w-[7rem] text-center">
                            {stopIndex === 0
                              ? 'Start'
                              : build.endShowFull && stopIndex === stops.length - 1
                                ? 'All frames'
                                : `Frame ${stopIndex}`}
                            <span className="text-slate-500"> · {stopIndex}/{stops.length - 1}</span>
                          </span>
                          <button onClick={() => setStopIndex((i) => Math.min(stops.length - 1, i + 1))} disabled={stopIndex >= stops.length - 1} className="p-2 rounded-lg bg-brand-teal text-white hover:bg-teal-600 disabled:opacity-30" aria-label="Next frame" title="Next (→)">
                            <ChevronRight size={16} />
                          </button>
                          <span className="text-xs text-slate-400 hidden sm:inline">← → step · 1-9 jump · E edits this frame</span>
                        </>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={build.autoPlay}
                            onChange={(e) => {
                              const auto = e.target.checked;
                              setBuild((b) => ({ ...b, autoPlay: auto }));
                              if (auto) { timeMsRef.current = 0; setTimeMs(0); setPlaying(true); }
                              else { setPlaying(false); setStopIndex(0); }
                            }}
                            className="accent-brand-teal"
                          />
                          Auto-play
                        </label>
                        <button onClick={toggleFullscreen} className={`p-2 rounded-lg ${isFullscreen ? 'text-brand-teal bg-brand-teal/10' : 'text-slate-300 hover:bg-white/10'}`} title="Fullscreen for recording" aria-label="Fullscreen">
                          {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
                        </button>
                        <button onClick={editCurrentItem} className="group/tip relative p-2 rounded-lg text-slate-300 hover:bg-white/10" aria-label="Edit this frame">
                          <Tip text="Edit this frame (E) · Esc exits without selecting" />
                          <Pencil size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Sidebar (edit mode) — minimal by default: settings fold away into
            titled sections, item rows carry just a badge/name/duration, and
            everything else appears on hover or selection. */}
        {mode === 'edit' && !cleanMode && sidebarOpen && (
          <div className="relative shrink-0 border-l border-[#30363d] flex flex-col" style={{ width: sidebarW }}>
            {/* Drag the left edge to resize the panel. */}
            <div
              onPointerDown={onSideResizeDown}
              onPointerMove={onSideResizeMove}
              onPointerUp={onSideResizeUp}
              onPointerCancel={onSideResizeUp}
              className="group/tip absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize hover:bg-brand-teal/30 z-10 touch-none"
            >
              <Tip text="Drag to resize the panel" />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Frames ({build.steps.length})</h3>
                <div className="flex items-center gap-1">
                  {build.steps.length > 0 && build.steps.some((s) => !s.label) && (
                    <button
                      onClick={() => void handleAutoName()}
                      disabled={naming}
                      className="group/tip relative inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-brand-teal text-[11px] font-semibold hover:bg-brand-teal/10 disabled:opacity-60"
                    >
                      {naming ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} AI names
                      <Tip text="AI names each frame from the image (one call on your Gemini key)" side="bottom" align="right" />
                    </button>
                  )}
                  {selectedStepId && (
                    <button onClick={() => setSelectedStepId(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#21262d] text-slate-200 text-[11px] font-semibold hover:bg-[#2d333b]">
                      <Plus size={11} /> New frame
                    </button>
                  )}
                  {build.steps.length > 0 && (
                    <button
                      onClick={armClearAll}
                      className={`group/tip relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${confirmClear ? 'bg-amber-500 text-white animate-pulse' : 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'}`}
                    >
                      <Trash2 size={11} />
                      {confirmClear && 'Sure?'}
                      <Tip text={confirmClear ? "Tap again to clear all frames (⌘Z restores)" : "Clear the whole animation (tap twice)"} side="bottom" align="right" />
                    </button>
                  )}
                </div>
              </div>
              {build.steps.length === 0 ? (
                <p className="px-3 text-xs text-slate-500">Pick a tool above and draw around each frame — or hit the wand to let AI propose the frames and their order for you.</p>
              ) : (
                <ul className="px-2 pb-3 space-y-0.5">
                  {build.steps.map((s, i) => {
                    const sel = s.id === selectedStepId;
                    const durMs = effectiveDurationMs(s, build);
                    return (
                      <li
                        key={s.id}
                        data-step-row={s.id}
                        className={`group/row relative rounded-lg transition-colors ${sel ? 'bg-brand-teal/10 ring-1 ring-inset ring-brand-teal/50' : 'hover:bg-[#161b22]'} ${draggingRowId === s.id ? 'opacity-40' : ''} ${rowDropIndex === i ? 'border-t-2 border-brand-teal' : ''} ${rowDropIndex === build.steps.length && i === build.steps.length - 1 ? 'border-b-2 border-brand-teal' : ''}`}
                      >
                        {/* Row (div, not button — it hosts inputs): click selects,
                            vertical drag reorders. */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (rowDroppedRef.current) { rowDroppedRef.current = false; return; }
                            setSelectedStepId(sel ? null : s.id);
                          }}
                          onPointerDown={(e) => onRowDown(e, s.id)}
                          onPointerMove={onRowMove}
                          onPointerUp={onRowUp}
                          onPointerCancel={onRowUp}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-left cursor-pointer touch-none"
                        >
                          <span className={`w-6 h-6 rounded-full text-white text-[11px] font-bold text-center tabular-nums shrink-0 ${sel ? 'bg-brand-teal' : 'bg-brand-red'}`} style={{ lineHeight: '24px' }}>{i + 1}</span>
                          {renamingId === s.id ? (
                            <input
                              data-no-row-drag
                              type="text"
                              defaultValue={s.label ?? ''}
                              placeholder={`Frame ${i + 1}`}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => {
                                updateStep(s.id, { label: e.target.value.trim() || undefined });
                                setRenamingId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') { e.stopPropagation(); setRenamingId(null); }
                              }}
                              className="flex-1 min-w-0 bg-[#0d1117] border border-brand-teal/60 rounded px-1.5 py-0.5 text-xs text-white placeholder:text-slate-600"
                            />
                          ) : (
                            <span
                              className="text-xs font-medium text-slate-300 truncate min-w-0"
                              onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(s.id); }}
                            >
                              {s.label || `Frame ${i + 1}`}
                            </span>
                          )}
                          {sel && (
                            <div data-no-row-drag className="ml-auto flex shrink-0 rounded-md border border-[#30363d] overflow-hidden">
                              {([
                                ['smart', Route, 'Smart — camera pans in from the previous frame'],
                                ['center', Crosshair, 'Center — pull back to the full image, then zoom in'],
                              ] as const).map(([zf, Icon, tip]) => {
                                const active = (s.zoomFrom ?? build.defaultZoomFrom) === zf;
                                return (
                                  <button
                                    key={zf}
                                    onClick={(e) => { e.stopPropagation(); updateStep(s.id, { zoomFrom: zf }); }}
                                    aria-label={tip}
                                    className={`group/tip relative px-1 py-0.5 ${active ? 'bg-brand-teal text-white' : 'text-slate-400 hover:bg-[#21262d]'}`}
                                  >
                                    <Icon size={11} />
                                    <Tip text={tip} side="left" />
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <button
                            data-no-row-drag
                            onClick={(e) => { e.stopPropagation(); deleteStep(s.id); }}
                            className={`group/tip relative ${sel ? '' : 'ml-auto'} p-1 text-red-400 hover:text-red-300 opacity-0 group-hover/row:opacity-100 transition-opacity`}
                            aria-label="Delete frame"
                          >
                            <Trash2 size={13} />
                            <Tip text="Delete frame" side="left" />
                          </button>
                          {/* Duration: drag horizontally to scrub, click to type. */}
                          {editingDurId === s.id ? (
                            <input
                              data-no-row-drag
                              type="number" min={0.3} max={20} step={0.1}
                              defaultValue={(durMs / 1000).toFixed(1)}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (v > 0) updateStep(s.id, { durationMs: Math.max(300, Math.min(20000, Math.round(v * 1000))) });
                                setEditingDurId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') { e.stopPropagation(); setEditingDurId(null); }
                              }}
                              className="w-12 bg-[#0d1117] border border-brand-teal/60 rounded px-1 py-0.5 text-[11px] text-white text-right"
                            />
                          ) : (
                            <span
                              data-no-row-drag
                              onPointerDown={(e) => onDurDown(e, s.id, durMs)}
                              onPointerMove={onDurMove}
                              onPointerUp={onDurUp}
                              onPointerCancel={onDurUp}
                              onClick={(e) => e.stopPropagation()}
                              className={`group/tip relative text-[11px] ${s.durationMs != null ? 'text-slate-300' : 'text-slate-500'} hover:text-slate-200 tabular-nums select-none touch-none`}
                              style={{ cursor: 'ew-resize' }}
                            >
                              {(durMs / 1000).toFixed(1)}s
                              <Tip text="Drag to adjust · click to type · ⌥-click resets to default" side="left" />
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedStep && (
                <p className="px-3 pb-3 text-[11px] text-slate-500">Draw to add · ⌥-brush erases · double-click a name to rename · drag rows to reorder.</p>
              )}
            </div>
            <SidebarSection title="Reveal style">
              <SettingRow label="Reveal">
                <Seg
                  value={build.revealStyle}
                  onChange={(v) => setBuild((b) => ({ ...b, revealStyle: v as ImageBuild['revealStyle'] }))}
                  options={[
                    { key: 'fade', label: 'Fade', tip: 'Each frame fades in' },
                    { key: 'wipe', label: 'Wipe', tip: 'Each frame wipes in, left to right' },
                    { key: 'spotlight', label: 'Spot', tip: 'Spotlight — the image stays dimmed, frames light up' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Backdrop">
                <Seg
                  value={build.background}
                  onChange={(v) => setBuild((b) => ({ ...b, background: v as ImageBuild['background'] }))}
                  options={[
                    { key: 'blank', label: 'White', tip: 'Not-yet-revealed areas are white' },
                    { key: 'dim', label: 'Dim', tip: 'Not-yet-revealed areas show the image, dimmed' },
                    { key: 'blur', label: 'Blur', tip: 'Not-yet-revealed areas show the image, blurred' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Build up">
                <Switch
                  checked={build.cumulative}
                  onChange={(v) => setBuild((b) => ({ ...b, cumulative: v }))}
                  tip="Keep previous frames visible as new ones appear"
                />
              </SettingRow>
              <SettingRow label="At the end">
                <Seg
                  value={!build.endShowFull ? 'none' : (build.endStyle ?? 'items')}
                  onChange={(k) =>
                    setBuild((b) =>
                      k === 'none'
                        ? { ...b, endShowFull: false }
                        : { ...b, endShowFull: true, endStyle: k as 'items' | 'image' }
                    )
                  }
                  options={[
                    { key: 'none', label: 'Stop', tip: 'End on the last frame' },
                    { key: 'items', label: 'Frames', tip: 'Zoom out and show all frames together' },
                    { key: 'image', label: 'Image', tip: 'Zoom out and reveal the entire image' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Opens on">
                <Seg
                  value={build.startMode}
                  onChange={(k) => setBuild((b) => ({ ...b, startMode: k as 'blank' | 'first' }))}
                  options={[
                    { key: 'blank', label: 'Blank', tip: 'Preview opens empty — first → reveals frame 1' },
                    { key: 'first', label: 'First frame', tip: 'Preview opens with frame 1 already revealing' },
                  ]}
                />
              </SettingRow>
            </SidebarSection>
            <SidebarSection title="Timing & camera">
              <SettingRow label="Each frame shows">
                <ScrubValue
                  value={build.defaultDurationMs}
                  min={500} max={6000} step={100} perPx={20}
                  format={(v) => `${(v / 1000).toFixed(1)}s`}
                  toInput={(v) => (v / 1000).toFixed(1)}
                  fromInput={(t) => Number(t) * 1000}
                  onChange={(v) => setBuild((b) => ({ ...b, defaultDurationMs: v }))}
                  tip="Default seconds per frame · drag to adjust · click to type (per-frame overrides win)"
                />
              </SettingRow>
              <SettingRow label="Transition">
                <ScrubValue
                  value={build.transitionMs}
                  min={200} max={2500} step={100} perPx={10}
                  format={(v) => `${(v / 1000).toFixed(1)}s`}
                  toInput={(v) => (v / 1000).toFixed(1)}
                  fromInput={(t) => Number(t) * 1000}
                  onChange={(v) => setBuild((b) => ({ ...b, transitionMs: v }))}
                  tip="How long each reveal + camera move takes · drag to adjust · click to type"
                />
              </SettingRow>
              <SettingRow label="Camera zoom">
                <ScrubValue
                  value={build.zoom}
                  min={0} max={1} step={0.05} perPx={0.005}
                  format={(v) => `${Math.round(v * 100)}%`}
                  toInput={(v) => String(Math.round(v * 100))}
                  fromInput={(t) => Number(t) / 100}
                  onChange={(v) => setBuild((b) => ({ ...b, zoom: v }))}
                  tip="0% = no camera zoom · 100% = zoom in tight on each frame · drag to adjust · click to type"
                />
              </SettingRow>
              <SettingRow label="Zoom from">
                <div className="inline-flex rounded-md border border-[#30363d]">
                  {([
                    ['smart', Route, 'Smart — camera pans in from the previous frame'],
                    ['center', Crosshair, 'Center — pull back to the full image, then zoom in'],
                  ] as const).map(([zf, Icon, tip]) => {
                    const active = build.defaultZoomFrom === zf;
                    return (
                      <button
                        key={zf}
                        onClick={() => setBuild((b) => ({ ...b, defaultZoomFrom: zf as BuildZoomFrom }))}
                        aria-label={tip}
                        className={`group/tip relative px-2 py-1 first:rounded-l-md last:rounded-r-md ${active ? 'bg-brand-teal text-white' : 'text-slate-400 hover:bg-[#21262d]'}`}
                      >
                        <Icon size={12} />
                        <Tip text={tip} />
                      </button>
                    );
                  })}
                </div>
              </SettingRow>
            </SidebarSection>
          </div>
        )}
      </div>

      {status && !cleanMode && (
        <div className="shrink-0 px-4 py-2 text-xs text-slate-300 border-t border-[#30363d] bg-black/30">{status}</div>
      )}
    </div>
  );
};

export default BuildStudio;
