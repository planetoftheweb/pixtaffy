// AI "auto-select pass" for Build Studio: sends the infographic to Gemini and
// gets back an ORDERED list of rectangular regions that tell its story —
// title/hook first, then the content blocks in reading order, conclusion last.
// The caller turns these into BuildSteps the user can fine-tune with the
// normal tools. BYOK: uses the user's own Gemini key, like every other
// auxiliary vision call in the app.

import { GoogleGenAI } from '@google/genai';
import { generateContentWithGeminiTextFallback } from './geminiTextModelService';

export interface AutoRegion {
  /** 2–4 word name for the block (shown in the Items list). */
  label: string;
  /** Normalized 0..1 bounding box — always present (the fallback shape). */
  rect: { x: number; y: number; w: number; h: number };
  /** Freeform outline traced from the model's segmentation mask (normalized
   * 0..1 image coords), when the mask came back usable. Preferred over rect. */
  poly?: { x: number; y: number }[];
}

const MAX_SEND_W = 1024; // plenty for layout detection, keeps the payload small
const MAX_REGIONS = 12;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Downscale the (CORS-clean) image to a JPEG base64 payload. */
const imageToJpegBase64 = (image: HTMLImageElement, imgW: number, imgH: number): string => {
  const scale = Math.min(1, MAX_SEND_W / imgW);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(imgW * scale));
  canvas.height = Math.max(1, Math.round(imgH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the image for analysis.');
  // JPEG has no alpha — fill white so transparent PNGs/SVGs stay readable.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
};

// Gemini's segmentation is a TRAINED output format — it only emits masks for
// prompts shaped like its canonical segmentation request (box_2d/mask/label
// keys, no responseSchema; a strict schema suppresses the mask pathway).
const PROMPT = `
Give the segmentation masks for the distinct content blocks of this
infographic (each numbered step, panel, callout, and the title block).
Output a JSON list of segmentation masks where each entry contains the 2D
bounding box in the key "box_2d", the segmentation mask in key "mask", and
the text label in the key "label".

This is for a step-by-step reveal animation — regions are shown one at a
time, in order, to walk a viewer through the infographic. So:
- Order the list in the most logical presentation sequence: the main title /
  hook first, then the reading flow (numbered items, arrows, visual
  hierarchy), and the conclusion / summary strip last.
- 3-10 entries. Each is ONE coherent block including its icon/illustration.
  Together they should cover every informative part; skip empty background.
- Labels are 2-4 words.
- Masks should follow each block's actual visual outline — panels here are
  often organic, hand-drawn shapes, not rectangles.
- A mask must FULLY CONTAIN every part of its block — all text, icons, and
  illustration, out to their outermost strokes. NEVER slice through a word,
  a line of text, a face, a mascot, or an illustration: if any part of one
  belongs to the block, include ALL of it. When unsure, err generous.
- "box_2d" must be at least as large as the mask — generous enough that the
  whole block fits inside with a little margin on every side.
- Masks must NOT overlap each other: a mask contains ONLY its own block,
  never any part of a neighboring block, and stays inside its own "box_2d".
- Outlines must be simple and tight: one smooth closed shape per block — no
  long spikes, thin tails, or detached islands.
- Before answering, double-check every entry: does the box really contain
  exactly one block, and does the mask cover that whole block and nothing
  else? Fix any entry that fails.
`.trim();

/** Push every vertex outward from the polygon's centroid by `pad` (normalized
 * units). Cheap offset that works well for the blobby regions infographic
 * panels are — margin hides small mask inaccuracies so an outline never
 * amputates artwork at the edge. */
const expandPolygon = (
  pts: { x: number; y: number }[],
  pad: number
): { x: number; y: number }[] => {
  const n = pts.length;
  const c = pts.reduce((acc, p) => ({ x: acc.x + p.x / n, y: acc.y + p.y / n }), { x: 0, y: 0 });
  // Radial expansion only behaves for star-shaped outlines. If the centroid
  // falls OUTSIDE the polygon (deeply concave / self-intersecting ring),
  // pushing vertices away from it warps the shape — leave those untouched.
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > c.y !== b.y > c.y && c.x < ((b.x - a.x) * (c.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  if (!inside) return pts;
  return pts.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy) || 1e-9;
    const k = (d + pad) / d;
    return { x: clamp01(c.x + dx * k), y: clamp01(c.y + dy * k) };
  });
};

/** Ramer–Douglas–Peucker simplification (normalized coords). */
const rdp = (pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] => {
  if (pts.length < 3) return pts;
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const abx = b.x - a.x, aby = b.y - a.y;
  const abLen = Math.hypot(abx, aby) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * aby - (pts[i].y - a.y) * abx) / abLen;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
};

/**
 * Some model versions answer the segmentation request with a polygon vertex
 * ring directly — [[y, x], ...] in 0-1000 image coords (Gemini's y-first
 * convention), usually closed. Even better than a PNG mask: use it as-is.
 */
const pairsToPolygon = (pairs: unknown[]): { x: number; y: number }[] | null => {
  const nums = pairs.filter(
    (p): p is number[] => Array.isArray(p) && p.length >= 2 && p.every((v) => typeof v === 'number')
  );
  if (nums.length < 3) return null;
  const maxV = Math.max(...nums.flat());
  const k = maxV <= 1.5 ? 1 : 1 / 1000; // tolerate 0-1 fraction answers
  let pts = nums.map((p) => ({ x: clamp01(p[1] * k), y: clamp01(p[0] * k) }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) pts.pop(); // drop closing vertex
  if (pts.length < 3 || pts.length > 400) return null;
  pts = rdp(pts, 0.0018); // thin dense rings while keeping curve fidelity
  if (pts.length < 3) return null;
  // Shoelace area sanity — reject degenerate slivers.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2 >= 0.0005 ? pts : null;
};

/**
 * Decode a region's segmentation mask (base64 PNG probability map, sized to
 * its bounding box) and trace it into a simplified freeform polygon in
 * normalized image coordinates. Returns null when the mask is unusable —
 * caller falls back to the rectangle.
 *
 * Tracing is a per-row scan (leftmost/rightmost filled cell per row, walked
 * down the right edge and back up the left): always yields a simple polygon,
 * follows the organic outlines infographic panels actually have, and any
 * horizontal notch it can't represent just over-fills — trimmable with the
 * eraser.
 */
const maskToPolygon = async (
  maskB64: string,
  rect: { x: number; y: number; w: number; h: number }
): Promise<{ x: number; y: number }[] | null> => {
  try {
    const src = maskB64.startsWith('data:') ? maskB64 : `data:image/png;base64,${maskB64}`;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('mask decode failed'));
      el.src = src;
    });
    const GRID = 96; // plenty of outline detail after RDP, cheap to scan
    const gw = Math.max(8, Math.min(GRID, img.naturalWidth));
    const gh = Math.max(8, Math.min(GRID, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = gw;
    canvas.height = gh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, gw, gh);
    const data = ctx.getImageData(0, 0, gw, gh).data;
    const filled = (x: number, y: number): boolean => {
      const i = (y * gw + x) * 4;
      return data[i + 3] > 16 && data[i] > 127; // opaque-ish AND bright
    };
    // Per-row extents.
    const rows: { y: number; l: number; r: number }[] = [];
    for (let y = 0; y < gh; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < gw; x++) if (filled(x, y)) { if (l < 0) l = x; r = x; }
      if (l >= 0) rows.push({ y, l, r });
    }
    if (rows.length < 3) return null;
    const coverage = rows.reduce((s, rw) => s + (rw.r - rw.l + 1), 0) / (gw * gh);
    if (coverage < 0.05) return null; // mask is mostly noise
    // Outlier guard: per-row min/max scanning amplifies a single stray mask
    // pixel into a huge horizontal spike on the outline. Median-smooth each
    // edge over a 5-row window so isolated noise rows can't drag it out.
    const median5 = (get: (rw: { l: number; r: number }) => number): number[] =>
      rows.map((_, i) => {
        const win = rows
          .slice(Math.max(0, i - 2), Math.min(rows.length, i + 3))
          .map(get)
          .sort((a, b) => a - b);
        return win[Math.floor(win.length / 2)];
      });
    const smoothL = median5((rw) => rw.l);
    const smoothR = median5((rw) => rw.r);
    rows.forEach((rw, i) => {
      rw.l = Math.min(smoothL[i], smoothR[i]);
      rw.r = Math.max(smoothL[i], smoothR[i]);
    });
    // Right edge down, then left edge back up (closed, clockwise-ish).
    const toNorm = (gx: number, gy: number) => ({
      x: rect.x + ((gx + 0.5) / gw) * rect.w,
      y: rect.y + ((gy + 0.5) / gh) * rect.h,
    });
    const right = rows.map((rw) => toNorm(rw.r, rw.y));
    const left = rows.slice().reverse().map((rw) => toNorm(rw.l, rw.y));
    const eps = 0.006 * Math.max(rect.w, rect.h); // simplify relative to region size
    const outline = [...rdp(right, eps), ...rdp(left, eps)];
    return outline.length >= 3 && outline.length <= 120 ? outline : null;
  } catch {
    return null;
  }
};

export async function autoDetectBuildRegions(
  image: HTMLImageElement,
  imgW: number,
  imgH: number,
  apiKey: string
): Promise<AutoRegion[]> {
  const key = apiKey.trim();
  if (!key) throw new Error('Add your Google Gemini API key in Settings to use AI auto-select.');
  const ai = new GoogleGenAI({ apiKey: key });

  const response = await generateContentWithGeminiTextFallback(
    ai,
    {
      contents: {
        parts: [
          { inlineData: { data: imageToJpegBase64(image, imgW, imgH), mimeType: 'image/jpeg' } },
          { text: PROMPT },
        ],
      },
      // No responseSchema on purpose — structured-output enforcement disables
      // the model's segmentation-mask emission (verified empirically). Plain
      // JSON mime + the canonical prompt shape is what makes masks appear.
      config: {
        responseMimeType: 'application/json',
      },
    },
    'autoDetectBuildRegions'
  );

  if (!response.text) throw new Error('The AI returned no regions for this image.');
  // Defensive parse: canonical output is a top-level list of
  // {box_2d, mask, label}, but tolerate a {regions:[...]} wrapper, legacy
  // "box" keys, and markdown fences.
  const text = response.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(text) as unknown;
  const rawList = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { regions?: unknown[] })?.regions)
      ? (parsed as { regions: unknown[] }).regions
      : [];
  const raw = rawList.map((r) => {
    const o = r as { label?: string; box?: number[]; box_2d?: number[]; mask?: string | unknown[] };
    return { label: o.label, box: o.box_2d ?? o.box, mask: o.mask };
  });

  // The model is asked for 0-1000 ints, but occasionally answers in 0-1
  // fractions — detect and scale accordingly.
  const allValues = raw.flatMap((r) => r.box ?? []);
  const scale = allValues.length > 0 && Math.max(...allValues) <= 1.5 ? 1 : 1 / 1000;

  const regions: AutoRegion[] = [];
  for (const r of raw) {
    if (!r.box || r.box.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = r.box.map((v) => clamp01(v * (scale === 1 ? 1 : scale)));
    const x = Math.min(xmin, xmax);
    const y = Math.min(ymin, ymax);
    const w = Math.abs(xmax - xmin);
    const h = Math.abs(ymax - ymin);
    if (w < 0.02 || h < 0.02) continue; // degenerate sliver
    const rect = { x, y, w, h };
    let poly = Array.isArray(r.mask)
      ? pairsToPolygon(r.mask)
      : typeof r.mask === 'string' && r.mask
        ? await maskToPolygon(r.mask, rect)
        : null;
    if (poly && Array.isArray(r.mask)) {
      // Vertex rings come back in absolute image coords, and sloppy answers
      // wander far outside the declared box — the "outline sprawls across
      // half the canvas" failure. Clamp every vertex into the box (small
      // margin), then drop the ring if clamping degenerated it: the box is
      // the model's own claim of where this block lives.
      const m = 0.03;
      poly = poly.map((p) => ({
        x: Math.min(Math.max(p.x, x - m), x + w + m),
        y: Math.min(Math.max(p.y, y - m), y + h + m),
      }));
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        area += a.x * b.y - b.x * a.y;
      }
      // After clamping, a wandering ring collapses onto the box edges (tiny
      // area) — unusable; fall back to the rectangle.
      if (Math.abs(area) / 2 < 0.25 * w * h) poly = null;
    }
    if (poly) {
      // Safety margin proportional to the region, so a slightly-lazy mask
      // never clips artwork at its edge.
      const pad = Math.min(0.012, Math.max(0.005, 0.05 * Math.min(w, h)));
      poly = expandPolygon(poly, pad);
    }
    regions.push({
      label: (r.label || '').trim().slice(0, 40) || `Region ${regions.length + 1}`,
      rect,
      ...(poly ? { poly } : {}),
    });
    if (regions.length >= MAX_REGIONS) break;
  }

  // Cross-region error checks — the model sometimes answers with a region
  // that is really the whole canvas, or lists the same block twice. Both
  // ruin the reveal (one step shows everything / a block flashes twice).
  const iou = (a: AutoRegion['rect'], b: AutoRegion['rect']): number => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / (a.w * a.h + b.w * b.h - inter || 1e-9);
  };
  const checked: AutoRegion[] = [];
  for (const region of regions) {
    // "Whole image" region alongside real blocks → drop it.
    if (regions.length > 2 && region.rect.w * region.rect.h > 0.9) continue;
    // Near-duplicate of an already-kept region → drop the later one.
    if (checked.some((kept) => iou(kept.rect, region.rect) > 0.75)) continue;
    checked.push(region);
  }

  if (checked.length === 0) {
    throw new Error('The AI could not find distinct regions in this image.');
  }
  return checked;
}

/**
 * Name existing (hand-drawn) regions: one cheap Flash call that looks at the
 * image plus each region's bounding box and returns a 2-3 word label per
 * region. Never called automatically — only from the explicit "AI name items"
 * button.
 */
export async function nameBuildRegions(
  image: HTMLImageElement,
  imgW: number,
  imgH: number,
  apiKey: string,
  regions: { index: number; rect: { x: number; y: number; w: number; h: number } }[]
): Promise<Map<number, string>> {
  const key = apiKey.trim();
  if (!key) throw new Error('Add your Google Gemini API key in Settings to use AI naming.');
  const ai = new GoogleGenAI({ apiKey: key });

  const boxLines = regions
    .map((r) => {
      const b = r.rect;
      const box = [b.y, b.x, b.y + b.h, b.x + b.w].map((v) => Math.round(v * 1000));
      return `Region ${r.index}: box_2d [${box.join(', ')}]`;
    })
    .join('\n');

  const response = await generateContentWithGeminiTextFallback(
    ai,
    {
      contents: {
        parts: [
          { inlineData: { data: imageToJpegBase64(image, imgW, imgH), mimeType: 'image/jpeg' } },
          {
            text:
              `Each region below is a bounding box [ymin, xmin, ymax, xmax] in 0-1000 ` +
              `image coordinates. Give each a short, meaningful 2-3 word name based on ` +
              `what that part of the infographic shows (its heading if it has one). ` +
              `Return JSON: {"names": [{"index": <region index>, "label": "<name>"}]}.\n\n` +
              boxLines,
          },
        ],
      },
      config: { responseMimeType: 'application/json' },
    },
    'nameBuildRegions'
  );

  if (!response.text) throw new Error('The AI returned no names.');
  const text = response.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(text) as unknown;
  // Without a schema the shape drifts: {names:[...]}, a bare array, "name"
  // instead of "label", string or 1-based indices. Accept all of it.
  const arr: { index?: unknown; label?: unknown; name?: unknown }[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { names?: unknown[] })?.names)
      ? ((parsed as { names: unknown[] }).names as [])
      : [];
  let entries = arr
    .map((n) => ({
      index: Number(n.index),
      label: String(n.label ?? n.name ?? '').trim().slice(0, 40),
    }))
    .filter((n) => Number.isFinite(n.index) && n.label);
  if (entries.length > 0 && Math.min(...entries.map((e) => e.index)) === 1 && !entries.some((e) => e.index === 0)) {
    entries = entries.map((e) => ({ ...e, index: e.index - 1 })); // 1-based answer
  }
  if (entries.length === 0 && arr.length === regions.length) {
    // No usable indices but one entry per region — trust the order.
    entries = arr
      .map((n, i) => ({ index: regions[i].index, label: String(n.label ?? n.name ?? '').trim().slice(0, 40) }))
      .filter((e) => e.label);
  }
  const out = new Map<number, string>();
  for (const e of entries) out.set(e.index, e.label);
  if (out.size === 0) {
    console.warn('[nameBuildRegions] unusable response:', text.slice(0, 400));
    throw new Error('The AI could not name these regions.');
  }
  return out;
}
