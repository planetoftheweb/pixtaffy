import type { Generation, GenerationVersion } from "../types";
import {
  getGenerationExportVersions,
  getVersionOriginalBlob,
} from "./batchExportService";

export type DocumentExportFormat = "pdf" | "pptx";

export interface DocumentExportResult {
  blob: Blob;
  successCount: number;
  failCount: number;
}

interface RasterExportItem {
  dataUrl: string;
  width: number;
  height: number;
  altText: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_RASTER_EDGE = 2400;
const JPEG_QUALITY = 0.92;
const WHITE = "FFFFFF";

const loadBlobImage = (blob: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image could not be decoded for document export."));
    };
    image.src = url;
  });

const canvasToJpegBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed."))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Image encoding failed."));
    reader.readAsDataURL(blob);
  });

const rasterizeVersion = async (
  generation: Generation,
  version: GenerationVersion
): Promise<RasterExportItem> => {
  const source = await getVersionOriginalBlob(generation.id, version);
  const image = await loadBlobImage(source);
  const sourceWidth = Math.max(1, image.naturalWidth || image.width || 1);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height || 1);
  const scale = Math.min(1, MAX_RASTER_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");

  // Documents use a white page, so flatten transparency consistently before
  // JPEG encoding instead of allowing transparent areas to render black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const jpeg = await canvasToJpegBlob(canvas);
  return {
    dataUrl: await blobToDataUrl(jpeg),
    width,
    height,
    altText: (version.refinementPrompt || generation.config.prompt || "Generated image").slice(
      0,
      1000
    ),
  };
};

const collectRasterItems = async (
  generations: Generation[]
): Promise<{ items: RasterExportItem[]; failCount: number }> => {
  const items: RasterExportItem[] = [];
  let failCount = 0;

  for (const generation of generations) {
    for (const version of getGenerationExportVersions(generation)) {
      try {
        items.push(await rasterizeVersion(generation, version));
      } catch (error) {
        console.warn(
          `[documentExport] Skipping image (gen ${generation.id}, version ${version.id}):`,
          error
        );
        failCount++;
      }
    }
  }

  if (items.length === 0) {
    throw new Error("No images could be loaded for document export.");
  }

  return { items, failCount };
};

const containRect = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Rect => {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
};

const canvasDimensionsForRatio = (
  ratio: number,
  longEdge: number
): { width: number; height: number } => {
  const safeRatio = Math.min(5, Math.max(0.2, ratio || 1));
  return safeRatio >= 1
    ? { width: longEdge, height: longEdge / safeRatio }
    : { width: longEdge * safeRatio, height: longEdge };
};

const buildPdf = async (items: RasterExportItem[]): Promise<Blob> => {
  const { jsPDF } = await import("jspdf");
  const first = items[0];
  const planned = canvasDimensionsForRatio(first.width / first.height, 720);
  const orientation = planned.width >= planned.height ? "landscape" : "portrait";
  const pdf = new jsPDF({
    orientation,
    unit: "pt",
    format: [planned.width, planned.height],
    compress: true,
    putOnlyUsedFonts: true,
  });
  pdf.setProperties({
    title: "BranDoIt carousel",
    subject: "Selected BranDoIt generations",
    author: "BranDoIt",
    creator: "BranDoIt",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  items.forEach((item, index) => {
    if (index > 0) {
      pdf.addPage([planned.width, planned.height], orientation);
    }
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageWidth, pageHeight, "F");
    const frame = containRect(item.width, item.height, pageWidth, pageHeight);
    pdf.addImage(
      item.dataUrl,
      "JPEG",
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      `generation-${index + 1}`,
      "FAST"
    );
  });

  return pdf.output("blob");
};

const buildPowerPoint = async (items: RasterExportItem[]): Promise<Blob> => {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const first = items[0];
  const slideSize = canvasDimensionsForRatio(first.width / first.height, 10);
  const pptx = new PptxGenJS();
  const layoutName = "BRANDOIT_EXPORT";
  pptx.defineLayout({ name: layoutName, width: slideSize.width, height: slideSize.height });
  pptx.layout = layoutName;
  pptx.author = "BranDoIt";
  pptx.company = "BranDoIt";
  pptx.subject = "Selected BranDoIt generations";
  pptx.title = "BranDoIt slideshow";

  items.forEach((item) => {
    const slide = pptx.addSlide();
    slide.background = { color: WHITE };
    const frame = containRect(
      item.width,
      item.height,
      slideSize.width,
      slideSize.height
    );
    slide.addImage({
      data: item.dataUrl,
      x: frame.x,
      y: frame.y,
      w: frame.width,
      h: frame.height,
      altText: item.altText,
    });
  });

  const output = await pptx.write({ outputType: "blob", compression: true });
  if (output instanceof Blob) return output;
  if (output instanceof ArrayBuffer || output instanceof Uint8Array) {
    return new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
  }
  throw new Error("PowerPoint export returned an unexpected file format.");
};

export const buildGenerationsDocumentBlob = async (
  generations: Generation[],
  format: DocumentExportFormat
): Promise<DocumentExportResult> => {
  if (generations.length === 0) {
    throw new Error("No generations selected.");
  }

  const { items, failCount } = await collectRasterItems(generations);
  const blob = format === "pdf" ? await buildPdf(items) : await buildPowerPoint(items);
  return { blob, successCount: items.length, failCount };
};

export const defaultDocumentExportFilename = (format: DocumentExportFormat): string => {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `brandoit-${format === "pdf" ? "carousel" : "slideshow"}-${stamp}.${format}`;
};
