import JSZip from "jszip";
import { Generation, GenerationVersion } from "../types";
import { getLatestVersion } from "./historyService";
import { buildExportFilename } from "./versionUtils";
import { getBlobFromImageSource } from "./imageSourceService";
import { getCachedImageBlob } from "./imageCache";
import {
  buildVersionBlob,
  DownloadFormat,
  extensionForMime,
} from "./imageFormatService";

export const getVersionOriginalBlob = async (
  genId: string,
  v: GenerationVersion
): Promise<Blob> => {
  if (v.mimeType === "image/svg+xml" && v.svgCode) {
    return new Blob([v.svgCode], { type: "image/svg+xml" });
  }
  const fromMemory = getBlobFromImageSource({
    imageUrl: v.imageUrl,
    base64Data: v.imageData,
    mimeType: v.mimeType,
  });
  if (fromMemory) return fromMemory;

  // Try the IDB cache before hitting the network — keeps VPN users unblocked
  // since the cache is seeded locally before any Firebase Storage upload.
  const cached = await getCachedImageBlob(genId, v.id);
  if (cached) return cached;

  if (!v.imageUrl) {
    throw new Error("No image data available for export.");
  }
  const res = await fetch(v.imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to load image for export (HTTP ${res.status}).`);
  }
  return res.blob();
};

export const getGenerationExportVersions = (
  generation: Generation
): GenerationVersion[] => {
  const generatedMarks = generation.versions.filter((version) => version.type === "generation");
  return generatedMarks.length > 0 ? generatedMarks : [getLatestVersion(generation)];
};

export const countGenerationExportItems = (generations: Generation[]): number =>
  generations.reduce(
    (total, generation) => total + getGenerationExportVersions(generation).length,
    0
  );

const uniqueZipEntryName = (base: string, used: Set<string>, genId: string): string => {
  if (!used.has(base)) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot) : "";
  return `${stem}-${genId.slice(0, 8)}${ext}`;
};

interface BuildZipOptions {
  /** Output format for raster items; SVGs always stay SVG. Defaults to "original". */
  format?: DownloadFormat;
}

export interface ZipResult {
  blob: Blob;
  successCount: number;
  failCount: number;
}

export const buildGenerationsZipBlob = async (
  generations: Generation[],
  options: BuildZipOptions = {}
): Promise<ZipResult> => {
  if (generations.length === 0) {
    throw new Error("No generations selected.");
  }
  const format: DownloadFormat = options.format || "original";
  const zip = new JSZip();
  const usedNames = new Set<string>();
  let successCount = 0;
  let failCount = 0;

  for (const gen of generations) {
    const versionsToExport = getGenerationExportVersions(gen);

    for (const v of versionsToExport) {
      try {
        let blob: Blob;
        let extension: string;

        if (format === "original") {
          blob = await getVersionOriginalBlob(gen.id, v);
          extension =
            v.mimeType === "image/svg+xml" && v.svgCode
              ? "svg"
              : extensionForMime(v.mimeType || "image/png");
        } else {
          // Delegate to the shared format service so SVG stays SVG and rasters
          // re-encode consistently with the single-image download flow.
          const built = await buildVersionBlob(v, format);
          blob = built.blob;
          extension = built.extension;
        }

        // Prefer the per-mark prompt stashed in refinementPrompt when batching
        // brace expansions so each file's name reflects what produced it.
        const promptForName = v.refinementPrompt || gen.config.prompt;
        const baseName = buildExportFilename(promptForName, v.number, extension);
        const entryName = uniqueZipEntryName(baseName, usedNames, `${gen.id}-${v.id}`);
        usedNames.add(entryName);
        const buf = await blob.arrayBuffer();
        zip.file(entryName, buf);
        successCount++;
      } catch (err) {
        console.warn(`[batchExport] Skipping image (gen ${gen.id}, version ${v?.id}):`, err);
        failCount++;
      }
    }
  }

  if (successCount === 0) {
    throw new Error("No images could be exported.");
  }

  return { blob: await zip.generateAsync({ type: "blob" }), successCount, failCount };
};

export const downloadBlobAsFile = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const defaultBatchExportFilename = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `pixtaffy-export-${y}-${m}-${day}.zip`;
};
