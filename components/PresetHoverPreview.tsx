import React from 'react';
import { createPortal } from 'react-dom';
import { AnchorRect } from './PresetActionPopover';

export interface PresetLabels {
  type?: string;
  style?: string;
  colors?: string;
  size?: string;
  svgMode?: string;
  model?: string;
  quality?: string;
  /** Free-text art direction the preset carries (customInstructions). */
  instructions?: string;
}

interface PresetHoverPreviewProps {
  anchor: AnchorRect;
  name: string;
  labels: PresetLabels;
  /** When true, prefer opening to the LEFT of the anchor (e.g. row is near the right edge). */
  preferLeft?: boolean;
}

const PREVIEW_WIDTH = 220;
const GAP = 12;
const MARGIN = 8;

function computePreviewStyle(
  anchor: AnchorRect,
  preferLeft: boolean,
  estimatedHeight: number
): React.CSSProperties {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const fitsRight = anchor.right + GAP + PREVIEW_WIDTH <= vw - MARGIN;
  const fitsLeft = anchor.left - GAP - PREVIEW_WIDTH >= MARGIN;
  const openLeft = preferLeft ? fitsLeft : !fitsRight && fitsLeft;
  const top = Math.max(
    MARGIN,
    Math.min(anchor.top, vh - MARGIN - estimatedHeight)
  );
  const style: React.CSSProperties = {
    position: 'fixed',
    top,
    width: PREVIEW_WIDTH,
    zIndex: 65,
    pointerEvents: 'none',
  };
  if (openLeft) {
    style.right = vw - anchor.left + GAP;
  } else {
    style.left = anchor.right + GAP;
  }
  return style;
}

export const PresetHoverPreview: React.FC<PresetHoverPreviewProps> = ({
  anchor,
  name,
  labels,
  preferLeft = false,
}) => {
  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'type', label: 'Type', value: labels.type || '' },
    { key: 'style', label: 'Style', value: labels.style || '' },
    { key: 'colors', label: 'Colors', value: labels.colors || '' },
    { key: 'size', label: 'Size', value: labels.size || '' },
    { key: 'svgMode', label: 'SVG mode', value: labels.svgMode || '' },
    { key: 'model', label: 'Model', value: labels.model || '' },
    { key: 'quality', label: 'Quality', value: labels.quality || '' },
  ].filter((r) => !!r.value);
  const instructions = labels.instructions?.trim() || '';

  const estimatedHeight = 64 + rows.length * 25 + (instructions ? 64 : 0);
  const style = computePreviewStyle(anchor, preferLeft, estimatedHeight);

  if (typeof document === 'undefined') return null;
  if (rows.length === 0 && !instructions) return null;

  return createPortal(
    <div
      data-preset-popover="hover"
      style={style}
      className="bg-white dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg shadow-xl p-3 text-[13px] text-slate-600 dark:text-slate-300"
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 truncate">
        {name}
      </p>
      <dl className="space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline gap-2">
            <dt className="text-slate-400 dark:text-slate-500 shrink-0 w-14">{r.label}</dt>
            <dd className="text-slate-700 dark:text-slate-200 truncate">{r.value}</dd>
          </div>
        ))}
      </dl>
      {instructions && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-[#30363d]">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-teal mb-1">Art direction</p>
          <p className="leading-snug text-slate-600 dark:text-slate-300 line-clamp-4">{instructions}</p>
        </div>
      )}
    </div>,
    document.body
  );
};
