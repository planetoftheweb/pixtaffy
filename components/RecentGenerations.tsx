import React from 'react';
import { createPortal } from 'react-dom';
import { Generation, BrandColor, VisualStyle, GraphicType, AspectRatioOption, Folder, INBOX_FOLDER_ID, ToolbarPreset } from '../types';
import { ArrowUpRight, Trash2, Archive, CheckSquare, Square, GitCompare, Eye, EyeOff, LayoutGrid, Folder as FolderIcon, FolderPlus, Pencil, FolderInput, X as XIcon, Check, ChevronLeft, ChevronRight, ChevronDown, Loader2, FileText, MoreVertical, ClipboardCopy, Download } from 'lucide-react';
import {
  buildFolderTree,
  flattenVisibleFolderTree,
  getChildFolders,
  getDescendantFolderIds,
  getEffectiveFolderInstructions,
} from '../services/folderTreeUtils';
import { sanitizeSvg } from '../services/svgService';
import { createBlobUrlFromImage } from '../services/imageSourceService';
import { backfillImageCache, getCachedImageBlobUrl } from '../services/imageCache';
import { getLatestVersion } from '../services/historyService';
import {
  buildVersionDownload,
  downloadBlob,
  singleDownloadOptions,
  type DownloadFormat,
} from '../services/imageFormatService';
import { DownloadMenu } from './DownloadMenu';
import { RichSelect, RichSelectOption } from './RichSelect';
import { GalleryPresetMenu, GalleryPresetSource } from './GalleryPresetMenu';
import { ToolbarPresetSnapshot } from '../utils/toolbarPresetUtils';
import { useConfirmAction } from '../hooks/useConfirmAction';

type ThumbnailSize = 'xs' | 'sm' | 'md' | 'lg';

// Tailwind grid-column maps per thumbnail size. Kept as full literal class
// strings so Tailwind's JIT picks them up (it can't see dynamically built
// `grid-cols-${n}` strings). Smaller sizes pack more tiles per row.
const THUMBNAIL_GRID_CLASS: Record<ThumbnailSize, string> = {
  xs: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2',
  sm: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-2.5',
  md: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3',
  lg: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4',
};

type ContextPoint = { x: number; y: number };

const CONTEXT_MENU_PANEL =
  'fixed z-[70] min-w-[11rem] max-w-[min(100vw-1rem,16rem)] py-1 rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-xl max-h-[min(70vh,20rem)] overflow-y-auto';
const CONTEXT_MENU_ITEM =
  'w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-[#21262d] disabled:opacity-50 disabled:pointer-events-none';
const CONTEXT_MENU_ITEM_ACCENT =
  'w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-brand-teal hover:bg-brand-teal/10';
const CONTEXT_MENU_ITEM_DANGER =
  'w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20';

function clampContextPoint(
  point: ContextPoint,
  size: { width: number; height: number } = { width: 220, height: 300 }
): ContextPoint {
  if (typeof window === 'undefined') return point;
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - size.width - margin);
  const maxY = Math.max(margin, window.innerHeight - size.height - margin);
  return {
    x: Math.min(Math.max(margin, point.x), maxX),
    y: Math.min(Math.max(margin, point.y), maxY),
  };
}

const PANEL_ANCHOR_GAP = 8;

type PanelAnchor = {
  left: number;
  align: 'start' | 'center' | 'end';
  triggerTop: number;
  triggerBottom: number;
};

function panelAnchorFromRect(
  rect: DOMRect,
  opts?: { align?: PanelAnchor['align'] }
): PanelAnchor {
  const align = opts?.align ?? 'start';
  return {
    left:
      align === 'center'
        ? rect.left + rect.width / 2
        : align === 'end'
          ? rect.right
          : rect.left,
    align,
    triggerTop: rect.top,
    triggerBottom: rect.bottom,
  };
}

function panelAnchorStyle(
  anchor: PanelAnchor,
  panelWidth: number,
  maxPanelHeight = 320
): React.CSSProperties {
  const margin = 8;
  const gap = PANEL_ANCHOR_GAP;
  const vw = typeof window !== 'undefined' ? window.innerWidth : panelWidth + margin * 2;
  const vh = typeof window !== 'undefined' ? window.innerHeight : maxPanelHeight + margin * 2;

  const spaceBelow = Math.max(0, vh - anchor.triggerBottom - margin);
  const spaceAbove = Math.max(0, anchor.triggerTop - margin);
  const minComfort = Math.min(maxPanelHeight, 100);
  const openAbove = spaceBelow < minComfort && spaceAbove > spaceBelow;

  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 70,
    overflowY: 'auto',
  };

  if (openAbove) {
    style.bottom = vh - anchor.triggerTop + gap;
    style.maxHeight = Math.min(maxPanelHeight, spaceAbove);
  } else {
    style.top = anchor.triggerBottom + gap;
    style.maxHeight = Math.min(maxPanelHeight, spaceBelow);
  }

  if (anchor.align === 'center') {
    style.left = anchor.left;
    style.transform = 'translateX(-50%)';
    style.width = Math.min(panelWidth, vw - margin * 2);
  } else if (anchor.align === 'end') {
    style.right = Math.max(margin, vw - anchor.left);
    style.minWidth = Math.min(panelWidth, vw - margin * 2);
  } else {
    const width = Math.min(panelWidth, vw - margin * 2);
    style.left = Math.max(margin, Math.min(anchor.left, vw - margin - width));
    style.width = width;
  }
  return style;
}

function usePanelAnchor(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  opts?: { align?: PanelAnchor['align'] }
): PanelAnchor | null {
  const [anchor, setAnchor] = React.useState<PanelAnchor | null>(null);
  const align = opts?.align ?? 'start';
  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAnchor(panelAnchorFromRect(el.getBoundingClientRect(), { align }));
  }, [ref, align]);
  React.useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);
  return anchor;
}

function ContextMenuDivider() {
  return (
    <div
      className="my-1 border-t border-gray-200 dark:border-[#30363d]"
      role="separator"
    />
  );
}

// Single-word labels keep the compact RichSelect trigger from wrapping
// onto two lines at narrow widths (the trigger is `w-28 xl:w-32`, which
// the hyphenated "X-Small" couldn't fit). The menu items still pair the
// label with a longer description so the meaning stays obvious.
const THUMBNAIL_SIZE_OPTIONS: RichSelectOption[] = [
  { value: 'xs', label: 'Tiny', description: 'X-Small — most thumbnails per row' },
  { value: 'sm', label: 'Small', description: 'Compact grid' },
  { value: 'md', label: 'Medium', description: 'Default — balanced size' },
  { value: 'lg', label: 'Large', description: 'Bigger thumbnails, fewer per row' },
];

/** When a folder has more than this many tiles, the gallery paginates. */
const GALLERY_PAGE_THRESHOLD = 50;
// Page-size options are now rendered as inline chip buttons inside the
// "1/2 ▾" header popover, so the prior `GALLERY_PAGE_SIZE_OPTIONS` array
// (used by a removed RichSelect dropdown) is no longer needed. Valid sizes
// live as a literal `[25, 50, 100, 200]` next to the chip buttons.

interface RecentGenerationsMarkRef {
  generationId: string;
  versionId: string;
  imageUrl: string;
  mimeType: string;
  modelId: string;
  markLabel: string;
  aspectRatio?: string;
}

interface RecentGenerationsProps {
  history: Generation[];
  onSelect: (gen: Generation) => void;
  onDelete: (generationId: string) => void;
  options: {
    brandColors: BrandColor[];
    visualStyles: VisualStyle[];
    graphicTypes: GraphicType[];
    aspectRatios: AspectRatioOption[];
  };
  /** True when the app is in compare-pick mode — tile clicks should pick marks. */
  isComparePicking?: boolean;
  /** Pick the latest mark of a tile as an A/B for comparison. */
  onPickMark?: (ref: RecentGenerationsMarkRef) => void;
  /** Batch ids for currently-picked A/B marks, used to render "picked" badge. */
  pickedMarkIds?: { a?: string; b?: string };
  /** All folders the current actor owns. The Inbox folder is always present. */
  folders: Folder[];
  /** Which folder's tiles the Recents grid is showing; new generations land here. */
  galleryViewFolderId: string;
  /** Persist the user's gallery folder tab (Firestore or guest localStorage). */
  onGalleryViewFolderChange: (folderId: string) => void | Promise<void>;
  /** Create a folder; optional `parentId` nests it as a subfolder. */
  onCreateFolder: (name: string, parentId?: string) => Promise<Folder>;
  onRenameFolder: (folderId: string, nextName: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  /** Bulk-move a list of tiles into a folder (used by selection-mode action). */
  onMoveToFolder: (generationIds: string[], folderId: string) => Promise<void>;
  /** Reparent a folder (Shift+drop onto another folder). Pass `null` for top level. */
  onMoveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  /** Reorder among siblings — drop above/below another folder row. */
  onReorderFolder: (
    folderId: string,
    referenceFolderId: string,
    position: 'before' | 'after'
  ) => Promise<void>;
  onSetFolderInstructions: (folderId: string, customInstructions: string) => Promise<void>;
  /** Presets shown in the gallery toolbar (global or folder-scoped). */
  galleryPresets: ToolbarPreset[];
  galleryPresetSource: GalleryPresetSource;
  onGalleryPresetSourceChange: (source: GalleryPresetSource) => void | Promise<void>;
  galleryToolbarPresetSnapshot: ToolbarPresetSnapshot;
  onApplyGalleryPreset: (preset: ToolbarPreset) => void;
  onSaveGalleryPreset?: (name: string) => Promise<void>;
  onUpdateGalleryPreset?: (presetId: string) => Promise<void>;
  onRenameGalleryPreset?: (presetId: string, name: string) => Promise<void>;
  onDeleteGalleryPreset?: (presetId: string) => Promise<void>;
  getPresetLabels?: (preset: ToolbarPreset) => import('./PresetHoverPreview').PresetLabels;
  galleryFolderName?: string;
  /**
   * ID of the generation currently rendered in the main `ImageDisplay`. The
   * matching tile in the grid below gets a brand-red ring so the user can
   * always tell at a glance which tile they're looking at, even after
   * scrolling, paginating, or restoring from history.
   */
  activeGenerationId?: string;
  /**
   * Whether the large preview (`ImageDisplay`) is rendered above the gallery.
   * When it is, the gallery draws a top divider + margin to separate itself
   * from the preview. On first load with nothing selected there's no preview,
   * so that divider would just stack a redundant second line under the toolbar
   * with dead space between — drop it in that case.
   */
  hasPreviewAbove?: boolean;
  /**
   * Whether the toolbar is collapsed (focus mode). In focus mode the preview
   * hugs the image with even padding, so the gallery's top separator/margin
   * would read as extra, unbalanced space below the image — drop it and let
   * the gallery sit flush so the image's framing stays even on all sides.
   */
  toolbarCollapsed?: boolean;
}

export const RecentGenerations: React.FC<RecentGenerationsProps> = ({
  history, 
  onSelect,
  onDelete,
  options,
  isComparePicking,
  onPickMark,
  pickedMarkIds,
  folders,
  galleryViewFolderId,
  onGalleryViewFolderChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveToFolder,
  onMoveFolder,
  onReorderFolder,
  onSetFolderInstructions,
  galleryPresets,
  galleryPresetSource,
  onGalleryPresetSourceChange,
  galleryToolbarPresetSnapshot,
  onApplyGalleryPreset,
  onSaveGalleryPreset,
  onUpdateGalleryPreset,
  onRenameGalleryPreset,
  onDeleteGalleryPreset,
  getPresetLabels,
  galleryFolderName,
  activeGenerationId,
  hasPreviewAbove = true,
  toolbarCollapsed = false,
}) => {
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  const [imageSrcById, setImageSrcById] = React.useState<Record<string, string>>({});
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  // Grid folder tab — persisted in App (Firestore for signed-in, localStorage for guests).
  const viewFolderId = galleryViewFolderId;
  const [renamingFolderId, setRenamingFolderId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [pendingDeleteFolderId, setPendingDeleteFolderId] = React.useState<string | null>(null);
  // Folder picker dropdown: combines the folder-name "label" with the
  // count chip and the (formerly chip-strip) folder list into a single
  // trigger + menu. Keeping it inside this component avoids having to
  // teach RichSelect about per-row pin/rename/delete actions.
  const [isFolderPickerOpen, setIsFolderPickerOpen] = React.useState(false);
  const folderPickerRef = React.useRef<HTMLDivElement>(null);
  const [folderActionsMenuAnchor, setFolderActionsMenuAnchor] =
    React.useState<PanelAnchor | null>(null);
  const pageMenuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const moveMenuTriggerRef = React.useRef<HTMLDivElement>(null);
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);
  const [createFolderParentId, setCreateFolderParentId] = React.useState<string | undefined>(undefined);
  const [newFolderDraft, setNewFolderDraft] = React.useState('');
  const [folderBusy, setFolderBusy] = React.useState(false);
  const [instructionsFolderId, setInstructionsFolderId] = React.useState<string | null>(null);
  const [instructionsDraft, setInstructionsDraft] = React.useState('');
  const [draggingTileId, setDraggingTileId] = React.useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = React.useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = React.useState<string | null>(null);
  const [folderDropIndicator, setFolderDropIndicator] = React.useState<{
    folderId: string;
    position: 'before' | 'after';
  } | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = React.useState<Set<string>>(() => new Set());
  const [folderActionsMenuId, setFolderActionsMenuId] = React.useState<string | null>(null);
  const [folderContextMenu, setFolderContextMenu] = React.useState<{
    /** `'root'` = header right-click (create top-level folder). */
    folderId: string | 'root';
    x: number;
    y: number;
  } | null>(null);
  const [tileContextMenu, setTileContextMenu] = React.useState<{
    generationId: string;
    x: number;
    y: number;
    view: 'main' | 'move' | 'download';
  } | null>(null);
  const [tileDownloadBusy, setTileDownloadBusy] = React.useState(false);
  const folderActionsMenuRef = React.useRef<HTMLDivElement>(null);
  const [moveMenuOpen, setMoveMenuOpen] = React.useState(false);
  // In-flight move-to-folder progress. `moveProgress` drives a sticky
  // "Moving N items to <folder>…" banner with a spinner so the user sees
  // immediate feedback when they pick a destination — large batches go
  // through Firestore one tile at a time and can take several seconds. The
  // tile IDs in the set get a dimmed/pulsing visual state until the
  // operation completes. `null` means no move is in flight.
  const [moveProgress, setMoveProgress] = React.useState<{
    ids: Set<string>;
    folderName: string;
    total: number;
  } | null>(null);
  // Combined page-jump + per-page popover anchored under the "1/2 ▾" button
  // in the gallery header. Replaces the prior wide page-size dropdown and
  // the standalone numeric page indicator with a single compact trigger.
  const [pageMenuOpen, setPageMenuOpen] = React.useState(false);
  const folderPickerAnchor = usePanelAnchor(isFolderPickerOpen, folderPickerRef);
  const pageMenuAnchor = usePanelAnchor(pageMenuOpen, pageMenuTriggerRef, {
    align: 'center',
  });
  const moveMenuAnchor = usePanelAnchor(moveMenuOpen, moveMenuTriggerRef, {
    align: 'end',
  });
  // Per-tile details panel (prompt + tag chips) is opt-in. Default to hidden
  // so the gallery reads as a clean image grid; users who want context can
  // flip the toggle and the choice survives reloads via localStorage.
  const DETAILS_PREF_KEY = 'recentGenerations.showDetails';
  const SIZE_PREF_KEY = 'recentGenerations.thumbnailSize';
  const PAGE_SIZE_PREF_KEY = 'recentGenerations.galleryPageSize';
  const [showDetails, setShowDetails] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(DETAILS_PREF_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Thumbnail density. Defaults to 'sm' so the gallery reads as a tighter
  // grid out of the box; users can pick xs/md/lg from the toolbar dropdown
  // and the choice persists.
  const [thumbnailSize, setThumbnailSize] = React.useState<ThumbnailSize>(() => {
    if (typeof window === 'undefined') return 'sm';
    try {
      const stored = window.localStorage.getItem(SIZE_PREF_KEY);
      if (stored === 'xs' || stored === 'sm' || stored === 'md' || stored === 'lg') {
        return stored;
      }
    } catch {
      // ignore
    }
    return 'sm';
  });
  const [galleryPage, setGalleryPage] = React.useState(1);
  const [galleryPageSize, setGalleryPageSize] = React.useState<number>(() => {
    if (typeof window === 'undefined') return 50;
    try {
      const stored = window.localStorage.getItem(PAGE_SIZE_PREF_KEY);
      if (stored === '25' || stored === '50' || stored === '100' || stored === '200') {
        return parseInt(stored, 10);
      }
    } catch {
      // ignore
    }
    return 50;
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DETAILS_PREF_KEY, showDetails ? '1' : '0');
    } catch {
      // ignore — quota / private mode shouldn't break the UI
    }
  }, [showDetails]);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SIZE_PREF_KEY, thumbnailSize);
    } catch {
      // ignore
    }
  }, [thumbnailSize]);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PAGE_SIZE_PREF_KEY, String(galleryPageSize));
    } catch {
      // ignore
    }
  }, [galleryPageSize]);
  const toastTimerRef = React.useRef<number | null>(null);
  const blobUrlsRef = React.useRef<Record<string, string>>({});

  const showToast = React.useCallback((msg: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 1800);
  }, []);
  // Hover preview: floats a large, full-aspect-ratio version of the tile's
  // image above the grid. We capture the tile's bounding rect so the
  // preview can be docked to the opposite side of the viewport — that way
  // the source tile stays visible and the user can sweep across to other
  // tiles without the preview ever covering the thing they're inspecting.
  // Activation is gated to hover-capable pointing devices so touch users
  // (who can't really "roll over" anything) don't get a preview that
  // appears on tap and blocks subsequent taps.
  const [hoverPreview, setHoverPreview] = React.useState<{ id: string; rect: DOMRect } | null>(null);
  const hoverTimerRef = React.useRef<number | null>(null);
  const clearHoverPreview = React.useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverPreview(null);
  }, []);
  const scheduleHoverPreview = React.useCallback(
    (genId: string, element: HTMLElement) => {
      if (typeof window === 'undefined') return;
      // Skip on touch / coarse-pointer devices where the user can't truly
      // hover. We check both `hover: hover` and `pointer: fine` to avoid
      // false positives on hybrid devices in tablet mode.
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      // Selection mode and compare-pick mode already overlay the tile, and
      // popping a large preview on top of those affordances would obscure
      // the very thing the user is trying to interact with.
      if (selectionMode || isComparePicking) return;
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = window.setTimeout(() => {
        // Re-read the rect at fire time so it reflects any layout that
        // shifted during the show delay (lazy images settling, etc.).
        setHoverPreview({ id: genId, rect: element.getBoundingClientRect() });
      }, 320);
    },
    [selectionMode, isComparePicking]
  );

  // Bulk-delete confirm uses the same double-tap pattern as the rest of
  // the app (per-version delete in `ImageDisplay`, preset delete in
  // `ControlPanel`). First click on the trash button arms it for ~3s and
  // changes label/style to "Click again to delete N items"; second click
  // within the window fires `onDelete` for each selected id and exits
  // selection mode. Arming auto-resets after the timeout so a forgotten
  // arm doesn't linger after the user moves on.
  const [bulkDeleting, setBulkDeleting] = React.useState(false);
  const bulkDelete = useConfirmAction<'delete-selected'>({
    onConfirm: async () => {
      if (selectedIds.length === 0) return;
      const idsToDelete = [...selectedIds];
      setBulkDeleting(true);
      try {
        // `onDelete` is fire-and-forget at the App level (it dispatches an
        // async `executeDeleteHistory` per id), so we can fan out without
        // awaiting. Clearing selection + exiting selection mode happens
        // synchronously; the parent's `history` prop updates as deletes
        // resolve and React removes the tiles via diff.
        idsToDelete.forEach((id) => onDelete(id));
        showToast(
          `Deleting ${idsToDelete.length} item${idsToDelete.length === 1 ? '' : 's'}…`
        );
        setSelectedIds([]);
        setSelectionMode(false);
      } finally {
        setBulkDeleting(false);
      }
    },
  });

  const exitSelectionMode = React.useCallback(() => {
    setSelectionMode(false);
    setSelectedIds([]);
    // Disarm the trash button on exit so re-entering selection mode
    // doesn't leave the destructive button half-armed from a prior session.
    bulkDelete.reset();
  }, [bulkDelete]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  React.useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitSelectionMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectionMode, exitSelectionMode]);

  React.useEffect(() => {
    const valid = new Set(history.map((g) => g.id));
    setSelectedIds((prev) => prev.filter((id) => valid.has(id)));
  }, [history]);

  // Invalid / missing folder ids are corrected in App; no local reset here.
  // Close the folder picker and the move-to-folder picker on outside
  // clicks / Escape, mirroring the existing toast lifecycle. Both menus
  // tag themselves with `data-folder-menu` so a click *inside* either menu
  // (or its trigger) is left alone.
  React.useEffect(() => {
    if (
      !isFolderPickerOpen &&
      !moveMenuOpen &&
      !pageMenuOpen &&
      !folderActionsMenuId &&
      !folderContextMenu &&
      !tileContextMenu
    ) {
      return;
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // `data-folder-menu` is a misnomer at this point — it's the generic
      // "popover guard" marker for any in-row popover (folder picker,
      // move-to-folder, and now the combined page-jump menu). Sharing the
      // attribute keeps a single global outside-click handler authoritative
      // for the whole header cluster.
      if (target && target.closest('[data-folder-menu]')) return;
      if (target && folderActionsMenuRef.current?.contains(target)) return;
      setIsFolderPickerOpen(false);
      setMoveMenuOpen(false);
      setPageMenuOpen(false);
      setFolderActionsMenuId(null);
      setFolderActionsMenuAnchor(null);
      setFolderContextMenu(null);
      setTileContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFolderPickerOpen(false);
        setMoveMenuOpen(false);
        setPageMenuOpen(false);
        setFolderActionsMenuId(null);
        setFolderActionsMenuAnchor(null);
        setFolderContextMenu(null);
        setTileContextMenu(null);
        setRenamingFolderId(null);
        setRenameDraft('');
        setIsCreatingFolder(false);
        setCreateFolderParentId(undefined);
        setNewFolderDraft('');
      }
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [
    isFolderPickerOpen,
    moveMenuOpen,
    pageMenuOpen,
    folderActionsMenuId,
    folderContextMenu,
    tileContextMenu,
  ]);

  // Visible history is the slice of tiles that live in the currently-viewed
  // folder. Legacy items without a `folderId` are normalized into Inbox via
  // historyService, so this filter handles them implicitly.
  const visibleHistory = React.useMemo(
    () => history.filter((g) => (g.folderId || INBOX_FOLDER_ID) === viewFolderId),
    [history, viewFolderId]
  );

  const galleryPaginationEnabled = visibleHistory.length > GALLERY_PAGE_THRESHOLD;
  const pagedVisibleHistory = React.useMemo(() => {
    if (!galleryPaginationEnabled) return visibleHistory;
    const start = (galleryPage - 1) * galleryPageSize;
    return visibleHistory.slice(start, start + galleryPageSize);
  }, [visibleHistory, galleryPaginationEnabled, galleryPage, galleryPageSize]);

  React.useEffect(() => {
    const targets = pagedVisibleHistory
      .map((gen) => {
        const latestVersion = getLatestVersion(gen);
        if (
          !latestVersion?.id ||
          !latestVersion.imageUrl ||
          latestVersion.mimeType === 'image/svg+xml' ||
          !/^https?:/i.test(latestVersion.imageUrl)
        ) {
          return null;
        }
        return {
          generationId: gen.id,
          versionId: latestVersion.id,
          imageUrl: latestVersion.imageUrl,
        };
      })
      .filter((target): target is { generationId: string; versionId: string; imageUrl: string } => Boolean(target));

    if (targets.length > 0) {
      void backfillImageCache(targets);
    }
  }, [pagedVisibleHistory]);

  const galleryTotalPages = React.useMemo(() => {
    if (!galleryPaginationEnabled) return 1;
    return Math.max(1, Math.ceil(visibleHistory.length / galleryPageSize));
  }, [galleryPaginationEnabled, visibleHistory.length, galleryPageSize]);

  const galleryRangeStart =
    visibleHistory.length === 0 ? 0 : (galleryPage - 1) * galleryPageSize + 1;
  const galleryRangeEnd = galleryPaginationEnabled
    ? Math.min(visibleHistory.length, galleryPage * galleryPageSize)
    : visibleHistory.length;

  React.useEffect(() => {
    setGalleryPage(1);
  }, [viewFolderId]);

  React.useEffect(() => {
    if (!galleryPaginationEnabled) return;
    setGalleryPage((p) => Math.min(Math.max(1, p), galleryTotalPages));
  }, [galleryPaginationEnabled, galleryTotalPages, visibleHistory.length, galleryPageSize]);

  // Per-folder counts shown on the tab chips. Built from the full history
  // (not the filtered slice) so every chip stays accurate while the user
  // is browsing a single folder.
  const folderCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const folder of folders) counts.set(folder.id, 0);
    for (const gen of history) {
      const id = gen.folderId || INBOX_FOLDER_ID;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [history, folders]);

  const folderTreeRoots = React.useMemo(() => buildFolderTree(folders), [folders]);

  const visibleFolderRows = React.useMemo(
    () => flattenVisibleFolderTree(folderTreeRoots, collapsedFolderIds),
    [folderTreeRoots, collapsedFolderIds]
  );

  const toggleFolderCollapsed = React.useCallback((folderId: string) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const beginAddSubfolder = React.useCallback((parentId: string) => {
    setCreateFolderParentId(parentId);
    setIsCreatingFolder(true);
    setNewFolderDraft('');
    setFolderActionsMenuId(null);
    setFolderActionsMenuAnchor(null);
    setFolderContextMenu(null);
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
  }, []);

  const beginCreateRootFolder = React.useCallback(() => {
    setCreateFolderParentId(undefined);
    setIsCreatingFolder(true);
    setNewFolderDraft('');
    setFolderActionsMenuId(null);
    setFolderActionsMenuAnchor(null);
    setFolderContextMenu(null);
  }, []);

  const closeAllContextMenus = React.useCallback(() => {
    setFolderContextMenu(null);
    setTileContextMenu(null);
  }, []);

  const downloadTileFormat = React.useCallback(
    async (gen: Generation, format: DownloadFormat) => {
      const version = getLatestVersion(gen);
      if (!version) {
        showToast('Nothing to download yet');
        return;
      }
      setTileDownloadBusy(true);
      closeAllContextMenus();
      try {
        const payload = await buildVersionDownload(gen, version, format);
        downloadBlob(payload.blob, payload.filename);
        showToast(`${format.toUpperCase()} download started`);
      } catch (err) {
        console.warn('[RecentGenerations] tile download failed:', err);
        showToast('Download failed');
      } finally {
        setTileDownloadBusy(false);
      }
    },
    [closeAllContextMenus, showToast]
  );

  const copyGenerationPrompt = React.useCallback(
    async (gen: Generation) => {
      try {
        await navigator.clipboard.writeText(gen.config.prompt);
        showToast('Prompt copied');
        closeAllContextMenus();
      } catch {
        showToast('Could not copy prompt');
      }
    },
    [closeAllContextMenus, showToast]
  );

  const moveTileToFolder = React.useCallback(
    async (generationId: string, folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      try {
        setFolderBusy(true);
        await onMoveToFolder([generationId], folderId);
        showToast(`Moved to ${folder.name}`);
        closeAllContextMenus();
      } catch (err) {
        console.error('Move tile failed:', err);
        showToast('Move failed');
      } finally {
        setFolderBusy(false);
      }
    },
    [folders, onMoveToFolder, closeAllContextMenus, showToast]
  );

  const openFolderInstructions = React.useCallback(
    (folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      setInstructionsFolderId(folderId);
      setInstructionsDraft(folder.customInstructions || '');
      setFolderActionsMenuId(null);
      setFolderActionsMenuAnchor(null);
      closeAllContextMenus();
      setIsFolderPickerOpen(false);
    },
    [folders, closeAllContextMenus]
  );

  const startRenameFolder = React.useCallback(
    (folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;
      setRenamingFolderId(folderId);
      setRenameDraft(folder.name);
      setFolderActionsMenuId(null);
      setFolderActionsMenuAnchor(null);
      closeAllContextMenus();
    },
    [folders, closeAllContextMenus]
  );

  const promptDeleteFolder = React.useCallback(
    (folderId: string) => {
      setFolderActionsMenuId(null);
      setFolderActionsMenuAnchor(null);
      closeAllContextMenus();
      setIsFolderPickerOpen(false);
      setPendingDeleteFolderId(folderId);
    },
    [closeAllContextMenus]
  );

  const openFolderFromMenu = React.useCallback(
    (folderId: string) => {
      void onGalleryViewFolderChange(folderId);
      closeAllContextMenus();
      setIsFolderPickerOpen(false);
    },
    [onGalleryViewFolderChange, closeAllContextMenus]
  );

  const childFoldersInView = React.useMemo(
    () => getChildFolders(folders, viewFolderId),
    [folders, viewFolderId]
  );

  const viewFolderEffectiveInstructions = React.useMemo(
    () => getEffectiveFolderInstructions(folders, viewFolderId),
    [folders, viewFolderId]
  );

  const applyFolderDrop = async (
    targetFolderId: string,
    folderDropMode?: 'before' | 'after' | 'nest'
  ) => {
    if (draggingTileId) {
      const ids = selectedIds.includes(draggingTileId) && selectedIds.length > 0
        ? selectedIds
        : [draggingTileId];
      const folder = folders.find((f) => f.id === targetFolderId);
      if (!folder) return;
      setMoveProgress({
        ids: new Set(ids),
        folderName: folder.name,
        total: ids.length,
      });
      try {
        setFolderBusy(true);
        await onMoveToFolder(ids, targetFolderId);
        showToast(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'} to ${folder.name}`);
        if (selectionMode) setSelectedIds([]);
      } catch (err) {
        console.error('Drag move to folder failed:', err);
        showToast('Move failed');
      } finally {
        setFolderBusy(false);
        setMoveProgress(null);
      }
      return;
    }
    if (draggingFolderId) {
      const mode =
        folderDropMode ??
        (folderDropIndicator
          ? folderDropIndicator.position
          : dropTargetFolderId
            ? 'nest'
            : null);
      try {
        setFolderBusy(true);
        if (mode === 'before' || mode === 'after') {
          await onReorderFolder(draggingFolderId, targetFolderId, mode);
          showToast('Folder reordered');
        } else if (mode === 'nest') {
          await onMoveFolder(draggingFolderId, targetFolderId);
          showToast('Folder moved into folder');
        }
      } catch (err) {
        console.error('Move folder failed:', err);
        showToast(err instanceof Error ? err.message : 'Could not move folder');
      } finally {
        setFolderBusy(false);
      }
    }
  };

  /** Top/bottom bands reorder among siblings; center band nests inside the row. */
  const resolveFolderDropMode = (
    e: React.DragEvent
  ): 'before' | 'after' | 'nest' => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1);
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'nest';
  };

  const folderDropHandlers = (targetFolderId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!draggingTileId && !draggingFolderId) return;
      e.preventDefault();
      if (draggingTileId) {
        e.dataTransfer.dropEffect = 'move';
        setFolderDropIndicator(null);
        setDropTargetFolderId(targetFolderId);
        return;
      }
      if (draggingFolderId === targetFolderId) {
        e.dataTransfer.dropEffect = 'none';
        setFolderDropIndicator(null);
        setDropTargetFolderId(null);
        return;
      }
      e.dataTransfer.dropEffect = 'move';
      const mode = resolveFolderDropMode(e);
      if (mode === 'nest') {
        setFolderDropIndicator(null);
        setDropTargetFolderId(targetFolderId);
        return;
      }
      setDropTargetFolderId(null);
      setFolderDropIndicator({
        folderId: targetFolderId,
        position: mode,
      });
    },
    onDragLeave: () => {
      setDropTargetFolderId((prev) => (prev === targetFolderId ? null : prev));
      setFolderDropIndicator((prev) =>
        prev?.folderId === targetFolderId ? null : prev
      );
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const folderDropMode = draggingFolderId
        ? resolveFolderDropMode(e)
        : undefined;
      setDropTargetFolderId(null);
      setFolderDropIndicator(null);
      setDraggingTileId(null);
      setDraggingFolderId(null);
      void applyFolderDrop(targetFolderId, folderDropMode);
    },
  });

  // Items that the "download all" menu operates on: selected items when the
  // user has made a selection; otherwise the visible folder's history.
  const downloadScope = React.useMemo(() => {
    if (selectedIds.length === 0) return visibleHistory;
    return visibleHistory.filter((g) => selectedIds.includes(g.id));
  }, [visibleHistory, selectedIds]);
  const downloadScopeLabel =
    selectedIds.length > 0
      ? `Download selected (${selectedIds.length})`
      : `Download all (${visibleHistory.length})`;

  React.useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Drop the hover preview the moment the user enters a mode where it
  // would interfere (selection, compare-pick), or when the underlying tile
  // disappears from the visible page.
  React.useEffect(() => {
    if (selectionMode || isComparePicking) clearHoverPreview();
  }, [selectionMode, isComparePicking, clearHoverPreview]);

  React.useEffect(() => {
    if (!hoverPreview) return;
    const stillVisible = pagedVisibleHistory.some((g) => g.id === hoverPreview.id);
    if (!stillVisible) clearHoverPreview();
  }, [hoverPreview, pagedVisibleHistory, clearHoverPreview]);

  // The preview is anchored relative to the tile's captured rect, so any
  // scroll movement would leave it visually disconnected from the tile
  // that triggered it. Dismissing on scroll mirrors OS-level tooltips.
  React.useEffect(() => {
    if (!hoverPreview) return;
    const onScroll = () => clearHoverPreview();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [hoverPreview, clearHoverPreview]);

  React.useEffect(() => {
    return () => {
      Object.values(blobUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = {};
    };
  }, []);

  React.useEffect(() => {
    const activeIds = new Set(history.map((gen) => gen.id));
    const staleIds = Object.keys(blobUrlsRef.current).filter((id) => !activeIds.has(id));
    if (staleIds.length === 0) return;

    staleIds.forEach((id) => {
      URL.revokeObjectURL(blobUrlsRef.current[id]);
      delete blobUrlsRef.current[id];
    });

    setImageSrcById((prev) => {
      const next = { ...prev };
      staleIds.forEach((id) => delete next[id]);
      return next;
    });
  }, [history]);

  // Hide the entire gallery only when there are no tiles AND no user
  // folders beyond the auto-seeded Inbox. Once the user creates any folder
  // we keep rendering so they can manage it even before generating tiles.
  const hasUserFolders = folders.some((f) => f.id !== INBOX_FOLDER_ID);
  if (history.length === 0 && !hasUserFolders) return null;

  const getLabel = (id: string, list: any[]) => {
    const item = list.find(i => i.id === id || i.value === id);
    return item?.name || item?.label || id;
  };

  const getColors = (id: string) => {
    const palette = options.brandColors.find(c => c.id === id);
    if (!palette) return '';
    return `${palette.name}: ${palette.colors.join(', ')}`;
  };

  const buildFullPrompt = (gen: Generation) => {
    const cfg = gen.config;
    const typeLabel = getLabel(cfg.graphicTypeId, options.graphicTypes);
    const styleLabel = getLabel(cfg.visualStyleId, options.visualStyles);
    const styleDesc = options.visualStyles.find(s => s.id === cfg.visualStyleId)?.description || '';
    const colorsLabel = getColors(cfg.colorSchemeId);
    const colorsHex = options.brandColors.find(c => c.id === cfg.colorSchemeId)?.colors?.join(', ') || '';
    const aspectLabel = getLabel(cfg.aspectRatio, options.aspectRatios);
    const expanded = [
      `Generate a ${typeLabel}`,
      aspectLabel ? `at ${aspectLabel} aspect ratio` : '',
      styleLabel ? `in the ${styleLabel} style${styleDesc ? ` (${styleDesc})` : ''}` : '',
      colorsLabel ? `using palette ${colorsLabel}` : '',
      colorsHex ? `Use these exact hex colors: ${colorsHex}` : '',
      `Subject/Content: ${cfg.prompt}`
    ].filter(Boolean).join('. ');

    return [
      `Original Prompt: ${cfg.prompt}`,
      `Structured Prompt: ${expanded}`,
      `Type: ${typeLabel}`,
      `Style: ${styleLabel}${styleDesc ? ` (${styleDesc})` : ''}`,
      colorsLabel ? `Colors: ${colorsLabel}` : '',
      aspectLabel ? `Size: ${aspectLabel}` : ''
    ].filter(Boolean).join('\n');
  };

  const getModelLabel = (modelId?: string) => {
    if (modelId === 'openai-2') return 'GPT Image 2';
    if (modelId === 'openai-mini') return 'GPT Image Mini';
    if (modelId === 'openai') return 'GPT Image 1.5';
    if (modelId === 'gemini-svg') return 'Gemini SVG';
    if (modelId === 'gemini-3.1-flash-image-preview') return 'Nano Banana 2';
    return 'Nano Banana Pro';
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const rawH = d.getHours();
    const hh = String(rawH % 12 === 0 ? 12 : rawH % 12).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ampm = rawH >= 12 ? 'PM' : 'AM';
    return `${mm}-${dd} ${hh}:${mi} ${ampm}`;
  };

  const getDisplayImageUrl = (gen: Generation): string => {
    const latestVersion = getLatestVersion(gen);
    return imageSrcById[gen.id] || latestVersion.imageUrl;
  };

  const applyFallbackBlobUrl = (generationId: string, blobUrl: string) => {
    const previousBlobUrl = blobUrlsRef.current[generationId];
    if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl);
    blobUrlsRef.current[generationId] = blobUrl;
    setImageSrcById((prev) => ({ ...prev, [generationId]: blobUrl }));
  };

  const handleImageLoadError = async (gen: Generation) => {
    const currentSource = imageSrcById[gen.id];
    if (currentSource?.startsWith('blob:')) return;

    const latestVersion = getLatestVersion(gen);

    // Path 1 — version still carries inline base64 (only true for fresh
    // generations that haven't been uploaded + stripped yet).
    const inlineBlobUrl = createBlobUrlFromImage({
      imageUrl: latestVersion.imageUrl,
      base64Data: latestVersion.imageData,
      mimeType: latestVersion.mimeType
    });
    if (inlineBlobUrl) {
      applyFallbackBlobUrl(gen.id, inlineBlobUrl);
      return;
    }

    // Path 2 — every other case (history loaded from Firestore, where the
    // bytes were stripped on upload). Look in IndexedDB. This is the path
    // that recovers thumbnails when the network blocks Firebase Storage.
    if (!latestVersion.id) return;
    try {
      const cachedBlobUrl = await getCachedImageBlobUrl(gen.id, latestVersion.id);
      if (!cachedBlobUrl) return;
      // Re-check we didn't already swap to a blob while waiting on IDB.
      if (blobUrlsRef.current[gen.id]) {
        URL.revokeObjectURL(cachedBlobUrl);
        return;
      }
      applyFallbackBlobUrl(gen.id, cachedBlobUrl);
    } catch (error) {
      console.warn('[RecentGenerations] Failed to load cached blob URL:', error);
    }
  };

  // Folder picker — trigger + collapsible tree dropdown. Row actions live in
  // a hamburger menu; chevrons expand/collapse branches; right-click adds a
  // subfolder under the clicked folder.
  const renderFolderPicker = () => {
    const activeFolder =
      folders.find((f) => f.id === viewFolderId) ??
      folders.find((f) => f.id === INBOX_FOLDER_ID) ??
      folders[0];
    const activeName = activeFolder?.name ?? 'Inbox';
    const activeCount = activeFolder
      ? folderCounts.get(activeFolder.id) || 0
      : 0;

    const handleSelectFolder = (folderId: string) => {
      void onGalleryViewFolderChange(folderId);
      setIsFolderPickerOpen(false);
      setRenamingFolderId(null);
      setRenameDraft('');
      setIsCreatingFolder(false);
      setNewFolderDraft('');
    };

    return (
      <div
        className="relative"
        ref={folderPickerRef}
        data-folder-menu
      >
        <button
          type="button"
          onClick={() => setIsFolderPickerOpen((open) => !open)}
          aria-haspopup="listbox"
          aria-expanded={isFolderPickerOpen}
          aria-label={`Folder: ${activeName}, ${activeCount} item${activeCount === 1 ? '' : 's'}. Click to switch folders.`}
          className="inline-flex items-center gap-2 pl-2.5 pr-2 py-1.5 min-h-9 rounded-full border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal transition"
        >
          <FolderIcon size={14} aria-hidden />
          <span className="truncate max-w-[14rem] sm:max-w-[18rem]">{activeName}</span>
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold leading-none tabular-nums bg-gray-200 dark:bg-[#30363d] text-slate-600 dark:text-slate-300">
            {activeCount}
          </span>
          <ChevronDown
            size={14}
            aria-hidden
            className={`text-slate-400 transition-transform ${
              isFolderPickerOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isFolderPickerOpen &&
          folderPickerAnchor &&
          typeof document !== 'undefined' &&
          createPortal(
          <div
            role="listbox"
            aria-label="Switch folder"
            data-folder-menu
            className="fixed max-h-[min(70vh,480px)] overflow-y-auto rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-xl p-1"
            style={panelAnchorStyle(folderPickerAnchor, 352, 480)}
          >
            <div
              className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none rounded-md hover:bg-gray-50 dark:hover:bg-[#21262d]"
              onContextMenu={(e) => {
                e.preventDefault();
                setFolderActionsMenuId(null);
                setFolderContextMenu({
                  folderId: 'root',
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              Folders
            </div>
            {visibleFolderRows.map(({ folder, depth, hasChildren, isCollapsed }) => {
              const isViewing = folder.id === viewFolderId;
              const isInbox = folder.id === INBOX_FOLDER_ID;
              const count = folderCounts.get(folder.id) || 0;
              const isRenaming = renamingFolderId === folder.id;
              const showInsertBefore =
                folderDropIndicator?.folderId === folder.id &&
                folderDropIndicator.position === 'before';
              const showInsertAfter =
                folderDropIndicator?.folderId === folder.id &&
                folderDropIndicator.position === 'after';
              const isNestDropTarget =
                Boolean(draggingFolderId) &&
                dropTargetFolderId === folder.id &&
                !folderDropIndicator;
              const isTileDropTarget =
                Boolean(draggingTileId) && dropTargetFolderId === folder.id;
              const hasInstructions = Boolean(folder.customInstructions?.trim());
              const canDragFolder = !isInbox;
              const rowIndent = depth * 14;

              if (isRenaming) {
                return (
                  <form
                    key={folder.id}
                    className="flex items-center gap-1 px-2 py-1"
                    style={{ paddingLeft: `${8 + rowIndent}px` }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const next = renameDraft.trim();
                      if (!next) return;
                      try {
                        setFolderBusy(true);
                        await onRenameFolder(folder.id, next);
                        setRenamingFolderId(null);
                        setRenameDraft('');
                        showToast('Folder renamed');
                      } catch (err) {
                        console.error('Rename folder failed:', err);
                        showToast('Rename failed');
                      } finally {
                        setFolderBusy(false);
                      }
                    }}
                  >
                    <FolderIcon
                      size={14}
                      aria-hidden
                      className="text-brand-teal shrink-0"
                    />
                    <input
                      autoFocus
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setRenamingFolderId(null);
                          setRenameDraft('');
                        }
                      }}
                      className="flex-1 min-w-0 text-xs font-semibold bg-transparent border border-brand-teal rounded-md px-2 py-1 min-h-8 focus:outline-none focus:ring-2 focus:ring-brand-teal/40 text-slate-900 dark:text-slate-100"
                      aria-label={`Rename ${folder.name}`}
                      maxLength={60}
                    />
                    <button
                      type="submit"
                      disabled={folderBusy || !renameDraft.trim()}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-brand-teal hover:bg-brand-teal/10 disabled:opacity-50"
                      aria-label="Save folder name"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingFolderId(null);
                        setRenameDraft('');
                      }}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-500 hover:bg-gray-100 dark:hover:bg-[#21262d]"
                      aria-label="Cancel rename"
                    >
                      <XIcon size={14} />
                    </button>
                  </form>
                );
              }

              return (
                <div
                  key={folder.id}
                  {...folderDropHandlers(folder.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setFolderActionsMenuId(null);
                    setFolderContextMenu({
                      folderId: folder.id,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  className={`group relative flex items-center gap-0.5 rounded-md pr-1 py-0.5 ${
                    isTileDropTarget || isNestDropTarget
                      ? 'ring-2 ring-brand-teal/60 bg-brand-teal/5'
                      : isViewing
                        ? 'bg-brand-teal/10'
                        : 'hover:bg-gray-50 dark:hover:bg-[#21262d]'
                  }`}
                  style={{ paddingLeft: `${4 + rowIndent}px` }}
                >
                  {showInsertBefore && (
                    <div
                      className="absolute left-1 right-1 top-0 z-20 border-t-4 border-brand-teal pointer-events-none"
                      aria-hidden
                    />
                  )}
                  {showInsertAfter && (
                    <div
                      className="absolute left-1 right-1 bottom-0 z-20 border-b-4 border-brand-teal pointer-events-none"
                      aria-hidden
                    />
                  )}
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFolderCollapsed(folder.id);
                      }}
                      aria-label={
                        isCollapsed
                          ? `Expand ${folder.name}`
                          : `Collapse ${folder.name}`
                      }
                      aria-expanded={!isCollapsed}
                      className="inline-flex items-center justify-center h-8 w-5 shrink-0 rounded-md text-slate-400 hover:text-brand-teal hover:bg-gray-100 dark:hover:bg-[#21262d]"
                    >
                      <ChevronRight
                        size={14}
                        aria-hidden
                        className={`transition-transform duration-150 ${
                          isCollapsed ? '' : 'rotate-90'
                        }`}
                      />
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" aria-hidden />
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isViewing}
                    draggable={canDragFolder}
                    onDragStart={
                      canDragFolder
                        ? (e) => {
                            e.stopPropagation();
                            setDraggingFolderId(folder.id);
                            e.dataTransfer.setData(
                              'text/plain',
                              `folder:${folder.id}`
                            );
                            e.dataTransfer.effectAllowed = 'move';
                          }
                        : undefined
                    }
                    onDragEnd={
                      canDragFolder
                        ? () => {
                            setDraggingFolderId(null);
                            setDropTargetFolderId(null);
                            setFolderDropIndicator(null);
                          }
                        : undefined
                    }
                    onClick={() => handleSelectFolder(folder.id)}
                    className={`flex-1 min-w-0 inline-flex items-center gap-2 text-left py-1.5 pr-1 text-xs font-semibold rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal ${
                      canDragFolder
                        ? 'cursor-grab active:cursor-grabbing'
                        : ''
                    } ${
                      isViewing
                        ? 'text-brand-teal'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                    aria-label={
                      canDragFolder
                        ? `${folder.name}, ${count} items. Click to open. Drag to the top or bottom edge to reorder; drop on the middle to move inside.`
                        : `${folder.name}, ${count} items`
                    }
                  >
                    <FolderIcon size={14} aria-hidden className="shrink-0" />
                    <span className="flex-1 min-w-0 truncate" title={folder.name}>
                      {folder.name}
                    </span>
                    {hasInstructions && (
                      <FileText
                        size={12}
                        className="shrink-0 text-brand-teal"
                        aria-label="Has custom instructions"
                      />
                    )}
                    <span
                      className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold leading-none tabular-nums shrink-0 ${
                        isViewing
                          ? 'bg-brand-teal text-white'
                          : 'bg-gray-200 dark:bg-[#30363d] text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderContextMenu(null);
                        if (folderActionsMenuId === folder.id) {
                          setFolderActionsMenuId(null);
                          setFolderActionsMenuAnchor(null);
                        } else {
                          setFolderActionsMenuId(folder.id);
                          setFolderActionsMenuAnchor(
                            panelAnchorFromRect(
                              (e.currentTarget as HTMLElement).getBoundingClientRect(),
                              { align: 'end' }
                            )
                          );
                        }
                      }}
                      aria-haspopup="menu"
                      aria-expanded={folderActionsMenuId === folder.id}
                      aria-label={`Actions for ${folder.name}`}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-400 hover:text-brand-teal hover:bg-gray-100 dark:hover:bg-[#21262d] transition"
                    >
                      <MoreVertical size={14} aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}

            <div
              className="my-1 border-t border-gray-200 dark:border-[#30363d]"
              aria-hidden
            />

            {isCreatingFolder ? (
              <form
                className="flex items-center gap-1 px-2 py-1"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const next = newFolderDraft.trim();
                  if (!next) return;
                  try {
                    setFolderBusy(true);
                    const created = await onCreateFolder(next, createFolderParentId);
                    setIsCreatingFolder(false);
                    setCreateFolderParentId(undefined);
                    setNewFolderDraft('');
                    setIsFolderPickerOpen(false);
                    showToast(`Created ${created.name}`);
                  } catch (err) {
                    console.error('Create folder failed:', err);
                    showToast('Could not create folder');
                  } finally {
                    setFolderBusy(false);
                  }
                }}
              >
                <FolderPlus
                  size={14}
                  aria-hidden
                  className="text-brand-teal shrink-0"
                />
                <input
                  autoFocus
                  type="text"
                  value={newFolderDraft}
                  onChange={(e) => setNewFolderDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setIsCreatingFolder(false);
                      setCreateFolderParentId(undefined);
                      setNewFolderDraft('');
                    }
                  }}
                  placeholder={
                    createFolderParentId ? 'Subfolder name' : 'Folder name'
                  }
                  className="flex-1 min-w-0 text-xs font-semibold bg-transparent border border-brand-teal rounded-md px-2 py-1 min-h-8 focus:outline-none focus:ring-2 focus:ring-brand-teal/40 text-slate-900 dark:text-slate-100"
                  maxLength={60}
                />
                <button
                  type="submit"
                  disabled={folderBusy || !newFolderDraft.trim()}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-brand-teal hover:bg-brand-teal/10 disabled:opacity-50"
                  aria-label={
                    createFolderParentId ? 'Create subfolder' : 'Create folder'
                  }
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingFolder(false);
                    setCreateFolderParentId(undefined);
                    setNewFolderDraft('');
                  }}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-500 hover:bg-gray-100 dark:hover:bg-[#21262d]"
                  aria-label="Cancel"
                >
                  <XIcon size={14} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreateFolderParentId(undefined);
                  setIsCreatingFolder(true);
                  setNewFolderDraft('');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-brand-teal rounded-md hover:bg-brand-teal/10 transition"
              >
                <FolderPlus size={14} aria-hidden />
                New folder
              </button>
            )}
          </div>,
          document.body
        )}
      </div>
    );
  };

  const renderFolderRowActionsMenuPortal = () => {
    if (
      !folderActionsMenuId ||
      !folderActionsMenuAnchor ||
      typeof document === 'undefined'
    ) {
      return null;
    }
    const folder = folders.find((f) => f.id === folderActionsMenuId);
    if (!folder) return null;
    const isInbox = folder.id === INBOX_FOLDER_ID;
    const hasInstructions = Boolean(folder.customInstructions?.trim());

    return createPortal(
      <div
        ref={folderActionsMenuRef}
        role="menu"
        data-folder-menu
        className="fixed min-w-[11rem] py-1 rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-lg"
        style={panelAnchorStyle(folderActionsMenuAnchor, 176, 200)}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => openFolderInstructions(folder.id)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-gray-50 dark:hover:bg-[#21262d] ${
            hasInstructions
              ? 'text-brand-teal'
              : 'text-slate-700 dark:text-slate-200'
          }`}
        >
          <FileText size={14} className="shrink-0" />
          {hasInstructions ? 'Edit instructions' : 'Add instructions'}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => startRenameFolder(folder.id)}
          className={CONTEXT_MENU_ITEM}
        >
          <Pencil size={14} className="shrink-0 text-slate-400" />
          Rename
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => beginAddSubfolder(folder.id)}
          className={CONTEXT_MENU_ITEM}
        >
          <FolderPlus size={14} className="shrink-0 text-brand-teal" />
          Add subfolder
        </button>
        {!isInbox && (
          <button
            type="button"
            role="menuitem"
            onClick={() => promptDeleteFolder(folder.id)}
            className={CONTEXT_MENU_ITEM_DANGER}
          >
            <Trash2 size={14} className="shrink-0" />
            Delete
          </button>
        )}
      </div>,
      document.body
    );
  };

  const renderFolderContextMenuPortal = () => {
    if (!folderContextMenu || typeof document === 'undefined') return null;
    const pos = clampContextPoint({
      x: folderContextMenu.x,
      y: folderContextMenu.y,
    });
    const isRoot = folderContextMenu.folderId === 'root';
    const folder = isRoot
      ? null
      : folders.find((f) => f.id === folderContextMenu.folderId);
    const isInbox = folder?.id === INBOX_FOLDER_ID;
    const hasInstructions = Boolean(folder?.customInstructions?.trim());
    const isViewing = folder?.id === viewFolderId;

    return createPortal(
      <div
        role="menu"
        data-folder-menu
        className={CONTEXT_MENU_PANEL}
        style={{ left: pos.x, top: pos.y }}
      >
        {isRoot ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => beginCreateRootFolder()}
            className={CONTEXT_MENU_ITEM_ACCENT}
          >
            <FolderPlus size={14} className="shrink-0" />
            New folder
          </button>
        ) : (
          folder && (
            <>
              {!isViewing && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openFolderFromMenu(folder.id)}
                  className={CONTEXT_MENU_ITEM}
                >
                  <FolderIcon size={14} className="shrink-0 text-brand-teal" />
                  Open folder
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => beginAddSubfolder(folder.id)}
                className={CONTEXT_MENU_ITEM_ACCENT}
              >
                <FolderPlus size={14} className="shrink-0" />
                Add subfolder
              </button>
              <ContextMenuDivider />
              <button
                type="button"
                role="menuitem"
                onClick={() => openFolderInstructions(folder.id)}
                className={
                  hasInstructions ? CONTEXT_MENU_ITEM_ACCENT : CONTEXT_MENU_ITEM
                }
              >
                <FileText size={14} className="shrink-0" />
                {hasInstructions ? 'Edit instructions' : 'Add instructions'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => startRenameFolder(folder.id)}
                className={CONTEXT_MENU_ITEM}
              >
                <Pencil size={14} className="shrink-0 text-slate-400" />
                Rename
              </button>
              {!isInbox && (
                <>
                  <ContextMenuDivider />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => promptDeleteFolder(folder.id)}
                    className={CONTEXT_MENU_ITEM_DANGER}
                  >
                    <Trash2 size={14} className="shrink-0" />
                    Delete folder
                  </button>
                </>
              )}
            </>
          )
        )}
      </div>,
      document.body
    );
  };

  const renderTileContextMenuPortal = () => {
    if (!tileContextMenu || typeof document === 'undefined') return null;
    const gen = history.find((g) => g.id === tileContextMenu.generationId);
    if (!gen) return null;
    const latestVersion = getLatestVersion(gen);
    const isSelected = selectedIds.includes(gen.id);
    const downloadOptions = singleDownloadOptions(latestVersion);
    const pos = clampContextPoint(
      { x: tileContextMenu.x, y: tileContextMenu.y },
      tileContextMenu.view === 'move'
        ? { width: 240, height: 360 }
        : tileContextMenu.view === 'download'
          ? { width: 220, height: 56 + downloadOptions.length * 40 }
          : { width: 220, height: downloadOptions.length > 0 ? 320 : 280 }
    );

    if (tileContextMenu.view === 'download') {
      return createPortal(
        <div
          role="menu"
          aria-label="Download image"
          data-folder-menu
          className={CONTEXT_MENU_PANEL}
          style={{ left: pos.x, top: pos.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              setTileContextMenu((prev) =>
                prev ? { ...prev, view: 'main' } : prev
              )
            }
            className={CONTEXT_MENU_ITEM}
          >
            <ChevronLeft size={14} className="shrink-0" aria-hidden />
            Back
          </button>
          <ContextMenuDivider />
          {downloadOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitem"
              disabled={tileDownloadBusy}
              onClick={() => void downloadTileFormat(gen, opt.id)}
              className={CONTEXT_MENU_ITEM}
            >
              <Download size={14} className="shrink-0 text-slate-400" />
              <span className="truncate flex-1">{opt.label}</span>
              {opt.description && (
                <span className="text-[10px] text-slate-400 shrink-0">{opt.description}</span>
              )}
            </button>
          ))}
        </div>,
        document.body
      );
    }

    if (tileContextMenu.view === 'move') {
      return createPortal(
        <div
          role="menu"
          aria-label="Move to folder"
          data-folder-menu
          className={CONTEXT_MENU_PANEL}
          style={{ left: pos.x, top: pos.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              setTileContextMenu((prev) =>
                prev ? { ...prev, view: 'main' } : prev
              )
            }
            className={CONTEXT_MENU_ITEM}
          >
            <ChevronLeft size={14} className="shrink-0" aria-hidden />
            Back
          </button>
          <ContextMenuDivider />
          {visibleFolderRows.map(({ folder, depth }) => {
            const inFolder = (gen.folderId || INBOX_FOLDER_ID) === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                role="menuitem"
                disabled={inFolder || folderBusy}
                onClick={() => void moveTileToFolder(gen.id, folder.id)}
                className={CONTEXT_MENU_ITEM}
                style={{ paddingLeft: `${12 + depth * 12}px` }}
              >
                <FolderIcon size={14} className="shrink-0 text-slate-400" />
                <span className="truncate flex-1">{folder.name}</span>
                {inFolder && (
                  <span className="text-[10px] text-slate-400 shrink-0">here</span>
                )}
              </button>
            );
          })}
        </div>,
        document.body
      );
    }

    return createPortal(
      <div
        role="menu"
        data-folder-menu
        className={CONTEXT_MENU_PANEL}
        style={{ left: pos.x, top: pos.y }}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onSelect(gen);
            showToast('Restored');
            closeAllContextMenus();
          }}
          className={CONTEXT_MENU_ITEM}
        >
          <ArrowUpRight size={14} className="shrink-0" />
          Open in preview
        </button>
        {downloadOptions.length > 0 && (
          <button
            type="button"
            role="menuitem"
            disabled={tileDownloadBusy}
            onClick={() =>
              setTileContextMenu((prev) =>
                prev ? { ...prev, view: 'download' } : prev
              )
            }
            className={CONTEXT_MENU_ITEM}
          >
            <Download size={14} className="shrink-0" />
            Download image…
          </button>
        )}
        {!selectionMode && !isComparePicking && onPickMark && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onPickMark({
                generationId: gen.id,
                versionId: latestVersion.id,
                imageUrl: getDisplayImageUrl(gen),
                mimeType: latestVersion.mimeType,
                modelId: latestVersion.modelId || gen.modelId,
                markLabel: latestVersion.label,
                aspectRatio:
                  latestVersion.aspectRatio || gen.config.aspectRatio,
              });
              closeAllContextMenus();
            }}
            className={CONTEXT_MENU_ITEM}
          >
            <GitCompare size={14} className="shrink-0" />
            Pick for compare
          </button>
        )}
        <ContextMenuDivider />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            if (!selectionMode) setSelectionMode(true);
            toggleSelect(gen.id);
            closeAllContextMenus();
          }}
          className={CONTEXT_MENU_ITEM}
        >
          {isSelected ? (
            <CheckSquare size={14} className="shrink-0 text-brand-teal" />
          ) : (
            <Square size={14} className="shrink-0" />
          )}
          {isSelected ? 'Deselect' : 'Select'}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            setTileContextMenu((prev) =>
              prev ? { ...prev, view: 'move' } : prev
            )
          }
          disabled={folderBusy}
          className={CONTEXT_MENU_ITEM}
        >
          <FolderInput size={14} className="shrink-0" />
          Move to folder…
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => void copyGenerationPrompt(gen)}
          className={CONTEXT_MENU_ITEM}
        >
          <ClipboardCopy size={14} className="shrink-0" />
          Copy prompt
        </button>
        <ContextMenuDivider />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onDelete(gen.id);
            showToast('Deleting…');
            closeAllContextMenus();
          }}
          className={CONTEXT_MENU_ITEM_DANGER}
        >
          <Trash2 size={14} className="shrink-0" />
          Delete
        </button>
      </div>,
      document.body
    );
  };

  return (
    <div className={`w-full max-w-7xl mx-auto px-4 md:px-6 pb-8 ${toolbarCollapsed ? 'pt-0' : 'pt-8'} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150 ${hasPreviewAbove && !toolbarCollapsed ? 'border-t border-gray-200 dark:border-[#30363d] mt-8' : ''}`}>
      {/* Single-line header. The folder picker is the section's identity
          (it already shows the active folder name + count + pin state), so
          the prior Clock + "RECENT" heading was redundant chrome. When the
          folder is large enough to paginate, the range indicator + page nav
          slot inline next to the folder picker; otherwise that block stays
          collapsed and the header is just `folder | actions`. The outer
          `flex-wrap` lets the left cluster and right toolbar wrap onto two
          rows naturally at narrow widths without forcing a fixed mobile
          breakpoint. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-4">
        <div className="flex flex-wrap items-center gap-2 min-w-0 text-slate-500 dark:text-slate-400">
          {/* Folder picker — combines the prior "Inbox" chip and "(N items in
              folder)" text into one dropdown. The trigger surfaces the active
              view's name + count; the menu lists every
              folder with inline pin/rename/delete actions and a "+ New
              folder" affordance at the bottom. The wrapping container sets
              `position: relative` so the absolutely-positioned menu anchors
              under the trigger, and `data-folder-menu` keeps the global
              outside-click handler from closing the menu when the user
              interacts with anything inside it (rename input, etc). */}
          {renderFolderPicker()}
          {/* Compact pagination cluster — `[‹] [1/2 ▾] [›]`. The "1/2 ▾"
              button opens a popover that combines page-jump chips with
              per-page sizing chips and footnotes the visible range, so we
              no longer need a standalone "1–50 / 51" caption *or* a wide
              "50 / page" dropdown that wrapped to two lines. Prev/next
              stay as direct buttons (most common action), and every
              control carries a hover/focus tooltip describing what it
              does. The outer `data-folder-menu` marker hooks into the
              shared outside-click effect so the popover dismisses
              cleanly. */}
          {galleryPaginationEnabled && visibleHistory.length > 0 && (
            <div
              className="relative flex items-center gap-1"
              role="navigation"
              aria-label="Gallery pages"
              data-folder-menu
            >
              {/* Rich tooltip mirrors the carousel-arrow style on the main
                  preview (`ImageDisplay.tsx`): uppercase title + one-line
                  description, anchored to the wrapper rather than to the
                  button itself. Anchoring on the wrapper matters because
                  `disabled:pointer-events-none` on the button suppresses
                  `:hover` on the button when it's at an edge state — keeping
                  the tooltip as a sibling under a parent group means the
                  "Already on the first page" message still appears as the
                  user hovers the disabled arrow. */}
              <div className="relative group/tip-prev">
                <button
                  type="button"
                  onClick={() => setGalleryPage((p) => Math.max(1, p - 1))}
                  disabled={galleryPage <= 1}
                  aria-label="Previous page"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal disabled:opacity-40 disabled:pointer-events-none"
                >
                  <ChevronLeft size={18} aria-hidden />
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 left-0 w-56 px-3 py-2.5 rounded-xl bg-black/90 text-white shadow-xl opacity-0 group-hover/tip-prev:opacity-100 group-focus-within/tip-prev:opacity-100 transition-opacity z-30"
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Previous page</div>
                  <div className="text-[11px] leading-relaxed text-slate-100">
                    {galleryPage <= 1 ? 'Already on the first page.' : 'Page back through this folder.'}
                  </div>
                </div>
              </div>
              <button
                ref={pageMenuTriggerRef}
                type="button"
                onClick={() => setPageMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={pageMenuOpen}
                aria-label={`Page ${galleryPage} of ${galleryTotalPages}. Open page and per-page options.`}
                className="group/tip-pages relative inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] px-2 text-slate-700 dark:text-slate-200 hover:border-brand-teal transition"
              >
                <span className="text-xs font-medium tabular-nums">
                  {galleryPage}<span className="text-slate-400 dark:text-slate-500"> / </span>{galleryTotalPages}
                </span>
                <ChevronDown size={14} aria-hidden className="text-slate-400 dark:text-slate-500" />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-pages:opacity-100 group-focus-visible/tip-pages:opacity-100 transition-opacity z-20"
                >
                  Jump to page or change per-page
                </span>
              </button>
              <div className="relative group/tip-next">
                <button
                  type="button"
                  onClick={() => setGalleryPage((p) => Math.min(galleryTotalPages, p + 1))}
                  disabled={galleryPage >= galleryTotalPages}
                  aria-label="Next page"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal disabled:opacity-40 disabled:pointer-events-none"
                >
                  <ChevronRight size={18} aria-hidden />
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 right-0 w-56 px-3 py-2.5 rounded-xl bg-black/90 text-white shadow-xl opacity-0 group-hover/tip-next:opacity-100 group-focus-within/tip-next:opacity-100 transition-opacity z-30"
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Next page</div>
                  <div className="text-[11px] leading-relaxed text-slate-100">
                    {galleryPage >= galleryTotalPages ? 'Already on the last page.' : 'Page forward through this folder.'}
                  </div>
                </div>
              </div>
              {pageMenuOpen &&
                pageMenuAnchor &&
                typeof document !== 'undefined' &&
                createPortal(
                <div
                  role="menu"
                  className="fixed min-w-[16rem] max-w-[20rem] rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-lg p-3"
                  data-folder-menu
                  style={panelAnchorStyle(pageMenuAnchor, 320, 400)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Page jump chips. Wraps freely so even very large
                      folders (e.g. 40 pages at 25 per page) stay
                      navigable inside the popover. */}
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
                      Jump to page
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: galleryTotalPages }, (_, i) => i + 1).map((pageNum) => {
                        const isActive = pageNum === galleryPage;
                        return (
                          <button
                            key={pageNum}
                            type="button"
                            role="menuitemradio"
                            aria-checked={isActive}
                            onClick={() => {
                              setGalleryPage(pageNum);
                              setPageMenuOpen(false);
                            }}
                            className={`min-w-9 px-2 py-1 rounded-md text-xs font-medium tabular-nums transition ${
                              isActive
                                ? 'bg-brand-teal text-white border border-brand-teal'
                                : 'border border-gray-200 dark:border-[#30363d] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Per-page selector — chips instead of a nested
                      dropdown so users can pick a size in one click and
                      we save vertical space. */}
                  <div className="mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
                      Per page
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {[25, 50, 100, 200].map((size) => {
                        const isActive = size === galleryPageSize;
                        return (
                          <button
                            key={size}
                            type="button"
                            role="menuitemradio"
                            aria-checked={isActive}
                            onClick={() => {
                              setGalleryPageSize(size);
                              setGalleryPage(1);
                              setPageMenuOpen(false);
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium tabular-nums transition ${
                              isActive
                                ? 'bg-brand-teal text-white border border-brand-teal'
                                : 'border border-gray-200 dark:border-[#30363d] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal'
                            }`}
                          >
                            {size}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Visible-range footnote — replaces the prior inline
                      "1–50 / 51" caption that used to live in the header
                      row. Surfacing it here keeps the data without
                      cluttering the chrome. */}
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums border-t border-gray-100 dark:border-[#30363d] pt-2">
                    Showing {galleryRangeStart}–{galleryRangeEnd} of {visibleHistory.length}
                    {history.length !== visibleHistory.length ? ` · ${history.length} total in history` : ''}
                  </p>
                </div>,
                document.body
              )}
            </div>
          )}
          {selectionMode && selectedIds.length > 0 && (
            <span className="text-xs font-semibold text-brand-teal" aria-live="polite">
              {selectedIds.length} selected
            </span>
          )}
        </div>
        {/* Toolbar — `flex-nowrap` so action buttons never break onto a
            second row. Buttons are fully icon-only at every breakpoint;
            each one renders the dark `bg-black/90` floating tooltip used
            elsewhere in the app (see `ControlPanel` Reset / Upload brand)
            so the meaning is still discoverable on hover or keyboard
            focus. Going icon-only at all widths frees ~150px the gallery
            heading + selection counter need on the left. The DownloadMenu
            count is folded into its tooltip text — the leading "X selected"
            indicator already exposes the same number visibly. Tooltips
            sit *below* the button (`top-full mt-2`) so they don't get
            clipped by the sticky control panel that floats above the
            gallery. Every button uses a distinct named group
            (`group/tip-<id>`) so a single hovered button never lights up
            siblings. */}
        <div className="flex flex-nowrap items-center gap-1.5">
          {selectionMode ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedIds(visibleHistory.map((g) => g.id))}
                aria-label="Select all items in this folder"
                className="group/tip-selectall relative inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal transition shrink-0"
              >
                <CheckSquare size={16} aria-hidden />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-selectall:opacity-100 group-focus-visible/tip-selectall:opacity-100 transition-opacity z-20"
                >
                  Select all
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                aria-label="Clear current selection"
                className="group/tip-clear relative inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal transition shrink-0"
              >
                <Square size={16} aria-hidden />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-clear:opacity-100 group-focus-visible/tip-clear:opacity-100 transition-opacity z-20"
                >
                  Clear selection
                </span>
              </button>
              <DownloadMenu
                mode="all-only"
                allGenerations={downloadScope}
                allLabel={downloadScopeLabel}
                triggerTitle={downloadScopeLabel}
                triggerTooltip={downloadScopeLabel}
                // Hide the visible label on the trigger; the count still
                // shows on the left ("X selected") and inside the open
                // dropdown's section header. Without this, the menu's own
                // fallback would render `allLabel` as a visible span.
                triggerLabelClassName="hidden"
                icon={<Archive size={16} aria-hidden />}
                triggerClassName="inline-flex items-center justify-center gap-1 text-xs font-semibold px-3 py-2 min-h-11 rounded-lg bg-brand-teal text-white hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none transition shrink-0"
                disabled={downloadScope.length === 0}
                onNotify={showToast}
                align="right"
              />
              <div className="relative shrink-0" data-folder-menu ref={moveMenuTriggerRef}>
                <button
                  type="button"
                  onClick={() => setMoveMenuOpen((prev) => !prev)}
                  disabled={selectedIds.length === 0 || folderBusy}
                  aria-haspopup="menu"
                  aria-expanded={moveMenuOpen}
                  aria-label="Move selected items to a folder"
                  className="group/tip-move relative inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal transition disabled:opacity-50 disabled:pointer-events-none"
                >
                  <FolderInput size={16} aria-hidden />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-move:opacity-100 group-focus-visible/tip-move:opacity-100 transition-opacity z-20"
                  >
                    Move to folder
                  </span>
                </button>
                {moveMenuOpen &&
                  moveMenuAnchor &&
                  typeof document !== 'undefined' &&
                  createPortal(
                  <div
                    role="menu"
                    data-folder-menu
                    className="fixed min-w-[200px] max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-lg p-1"
                    style={panelAnchorStyle(moveMenuAnchor, 200, 288)}
                  >
                    {visibleFolderRows.map(({ folder, depth }) => {
                      const isHighlighted = folder.id === viewFolderId;
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          role="menuitem"
                          {...folderDropHandlers(folder.id)}
                          onClick={async () => {
                            setMoveMenuOpen(false);
                            if (selectedIds.length === 0) return;
                            // Snapshot the IDs so the in-flight set is
                            // stable even if `selectedIds` mutates during
                            // the await (it doesn't today, but this is
                            // cheap insurance).
                            const idsToMove = [...selectedIds];
                            const total = idsToMove.length;
                            setMoveProgress({
                              ids: new Set(idsToMove),
                              folderName: folder.name,
                              total,
                            });
                            try {
                              setFolderBusy(true);
                              await onMoveToFolder(idsToMove, folder.id);
                              showToast(
                                `Moved ${total} item${total === 1 ? '' : 's'} to ${folder.name}`
                              );
                              setSelectedIds([]);
                            } catch (err) {
                              console.error('Move to folder failed:', err);
                              showToast('Move failed');
                            } finally {
                              setFolderBusy(false);
                              setMoveProgress(null);
                            }
                          }}
                          className={`w-full flex items-center gap-2 py-2 text-left text-xs rounded-md transition ${
                            dropTargetFolderId === folder.id
                              ? 'ring-2 ring-brand-teal/50 bg-brand-teal/5'
                              : isHighlighted
                                ? 'bg-brand-teal/10 text-brand-teal font-semibold'
                                : 'text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d]'
                          }`}
                          style={{ paddingLeft: `${12 + depth * 12}px`, paddingRight: '12px' }}
                        >
                          <FolderIcon size={14} aria-hidden />
                          <span className="truncate flex-1">{folder.name}</span>
                          <span className="text-[10px] text-slate-400">
                            {folderCounts.get(folder.id) || 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>,
                  document.body
                )}
              </div>
              {/* Bulk delete — destructive action so it follows the same
                  double-tap-to-confirm pattern used elsewhere (per-version
                  rail delete in ImageDisplay, preset delete in
                  ControlPanel). First click arms (amber + Check icon +
                  pulse + tooltip swaps to "Click again to delete N"),
                  second click within ~3s fires `onDelete` for each
                  selected id. Disabled when nothing is selected. The
                  trash icon is intentionally red on the idle state so
                  it's visually distinct from the neutral folder/select
                  buttons next to it. */}
              {(() => {
                const isArmed = bulkDelete.isArmed('delete-selected');
                const disabled = selectedIds.length === 0 || bulkDeleting;
                return (
                  <button
                    type="button"
                    onClick={() => bulkDelete.trigger('delete-selected')}
                    disabled={disabled}
                    aria-label={
                      isArmed
                        ? `Click again to delete ${selectedIds.length} selected item${selectedIds.length === 1 ? '' : 's'}`
                        : 'Delete selected items'
                    }
                    className={`group/tip-bulkdelete relative inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-lg border transition shrink-0 disabled:opacity-50 disabled:pointer-events-none ${
                      isArmed
                        ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400 animate-pulse'
                        : 'border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-red-600 dark:text-red-400 hover:border-red-500 hover:bg-red-500/5'
                    }`}
                  >
                    {isArmed ? (
                      <Check size={16} strokeWidth={3} aria-hidden />
                    ) : (
                      <Trash2 size={16} aria-hidden />
                    )}
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-bulkdelete:opacity-100 group-focus-visible/tip-bulkdelete:opacity-100 transition-opacity z-20"
                    >
                      {isArmed
                        ? `Click again to delete ${selectedIds.length}`
                        : selectedIds.length === 0
                          ? 'Delete selected'
                          : `Delete ${selectedIds.length} selected`}
                    </span>
                  </button>
                );
              })()}
              <button
                type="button"
                onClick={exitSelectionMode}
                aria-label="Exit selection mode"
                className="group/tip-cancel relative inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-slate-500 transition shrink-0"
              >
                <XIcon size={16} aria-hidden />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-cancel:opacity-100 group-focus-visible/tip-cancel:opacity-100 transition-opacity z-20"
                >
                  Exit selection mode
                </span>
              </button>
            </>
          ) : (
            <>
              {/* Thumbnail-size selector — icon-only by default to match the
                  other icon buttons in this row. The current value name
                  (Tiny / Small / Medium / Large) only appears at xl+ where
                  there's plenty of horizontal room; below that the
                  LayoutGrid icon plus chevron are enough to signal a size
                  picker, and the open menu still surfaces the active
                  selection clearly. */}
              <div className="w-auto xl:w-32 shrink-0">
                <RichSelect
                  value={thumbnailSize}
                  onChange={(value) => setThumbnailSize(value as ThumbnailSize)}
                  options={THUMBNAIL_SIZE_OPTIONS}
                  placeholder="Size"
                  icon={LayoutGrid}
                  compact
                  buttonClassName="rounded-lg min-h-11"
                  menuClassName="max-w-[16rem] z-[40]"
                  triggerLabelClassName="hidden xl:inline"
                />
              </div>
              <GalleryPresetMenu
                presets={galleryPresets}
                presetSource={galleryPresetSource}
                onPresetSourceChange={(source) => {
                  void onGalleryPresetSourceChange(source);
                }}
                currentSnapshot={galleryToolbarPresetSnapshot}
                onApplyPreset={onApplyGalleryPreset}
                onSavePreset={onSaveGalleryPreset}
                onUpdatePreset={onUpdateGalleryPreset}
                onRenamePreset={onRenameGalleryPreset}
                onDeletePreset={onDeleteGalleryPreset}
                getPresetLabels={getPresetLabels}
                folderName={galleryFolderName}
              />
              <button
                type="button"
                onClick={() => openFolderInstructions(viewFolderId)}
                aria-label={
                  viewFolderEffectiveInstructions
                    ? 'Edit folder instructions'
                    : 'Add folder instructions'
                }
                className={`group/tip-instructions relative inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-lg border transition shrink-0 ${
                  viewFolderEffectiveInstructions
                    ? 'border-brand-teal bg-brand-teal/10 text-brand-teal'
                    : 'border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal'
                }`}
              >
                <FileText size={16} aria-hidden />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-instructions:opacity-100 group-focus-visible/tip-instructions:opacity-100 transition-opacity z-20"
                >
                  {viewFolderEffectiveInstructions ? 'Folder instructions' : 'Add instructions'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-pressed={showDetails}
                aria-label={showDetails ? 'Hide prompt and tag details under each thumbnail' : 'Show prompt and tag details under each thumbnail'}
                className={`group/tip-details relative inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-lg border transition shrink-0 ${
                  showDetails
                    ? 'border-brand-teal bg-brand-teal/10 text-brand-teal'
                    : 'border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal'
                }`}
              >
                {showDetails ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-details:opacity-100 group-focus-visible/tip-details:opacity-100 transition-opacity z-20"
                >
                  {showDetails ? 'Hide details' : 'Show details'}
                </span>
              </button>
              <DownloadMenu
                mode="all-only"
                allGenerations={visibleHistory}
                allLabel={`Download all (${visibleHistory.length})`}
                triggerTitle={`Download all (${visibleHistory.length}) in folder as ZIP`}
                triggerTooltip={`Download all (${visibleHistory.length}) in folder as ZIP`}
                // Hide the visible "Download all (N)" label on the trigger;
                // the gallery heading already shows the count next to the
                // folder name, and the open dropdown still surfaces it in
                // its section header. Without this, DownloadMenu's own
                // fallback would render `allLabel` as a visible span.
                triggerLabelClassName="hidden"
                icon={<Archive size={16} aria-hidden />}
                triggerClassName="inline-flex items-center justify-center gap-1 text-xs font-semibold px-3 py-2 min-h-11 rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal transition disabled:opacity-50 disabled:pointer-events-none shrink-0"
                disabled={visibleHistory.length === 0}
                onNotify={showToast}
                align="right"
              />
              <button
                type="button"
                onClick={() => setSelectionMode(true)}
                aria-label="Select items to move, export, or delete in bulk"
                className="group/tip-select relative inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal transition shrink-0"
              >
                <CheckSquare size={16} aria-hidden />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-select:opacity-100 group-focus-visible/tip-select:opacity-100 transition-opacity z-20"
                >
                  Select items
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Folder tab strip removed — replaced by the inline folder-picker
          dropdown rendered above by `renderFolderPicker`. The dropdown is
          denser (one trigger vs. a horizontally-scrollable rail of chips),
          persists the chosen view via localStorage so reloads return to
          the user's last folder, and keeps every per-folder action
          (pin/rename/delete + create) colocated in one menu. */}

      {/* Pagination row removed — its controls now live inline in the
          header above (next to the folder picker), and the "Large folders
          are split into pages so the grid stays responsive" helper text
          was dropped because the page-nav controls themselves make the
          behavior self-evident. */}

      {viewFolderEffectiveInstructions.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 px-1 leading-relaxed">
          <span className="font-semibold text-slate-600 dark:text-slate-300">Folder instructions</span>
          {' '}(applied to generations and refinements in this folder):{' '}
          <span className="italic">{viewFolderEffectiveInstructions.slice(0, 160)}{viewFolderEffectiveInstructions.length > 160 ? '…' : ''}</span>
        </p>
      )}

      {childFoldersInView.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-4">
          {childFoldersInView.map((sub) => {
            const subCount = folderCounts.get(sub.id) || 0;
            const subInsertBefore =
              folderDropIndicator?.folderId === sub.id &&
              folderDropIndicator.position === 'before';
            const subInsertAfter =
              folderDropIndicator?.folderId === sub.id &&
              folderDropIndicator.position === 'after';
            const isSubNestDrop =
              Boolean(draggingFolderId) &&
              dropTargetFolderId === sub.id &&
              !folderDropIndicator;
            const isSubTileDrop =
              Boolean(draggingTileId) && dropTargetFolderId === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                {...folderDropHandlers(sub.id)}
                draggable={sub.id !== INBOX_FOLDER_ID}
                onDragStart={(e) => {
                  if (sub.id === INBOX_FOLDER_ID) return;
                  e.stopPropagation();
                  setDraggingFolderId(sub.id);
                  e.dataTransfer.setData('text/plain', `folder:${sub.id}`);
                }}
                onDragEnd={() => {
                  setDraggingFolderId(null);
                  setDropTargetFolderId(null);
                  setFolderDropIndicator(null);
                }}
                onClick={() => void onGalleryViewFolderChange(sub.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setFolderActionsMenuId(null);
                  setTileContextMenu(null);
                  setFolderContextMenu({
                    folderId: sub.id,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                className={`relative flex items-center gap-2 p-3 min-h-11 rounded-xl border text-left transition ${
                  isSubTileDrop || isSubNestDrop
                    ? 'border-brand-teal ring-2 ring-brand-teal/40 bg-brand-teal/5'
                    : 'border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] hover:border-brand-teal'
                }`}
              >
                {subInsertBefore && (
                  <div
                    className="absolute left-2 right-2 top-0 z-20 border-t-4 border-brand-teal pointer-events-none"
                    aria-hidden
                  />
                )}
                {subInsertAfter && (
                  <div
                    className="absolute left-2 right-2 bottom-0 z-20 border-b-4 border-brand-teal pointer-events-none"
                    aria-hidden
                  />
                )}
                <FolderIcon size={18} className="text-brand-teal shrink-0" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {sub.name}
                  </span>
                  <span className="text-[10px] text-slate-400">{subCount} item{subCount === 1 ? '' : 's'}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {visibleHistory.length === 0 && childFoldersInView.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-500 dark:text-slate-400 border border-dashed border-gray-300 dark:border-[#30363d] rounded-xl mb-4">
          This folder is empty.
          {viewFolderId === galleryViewFolderId
            ? ' New generations will land here while this folder is open.'
            : ' Move tiles in from another folder, or open this folder before generating.'}
        </div>
      )}

      <div className={THUMBNAIL_GRID_CLASS[thumbnailSize]}>
        {pagedVisibleHistory.map((gen) => {
          const latestVersion = getLatestVersion(gen);
          const versionCount = gen.versions.length;
          const batchId = gen.comparisonBatchId;
          // New behavior: a comparison tile keeps every model's marks inside
          // itself, so we detect "compare" by counting distinct per-version
          // models within the tile. Legacy behavior (one tile per model with a
          // shared batchId) is still handled below as a fallback so old
          // history items keep their badge. Use full history for sibling
          // counts so a comparison group spread across folders still reads
          // correctly.
          const distinctTileModelIds = Array.from(
            new Set(gen.versions.map((v) => v.modelId).filter(Boolean) as string[])
          );
          const isInTileComparison = distinctTileModelIds.length > 1;
          const legacyBatchSiblings = batchId
            ? history.filter((g) => g.comparisonBatchId === batchId).length
            : 0;
          const showCompareBadge = isInTileComparison || legacyBatchSiblings > 1;
          const compareCount = isInTileComparison
            ? distinctTileModelIds.length
            : legacyBatchSiblings;
          const compareLabel = isInTileComparison
            ? `${compareCount} models`
            : `${compareCount}`;
          const isPickedSide: 'A' | 'B' | null =
            pickedMarkIds?.a && pickedMarkIds.a === `${gen.id}|${latestVersion.id}` ? 'A' :
            pickedMarkIds?.b && pickedMarkIds.b === `${gen.id}|${latestVersion.id}` ? 'B' : null;
          // Match the tile against whatever generation the main ImageDisplay
          // is currently rendering. Compare-pick and multi-select still win
          // visually because they're explicit user actions; the active-tile
          // ring is the ambient "you are here" cue when neither of those
          // modes is engaged.
          const isActiveTile = !!activeGenerationId && activeGenerationId === gen.id;
          const isMoving = !!moveProgress && moveProgress.ids.has(gen.id);

          return (
            <div 
              key={gen.id}
              draggable={!selectionMode && !isComparePicking}
              onDragStart={(e) => {
                if (selectionMode || isComparePicking) return;
                setDraggingTileId(gen.id);
                e.dataTransfer.setData('text/plain', `tile:${gen.id}`);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDraggingTileId(null)}
              className={`group relative bg-white dark:bg-[#161b22] border rounded-xl overflow-visible shadow-sm hover:shadow-lg transition-all ${
                isPickedSide
                  ? 'border-amber-400 ring-2 ring-amber-400/40'
                  : selectionMode && selectedIds.includes(gen.id)
                    ? 'border-brand-teal ring-2 ring-brand-teal/50 dark:ring-brand-teal/40'
                    : isActiveTile
                      ? 'border-brand-red ring-2 ring-brand-red/50 dark:ring-brand-red/40 shadow-md'
                      : 'border-gray-200 dark:border-[#30363d] hover:border-brand-teal dark:hover:border-brand-teal'
              } ${isMoving ? 'opacity-60 animate-pulse pointer-events-none' : ''}`}
              data-comparison-batch={batchId || undefined}
              data-active-tile={isActiveTile ? 'true' : undefined}
              aria-current={isActiveTile ? 'true' : undefined}
              onMouseEnter={(e) => scheduleHoverPreview(gen.id, e.currentTarget)}
              onMouseLeave={clearHoverPreview}
              onContextMenu={(e) => {
                e.preventDefault();
                clearHoverPreview();
                setFolderContextMenu(null);
                setFolderActionsMenuId(null);
                setTileContextMenu({
                  generationId: gen.id,
                  x: e.clientX,
                  y: e.clientY,
                  view: 'main',
                });
              }}
            >
              {selectionMode && (
                <div className="absolute top-2 left-2 z-20">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(gen.id);
                    }}
                    className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg border border-gray-300/80 dark:border-white/15 bg-white/95 dark:bg-[#1f252d]/95 text-slate-800 dark:text-slate-200 shadow-sm hover:bg-brand-teal hover:border-brand-teal hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-teal/70"
                    aria-pressed={selectedIds.includes(gen.id)}
                    aria-label={selectedIds.includes(gen.id) ? 'Deselect generation' : 'Select generation'}
                  >
                    {selectedIds.includes(gen.id) ? <CheckSquare size={20} /> : <Square size={20} />}
                  </button>
                </div>
              )}
              {showCompareBadge && (
                <div
                  className={`absolute z-10 top-2 ${selectionMode ? 'left-14' : 'left-2'}`}
                  title={
                    isInTileComparison
                      ? `Comparison tile — ${distinctTileModelIds.map((id) => getModelLabel(id)).join(' vs ')}`
                      : `Part of a comparison run with ${legacyBatchSiblings} tiles`
                  }
                >
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-teal/90 text-white shadow-sm">
                    <GitCompare size={10} />
                    Compare · {compareLabel}
                  </span>
                </div>
              )}
              {isPickedSide && (
                <div className="absolute top-2 right-2 z-20 pointer-events-none">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-[11px] font-bold text-slate-900 shadow">
                    {isPickedSide}
                  </span>
                </div>
              )}

              {/* Per-tile hover toolbar removed: every action (download,
                  copy, delete, etc.) is one click away once the user opens
                  the tile in the main preview, and the bulk-action header
                  above the grid already covers multi-select operations.
                  Keeping the thumbnails uncluttered makes the gallery read
                  as a clean image grid. */}

              <div className="aspect-square w-full relative bg-gray-100 dark:bg-[#0d1117] overflow-hidden rounded-xl">
                {latestVersion.mimeType === 'image/svg+xml' && latestVersion.svgCode ? (
                  <div
                    className="w-full h-full flex items-center justify-center p-2 [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto transition-transform duration-500 group-hover:scale-105"
                    dangerouslySetInnerHTML={{ __html: sanitizeSvg(latestVersion.svgCode) }}
                  />
                ) : (
                  <img 
                    src={getDisplayImageUrl(gen)} 
                    alt={gen.config.prompt} 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    onError={() => handleImageLoadError(gen)}
                  />
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    if (selectionMode) {
                      toggleSelect(gen.id);
                      return;
                    }
                    if (onPickMark && (event.shiftKey || isComparePicking)) {
                      event.preventDefault();
                      event.stopPropagation();
                      onPickMark({
                        generationId: gen.id,
                        versionId: latestVersion.id,
                        imageUrl: getDisplayImageUrl(gen),
                        mimeType: latestVersion.mimeType,
                        // Per-version model wins for mixed-model tiles so the
                        // slider labels the right side correctly.
                        modelId: latestVersion.modelId || gen.modelId,
                        markLabel: latestVersion.label,
                        aspectRatio: latestVersion.aspectRatio || gen.config.aspectRatio,
                      });
                      return;
                    }
                    onSelect(gen);
                    showToast('Restored');
                  }}
                  className={
                    selectionMode
                      // In selection mode the corner checkbox button + the
                      // teal ring on selected tiles already convey "select
                      // me" / "I'm selected" — adding an always-on dim
                      // overlay and a centered "Select"/"Selected" pill on
                      // top of that was visually busy (every tile in the
                      // grid showed the same pill at once). Keep the
                      // full-bleed click target so anywhere on the tile
                      // toggles selection, but drop the static dim and let
                      // hover give the confirmation cue.
                      ? 'absolute inset-0 bg-black/0 hover:bg-black/20 focus:bg-black/20 transition-colors'
                      : isComparePicking
                        ? 'absolute inset-0 bg-black/0 hover:bg-brand-teal/30 transition-colors flex items-center justify-center'
                        : 'absolute inset-0 bg-black/0 group-hover:bg-black/40 focus:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100'
                  }
                  aria-label={selectionMode ? 'Toggle selection' : isComparePicking ? 'Pick this tile to compare' : 'Restore generation'}
                >
                  {/* Pill is normal-mode only. In selection mode the
                      corner checkbox button is the canonical visible
                      affordance; rendering a duplicate "Select" pill
                      here just clutters the grid. */}
                  {!selectionMode && (
                    <span className="text-white font-medium flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md text-xs">
                      <ArrowUpRight size={14} /> Restore
                    </span>
                  )}
                </button>
              </div>

              {showDetails && (
                <div className="p-3 pt-4">
                  <p className="text-xs font-medium text-slate-900 dark:text-white line-clamp-2 mb-2 h-8 leading-relaxed">
                    {gen.config.prompt}
                  </p>

                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-gray-500/60 bg-[#11151d] text-slate-100">
                      {getLabel(gen.config.graphicTypeId, options.graphicTypes)}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-gray-500/60 bg-[#11151d] text-slate-100">
                      {getLabel(gen.config.visualStyleId, options.visualStyles)}
                    </span>
                    {isInTileComparison ? (
                      distinctTileModelIds.map((modelId) => (
                        <span
                          key={modelId}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-brand-teal/10 text-brand-teal border border-brand-teal/40"
                        >
                          {getModelLabel(modelId)}
                        </span>
                      ))
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-brand-teal/10 text-brand-teal border border-brand-teal/40">
                        {getModelLabel(gen.modelId)}
                      </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-gray-500/60 bg-[#11151d] text-slate-100">
                      {formatTimestamp(gen.createdAt)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {instructionsFolderId && (() => {
        const target = folders.find((f) => f.id === instructionsFolderId);
        if (!target) return null;
        const inherited = getEffectiveFolderInstructions(folders, target.id);
        const own = (target.customInstructions || '').trim();
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="folder-instructions-title"
              className="bg-white dark:bg-[#161b22] rounded-xl border border-gray-200 dark:border-[#30363d] shadow-2xl max-w-lg w-full p-5"
            >
              <h2 id="folder-instructions-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                Instructions — {target.name}
              </h2>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Merged with parent folder instructions, then applied to every generation and refinement in this folder.
              </p>
              {inherited && inherited !== own && (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 bg-gray-50 dark:bg-[#21262d] rounded-lg p-2">
                  <span className="font-semibold">Effective preview:</span> {inherited.slice(0, 280)}
                  {inherited.length > 280 ? '…' : ''}
                </p>
              )}
              <textarea
                value={instructionsDraft}
                onChange={(e) => setInstructionsDraft(e.target.value)}
                rows={6}
                maxLength={4000}
                placeholder="e.g. Always use brand teal, flat vector style, no photorealism…"
                className="mt-3 w-full text-sm rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#0d1117] px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-teal/50"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInstructionsFolderId(null);
                    setInstructionsDraft('');
                  }}
                  className="px-3 py-2 min-h-11 text-sm font-semibold rounded-lg border border-gray-300 dark:border-[#30363d] text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={folderBusy}
                  onClick={async () => {
                    try {
                      setFolderBusy(true);
                      await onSetFolderInstructions(instructionsFolderId, instructionsDraft);
                      setInstructionsFolderId(null);
                      setInstructionsDraft('');
                      showToast('Folder instructions saved');
                    } catch (err) {
                      console.error('Save folder instructions failed:', err);
                      showToast('Could not save instructions');
                    } finally {
                      setFolderBusy(false);
                    }
                  }}
                  className="px-3 py-2 min-h-11 text-sm font-semibold rounded-lg bg-brand-teal text-white hover:opacity-90 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Folder delete confirmation. Tiles inside the deleted folder are
          swept into Inbox by App.handleDeleteFolder before the folder
          itself is removed, so deletion never strands content. */}
      {pendingDeleteFolderId && (() => {
        const target = folders.find((f) => f.id === pendingDeleteFolderId);
        if (!target) return null;
        const subtree = getDescendantFolderIds(folders, pendingDeleteFolderId);
        subtree.add(pendingDeleteFolderId);
        const tilesInSubtree = history.filter((g) =>
          subtree.has(g.folderId || INBOX_FOLDER_ID)
        ).length;
        const directSubfolders = getChildFolders(folders, pendingDeleteFolderId).length;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div role="dialog" aria-modal="true" aria-labelledby="delete-folder-title" className="bg-white dark:bg-[#161b22] rounded-xl border border-gray-200 dark:border-[#30363d] shadow-2xl max-w-sm w-full p-5">
              <h2 id="delete-folder-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                Delete "{target.name}"?
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {tilesInSubtree > 0
                  ? `${tilesInSubtree} tile${tilesInSubtree === 1 ? '' : 's'} in this folder and subfolders will move to Inbox.`
                  : 'No tiles in this folder tree.'}
                {directSubfolders > 0
                  ? ` ${directSubfolders} subfolder${directSubfolders === 1 ? '' : 's'} will move up one level.`
                  : ''}
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDeleteFolderId(null)}
                  disabled={folderBusy}
                  className="text-xs font-semibold px-3 py-2 min-h-11 rounded-lg border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-slate-500 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setFolderBusy(true);
                      await onDeleteFolder(target.id);
                      setPendingDeleteFolderId(null);
                      showToast(`Deleted ${target.name}`);
                    } catch (err) {
                      console.error('Delete folder failed:', err);
                      showToast('Could not delete folder');
                    } finally {
                      setFolderBusy(false);
                    }
                  }}
                  disabled={folderBusy}
                  className="text-xs font-semibold px-3 py-2 min-h-11 rounded-lg bg-brand-red text-white hover:opacity-90 disabled:opacity-50 transition"
                >
                  Delete folder
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Folder kebab portal removed — rename / delete actions now live
          inline in each row of the folder-picker dropdown, so we no longer
          need the portal-based escape hatch that was working around the
          chip rail's overflow clipping. */}

      {/* Hover preview — a larger render of whichever tile the cursor is
          over. Rendered via a portal so it floats above the gallery grid
          and folder strip without being clipped by their overflow
          containers.

          Placement strategy: the preview prefers to sit DIRECTLY ABOVE
          the hovered tile (or below if the tile is near the top of the
          viewport) so the visual association between cursor and preview
          is immediate. The card is horizontally centered on the tile's
          column and clamped to the viewport. Side docking (right/left)
          is a last-resort fallback used only when neither vertical
          direction has enough room — for example a very-short viewport
          where the tile sits mid-screen with crowded grids above and
          below.

          Earlier the default was side docking, which on wide viewports
          looked correct horizontally but vertically-centered on the
          tile + viewport-clamped, leaving the preview pinned to the top
          edge of the screen far away from a tile in row 2 or 3 of the
          gallery. Preferring vertical placement keeps the preview
          attached to the tile no matter where it sits in the grid.

          Dimensions are capped (`MAX_WIDTH` / `MAX_HEIGHT`) so the
          preview reads as a generous tooltip rather than a half-screen
          panel. `pointer-events-none` keeps the underlying tile's hover
          toolbar and click target fully usable; `aria-hidden` keeps it
          out of the a11y tree (the source tile already exposes the same
          image via its `<img alt>` and the "Restore" button). */}
      {hoverPreview && (() => {
        const gen = pagedVisibleHistory.find((g) => g.id === hoverPreview.id);
        if (!gen) return null;
        const latestVersion = getLatestVersion(gen);
        const imageUrl = getDisplayImageUrl(gen);
        const modelLabel = getModelLabel(latestVersion.modelId || gen.modelId);

        // Tight gap so the preview reads as attached to the tile, plus
        // an extra viewport margin to keep the card from kissing the
        // screen edge when it's clamped.
        const gap = 10;
        const margin = 16;
        // Cap the preview's footprint so it always feels like a peek,
        // not a full takeover. The image will scale to fit inside.
        const MAX_WIDTH = 520;
        const MAX_HEIGHT = 420;
        // Below this we'd rather dock to the side than show a stunted
        // sliver of preview.
        const MIN_VERTICAL = 220;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const { rect } = hoverPreview;
        const spaceRight = Math.max(0, vw - rect.right - gap - margin);
        const spaceLeft = Math.max(0, rect.left - gap - margin);
        const spaceBelow = Math.max(0, vh - rect.bottom - gap - margin);
        const spaceAbove = Math.max(0, rect.top - gap - margin);
        const horizontalSpace = Math.max(spaceLeft, spaceRight);
        const verticalSpace = Math.max(spaceAbove, spaceBelow);
        // Default to vertical placement (above preferred, then below).
        // Side placement is only chosen when both vertical gutters are
        // too cramped AND a side gutter is meaningfully larger.
        const preferSide =
          verticalSpace < MIN_VERTICAL && horizontalSpace > verticalSpace;
        const placement: 'right' | 'left' | 'below' | 'above' = preferSide
          ? spaceRight >= spaceLeft
            ? 'right'
            : 'left'
          : spaceAbove >= spaceBelow
            ? 'above'
            : 'below';

        const style: React.CSSProperties = { position: 'fixed', zIndex: 60 };
        if (placement === 'right' || placement === 'left') {
          // Side dock — width fills the chosen gutter (capped) and the
          // card vertically tracks the tile's center so the eye doesn't
          // have to jump. Only reached when neither vertical direction
          // has enough room.
          const width = Math.min(
            MAX_WIDTH,
            placement === 'right' ? spaceRight : spaceLeft
          );
          const maxHeight = Math.min(MAX_HEIGHT, vh - margin * 2);
          style.width = `${width}px`;
          style.maxHeight = `${maxHeight}px`;
          if (placement === 'right') style.left = `${rect.right + gap}px`;
          else style.right = `${vw - rect.left + gap}px`;
          const tileCenterY = rect.top + rect.height / 2;
          const desiredTop = tileCenterY - maxHeight / 2;
          style.top = `${Math.max(margin, Math.min(desiredTop, vh - margin - maxHeight))}px`;
        } else {
          // Vertical dock — sit directly above (or below) the tile,
          // horizontally centered on the tile's column then clamped to
          // the viewport. The capped maxHeight makes the preview feel
          // like a chunky tooltip rather than a screen-sized panel.
          const width = Math.min(MAX_WIDTH, vw - margin * 2);
          const maxHeight = Math.min(
            MAX_HEIGHT,
            placement === 'below' ? spaceBelow : spaceAbove
          );
          style.width = `${width}px`;
          style.maxHeight = `${maxHeight}px`;
          const tileCenterX = rect.left + rect.width / 2;
          const desiredLeft = tileCenterX - width / 2;
          style.left = `${Math.max(margin, Math.min(desiredLeft, vw - margin - width))}px`;
          if (placement === 'below') style.top = `${rect.bottom + gap}px`;
          else style.bottom = `${vh - rect.top + gap}px`;
        }

        // The image has to leave room for the prompt/meta footer below it
        // (~64px) plus the card's borders, so we shrink its max-height by
        // a fixed gutter rather than letting it claim the full card.
        const imageMaxHeight = `calc(${(style.maxHeight as string)} - 80px)`;

        return createPortal(
          <div
            aria-hidden
            style={style}
            className="pointer-events-none animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="rounded-2xl overflow-hidden border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-2xl flex flex-col max-h-full">
              <div
                className="w-full bg-gray-50 dark:bg-[#0d1117] flex items-center justify-center min-h-0 flex-1"
                style={{ maxHeight: imageMaxHeight }}
              >
                {latestVersion.mimeType === 'image/svg+xml' && latestVersion.svgCode ? (
                  <div
                    className="w-full h-full flex items-center justify-center p-4 [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                    dangerouslySetInnerHTML={{ __html: sanitizeSvg(latestVersion.svgCode) }}
                  />
                ) : (
                  <img
                    src={imageUrl}
                    alt=""
                    className="block w-auto h-auto max-w-full max-h-full object-contain"
                    onError={() => handleImageLoadError(gen)}
                  />
                )}
              </div>
              <div className="px-4 py-2.5 border-t border-gray-200 dark:border-[#30363d] bg-white/95 dark:bg-[#161b22]/95 shrink-0">
                <p className="text-xs text-slate-700 dark:text-slate-200 line-clamp-2">
                  {gen.config.prompt}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-brand-teal/10 text-brand-teal border border-brand-teal/40">
                    {modelLabel}
                  </span>
                  <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatTimestamp(gen.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {renderFolderRowActionsMenuPortal()}
      {renderFolderContextMenuPortal()}
      {renderTileContextMenuPortal()}

      {toastMessage && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <div className="bg-brand-red text-white text-sm px-4 py-3 rounded-lg shadow-2xl border border-brand-red/70 animate-in fade-in duration-150" role="status" aria-live="polite">
            {toastMessage}
          </div>
        </div>
      )}

      {/* Sticky busy banner shown while a bulk move-to-folder is in flight.
          Sits one z-layer above `toastMessage` so the success toast that
          appears when the operation finishes can briefly overlap without
          getting hidden underneath. The matching tiles in the grid are
          dimmed + pulsing (see `isMoving` above) so the user can see at a
          glance which items are currently being relocated. */}
      {moveProgress && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto inline-flex items-center gap-3 rounded-lg border border-brand-teal/40 bg-white/95 dark:bg-[#161b22]/95 backdrop-blur px-4 py-3 shadow-2xl">
            <Loader2
              size={18}
              className="text-brand-teal animate-spin shrink-0"
              aria-hidden
            />
            <div className="text-sm text-slate-700 dark:text-slate-100">
              <span className="font-semibold">
                Moving {moveProgress.total} item{moveProgress.total === 1 ? '' : 's'}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {' '}to{' '}
              </span>
              <span className="font-semibold text-brand-teal">
                {moveProgress.folderName}
              </span>
              <span className="text-slate-500 dark:text-slate-400">…</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
