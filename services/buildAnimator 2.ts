// Deterministic renderer for a "build" (sequential reveal animation) of a
// generated infographic. The same `renderFrame` drives both the live player
// and the offscreen MP4 exporter, so what you record is exactly what you see.
//
// Coordinate spaces:
//   - Steps store freeform polygons normalized 0..1 relative to the image
//     (resolution-free).
//   - The "camera" is a square in NORMALIZED space {cx, cy, s}. Because the
//     output canvas always matches the image's aspect ratio, an aspect-
//     preserving view is exactly a square in normalized coords (s = width =
//     height), which maps without distortion to the full canvas. Each step's
//     item is CENTERED on screen (no edge pan-clamp — areas past the image
//     edge fill with the build background), so the reveal reads like a camera
//     moving to each item.

import type { ImageBuild, BuildStep, BuildPoint, BuildShape } from '../types';

/** A camera framing: center (cx,cy) and size s, all normalized 0..1. */
export interface Camera {
  cx: number;
  cy: number;
  s: number;
}

const FULL_CAMERA: Camera = { cx: 0.5, cy: 0.5, s: 1 };

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Ease-in-out with a punchy acceleration curve (quartic). Higher power than a
 * standard cubic ease → slower starts, faster middles, softer lands. Used for
 * the ORIGINAL, timeline-driven reveal (auto-play, or holding on a stop).
 */
const easeInOut = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
};

/**
 * Cubic ease-OUT — starts fast, decelerates into the landing. Used for manual
 * seeks (arrow-key stepping): the goal there is to feel instantaneous the
 * moment the key is pressed, not to slowly wind up like the original reveal.
 */
export const easeOut = (t: number): number => {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpCamera = (a: Camera, b: Camera, t: number): Camera => ({
  cx: lerp(a.cx, b.cx, t),
  cy: lerp(a.cy, b.cy, t),
  s: lerp(a.s, b.s, t),
});

/** Axis-aligned bounds of a polygon (normalized). */
const boundsOf = (points: BuildPoint[]): { x: number; y: number; w: number; h: number } => {
  if (points.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
};

/**
 * The camera framing for a step: centered on the region's bounds and zoomed.
 * `zoom` (0..1) blends between the whole image (0) and a snug frame around the
 * region (1). No pan-clamp — the item sits dead-center on screen.
 */
const cameraForBounds = (b: { x: number; y: number; w: number; h: number }, zoom: number): Camera => {
  const margin = 0.12; // breathing room around the region when fully zoomed
  const fit = Math.max(b.w, b.h);
  // Floor so a tiny lasso doesn't zoom to an extreme close-up.
  const sRegion = clamp(fit * (1 + 2 * margin), 0.25, 1);
  const s = clamp(lerp(1, sRegion, clamp(zoom, 0, 1)), 0.2, 1.2);
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, s };
};

/** All points from a step's additive shapes — the geometric fallback. */
const stepAddPoints = (step: BuildStep): BuildPoint[] =>
  step.shapes.filter((s) => s.op === 'add').flatMap((s) => s.points);

/**
 * Bounding box of a step's NET region — adds minus erase cutouts, measured by
 * rasterizing the mask at low resolution. Erasing away part of a region must
 * shrink its camera framing too; the raw add-points would keep framing the
 * old, pre-trim box. Cached per step OBJECT (steps are immutable — every edit
 * makes a new one, and undo restores old ones, so the cache is always right).
 */
const netBoundsCache = new WeakMap<BuildStep, { x: number; y: number; w: number; h: number } | null>();
export const netRegionBounds = (step: BuildStep): { x: number; y: number; w: number; h: number } | null => {
  const hit = netBoundsCache.get(step);
  if (hit !== undefined) return hit;
  let out: { x: number; y: number; w: number; h: number } | null = null;
  try {
    const S = 256; // plenty for framing accuracy (~0.4% of the image)
    const mask = document.createElement('canvas');
    mask.width = S;
    mask.height = S;
    const mc = mask.getContext('2d');
    if (mc) {
      mc.fillStyle = '#fff';
      mc.strokeStyle = '#fff';
      for (const sh of step.shapes) {
        mc.globalCompositeOperation = sh.op === 'sub' ? 'destination-out' : 'source-over';
        if (sh.kind === 'poly') {
          if (sh.points.length < 3) continue;
          mc.beginPath();
          sh.points.forEach((p, i) => (i === 0 ? mc.moveTo(p.x * S, p.y * S) : mc.lineTo(p.x * S, p.y * S)));
          mc.closePath();
          mc.fill();
        } else {
          if (sh.points.length === 0) continue;
          const w = Math.max(1, sh.radius * S * 2);
          mc.lineWidth = w;
          mc.lineCap = 'round';
          mc.lineJoin = 'round';
          if (sh.points.length === 1) {
            mc.beginPath();
            mc.arc(sh.points[0].x * S, sh.points[0].y * S, w / 2, 0, Math.PI * 2);
            mc.fill();
          } else {
            mc.beginPath();
            sh.points.forEach((p, i) => (i === 0 ? mc.moveTo(p.x * S, p.y * S) : mc.lineTo(p.x * S, p.y * S)));
            mc.stroke();
          }
        }
      }
      const data = mc.getImageData(0, 0, S, S).data;
      let minX = S, minY = S, maxX = -1, maxY = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (data[(y * S + x) * 4 + 3] > 16) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= minX && maxY >= minY) {
        out = { x: minX / S, y: minY / S, w: (maxX - minX + 1) / S, h: (maxY - minY + 1) / S };
      }
    }
  } catch {
    out = null; // no DOM (tests) or canvas failure — fall back to geometry
  }
  netBoundsCache.set(step, out);
  return out;
};

/** A step's framing bounds: net region when available, add-points otherwise. */
const stepFrameBounds = (step: BuildStep): { x: number; y: number; w: number; h: number } =>
  netRegionBounds(step) ?? boundsOf(stepAddPoints(step));

/** Camera framing for a step (from its NET region's bounds). */
const cameraForStep = (step: BuildStep, zoom: number): Camera =>
  cameraForBounds(stepFrameBounds(step), zoom);

/** A step's hold length, using the build's global default when unset. */
export const effectiveDurationMs = (step: BuildStep, build: ImageBuild): number =>
  Math.max(0, step.durationMs ?? build.defaultDurationMs);

/** Per-step timing: each step gets a reveal window then a hold. */
const revealMsFor = (step: BuildStep, build: ImageBuild): number =>
  Math.min(build.transitionMs, effectiveDurationMs(step, build));

/** Total animation length including the optional "zoom back out to full" tail. */
export const totalDurationMs = (build: ImageBuild): number => {
  const steps = build.steps.reduce((sum, s) => sum + effectiveDurationMs(s, build), 0);
  const tail = build.endShowFull && build.steps.length > 0 ? build.transitionMs : 0;
  return steps + tail;
};

/** Cumulative start time of each step (for scrubber ticks). */
export const stepStartTimes = (build: ImageBuild): number[] => {
  const out: number[] = [];
  let acc = 0;
  for (const s of build.steps) {
    out.push(acc);
    acc += effectiveDurationMs(s, build);
  }
  return out;
};

/**
 * The times a manual (arrow-key) walkthrough pauses on: the start (nothing
 * shown), each item fully revealed, then the final all-revealed end. `→`/`←`
 * step forward/back through these.
 */
export const stepStopTimes = (build: ImageBuild): number[] => {
  if (build.steps.length === 0) return [0];
  const starts = stepStartTimes(build);
  const stops = [0];
  build.steps.forEach((s, i) => stops.push(starts[i] + revealMsFor(s, build)));
  if (build.endShowFull) stops.push(totalDurationMs(build));
  return stops;
};

export interface FrameState {
  camera: Camera;
  /** revealAlpha[i] = 0..1 how revealed step i is right now. */
  revealAlpha: number[];
  /** Index of the step currently animating in (or -1 in the tail). */
  activeStep: number;
  /** 0..1 fade-in of the ENTIRE unmasked image — used by the
   * `endStyle: 'image'` tail, 0 everywhere else. */
  fullImageAlpha: number;
}

/**
 * Interpolate directly between two already-resolved visual states. Used for
 * manual seeks (arrow-key stepping) — interpolating the STATE, rather than
 * the raw `timeMs` value, skips over any "hold" gap between a step's reveal
 * completing and the next step's reveal starting. Without this, a seek that
 * lands mid-hold would spend most of its (short, fixed) duration on a static
 * frame before any visible motion began — the actual difficulty reported.
 */
export const lerpFrameState = (a: FrameState, b: FrameState, t: number): FrameState => {
  const k = clamp(t, 0, 1);
  const n = Math.max(a.revealAlpha.length, b.revealAlpha.length);
  const revealAlpha: number[] = [];
  for (let i = 0; i < n; i++) revealAlpha.push(lerp(a.revealAlpha[i] ?? 0, b.revealAlpha[i] ?? 0, k));
  return {
    camera: lerpCamera(a.camera, b.camera, k),
    revealAlpha,
    activeStep: k < 1 ? a.activeStep : b.activeStep,
    fullImageAlpha: lerp(a.fullImageAlpha ?? 0, b.fullImageAlpha ?? 0, k),
  };
};

/** Resolve the camera + per-step reveal at a given time. Pure. */
export const frameStateAt = (build: ImageBuild, timeMs: number): FrameState => {
  const n = build.steps.length;
  const revealAlpha = new Array(n).fill(0);
  if (n === 0) return { camera: FULL_CAMERA, revealAlpha, activeStep: -1, fullImageAlpha: 0 };

  const starts = stepStartTimes(build);
  const total = totalDurationMs(build);
  const t = clamp(timeMs, 0, total);

  // Find the active step (last step whose window has started).
  let i = 0;
  for (let k = 0; k < n; k++) {
    if (t >= starts[k]) i = k;
  }

  const lastHoldStart = starts[n - 1] + effectiveDurationMs(build.steps[n - 1], build);
  const inTail = build.endShowFull && t >= lastHoldStart;

  if (inTail) {
    // End: zoom back out to the whole image while either (a) revealing ALL
    // selected items together — non-selected areas stay background — or
    // (b) `endStyle: 'image'`: fading in the entire unmasked image.
    const p = easeInOut(build.transitionMs > 0 ? clamp((t - lastHoldStart) / build.transitionMs, 0, 1) : 1);
    const fullImage = (build.endStyle ?? 'items') === 'image';
    for (let k = 0; k < n; k++) revealAlpha[k] = 1;
    const lastCam = cameraForStep(build.steps[n - 1], build.zoom);
    return {
      camera: lerpCamera(lastCam, FULL_CAMERA, p),
      revealAlpha,
      activeStep: -1,
      fullImageAlpha: fullImage ? p : 0,
    };
  }

  const localT = t - starts[i];
  const reveal = revealMsFor(build.steps[i], build);
  const p = reveal > 0 ? clamp(localT / reveal, 0, 1) : 1;
  const eased = easeInOut(p);

  // Where the camera starts this step's move. 'center' pulls back to the whole
  // image first; 'smart' pans straight from the previous item. Step 0 always
  // starts from the full image (there is no previous item).
  const zoomFrom = build.steps[i].zoomFrom ?? build.defaultZoomFrom;
  const fromCam =
    i === 0 || zoomFrom === 'center'
      ? FULL_CAMERA
      : cameraForStep(build.steps[i - 1], build.zoom);
  const toCam = cameraForStep(build.steps[i], build.zoom);
  const camera = lerpCamera(fromCam, toCam, eased);

  if (build.cumulative) {
    // Build up: previously shown items stay visible.
    for (let k = 0; k < i; k++) revealAlpha[k] = 1;
    revealAlpha[i] = build.revealStyle === 'wipe' ? 1 : eased;
  } else {
    // One at a time: the current item fades/wipes in while the previous one
    // fades out during the transition, then only the current item is held.
    revealAlpha[i] = build.revealStyle === 'wipe' ? 1 : eased;
    if (i > 0) revealAlpha[i - 1] = 1 - eased;
  }
  return { camera, revealAlpha, activeStep: i, fullImageAlpha: 0 };
};

/**
 * Set the 2D transform so subsequent drawing in IMAGE-PIXEL space lands inside
 * the camera's view, filling the whole canvas.
 */
const applyCamera = (
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  imgW: number,
  imgH: number,
  cw: number,
  ch: number
): void => {
  const a = cw / (cam.s * imgW);
  const d = ch / (cam.s * imgH);
  const e = -((cam.cx - cam.s / 2) / cam.s) * cw;
  const f = -((cam.cy - cam.s / 2) / cam.s) * ch;
  ctx.setTransform(a, 0, 0, d, e, f);
};

/**
 * Rasterize a step's composited region (add/subtract of polygons + brush
 * strokes) into an image-resolution canvas that shows the image only inside
 * that region (transparent elsewhere). Precomputed once per shape-change, then
 * drawn each frame under the camera transform.
 */
export const renderStepLayer = (
  image: CanvasImageSource,
  imgW: number,
  imgH: number,
  shapes: BuildShape[]
): HTMLCanvasElement => {
  const layer = document.createElement('canvas');
  layer.width = imgW;
  layer.height = imgH;
  const lc = layer.getContext('2d');
  if (!lc || shapes.length === 0) return layer;

  const mask = document.createElement('canvas');
  mask.width = imgW;
  mask.height = imgH;
  const mc = mask.getContext('2d');
  if (!mc) return layer;

  const minDim = Math.min(imgW, imgH);
  mc.fillStyle = '#fff';
  mc.strokeStyle = '#fff';
  for (const sh of shapes) {
    mc.globalCompositeOperation = sh.op === 'sub' ? 'destination-out' : 'source-over';
    if (sh.kind === 'poly') {
      if (sh.points.length < 3) continue;
      mc.beginPath();
      sh.points.forEach((p, i) =>
        i === 0 ? mc.moveTo(p.x * imgW, p.y * imgH) : mc.lineTo(p.x * imgW, p.y * imgH)
      );
      mc.closePath();
      mc.fill();
    } else {
      if (sh.points.length === 0) continue;
      const w = Math.max(1, sh.radius * minDim * 2);
      mc.lineWidth = w;
      mc.lineCap = 'round';
      mc.lineJoin = 'round';
      if (sh.points.length === 1) {
        const p = sh.points[0];
        mc.beginPath();
        mc.arc(p.x * imgW, p.y * imgH, w / 2, 0, Math.PI * 2);
        mc.fill();
      } else {
        mc.beginPath();
        sh.points.forEach((p, i) =>
          i === 0 ? mc.moveTo(p.x * imgW, p.y * imgH) : mc.lineTo(p.x * imgW, p.y * imgH)
        );
        mc.stroke();
      }
    }
  }
  mc.globalCompositeOperation = 'source-over';

  lc.drawImage(image, 0, 0, imgW, imgH);
  lc.globalCompositeOperation = 'destination-in';
  lc.drawImage(mask, 0, 0);
  lc.globalCompositeOperation = 'source-over';
  return layer;
};

/** Precompute the masked-image layer for every step (null for empty steps). */
export const prepareStepLayers = (
  build: ImageBuild,
  image: CanvasImageSource,
  imgW: number,
  imgH: number
): (HTMLCanvasElement | null)[] =>
  build.steps.map((s) => (s.shapes.length ? renderStepLayer(image, imgW, imgH, s.shapes) : null));

/**
 * Sample the image's own background color (mode of its border pixels, on a
 * small downscale). Used as the 'blank' fill so isolated frames sit on the
 * SAME color they were drawn on — a white/dark stage makes every reveal look
 * like a pasted-on cutout.
 */
export const sampleImageBackground = (
  image: CanvasImageSource,
  imgW: number,
  imgH: number
): string => {
  try {
    const S = 64;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '#ffffff';
    ctx.fillStyle = '#ffffff'; // transparent PNG/SVG → white, matching the editor
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(image, 0, 0, imgW, imgH, 0, 0, S, S);
    const data = ctx.getImageData(0, 0, S, S).data;
    // Border ring, 2px thick — the most likely pure-background pixels.
    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (x >= 2 && x < S - 2 && y >= 2 && y < S - 2) continue;
        const i = (y * S + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = `${r >> 4},${g >> 4},${b >> 4}`; // quantize to 16 levels
        const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += r; e.g += g; e.b += b;
        buckets.set(key, e);
      }
    }
    let best: { n: number; r: number; g: number; b: number } | null = null;
    for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
    if (!best) return '#ffffff';
    return `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})`;
  } catch {
    return '#ffffff'; // tainted canvas or decode issue — keep the old look
  }
};

/** Screen-space background fill so centered/past-the-edge areas look intentional. */
const fillBackground = (ctx: CanvasRenderingContext2D, build: ImageBuild, bgColor?: string): void => {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (build.background === 'dim') ctx.fillStyle = '#0d1117';
  else if (build.background === 'blur') ctx.fillStyle = '#e5e7eb';
  else ctx.fillStyle = bgColor || '#ffffff';
  ctx.fillRect(0, 0, width, height);
};

/** Wipe progress (0..1) for the active step, left-to-right. */
const wipeProgressAt = (build: ImageBuild, timeMs: number, activeStep: number): number => {
  if (activeStep < 0) return 1;
  const starts = stepStartTimes(build);
  const localT = clamp(timeMs, 0, totalDurationMs(build)) - starts[activeStep];
  const reveal = revealMsFor(build.steps[activeStep], build);
  return reveal > 0 ? easeInOut(clamp(localT / reveal, 0, 1)) : 1;
};

/**
 * Draw one frame from an ALREADY-RESOLVED visual state (camera + per-step
 * reveal alpha). This is the shared drawing core: `renderFrame` below feeds it
 * a state computed from a timeline position; a manual seek (see
 * BuildStudio's arrow-key stepping) feeds it a state interpolated directly
 * between two stops via `lerpFrameState`, bypassing the timeline entirely so
 * a static "hold" gap between two stops never eats into the seek's duration.
 */
export const renderFrameFromState = (
  ctx: CanvasRenderingContext2D,
  build: ImageBuild,
  image: CanvasImageSource,
  layers: (HTMLCanvasElement | null)[],
  imgW: number,
  imgH: number,
  state: FrameState,
  wipeP: number,
  bgColor?: string
): void => {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  fillBackground(ctx, build, bgColor);

  // No steps yet → just show the whole image so the editor preview isn't blank.
  if (build.steps.length === 0) {
    applyCamera(ctx, FULL_CAMERA, imgW, imgH, cw, ch);
    ctx.drawImage(image, 0, 0, imgW, imgH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }

  applyCamera(ctx, state.camera, imgW, imgH, cw, ch);

  // Base layer inside the image bounds (the not-yet-revealed look). 'blank'
  // needs no base — the screen fill already shows white behind the reveals.
  if (build.background === 'blur') {
    ctx.save();
    ctx.filter = 'blur(14px) brightness(0.98)';
    ctx.drawImage(image, 0, 0, imgW, imgH);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 0, imgW, imgH);
  } else if (build.background === 'dim') {
    ctx.drawImage(image, 0, 0, imgW, imgH);
    ctx.fillStyle = 'rgba(15,17,23,0.6)';
    ctx.fillRect(0, 0, imgW, imgH);
  }

  // Revealed regions: draw each step's precomputed masked layer over the base.
  for (let k = 0; k < build.steps.length; k++) {
    const alpha = state.revealAlpha[k] ?? 0;
    if (alpha <= 0) continue;
    const layer = layers[k];
    if (!layer) continue;

    ctx.save();
    ctx.globalAlpha = build.revealStyle === 'wipe' ? 1 : clamp(alpha, 0, 1);
    // Active step wipes left-to-right by clipping a growing rect over its bounds.
    if (build.revealStyle === 'wipe' && k === state.activeStep) {
      const b = stepFrameBounds(build.steps[k]);
      ctx.beginPath();
      ctx.rect(b.x * imgW, b.y * imgH, b.w * imgW * wipeP, b.h * imgH);
      ctx.clip();
    }
    ctx.drawImage(layer, 0, 0, imgW, imgH);
    ctx.restore();
  }

  // `endStyle: 'image'` tail: the entire unmasked image fades in over the
  // revealed items as the camera pulls back to full.
  if (state.fullImageAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(state.fullImageAlpha, 0, 1);
    ctx.drawImage(image, 0, 0, imgW, imgH);
    ctx.restore();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
};

/**
 * Draw one frame of the build to `ctx` at a specific timeline position. The
 * canvas must already be sized to the output frame (its width/height are read
 * as the drawing surface). Caller is responsible for matching the canvas
 * aspect ratio to the image.
 */
export const renderFrame = (
  ctx: CanvasRenderingContext2D,
  build: ImageBuild,
  image: CanvasImageSource,
  layers: (HTMLCanvasElement | null)[],
  imgW: number,
  imgH: number,
  timeMs: number,
  bgColor?: string
): void => {
  const state = frameStateAt(build, timeMs);
  const wipeP = wipeProgressAt(build, timeMs, state.activeStep);
  renderFrameFromState(ctx, build, image, layers, imgW, imgH, state, wipeP, bgColor);
};

/** A sensible starting build for a freshly opened image. */
export const defaultBuild = (): ImageBuild => ({
  steps: [],
  revealStyle: 'fade',
  cumulative: false,
  zoom: 0.8,
  fps: 30,
  transitionMs: 900,
  endShowFull: true,
  endStyle: 'items',
  background: 'blank',
  defaultDurationMs: 1800,
  defaultZoomFrom: 'smart',
  autoPlay: false,
  startMode: 'first',
});
