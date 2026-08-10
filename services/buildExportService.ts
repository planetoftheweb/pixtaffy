// MP4 export for a build (reveal animation). Renders the timeline offscreen at
// the build's fps and encodes H.264 via WebCodecs, muxed to MP4 with Mediabunny.
//
// This module statically imports `mediabunny`, so it is ONLY ever loaded via
// a dynamic `import()` (see BuildStudio.handleExport) — that keeps mediabunny +
// the WebCodecs glue out of the main bundle until the user actually exports.

import {
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, canEncodeVideo, QUALITY_HIGH,
} from 'mediabunny';
import type { ImageBuild } from '../types';
import { renderFrame, totalDurationMs, prepareStepLayers, stepStopTimes } from './buildAnimator';

const MAX_EXPORT_W = 1920;
const MAX_EXPORT_SECONDS = 90; // safety cap so a runaway build can't OOM the tab

export interface ExportOptions {
  onProgress?: (fraction: number) => void;
  /** Image's own background color — 'blank' frames render on it so reveals
   * don't read as cutouts (see sampleImageBackground in buildAnimator). */
  bgColor?: string;
}

/** Fast synchronous check: is in-browser H.264 encoding even possible here? */
export const canExportMp4 = (): boolean =>
  typeof window !== 'undefined' &&
  typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder !== 'undefined';

/** Even-dimension output sized to the image aspect (H.264/yuv420p needs even). */
const outputDims = (imgW: number, imgH: number): { w: number; h: number } => {
  const w = Math.min(imgW, MAX_EXPORT_W);
  const h = Math.round((w * imgH) / imgW);
  return { w: w - (w % 2), h: h - (h % 2) };
};

export const exportBuildToMp4 = async (
  build: ImageBuild,
  image: CanvasImageSource,
  imgW: number,
  imgH: number,
  opts: ExportOptions = {}
): Promise<Blob> => {
  if (!imgW || !imgH) throw new Error('Image dimensions unknown.');
  const { w: outW, h: outH } = outputDims(imgW, imgH);

  const canEncode = await canEncodeVideo('avc', { width: outW, height: outH });
  if (!canEncode) throw new Error('H.264 (AVC) encoding is not available in this browser.');

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
  output.addVideoTrack(source);
  await output.start();

  const fps = Math.max(1, Math.min(60, build.fps || 30));
  const totalSec = Math.min(MAX_EXPORT_SECONDS, totalDurationMs(build) / 1000);
  const totalMs = totalSec * 1000;
  const frameCount = Math.max(1, Math.ceil(totalSec * fps));
  const frameDur = 1 / fps;

  // Precompute each step's masked layer once (shapes don't change per frame).
  const layers = prepareStepLayers(build, image, imgW, imgH);

  for (let i = 0; i < frameCount; i++) {
    const t = Math.min((i / fps) * 1000, totalMs);
    renderFrame(ctx, build, image, layers, imgW, imgH, t, opts.bgColor);
    // Await each add to respect encoder/writer backpressure.
    await source.add(i / fps, frameDur);
    opts.onProgress?.(i / frameCount);
  }

  await output.finalize();
  opts.onProgress?.(1);

  const buffer = target.buffer;
  if (!buffer) throw new Error('Export produced no data.');
  return new Blob([buffer], { type: 'video/mp4' });
};

/**
 * One PNG per build stop — the empty start, each frame fully revealed, and
 * the final all-revealed end — zipped for slide decks (Google Slides /
 * PowerPoint / Keynote: one image per slide + a Fade transition gives
 * click-to-advance builds with the presenter in control of timing).
 * Renders the exact settled states the arrow-key walkthrough pauses on.
 */
export const exportBuildToPngZip = async (
  build: ImageBuild,
  image: CanvasImageSource,
  imgW: number,
  imgH: number,
  opts: ExportOptions = {}
): Promise<Blob> => {
  if (!imgW || !imgH) throw new Error('Image dimensions unknown.');
  const { w: outW, h: outH } = outputDims(imgW, imgH);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const layers = prepareStepLayers(build, image, imgW, imgH);
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const stops = stepStopTimes(build);
  // Names parallel to stops: start, one per step (its label), optional end.
  const names = [
    'start',
    ...build.steps.map((s, i) => s.label || `frame-${i + 1}`),
    ...(build.endShowFull && build.steps.length > 0 ? ['end'] : []),
  ];
  const slug = (v: string): string =>
    v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'frame';

  for (let i = 0; i < stops.length; i++) {
    renderFrame(ctx, build, image, layers, imgW, imgH, stops[i], opts.bgColor);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed.');
    zip.file(`${String(i).padStart(2, '0')}-${slug(names[i] ?? `stop-${i}`)}.png`, blob);
    opts.onProgress?.((i + 1) / stops.length);
  }

  return zip.generateAsync({ type: 'blob' });
};
