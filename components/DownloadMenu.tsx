import React, { useRef, useState, useEffect } from "react";
import {
  Download,
  Loader2,
  Archive,
  ChevronDown,
  Image as ImageIcon,
  FileCode,
  FileText,
  Presentation,
} from "lucide-react";
import { Generation } from "../types";
import { getCurrentVersion } from "../services/historyService";
import {
  DownloadFormat,
  buildVersionDownload,
  downloadBlob,
  singleDownloadOptions,
  batchFormatOptionsForTile,
  tileBatchIncludesSvg,
} from "../services/imageFormatService";
import {
  buildGenerationsZipBlob,
  countGenerationExportItems,
  downloadBlobAsFile,
  defaultBatchExportFilename,
} from "../services/batchExportService";
import type { DocumentExportFormat } from "../services/documentExportService";

export type DownloadMenuMode = "this-and-all" | "all-only";

interface DownloadMenuProps {
  mode: DownloadMenuMode;
  currentGeneration?: Generation | null;
  allGenerations?: Generation[];
  allLabel?: string;
  triggerClassName?: string;
  triggerLabel?: string;
  triggerTitle?: string;
  /**
   * Class names applied to the inner label `<span>` of the trigger button.
   * Lets callers responsively hide the text label (e.g. `hidden xl:inline`)
   * to collapse the trigger to icon-only at narrower widths without losing
   * its accessible name (which still reads `triggerTitle`/`triggerLabel`).
   */
  triggerLabelClassName?: string;
  /**
   * Optional styled tooltip text shown below the trigger on hover/focus.
   * Uses the same dark `bg-black/90` pill style as the rest of the app
   * (see `ControlPanel` reset / upload-brand buttons). When set, the
   * native browser `title` tooltip is suppressed so they don't double up.
   * The tooltip is always available — pair with `triggerLabel={undefined}`
   * (or hide the label with `triggerLabelClassName="hidden"`) when you
   * want a fully icon-only trigger; if a visible label is also rendered
   * the tooltip simply provides extra context like a longer description
   * or a count.
   */
  triggerTooltip?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  align?: "left" | "right";
  onNotify?: (message: string) => void;
}

export const DownloadMenu: React.FC<DownloadMenuProps> = ({
  mode,
  currentGeneration,
  allGenerations,
  allLabel,
  triggerClassName,
  triggerLabel,
  triggerTitle,
  triggerLabelClassName,
  triggerTooltip,
  icon,
  disabled = false,
  align = "right",
  onNotify,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [isOpen]);

  const version = currentGeneration ? getCurrentVersion(currentGeneration) : null;
  const thisFormats = singleDownloadOptions(version);
  const allCount = allGenerations?.length ?? 0;
  const documentItemCount = allGenerations
    ? countGenerationExportItems(allGenerations)
    : 0;
  const batchIncludesSvg = allGenerations && allCount > 0 ? tileBatchIncludesSvg(allGenerations) : false;
  const batchOptions = batchFormatOptionsForTile(batchIncludesSvg);

  const notify = (message: string) => {
    onNotify?.(message);
  };

  const runThis = async (format: DownloadFormat) => {
    if (!currentGeneration || !version) return;
    setBusy(true);
    setIsOpen(false);
    try {
      const payload = await buildVersionDownload(currentGeneration, version, format);
      downloadBlob(payload.blob, payload.filename);
      notify(`${format.toUpperCase()} download started`);
    } catch (err) {
      console.error("Download failed:", err);
      notify("Download failed");
    } finally {
      setBusy(false);
    }
  };

  const runAll = async (format: DownloadFormat) => {
    if (!allGenerations || allGenerations.length === 0) return;
    setBusy(true);
    setIsOpen(false);
    try {
      const { blob, successCount, failCount } = await buildGenerationsZipBlob(allGenerations, { format });
      downloadBlobAsFile(blob, defaultBatchExportFilename());
      if (failCount > 0) {
        notify(`ZIP downloaded (${successCount} of ${successCount + failCount} images — ${failCount} could not be loaded)`);
      } else {
        notify(`ZIP download started (${successCount} item${successCount === 1 ? "" : "s"})`);
      }
    } catch (err) {
      console.error("ZIP failed:", err);
      notify("ZIP download failed");
    } finally {
      setBusy(false);
    }
  };

  const runDocument = async (format: DocumentExportFormat) => {
    if (!allGenerations || allGenerations.length === 0) return;
    const label = format === "pdf" ? "PDF" : "PowerPoint";
    const unit = format === "pdf" ? "page" : "slide";
    setBusy(true);
    setIsOpen(false);
    notify(`Preparing ${label} (${documentItemCount} ${unit}${documentItemCount === 1 ? "" : "s"})…`);
    try {
      const {
        buildGenerationsDocumentBlob,
        defaultDocumentExportFilename,
      } = await import("../services/documentExportService");
      const { blob, successCount, failCount } = await buildGenerationsDocumentBlob(
        allGenerations,
        format
      );
      downloadBlobAsFile(blob, defaultDocumentExportFilename(format));
      if (failCount > 0) {
        notify(
          `${label} downloaded (${successCount} of ${successCount + failCount} images — ${failCount} could not be loaded)`
        );
      } else {
        notify(
          `${label} download started (${successCount} ${unit}${successCount === 1 ? "" : "s"})`
        );
      }
    } catch (err) {
      console.error(`${label} export failed:`, err);
      notify(`${label} export failed`);
    } finally {
      setBusy(false);
    }
  };

  const canThis = mode !== "all-only" && !!currentGeneration && !!version;
  const canAll = allCount > 0;
  const isDisabled = disabled || busy || (!canThis && !canAll);

  const defaultTriggerClasses =
    "inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] text-slate-800 dark:text-slate-100 hover:bg-brand-teal hover:border-brand-teal hover:text-white transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed";

  const triggerIcon = busy ? (
    <Loader2 size={16} className="animate-spin" />
  ) : (
    icon ?? <Download size={16} />
  );

  const showTriggerText = !!triggerLabel || (mode === "all-only" && canAll);
  const resolvedLabel =
    triggerLabel ?? (mode === "all-only" ? allLabel || `Download (${allCount})` : undefined);

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !isDisabled && setIsOpen((v) => !v)}
        disabled={isDisabled}
        title={triggerTooltip ? undefined : triggerTitle || "Download"}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={triggerTitle || resolvedLabel || "Download"}
        className={`${triggerClassName || defaultTriggerClasses}${triggerTooltip ? " relative group/dl-tip" : ""}`}
      >
        {triggerIcon}
        {showTriggerText && resolvedLabel ? (
          <span className={triggerLabelClassName}>{resolvedLabel}</span>
        ) : null}
        <ChevronDown size={14} className="opacity-70" aria-hidden="true" />
        {triggerTooltip && (
          <span
            role="tooltip"
            className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/dl-tip:opacity-100 group-focus-visible/dl-tip:opacity-100 transition-opacity z-20"
          >
            {triggerTooltip}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`absolute ${
            align === "left" ? "left-0" : "right-0"
          } top-full mt-2 z-50 w-64 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl overflow-hidden text-sm`}
        >
          {canThis && thisFormats.length > 0 && (
            <div className="p-1">
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Download this
              </div>
              {thisFormats.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="menuitem"
                  onClick={() => runThis(opt.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-800 dark:text-slate-100 transition text-left"
                >
                  <span className="flex items-center gap-2">
                    {opt.id === "svg" || opt.id === "html" ? (
                      <FileCode size={14} aria-hidden="true" />
                    ) : (
                      <ImageIcon size={14} aria-hidden="true" />
                    )}
                    <span className="font-medium">{opt.label}</span>
                  </span>
                  {opt.description && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {opt.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {canThis && canAll && (
            <div
              className="border-t border-gray-200 dark:border-[#30363d]"
              aria-hidden="true"
            />
          )}

          {canAll && (
            <div className="p-1">
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {allLabel || `Download all (${allCount})`}
              </div>
              {batchOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="menuitem"
                  onClick={() => runAll(opt.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-800 dark:text-slate-100 transition text-left"
                >
                  <span className="flex items-center gap-2">
                    <Archive size={14} aria-hidden="true" />
                    <span className="font-medium">{opt.label}</span>
                  </span>
                  {opt.description && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {opt.description}
                    </span>
                  )}
                </button>
              ))}
              <div
                className="my-1 border-t border-gray-200 dark:border-[#30363d]"
                aria-hidden="true"
              />
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Slides and carousel
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => runDocument("pdf")}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-800 dark:text-slate-100 transition text-left"
              >
                <span className="flex items-center gap-2">
                  <FileText size={14} aria-hidden="true" />
                  <span className="font-medium">PDF carousel</span>
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {documentItemCount} {documentItemCount === 1 ? "page" : "pages"}
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runDocument("pptx")}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-800 dark:text-slate-100 transition text-left"
              >
                <span className="flex items-center gap-2">
                  <Presentation size={14} aria-hidden="true" />
                  <span className="font-medium">PowerPoint</span>
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {documentItemCount} {documentItemCount === 1 ? "slide" : "slides"}
                </span>
              </button>
            </div>
          )}

          {!canThis && !canAll && (
            <div className="p-3 text-xs text-slate-500 dark:text-slate-400">
              Nothing available to download yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
