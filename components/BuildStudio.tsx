import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  X, Plus, Trash2, Play, Pause, Repeat, ArrowUp, ArrowDown,
  Film, Eye, Pencil, Loader2, Sparkles, Maximize, Minimize,
  ChevronLeft, ChevronRight, Square, PenTool, Brush, Eraser, Ruler,
  type LucideIcon,
} from 'lucide-react';
import type {
  Generation, GenerationVersion, ImageBuild, BuildStep, BuildPoint,
  BuildZoomFrom, BuildShape,
} from '../types';
import { RichSelect } from './RichSelect';
import { createBlobUrlFromImage } from '../services/imageSourceService';
import { getCachedImageBlobUrl } from '../services/imageCache';
import {
  renderFrame, totalDurationMs, stepStartTimes, stepStopTimes,
  effectiveDurationMs, prepareStepLayers, defaultBuild,
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

/** Normalized points → an SVG points string against a 0..100 viewBox. */
const svgPoints = (pts: BuildPoint[]): string =>
  pts.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');

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

const REVEAL_OPTIONS = [
  { value: 'fade', label: 'Fade in' },
  { value: 'wipe', label: 'Wipe in' },
  { value: 'spotlight', label: 'Spotlight' },
];
const BACKGROUND_OPTIONS = [
  { value: 'blank', label: 'White' },
  { value: 'dim', label: 'Dimmed image' },
  { value: 'blur', label: 'Blurred image' },
];
const SPEED_OPTIONS = [0.5, 1, 1.5, 2];
const ZOOMFROM_OPTIONS = [
  { value: 'smart', label: 'Smart (from previous)' },
  { value: 'center', label: 'From center' },
];

/** A single icon button for the floating Photoshop-style tool bar, with a
 * hover tooltip below (the bar itself docks to the top of the canvas). */
const ToolBarButton: React.FC<{
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
  label: string;
  activeClassName?: string;
}> = ({ icon: Icon, active, onClick, label, activeClassName }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-pressed={active}
    className={`group/tb relative w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-colors ${
      active ? activeClassName || 'bg-brand-teal text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
    }`}
  >
    <Icon size={16} />
    <span className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tb:opacity-100 transition-opacity z-30">
      {label}
    </span>
  </button>
);

export const BuildStudio: React.FC<BuildStudioProps> = ({ generation, version, onClose, userId }) => {
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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<BuildPoint[] | null>(null); // freeform/brush/straight-line points
  const [hoverPt, setHoverPt] = useState<BuildPoint | null>(null); // straight-line rubber band
  const [rectDrag, setRectDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [tool, setTool] = useState<BuildTool>('freeform');
  const [op, setOp] = useState<'add' | 'sub'>('add');
  const [brushRadius, setBrushRadius] = useState(0.03); // fraction of min image side
  const [straightLine, setStraightLine] = useState(true);
  const [altHeld, setAltHeld] = useState(false); // for render-time hints only; gestures read e.altKey directly
  const isCurveGestureRef = useRef(false); // true while the current freeform drag is a curvy (non-vertex-click) trace
  const freshShapeRef = useRef(false); // true if that curvy drag started a brand-new shape (vs. continuing one)
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stopIndex, setStopIndex] = useState(0);
  const timeMsRef = useRef(0);

  const total = useMemo(() => totalDurationMs(build), [build]);
  const starts = useMemo(() => stepStartTimes(build), [build]);
  const stops = useMemo(() => stepStopTimes(build), [build]);

  // Masked-image layer per step, recomputed only when the shapes (or image)
  // change — keyed on a shapes signature so unrelated build edits don't rebuild.
  const shapesKey = useMemo(() => JSON.stringify(build.steps.map((s) => s.shapes)), [build.steps]);
  const layers = useMemo(
    () => (image && imgDims.w ? prepareStepLayers(build, image, imgDims.w, imgDims.h) : []),
    // build is read but intentionally keyed via shapesKey to avoid rebuilds on timing tweaks.
    [shapesKey, image, imgDims.w, imgDims.h] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => { timeMsRef.current = timeMs; }, [timeMs]);

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
  useEffect(() => {
    if (!hasHydrated) return;
    saveBuild(userId, generation.id, version.id, build);
  }, [build, generation.id, version.id, userId, hasHydrated]);

  // --- Fit the stage to the available area --------------------------------
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || !imgDims.w) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBox(fitBox(rect.width, rect.height, imgDims.w, imgDims.h));
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
    } else {
      renderFrame(ctx, build, image, layers, imgDims.w, imgDims.h, timeMs);
    }
  }, [image, mode, build, layers, timeMs, imgDims.w, imgDims.h]);

  useEffect(() => {
    draw();
  }, [draw, renderDims.w, renderDims.h]);

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
  useEffect(() => {
    if (mode !== 'play' || build.autoPlay || !image) return;
    const target = stops[Math.min(stopIndex, stops.length - 1)] ?? 0;
    const from = timeMsRef.current;
    const dist = target - from;
    if (Math.abs(dist) < 1) {
      setTimeMs(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = Math.max(1, Math.abs(dist) / Math.max(0.25, speed));
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      setTimeMs(from + dist * k);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally excludes timeMs (read via ref) so it animates once per step.
  }, [stopIndex, mode, build.autoPlay, image, speed, stops]);

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

  // --- Box drawing (edit mode) --------------------------------------------
  const normFromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const el = stageRef.current?.querySelector('[data-stage-inner]') as HTMLElement | null;
    const rect = (el || stageRef.current)!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  // Add a shape to the selected step, or start a new step when none is
  // selected. New steps always begin additive (you can't erase from nothing).
  const addShape = (shape: BuildShape) => {
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
      const step: BuildStep = { id: newId(build.steps.length), shapes: [{ ...shape, op: 'add' }] };
      setBuild((b) => ({ ...b, steps: [...b.steps, step] }));
    }
  };
  const finishPoly = (pts: BuildPoint[]) => {
    if (pts.length < 3 || polygonArea(pts) < 0.003) return; // ignore tiny/accidental shapes
    addShape({ kind: 'poly', op, points: pts });
  };
  const finishBrush = (pts: BuildPoint[]) => {
    if (pts.length < 1) return;
    addShape({ kind: 'brush', op, points: pts, radius: brushRadius });
  };
  const cancelDraft = () => {
    setDraft(null);
    setRectDrag(null);
    setHoverPt(null);
    isCurveGestureRef.current = false;
  };

  // Render-time hint of what a click would do right now (straight vertex vs.
  // curvy trace) — actual gesture decisions always read the live e.altKey
  // instead of this, since that can't go stale mid-drag.
  const usesStraightLine = tool === 'freeform' && straightLine !== altHeld;

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (mode !== 'edit') return;
    const p = normFromEvent(e);
    if (tool === 'rectangle') {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      setRectDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    if (tool === 'brush') {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      setDraft([p]);
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
      setDraft((pts) => (pts ? [...pts, p] : [p]));
      return;
    }
    isCurveGestureRef.current = true;
    freshShapeRef.current = !draft || draft.length === 0;
    setHoverPt(null);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraft((pts) => (pts ? [...pts, p] : [p]));
  };
  const onStagePointerMove = (e: React.PointerEvent) => {
    const p = normFromEvent(e);
    if (tool === 'rectangle') {
      if (!rectDrag) return;
      setRectDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
      return;
    }
    if (tool === 'brush') {
      if (!draft) return;
      setDraft((pts) => {
        if (!pts) return pts;
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return pts;
        return [...pts, p];
      });
      return;
    }
    // Freeform.
    if (isCurveGestureRef.current) {
      setDraft((pts) => {
        if (!pts) return pts;
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 0.008) return pts;
        return [...pts, p];
      });
      return;
    }
    if (draft) setHoverPt(p); // rubber-band preview to the cursor while placing vertices
  };
  const onStagePointerUp = () => {
    if (tool === 'rectangle') {
      if (!rectDrag) return;
      const { x0, y0, x1, y1 } = rectDrag;
      setRectDrag(null);
      const x = Math.min(x0, x1), y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      finishPoly([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
      return;
    }
    if (tool === 'brush') {
      if (!draft) return;
      const pts = draft;
      setDraft(null);
      finishBrush(pts);
      return;
    }
    // Freeform.
    if (isCurveGestureRef.current) {
      isCurveGestureRef.current = false;
      if (freshShapeRef.current) {
        // Started fresh as a curvy drag (classic single-shot lasso) — finish now.
        if (!draft) return;
        const pts = draft;
        setDraft(null);
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
    if (tool === 'freeform' && draft) {
      const pts = draft;
      setDraft(null);
      setHoverPt(null);
      finishPoly(pts);
    }
  };

  // --- Keyboard --------------------------------------------------------------
  // Capture phase + stopImmediatePropagation so arrow keys don't also drive the
  // gallery/carousel mounted underneath this overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (draft || rectDrag) { cancelDraft(); return; }
        if (cleanMode) setCleanMode(false);
        else if (!document.fullscreenElement) onClose();
        return;
      }
      if (mode === 'edit') {
        if (e.key === '[') { e.preventDefault(); setBrushRadius((r) => Math.max(0.005, r - 0.006)); }
        else if (e.key === ']') { e.preventDefault(); setBrushRadius((r) => Math.min(0.25, r + 0.006)); }
        else if ((e.key === 'l' || e.key === 'L') && tool === 'freeform') { e.preventDefault(); setStraightLine((s) => !s); }
        else if (e.key === 'Enter' && tool === 'freeform' && draft) { e.preventDefault(); onStageDoubleClick(); }
        return;
      }
      // Play mode.
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
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose, cleanMode, mode, build.autoPlay, stops.length, tool, straightLine, draft, rectDrag]);

  // Track Option/Alt purely for render-time hints (cursor/hint text) — the
  // actual gesture logic above reads the live PointerEvent.altKey instead,
  // since that can't desync from focus loss the way a keydown/keyup pair can.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true); };
    const onUp = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false); };
    const onBlur = () => setAltHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // --- Step list mutations ------------------------------------------------
  const updateStep = (id: string, patch: Partial<BuildStep>) =>
    setBuild((b) => ({ ...b, steps: b.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const deleteStep = (id: string) =>
    setBuild((b) => ({ ...b, steps: b.steps.filter((s) => s.id !== id) }));
  const moveStep = (id: string, dir: -1 | 1) =>
    setBuild((b) => {
      const i = b.steps.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= b.steps.length) return b;
      const steps = [...b.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...b, steps };
    });

  const enterPlay = () => {
    setMode('play');
    timeMsRef.current = 0;
    setTimeMs(0);
    setStopIndex(0);
    setPlaying(build.autoPlay); // manual opens paused; auto starts playing
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

  const selectedStep = build.steps.find((s) => s.id === selectedStepId) || null;
  const stageInner = box.w > 0 ? { width: box.w, height: box.h } : { width: '100%', height: '100%' };
  const exportSupported = build.steps.length > 0;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-[#0d1117]/95 backdrop-blur-sm">
      {/* Header */}
      {!cleanMode && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#30363d] shrink-0">
          <Film size={18} className="text-brand-teal" />
          <h2 className="text-sm font-bold text-white">Build Studio</h2>
          <span className="text-xs text-slate-400 hidden sm:inline truncate max-w-[30vw]">
            {generation.config.prompt}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-[#30363d] overflow-hidden">
              <button
                onClick={() => { setMode('edit'); setPlaying(false); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${mode === 'edit' ? 'bg-brand-teal text-white' : 'text-slate-300 hover:bg-[#21262d]'}`}
              >
                <Pencil size={13} /> Edit
              </button>
              <button
                onClick={enterPlay}
                disabled={build.steps.length === 0}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${mode === 'play' ? 'bg-brand-teal text-white' : 'text-slate-300 hover:bg-[#21262d]'}`}
              >
                <Eye size={13} /> Preview
              </button>
            </div>
            <button
              onClick={handleExport}
              disabled={!exportSupported || exporting}
              title={exportSupported ? 'Export to MP4' : 'Add at least one selection first'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-red text-white text-xs font-semibold disabled:opacity-40 hover:bg-red-700"
            >
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Film size={13} />}
              {exporting ? `${Math.round(exportProgress * 100)}%` : 'Export MP4'}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#21262d]"
              aria-label="Close Build Studio"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Stage */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div ref={stageRef} className={`flex-1 min-h-0 flex items-center justify-center p-4 relative ${isFullscreen ? 'bg-black' : ''}`}>
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
              <div data-stage-inner className="relative shadow-2xl shadow-black rounded-md overflow-hidden" style={stageInner}>
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
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                      onPointerDown={onStagePointerDown}
                      onPointerMove={onStagePointerMove}
                      onPointerUp={onStagePointerUp}
                      onDoubleClick={onStageDoubleClick}
                    >
                      {/* Existing shapes are display-only here — never intercept
                          pointer events. Otherwise starting a new draw on top
                          of (or even just near, once filled) an existing shape
                          would select that old step instead of drawing a new
                          one. Selecting an item happens via its numbered badge
                          (below) or the sidebar list instead. */}
                      {build.steps.map((s) => {
                        const sel = s.id === selectedStepId;
                        const strokeCls = sel ? 'stroke-brand-teal' : 'stroke-brand-red';
                        return (
                          <g key={s.id} className="pointer-events-none">
                            {s.shapes.map((sh, si) => {
                              const sub = sh.op === 'sub';
                              const common = {
                                className: strokeCls,
                                vectorEffect: 'non-scaling-stroke' as const,
                                style: { strokeWidth: 2, strokeDasharray: sub ? '2 2' : undefined },
                              };
                              if (sh.kind === 'brush') {
                                return (
                                  <polyline
                                    key={si}
                                    points={svgPoints(sh.points.length > 1 ? sh.points : [sh.points[0], sh.points[0]])}
                                    fill="none"
                                    className={strokeCls}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ strokeWidth: sh.radius * 200, opacity: sub ? 0.25 : 0.4 }}
                                  />
                                );
                              }
                              return (
                                <polygon
                                  key={si}
                                  points={svgPoints(sh.points)}
                                  {...common}
                                  fill={sub ? 'rgba(220,60,40,0.10)' : sel ? 'rgba(20,184,166,0.15)' : 'rgba(220,60,40,0.10)'}
                                />
                              );
                            })}
                          </g>
                        );
                      })}
                      {/* Live draft */}
                      {draft && draft.length > 0 && tool === 'brush' && (
                        <polyline
                          points={svgPoints(draft.length > 1 ? draft : [draft[0], draft[0]])}
                          fill="none" strokeLinecap="round" strokeLinejoin="round"
                          className={op === 'sub' ? 'stroke-brand-red' : 'stroke-brand-teal'}
                          style={{ strokeWidth: brushRadius * 200, opacity: 0.5 }}
                        />
                      )}
                      {draft && draft.length > 0 && tool !== 'brush' && (
                        <polyline
                          points={svgPoints(usesStraightLine && hoverPt ? [...draft, hoverPt] : draft)}
                          fill="rgba(20,184,166,0.12)"
                          className={op === 'sub' ? 'stroke-brand-red' : 'stroke-brand-teal'}
                          vectorEffect="non-scaling-stroke"
                          style={{ strokeWidth: 2, strokeDasharray: '3 2' }}
                        />
                      )}
                      {rectDrag && (
                        <rect
                          x={Math.min(rectDrag.x0, rectDrag.x1) * 100}
                          y={Math.min(rectDrag.y0, rectDrag.y1) * 100}
                          width={Math.abs(rectDrag.x1 - rectDrag.x0) * 100}
                          height={Math.abs(rectDrag.y1 - rectDrag.y0) * 100}
                          fill="rgba(20,184,166,0.12)"
                          className="stroke-brand-teal"
                          vectorEffect="non-scaling-stroke"
                          style={{ strokeWidth: 2, strokeDasharray: '3 2' }}
                        />
                      )}
                    </svg>
                    {/* Floating Photoshop-style tool + options bar, docked to
                        the top of the canvas. Renders after the svg so it
                        paints on top and its own clicks never fall through to
                        the drawing layer underneath. */}
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 px-1.5 py-1.5 rounded-xl bg-[#161b22]/95 border border-white/10 shadow-xl backdrop-blur-sm">
                      <ToolBarButton icon={PenTool} active={tool === 'freeform'} onClick={() => setTool('freeform')} label="Freeform selection" />
                      <ToolBarButton icon={Square} active={tool === 'rectangle'} onClick={() => setTool('rectangle')} label="Rectangle selection" />
                      <ToolBarButton icon={Brush} active={tool === 'brush'} onClick={() => setTool('brush')} label="Brush selection" />

                      <div className="w-px h-6 bg-white/10 mx-1" />

                      <ToolBarButton icon={Plus} active={op === 'add'} onClick={() => setOp('add')} label={selectedStepId ? 'Add to selected item' : 'Add — starts a new item'} activeClassName="bg-brand-teal text-white" />
                      <ToolBarButton icon={Eraser} active={op === 'sub'} onClick={() => setOp('sub')} label="Erase from selected item" activeClassName="bg-brand-red text-white" />

                      {tool === 'freeform' && (
                        <>
                          <div className="w-px h-6 bg-white/10 mx-1" />
                          <ToolBarButton icon={Ruler} active={straightLine} onClick={() => setStraightLine((s) => !s)} label="Straight lines (L) · hold Alt/Option to draw freehand" />
                        </>
                      )}

                      {tool === 'brush' && (
                        <>
                          <div className="w-px h-6 bg-white/10 mx-1" />
                          <div className="flex items-center gap-1.5 pl-1 pr-2">
                            <Brush size={13} className="text-slate-400 shrink-0" />
                            <input
                              type="range" min={0.005} max={0.25} step={0.005}
                              value={brushRadius}
                              onChange={(e) => setBrushRadius(Number(e.target.value))}
                              title={`Brush size: ${Math.round(brushRadius * 100)}% ( [ / ] )`}
                              className="w-16 accent-brand-teal"
                            />
                          </div>
                        </>
                      )}
                    </div>
                    {/* Step number badges at each region's centroid. */}
                    {build.steps.map((s, i) => {
                      const addPts = s.shapes.filter((sh) => sh.op === 'add').flatMap((sh) => sh.points);
                      const c = addPts.length ? centroidOf(addPts) : { x: 0.5, y: 0.5 };
                      const sel = s.id === selectedStepId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedStepId((cur) => (cur === s.id ? null : s.id))}
                          title={sel ? 'Selected — click to deselect' : 'Select this item to add/erase shapes'}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-transparent hover:ring-white/60 ${sel ? 'bg-brand-teal' : 'bg-brand-red'}`}
                          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                    {build.steps.length === 0 && !draft && !rectDrag && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="px-3 py-1.5 rounded-full bg-black/70 text-white text-xs font-medium flex items-center gap-1.5">
                          <Plus size={13} />
                          {tool === 'rectangle'
                            ? 'Drag a box around your first item'
                            : tool === 'brush'
                              ? 'Paint over your first item'
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
                    onClick={() => setCleanMode(false)}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-black/50 text-white/80 hover:text-white opacity-0 hover:opacity-100 transition-opacity"
                    aria-label="Exit clean mode"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Transport (play mode) */}
          {mode === 'play' && !cleanMode && (
            <div className="shrink-0 px-4 py-3 border-t border-[#30363d] flex items-center gap-3 flex-wrap">
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
                  <span className="text-xs text-slate-400 tabular-nums w-16 text-right">
                    {(Math.min(timeMs, total) / 1000).toFixed(1)}s / {(total / 1000).toFixed(1)}s
                  </span>
                  <button onClick={() => setLoop((l) => !l)} className={`p-2 rounded-lg ${loop ? 'text-brand-teal bg-brand-teal/10' : 'text-slate-400 hover:bg-[#21262d]'}`} aria-label="Loop" title="Loop">
                    <Repeat size={15} />
                  </button>
                  <div className="inline-flex rounded-lg border border-[#30363d] overflow-hidden">
                    {SPEED_OPTIONS.map((sp) => (
                      <button key={sp} onClick={() => setSpeed(sp)} className={`px-2 py-1 text-xs font-semibold ${speed === sp ? 'bg-brand-teal text-white' : 'text-slate-300 hover:bg-[#21262d]'}`}>
                        {sp}×
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <button onClick={() => setStopIndex((i) => Math.max(0, i - 1))} disabled={stopIndex <= 0} className="p-2 rounded-lg bg-[#21262d] text-white hover:bg-[#2d333b] disabled:opacity-30" aria-label="Previous item" title="Previous (←)">
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs text-slate-300 font-medium tabular-nums min-w-[7rem] text-center">
                    {stopIndex === 0
                      ? 'Start'
                      : build.endShowFull && stopIndex === stops.length - 1
                        ? 'All items'
                        : `Item ${stopIndex}`}
                    <span className="text-slate-500"> · {stopIndex}/{stops.length - 1}</span>
                  </span>
                  <button onClick={() => setStopIndex((i) => Math.min(stops.length - 1, i + 1))} disabled={stopIndex >= stops.length - 1} className="p-2 rounded-lg bg-brand-teal text-white hover:bg-teal-600 disabled:opacity-30" aria-label="Next item" title="Next (→)">
                    <ChevronRight size={16} />
                  </button>
                  <span className="text-xs text-slate-500 hidden sm:inline">Use ← → to step through</span>
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
                <button onClick={toggleFullscreen} className={`p-2 rounded-lg ${isFullscreen ? 'text-brand-teal bg-brand-teal/10' : 'text-slate-400 hover:bg-[#21262d]'}`} title="Fullscreen for recording" aria-label="Fullscreen">
                  {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
                </button>
                <button onClick={() => { setCleanMode(true); if (build.autoPlay) { timeMsRef.current = 0; setTimeMs(0); setPlaying(true); } }} className="p-2 rounded-lg text-slate-400 hover:bg-[#21262d]" title="Clean mode (hide chrome for screen recording)" aria-label="Clean mode">
                  <Sparkles size={15} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar (edit mode) */}
        {mode === 'edit' && !cleanMode && (
          <div className="w-72 shrink-0 border-l border-[#30363d] flex flex-col">
            <div className="p-3 border-b border-[#30363d]">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Reveal settings</h3>
              <div className="space-y-2">
                <RichSelect value={build.revealStyle} onChange={(v) => setBuild((b) => ({ ...b, revealStyle: v as ImageBuild['revealStyle'] }))} options={REVEAL_OPTIONS} compact />
                <RichSelect value={build.background} onChange={(v) => setBuild((b) => ({ ...b, background: v as ImageBuild['background'] }))} options={BACKGROUND_OPTIONS} compact />
                <label className="block text-xs text-slate-400">
                  Seconds each item shows: {(build.defaultDurationMs / 1000).toFixed(1)}s
                  <input type="range" min={500} max={6000} step={100} value={build.defaultDurationMs} onChange={(e) => setBuild((b) => ({ ...b, defaultDurationMs: Number(e.target.value) }))} className="w-full accent-brand-teal" />
                </label>
                <div className="text-xs text-slate-400">
                  <span className="block mb-1">Zoom from (default)</span>
                  <RichSelect value={build.defaultZoomFrom} onChange={(v) => setBuild((b) => ({ ...b, defaultZoomFrom: v as BuildZoomFrom }))} options={ZOOMFROM_OPTIONS} compact />
                </div>
                <label className="block text-xs text-slate-400">
                  Zoom: {Math.round(build.zoom * 100)}%
                  <input type="range" min={0} max={1} step={0.05} value={build.zoom} onChange={(e) => setBuild((b) => ({ ...b, zoom: Number(e.target.value) }))} className="w-full accent-brand-teal" />
                </label>
                <label className="block text-xs text-slate-400">
                  Transition: {(build.transitionMs / 1000).toFixed(1)}s
                  <input type="range" min={200} max={2500} step={100} value={build.transitionMs} onChange={(e) => setBuild((b) => ({ ...b, transitionMs: Number(e.target.value) }))} className="w-full accent-brand-teal" />
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={build.cumulative} onChange={(e) => setBuild((b) => ({ ...b, cumulative: e.target.checked }))} className="accent-brand-teal" />
                  Build up (keep previous items visible)
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={build.endShowFull} onChange={(e) => setBuild((b) => ({ ...b, endShowFull: e.target.checked }))} className="accent-brand-teal" />
                  Reveal all selections at the end
                </label>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Steps ({build.steps.length})</h3>
                {selectedStepId && (
                  <button onClick={() => setSelectedStepId(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#21262d] text-slate-200 text-[11px] font-semibold hover:bg-[#2d333b]">
                    <Plus size={11} /> New item
                  </button>
                )}
              </div>
              {build.steps.length === 0 ? (
                <p className="text-xs text-slate-500">Pick a tool above, then draw around each item on the image. Each shape becomes a step.</p>
              ) : (
                <ul className="space-y-1.5">
                  {build.steps.map((s, i) => {
                    const sel = s.id === selectedStepId;
                    return (
                      <li key={s.id} className={`rounded-lg border p-2 ${sel ? 'border-brand-teal bg-brand-teal/10' : 'border-[#30363d]'}`}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setSelectedStepId(s.id)} className="w-5 h-5 rounded-full bg-brand-red text-white text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</button>
                          <input
                            type="number" min={0.3} max={20} step={0.1}
                            value={(effectiveDurationMs(s, build) / 1000).toFixed(1)}
                            onChange={(e) => updateStep(s.id, { durationMs: Math.max(300, Number(e.target.value) * 1000) })}
                            className="w-14 bg-[#0d1117] border border-[#30363d] rounded px-1.5 py-1 text-xs text-white"
                            title="Seconds this item shows (overrides the global default)"
                          />
                          <span className="text-[11px] text-slate-500">sec</span>
                          <div className="ml-auto flex items-center gap-0.5">
                            <button onClick={() => moveStep(s.id, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-white disabled:opacity-30" aria-label="Move up"><ArrowUp size={13} /></button>
                            <button onClick={() => moveStep(s.id, 1)} disabled={i === build.steps.length - 1} className="p-1 text-slate-400 hover:text-white disabled:opacity-30" aria-label="Move down"><ArrowDown size={13} /></button>
                            <button onClick={() => deleteStep(s.id)} className="p-1 text-red-400 hover:text-red-300" aria-label="Delete step"><Trash2 size={13} /></button>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                          <span>Zoom from</span>
                          <div className="inline-flex rounded-md border border-[#30363d] overflow-hidden">
                            {(['smart', 'center'] as BuildZoomFrom[]).map((zf) => {
                              const active = (s.zoomFrom ?? build.defaultZoomFrom) === zf;
                              return (
                                <button
                                  key={zf}
                                  onClick={() => updateStep(s.id, { zoomFrom: zf })}
                                  className={`px-1.5 py-0.5 ${active ? 'bg-brand-teal text-white' : 'text-slate-300 hover:bg-[#21262d]'}`}
                                >
                                  {zf === 'smart' ? 'Smart' : 'Center'}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedStep && (
                <p className="mt-3 text-[11px] text-slate-500">Tip: delete a shape and redraw to reposition it.</p>
              )}
            </div>
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
