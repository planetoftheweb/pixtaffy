import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Generation, GenerationVersion, BrandColor, VisualStyle, GraphicType, AspectRatioOption, INBOX_FOLDER_ID } from '../types';
import { Download, RefreshCw, Send, Image as ImageIcon, Copy, Link, Trash2, ChevronDown, ChevronLeft, ChevronRight, Layers, FileImage, Code, Play, Pause, FileCode, Info, X, Globe, Wand2, Maximize, Maximize2, Minimize, GitCompare, Plus, Expand, ScanSearch, Check, Star, Film, Sparkles, GripVertical } from 'lucide-react';
import { useConfirmAction } from '../hooks/useConfirmAction';
import { createBlobUrlFromImage } from '../services/imageSourceService';
import { getCachedImageBlob, getCachedImageBlobUrl } from '../services/imageCache';
import { getCurrentVersion } from '../services/historyService';
import { buildExportFilename } from '../services/versionUtils';
import { webpToPngBlob, imageDataToPngBlob, imageBlobToPngBlob } from '../services/imageConversionService';
import { sanitizeSvg } from '../services/svgService';
import { SUPPORTED_MODELS, MODEL_GROUP_ORDER, CLEANUP_FOR_ANIMATION_PROMPT, getModelDisplayName } from '../constants';
import { normalizeAspectRatio } from '../services/aspectRatioService';
import { RichSelect, RichSelectOption } from './RichSelect';
import { DownloadMenu } from './DownloadMenu';
import { JuxtaposeSlider } from './JuxtaposeSlider';

export interface ImageDisplayMarkRef {
  generationId: string;
  versionId: string;
  imageUrl: string;
  mimeType: string;
  modelId: string;
  markLabel: string;
  aspectRatio?: string;
}

export interface ImageDisplayComparisonState {
  mode: 'idle' | 'picking';
  a: ImageDisplayMarkRef | null;
  b: ImageDisplayMarkRef | null;
}

interface ImageDisplayProps {
  generation: Generation | null;
  onRefine: (refinementText: string) => void;
  /**
   * Re-roll the same prompt as a fresh generation and append the result as a
   * new Mark on the current tile. Unlike `onRefine`, this does NOT use the
   * previous image as input, so the model is free to rethink the layout,
   * palette application, and overall composition. Wired to the "+" plus
   * button at the end of the version rail. The optional `count` (1-9) batches
   * multiple re-rolls — held-digit shortcut on the rail, or count picker in
   * the editor.
   */
  onRerun?: (rerunPrompt: string, count?: number) => void;
  /**
   * Toggle the "best Mark" star on a version within the current tile. Only
   * one version per tile is starred at a time; the canvas prev/next arrows
   * skip non-starred tiles when any starred tiles exist in history.
   */
  onToggleStarred?: (versionId: string) => void;
  /**
   * In-flight "Add a new Mark" re-rolls owned by the App. The version rail
   * renders this many spinner placeholders after the real versions so a
   * batched click shows N pending boxes at once instead of one-at-a-time.
   */
  pendingRerunCount?: number;
  onAnalyzeRefinePrompt: () => Promise<string>;
  /** AI-expand the refine draft (or the tile's original prompt when the draft is empty). */
  onExpandRefinementPrompt: (draft: string) => Promise<string>;
  onResizeCanvasRefine: (targetAspectRatio: string) => Promise<void>;
  /** True while refine / recompose preview work is in flight (serialized queue). */
  isRefining: boolean;
  /** True while a fresh batch generation is starting and no tile is on the canvas yet. */
  isBatchStarting?: boolean;
  onCopy?: () => void;
  onDelete?: () => void;
  onVersionChange: (index: number) => void;
  onDeleteRefinementVersion: (versionId: string) => Promise<void>;
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  resizeAspectRatios: AspectRatioOption[];
  options: {
    brandColors: BrandColor[];
    visualStyles: VisualStyle[];
    graphicTypes: GraphicType[];
    aspectRatios: AspectRatioOption[];
  };
  history?: Generation[];
  /**
   * The folder currently shown in the Recent Generations gallery. When the
   * user enters fullscreen / slideshow mode (F key), arrow-key navigation
   * is scoped to this folder so flipping through marks feels like walking
   * the folder the user is already viewing rather than the global history.
   */
  galleryViewFolderId?: string;
  comparisonState?: ImageDisplayComparisonState;
  onEnterComparePicker?: (seed?: ImageDisplayMarkRef) => void;
  onExitComparePicker?: () => void;
  onPickMark?: (ref: ImageDisplayMarkRef) => void;
  /**
   * Step the main viewport to a sibling generation in the recent-history
   * carousel. Wired by the parent to the same restore flow used by the
   * Recent Generations grid so state stays consistent.
   */
  onNavigateToGeneration?: (gen: Generation) => void;
  /**
   * True when the toolbar/prompt is collapsed (focus mode). The preview grows
   * to fill the reclaimed vertical space instead of sitting capped in a tall,
   * mostly-empty frame.
   */
  toolbarCollapsed?: boolean;
  /** Open the Build Studio (reveal animator) for the current version. */
  onOpenBuildStudio?: () => void;
}

/** Keydown targets where cursor/preview idle auto-hide should pause while the user types. */
const isTypingInteractionTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

export const ImageDisplay: React.FC<ImageDisplayProps> = ({ 
  generation,
  onRefine,
  onRerun,
  onToggleStarred,
  pendingRerunCount = 0,
  onAnalyzeRefinePrompt,
  onExpandRefinementPrompt,
  onResizeCanvasRefine,
  isRefining,
  isBatchStarting = false,
  onCopy,
  onDelete,
  onVersionChange,
  onDeleteRefinementVersion,
  selectedModel,
  onModelChange,
  resizeAspectRatios,
  options,
  history = [],
  galleryViewFolderId,
  comparisonState,
  onEnterComparePicker,
  onExitComparePicker,
  onPickMark,
  onNavigateToGeneration,
  toolbarCollapsed = false,
  onOpenBuildStudio,
}) => {
  // In focus mode the toolbar is gone, so let the image claim that height
  // (less letterboxing). With the toolbar open we stay conservative so the
  // image + toolbar both fit without forcing a scroll.
  const previewMaxHeight = toolbarCollapsed ? '86vh' : '70vh';
  const isCompareMode = comparisonState?.mode === 'picking';
  const comparisonA = comparisonState?.a || null;
  const comparisonB = comparisonState?.b || null;
  const isComparing = !!(comparisonA && comparisonB);
  const handleMarkActivate = (
    event: React.MouseEvent,
    ref: ImageDisplayMarkRef,
    onNormalClick: () => void
  ) => {
    if (onPickMark && (event.shiftKey || isCompareMode)) {
      event.preventDefault();
      event.stopPropagation();
      // Shift-click should feel like "compare this against what I'm currently
      // looking at". If we're not already in compare mode and a committed
      // mark exists, seed A with the committed mark and immediately use the
      // shift-clicked mark as B.
      const isSameMark = (a: ImageDisplayMarkRef, b: ImageDisplayMarkRef) =>
        a.generationId === b.generationId && a.versionId === b.versionId;
      if (
        event.shiftKey &&
        !isCompareMode &&
        !isComparing &&
        currentMarkRef &&
        !isSameMark(currentMarkRef, ref)
      ) {
        onPickMark(currentMarkRef);
      }
      onPickMark(ref);
      return;
    }
    onNormalClick();
    // First-run discoverability nudge: the compare feature is otherwise easy
    // to miss. Flash a small hint when a thumbnail is normal-clicked so the
    // user learns the shift-click shortcut. Suppressed while already picking
    // or while a comparison is already on screen, and skipped when there's
    // only a single mark on the tile (nothing to shift-click against, so
    // the hint would be misleading).
    const hasSiblingsToCompare = (generation?.versions.length ?? 0) > 1;
    if (onPickMark && !isCompareMode && !isComparing && hasSiblingsToCompare) {
      if (compareHintTimerRef.current) {
        window.clearTimeout(compareHintTimerRef.current);
      }
      setCompareHintVisible(true);
      compareHintTimerRef.current = window.setTimeout(() => {
        setCompareHintVisible(false);
        compareHintTimerRef.current = null;
      }, 4000);
    }
  };
  const isMarkPicked = (genId: string, verId: string): 'a' | 'b' | null => {
    if (comparisonA && comparisonA.generationId === genId && comparisonA.versionId === verId) return 'a';
    if (comparisonB && comparisonB.generationId === genId && comparisonB.versionId === verId) return 'b';
    return null;
  };
  const [refinementInput, setRefinementInput] = useState('');
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  /** Neutral notices use the dark-glass pill; red is reserved for errors. */
  const [copyNoticeTone, setCopyNoticeTone] = useState<'neutral' | 'error'>('neutral');
  // Transient toast for star-toggle feedback so the user gets a confirmation
  // even when the version rail is faded out (idle) or off-screen. Mirrors the
  // shape of copyNotice but lives separately so a copy + star fired in quick
  // succession don't clobber each other's message.
  const [starFeedback, setStarFeedback] = useState<{ message: string; on: boolean } | null>(null);
  const starFeedbackTimerRef = useRef<number | null>(null);
  const [noticeTimer, setNoticeTimer] = useState<number | null>(null);
  const [renderImageSrc, setRenderImageSrc] = useState<string>('');
  const [fallbackBlobUrl, setFallbackBlobUrl] = useState<string | null>(null);
  const [versionImageSrcByKey, setVersionImageSrcByKey] = useState<Record<string, string>>({});
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);
  const [animationPaused, setAnimationPaused] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  // Single "Copy" trigger replaces what used to be 2-3 separate copy buttons
  // (Copy prompt, Copy image, Copy URL / Copy SVG code) in the in-image
  // action group. Opening the menu reveals all applicable copy targets for
  // the current asset (raster vs SVG). Keeps the action bar uncluttered
  // while preserving every action.
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  // Refine / Recompose panel was previously a permanent footer under every
  // tile preview — useful but visually heavy and stealing vertical room
  // from the main image. It now hides behind a single Wand2 icon in the
  // in-image action bar; the panel only mounts (and consumes space) when
  // the user actively wants to refine or resize. Default closed so the
  // canvas claims the freed space whenever refinement isn't in play.
  const [isRefinePanelOpen, setIsRefinePanelOpen] = useState(false);
  const [refinePanelOffset, setRefinePanelOffset] = useState({ x: 0, y: 0 });
  const refinePanelRef = useRef<HTMLDivElement>(null);
  const refinePanelOffsetRef = useRef(refinePanelOffset);
  const refinePanelDragRef = useRef<{
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  // Fullscreen / slideshow mode. The F key (and the Maximize button in the
  // in-image action group) flips into a black-background, image-maxed view.
  // The H key inside fullscreen hides the chrome (counter, arrows, hint) for
  // a clean slideshow read. We also kick the browser into real Fullscreen API
  // when available so the OS chrome disappears too — falling back gracefully
  // when the call is rejected (no user gesture, iframe sandbox, etc.).
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Slideshow defaults to a clean, chrome-less canvas — the image owns the
  // viewport on entry and the user reveals UI with `H` only when they want
  // navigation / position info. Avoids the "F-then-H" two-step that the
  // earlier default required and matches every other fullscreen image viewer
  // (Preview, Lightbox, Photos, etc.).
  const [hideChromeInFullscreen, setHideChromeInFullscreen] = useState(true);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const [isAnalyzingRefinePrompt, setIsAnalyzingRefinePrompt] = useState(false);
  const [isExpandingRefinement, setIsExpandingRefinement] = useState(false);
  const [isResizingCanvas, setIsResizingCanvas] = useState(false);
  const [deletingRefinementId, setDeletingRefinementId] = useState<string | null>(null);
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  // The prompt editor has two callers. The refine bar / refine-action buttons
  // open it in 'refine' mode (text is an edit instruction; submit goes to
  // `onRefine` and uses the previous image as input). The "+" button on the
  // version rail opens it in 'rerun' mode (text is the original brief; submit
  // goes to `onRerun` for fresh creative re-rolls and supports a count).
  const [promptEditorMode, setPromptEditorMode] = useState<'refine' | 'rerun'>('refine');
  const [rerunDraft, setRerunDraft] = useState('');
  const [rerunCount, setRerunCount] = useState(1);
  // Held digit (1-9) when the "+" button is clicked — batches that many
  // re-rolls in one click. Tracked via window-level keydown/keyup so the
  // shortcut works from anywhere on the page that doesn't have its own
  // focused input. We keep both a ref (read at click time, latest value)
  // and a state (for rendering the floating badge on the "+" button).
  const heldDigitRef = useRef<number | null>(null);
  const [heldDigit, setHeldDigit] = useState<number | null>(null);
  // Anchor + visibility for the "+" button's rich hover tooltip. Portaled to
  // body so the rail's `overflow-y-auto` (which also clips horizontally)
  // doesn't truncate the tip. Position computed on enter; hidden on leave.
  const [addMarkTipAnchor, setAddMarkTipAnchor] = useState<{
    top: number;
    bottom: number;
    right: number;
  } | null>(null);
  const [addMarkTipVisible, setAddMarkTipVisible] = useState(false);
  const [resizeAspectRatio, setResizeAspectRatio] = useState('');
  /** True while refine / analysis / expand / recompose is in flight. */
  const refinementControlsLocked =
    isAnalyzingRefinePrompt || isResizingCanvas || isExpandingRefinement;
  /** Any AI call in flight — drives the red "working" state on the AI
   * toolbar buttons so it's obvious work is running. */
  const aiBusy = isRefining || refinementControlsLocked;
  /** Which AI button started the in-flight work — only THAT button turns
   * red. Set on click, cleared when the pipeline goes idle. */
  const [aiBusySource, setAiBusySource] = useState<'refine' | 'simplify' | null>(null);
  useEffect(() => {
    if (!aiBusy) setAiBusySource(null);
  }, [aiBusy]);
  // True while the user is actively dragging the JuxtaposeSlider divider.
  // Used to mute the in-image overlays (rail, version chip, action buttons,
  // compare overlay, etc.) so the user gets a clean before/after read while
  // they scrub. Reset by JuxtaposeSlider on pointerup / unmount.
  const [isSliderDragging, setIsSliderDragging] = useState(false);
  // Thumbnail strip hover: while hovering a thumbnail, the main viewport
  // mirrors that version without committing it. Null = show the committed
  // `currentVersionIndex`.
  const [hoveredVersionIdx, setHoveredVersionIdx] = useState<number | null>(null);
  // Viewport coordinates for the floating hover popover. We use
  // `position: fixed` because the rail lives deep inside a stack of
  // absolutely-positioned + overflow:auto ancestors and the page header
  // (z-50) was painting on top of the popover image when its `absolute`
  // ancestor's top fell near the viewport top. Fixed positioning + a
  // viewport-aware clamp keeps the popover fully visible no matter where
  // the rail is on the page.
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // Ephemeral "shift-click another to compare" hint shown for ~4s after the
  // user clicks a thumbnail normally. Resets every time a new thumbnail is
  // clicked. Intentionally suppressed while already in compare-picker mode.
  const [compareHintVisible, setCompareHintVisible] = useState(false);
  const compareHintTimerRef = useRef<number | null>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const railInnerRef = useRef<HTMLDivElement>(null);
  // Anchors the main preview `group` div so the idle-tracker effect can scope
  // its mouseenter / mouseleave / mousemove listeners to just the preview area
  // (rather than the whole window).
  const mainPreviewGroupRef = useRef<HTMLDivElement>(null);
  const versionBlobUrlsRef = useRef<Record<string, string>>({});
  // While the cursor is over the main preview but stationary for 5 seconds,
  // we treat the preview as "idle" and hide both the cursor and the
  // hover-revealed chrome (history arrows, position pill, version dropdown,
  // top-right actions, etc.). Any mouse movement re-arms the timer; pressing
  // an arrow key (history nav) hides immediately. Symmetric to the fullscreen
  // cursor effect above. Toggled via a `data-idle` attribute on the group
  // container so chrome elements can opt in with
  // `group-data-[idle=true]:!opacity-0` — same pattern already used for
  // `data-dragging` during slider scrubs.
  const [isPreviewMouseIdle, setIsPreviewMouseIdle] = useState(false);

  const version = generation ? getCurrentVersion(generation) : null;
  const isSvg = version?.mimeType === 'image/svg+xml';
  const lastRefineModelSyncKeyRef = useRef<string | null>(null);

  const clampRefinePanelOffset = useCallback((next: { x: number; y: number }) => {
    const panel = refinePanelRef.current;
    if (!panel) return next;

    const rect = panel.getBoundingClientRect();
    const current = refinePanelOffsetRef.current;
    const naturalLeft = rect.left - current.x;
    const naturalTop = rect.top - current.y;
    const preview = mainPreviewGroupRef.current?.getBoundingClientRect();
    const edge = 8;
    const boundaryLeft = Math.max(edge, preview?.left ?? edge);
    const boundaryRight = Math.min(window.innerWidth - edge, preview?.right ?? window.innerWidth - edge);
    const boundaryTop = Math.max(edge, preview?.top ?? edge);
    const boundaryBottom = Math.min(window.innerHeight - edge, preview?.bottom ?? window.innerHeight - edge);
    const minX = boundaryLeft - naturalLeft;
    const maxX = boundaryRight - rect.width - naturalLeft;
    const minY = boundaryTop - naturalTop;
    const maxY = boundaryBottom - rect.height - naturalTop;

    return {
      x: minX <= maxX ? Math.min(maxX, Math.max(minX, next.x)) : (minX + maxX) / 2,
      y: minY <= maxY ? Math.min(maxY, Math.max(minY, next.y)) : (minY + maxY) / 2,
    };
  }, []);

  const applyRefinePanelOffset = useCallback((next: { x: number; y: number }) => {
    const clamped = clampRefinePanelOffset(next);
    refinePanelOffsetRef.current = clamped;
    if (refinePanelRef.current) {
      refinePanelRef.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    }
    return clamped;
  }, [clampRefinePanelOffset]);

  const handleRefinePanelDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = refinePanelOffsetRef.current;
    refinePanelDragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: current.x,
      offsetY: current.y,
    };
  };

  const handleRefinePanelDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = refinePanelDragRef.current;
    if (!drag) return;
    applyRefinePanelOffset({
      x: drag.offsetX + event.clientX - drag.pointerX,
      y: drag.offsetY + event.clientY - drag.pointerY,
    });
  };

  const handleRefinePanelDragEnd = () => {
    if (!refinePanelDragRef.current) return;
    refinePanelDragRef.current = null;
    setRefinePanelOffset(refinePanelOffsetRef.current);
  };

  const resetRefinePanelOffset = () => {
    const origin = { x: 0, y: 0 };
    refinePanelOffsetRef.current = origin;
    setRefinePanelOffset(origin);
  };

  const handleRefinePanelMoveKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const directions: Partial<Record<string, { x: number; y: number }>> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    if (event.key === 'Home') {
      event.preventDefault();
      resetRefinePanelOffset();
      return;
    }
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    const current = refinePanelOffsetRef.current;
    const next = applyRefinePanelOffset({
      x: current.x + direction.x * step,
      y: current.y + direction.y * step,
    });
    setRefinePanelOffset(next);
  };

  useEffect(() => {
    if (!isRefinePanelOpen) return;
    const keepPanelVisible = () => {
      const next = applyRefinePanelOffset(refinePanelOffsetRef.current);
      setRefinePanelOffset(next);
    };
    const frame = window.requestAnimationFrame(keepPanelVisible);
    window.addEventListener('resize', keepPanelVisible);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', keepPanelVisible);
    };
  }, [applyRefinePanelOffset, isRefinePanelOpen]);
  const getVersionImageKey = (generationId: string, versionId: string): string =>
    `${generationId}|${versionId}`;
  const getVersionDisplayImageUrl = (generationId: string, targetVersion: GenerationVersion): string =>
    versionImageSrcByKey[getVersionImageKey(generationId, targetVersion.id)] || targetVersion.imageUrl;

  // Turn the currently-committed version into a MarkRef so the Compare button
  // can hand it off as the pre-seeded "A" side. Users enter compare mode
  // while already looking at a specific mark, so it's almost always the thing
  // they want to be one half of the comparison.
  const currentMarkRef: ImageDisplayMarkRef | null = generation && version
    ? {
        generationId: generation.id,
        versionId: version.id,
        imageUrl: renderImageSrc || getVersionDisplayImageUrl(generation.id, version),
        mimeType: version.mimeType,
        modelId: version.modelId || generation.modelId,
        markLabel: version.label,
        aspectRatio: version.aspectRatio || generation.config.aspectRatio,
      }
    : null;
  const handleEnterCompareFromButton = () => {
    if (!onEnterComparePicker) return;
    onEnterComparePicker(currentMarkRef || undefined);
  };

  // Carousel navigation across the Recent Generations history. The grid is
  // rendered newest-first, so "previous" (←) jumps to the newer neighbor and
  // "next" (→) jumps to the older one — matching the visual order users see
  // in the gallery below.
  //
  // Slideshow scoping: when fullscreen mode is active and the current tile
  // lives inside the active gallery folder, we navigate only within that
  // folder so F + ←/→ behaves like flipping through the folder the user is
  // currently viewing. We fall back to the unscoped history when the tile
  // isn't in the folder (e.g. opened from a search result) so the user
  // isn't stranded on an empty list.
  const folderScopedNavHistory = useMemo<Generation[] | null>(() => {
    if (!galleryViewFolderId) return null;
    const scoped = history.filter(
      (g) => (g.folderId || INBOX_FOLDER_ID) === galleryViewFolderId
    );
    if (generation && !scoped.some((g) => g.id === generation.id)) return null;
    return scoped;
  }, [history, galleryViewFolderId, generation?.id]);
  const navHistory =
    isFullscreen && folderScopedNavHistory ? folderScopedNavHistory : history;
  // When any tile in scope has a starred Mark, the prev/next arrows become a
  // curated "best-of" walk — they only step through starred tiles and land on
  // the starred version of each. Falls back to "all tiles" when nothing is
  // starred so the affordance never becomes a dead-end.
  const starredFilteredHistory = useMemo(
    () => navHistory.filter((g) => g.starredVersionId),
    [navHistory]
  );
  const useStarredNav = starredFilteredHistory.length > 0;
  const navList = useStarredNav ? starredFilteredHistory : navHistory;
  const currentIdxInHistory = generation
    ? navList.findIndex((g) => g.id === generation.id)
    : -1;
  const newerGeneration =
    currentIdxInHistory > 0 ? navList[currentIdxInHistory - 1] : null;
  const olderGeneration =
    currentIdxInHistory >= 0 && currentIdxInHistory < navList.length - 1
      ? navList[currentIdxInHistory + 1]
      : null;
  const canNavigate = !!onNavigateToGeneration && !isComparing && !isCompareMode;
  const canGoNewer = canNavigate && !!newerGeneration;
  const canGoOlder = canNavigate && !!olderGeneration;
  // Carousel arrows land on a curated version of the next generation: the
  // starred Mark when one exists (so "best-of" mode is honored), otherwise
  // the newest Mark so the user sees the latest refinement rather than
  // whatever stale `currentVersionIndex` happened to be persisted.
  const withCarouselVersion = (gen: Generation): Generation => {
    const targetIdx = gen.starredVersionId
      ? gen.versions.findIndex((v) => v.id === gen.starredVersionId)
      : -1;
    const safeIdx = targetIdx >= 0 ? targetIdx : Math.max(0, gen.versions.length - 1);
    return { ...gen, currentVersionIndex: safeIdx };
  };
  const goNewer = useCallback(() => {
    if (!onNavigateToGeneration || !newerGeneration) return;
    onNavigateToGeneration(withCarouselVersion(newerGeneration));
  }, [onNavigateToGeneration, newerGeneration]);
  const goOlder = useCallback(() => {
    if (!onNavigateToGeneration || !olderGeneration) return;
    onNavigateToGeneration(withCarouselVersion(olderGeneration));
  }, [onNavigateToGeneration, olderGeneration]);

  const versionCount = generation?.versions.length ?? 0;
  const canCycleVersions =
    !!generation &&
    versionCount > 1 &&
    !isComparing &&
    !isCompareMode;

  const goNextVersion = useCallback(() => {
    if (!generation || versionCount < 2) return;
    const idx = generation.currentVersionIndex;
    const next = (idx + 1) % versionCount;
    onVersionChange(next);
  }, [generation, versionCount, onVersionChange]);

  const goPrevVersion = useCallback(() => {
    if (!generation || versionCount < 2) return;
    const idx = generation.currentVersionIndex;
    const next = (idx - 1 + versionCount) % versionCount;
    onVersionChange(next);
  }, [generation, versionCount, onVersionChange]);

  useEffect(() => {
    return () => {
      if (noticeTimer) window.clearTimeout(noticeTimer);
    };
  }, [noticeTimer]);

  useEffect(() => {
    setRenderImageSrc(version?.imageUrl || '');
    if (fallbackBlobUrl) {
      URL.revokeObjectURL(fallbackBlobUrl);
      setFallbackBlobUrl(null);
    }
    setAnimationPaused(false);
  }, [version?.imageUrl]);

  // Drop hover preview whenever the underlying generation changes so we
  // don't display a thumbnail pointer into a stale version list.
  useEffect(() => {
    setHoveredVersionIdx(null);
  }, [generation?.id]);

  // Clear any pending compare-hint timer on unmount.
  useEffect(() => {
    return () => {
      if (compareHintTimerRef.current) {
        window.clearTimeout(compareHintTimerRef.current);
        compareHintTimerRef.current = null;
      }
    };
  }, []);

  // Wraps the App-level `onToggleStarred` so click and keyboard both produce
  // the same visible confirmation toast. The toast tells the user which Mark
  // just got starred (or unstarred) so the gesture is never silent — important
  // because the rail is often faded out when "S" is the only way to discover
  // the result. Defined BEFORE the keyboard `useEffect` below so its deps
  // array can safely reference it on the first render.
  const handleStarToggle = useCallback(
    (versionId: string) => {
      if (!onToggleStarred || !generation) return;
      const v = generation.versions.find((vv) => vv.id === versionId);
      const wasStarred = generation.starredVersionId === versionId;
      const nowStarred = !wasStarred;
      const label = v?.label || 'Mark';
      onToggleStarred(versionId);
      if (starFeedbackTimerRef.current) window.clearTimeout(starFeedbackTimerRef.current);
      setStarFeedback({
        message: nowStarred ? `Starred ${label}` : `Unstarred ${label}`,
        on: nowStarred,
      });
      starFeedbackTimerRef.current = window.setTimeout(() => {
        setStarFeedback(null);
        starFeedbackTimerRef.current = null;
      }, 1600);
    },
    [generation, onToggleStarred]
  );

  // Keyboard carousel: ←/→ steps the main viewport to the neighboring
  // generation; ↑/↓ cycles Marks (Mark I, II, …) on the current tile, with
  // wrap (last ↓ → Mark I). Same window listener and focus guards as ←/→.
  useEffect(() => {
    // The "S" star toggle works whenever a generation is showing — even on
    // single-version tiles where cycling/navigation are both no-ops — so we
    // only bail out when none of those affordances are wired up at all.
    if (!canNavigate && !canCycleVersions && !onToggleStarred) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 's' &&
        e.key !== 'S'
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isPromptEditorOpen) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!canCycleVersions) return;
        e.preventDefault();
        if (e.key === 'ArrowDown') {
          goNextVersion();
        } else {
          goPrevVersion();
        }
        return;
      }
      // "S" toggles the star on the currently-displayed Mark. Form-field
      // and prompt-editor guards above already prevent stray typing from
      // arming this; modifier keys are ignored so ⌘S still saves the page.
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!generation || !onToggleStarred) return;
        const v = generation.versions[generation.currentVersionIndex];
        if (!v) return;
        e.preventDefault();
        handleStarToggle(v.id);
        return;
      }
      if (!canNavigate) return;
      if (e.key === 'ArrowLeft' && canGoNewer) {
        e.preventDefault();
        goNewer();
      } else if (e.key === 'ArrowRight' && canGoOlder) {
        e.preventDefault();
        goOlder();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    canNavigate,
    canCycleVersions,
    canGoNewer,
    canGoOlder,
    goNewer,
    goOlder,
    goNextVersion,
    goPrevVersion,
    isPromptEditorOpen,
    generation,
    onToggleStarred,
    handleStarToggle,
  ]);

  // ===== Fullscreen / slideshow mode =====
  //
  // We deliberately do NOT use the DOM Fullscreen API (`requestFullscreen`).
  // On macOS that API triggers the OS-level workspace animation which grows
  // the browser window from its current position to fill the screen over
  // ~400ms. Our `position: fixed` overlay follows the resize, producing a
  // jarring "overlay slides from the right side of the screen out to fill
  // the screen" effect we can't disable. Instead we run the slideshow
  // entirely inside a CSS overlay (`fixed inset-0`) that fades in over the
  // browser window. Visually identical to OS fullscreen for the user
  // (immersive black canvas with the image filling it), without the OS
  // shuffle. Users who want true OS fullscreen can press F11 / Cmd+Ctrl+F
  // before triggering the slideshow.
  const exitFullscreen = useCallback(() => {
    setIsFullscreen(false);
    setHideChromeInFullscreen(true);
  }, []);

  const enterFullscreen = useCallback(() => {
    if (!generation || !version) return;
    setIsFullscreen(true);
  }, [generation, version]);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // F toggles fullscreen, H hides chrome inside fullscreen, Esc exits.
  // We register on `window` (same as the arrow-key handler above) and apply
  // the same input-focused guards so typing "F" into the refine textarea
  // never hijacks the keystroke.
  useEffect(() => {
    if (!generation || !version) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isPromptEditorOpen) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (!isFullscreen) return;
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setHideChromeInFullscreen((prev) => !prev);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        exitFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    generation,
    version,
    isFullscreen,
    isPromptEditorOpen,
    toggleFullscreen,
    exitFullscreen,
  ]);

  // Lock body scroll behind the overlay so a stray scroll wheel doesn't
  // shift the page underneath while the user is in slideshow mode.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  // Cursor auto-hide in slideshow.
  //
  // A pointer arrow sitting on top of a generated image reads as a smudge —
  // every other immersive image viewer (Preview, Photos, Lightroom, video
  // players) hides the cursor while the user is just looking. We mirror
  // that: after 5s of mouse stillness the cursor fades to `cursor-none`,
  // and any mouse motion brings it back instantly and re-arms the timer.
  //
  // We also hide on keyboard navigation (arrows + H) because once the user
  // is flipping through marks via the keyboard, a stationary pointer over
  // the canvas is just visual noise. F and Esc are intentionally excluded
  // — they exit/toggle fullscreen so cursor visibility resets on the way
  // out anyway.
  //
  // Effect resets state on entry and on exit so the cursor never gets
  // stuck "invisible" once the user leaves the overlay.
  const [isFullscreenCursorVisible, setIsFullscreenCursorVisible] = useState(true);
  useEffect(() => {
    if (!isFullscreen) {
      setIsFullscreenCursorVisible(true);
      return;
    }
    setIsFullscreenCursorVisible(true);

    let hideTimer: number | null = null;
    const armHideTimer = () => {
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        setIsFullscreenCursorVisible(false);
        hideTimer = null;
      }, 5000);
    };

    const handleMouseMove = () => {
      setIsFullscreenCursorVisible(true);
      armHideTimer();
    };

    // Navigation-style keys: arrows walk the slideshow, H toggles chrome.
    // Typing in any text control clears the idle hide — otherwise the cursor
    // vanishes mid-keystroke when the pointer happened to stay still.
    const NAV_KEYS = new Set([
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'h',
      'H',
    ]);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingInteractionTarget(e.target)) {
        setIsFullscreenCursorVisible(true);
        if (hideTimer !== null) {
          window.clearTimeout(hideTimer);
          hideTimer = null;
        }
        return;
      }
      if (!NAV_KEYS.has(e.key)) return;
      setIsFullscreenCursorVisible(false);
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    armHideTimer();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
    };
  }, [isFullscreen]);

  // Main-preview idle tracker. While the cursor is over the preview group
  // and stationary for 5s, flip `isPreviewMouseIdle` true; that drives a
  // `data-idle="true"` attribute on the group container which (a) hides the
  // cursor via `data-[idle=true]:cursor-none` and (b) hides every hover-
  // revealed chrome element via `group-data-[idle=true]:!opacity-0` — same
  // override pattern already used for `data-dragging`.
  //
  // Listeners are scoped to the preview ref (not window) so the timer is
  // only armed while the user is actually inside the preview. Leaving the
  // area clears any pending hide and resets state so re-entry starts fresh.
  //
  // Arrow-key history nav (← →) hides immediately on the theory that if
  // the user is flipping through with the keyboard, a stationary pointer
  // and a hovering chrome layer are just visual noise. We skip the
  // suppression when the keydown originates from a form control so typing
  // in a refine textarea (Arrow keys move the caret) doesn't blank the UI.
  // Any typing in a text control also cancels the idle timer so the canvas
  // chrome does not auto-hide while the prompt still has focus.
  //
  // Effect bails out entirely while the fullscreen overlay is up — that
  // layer has its own cursor effect and the preview is occluded anyway.
  useEffect(() => {
    if (isFullscreen) {
      setIsPreviewMouseIdle(false);
      return;
    }
    setIsPreviewMouseIdle(false);

    const el = mainPreviewGroupRef.current;
    if (!el) return;

    let hideTimer: number | null = null;
    let isHovering = false;

    const clearHideTimer = () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    const armHideTimer = () => {
      clearHideTimer();
      hideTimer = window.setTimeout(() => {
        setIsPreviewMouseIdle(true);
        hideTimer = null;
      }, 5000);
    };

    const handleMouseEnter = () => {
      isHovering = true;
      setIsPreviewMouseIdle(false);
      armHideTimer();
    };

    const handleMouseLeave = () => {
      isHovering = false;
      clearHideTimer();
      setIsPreviewMouseIdle(false);
    };

    const handleMouseMove = () => {
      if (!isHovering) return;
      setIsPreviewMouseIdle(false);
      armHideTimer();
    };

    const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingInteractionTarget(e.target)) {
        setIsPreviewMouseIdle(false);
        clearHideTimer();
        return;
      }
      if (!NAV_KEYS.has(e.key)) return;
      setIsPreviewMouseIdle(true);
      clearHideTimer();
    };

    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);
    el.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.removeEventListener('mouseleave', handleMouseLeave);
      el.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      clearHideTimer();
    };
  }, [isFullscreen]);

  // If the user navigates away from a fullscreen-capable tile (generation
  // becomes null) leave fullscreen automatically — otherwise the overlay
  // would render an empty black screen with no way to recover except Esc.
  useEffect(() => {
    if (isFullscreen && (!generation || !version)) {
      exitFullscreen();
    }
  }, [isFullscreen, generation, version, exitFullscreen]);

  useEffect(() => {
    return () => {
      if (fallbackBlobUrl) URL.revokeObjectURL(fallbackBlobUrl);
    };
  }, [fallbackBlobUrl]);

  useEffect(() => {
    if (!isPromptEditorOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsPromptEditorOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPromptEditorOpen]);

  // Hold a digit (1-9) while clicking the "+" button to batch that many
  // re-rolls in one click. We track via a ref (no re-render churn per
  // keystroke) and ignore digits typed into form inputs / textareas so the
  // user can type a "3" into the refine prompt without arming the shortcut.
  useEffect(() => {
    const isFormFieldTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      );
    };
    const onDown = (e: KeyboardEvent) => {
      if (isFormFieldTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '9') {
        const n = parseInt(e.key, 10);
        heldDigitRef.current = n;
        setHeldDigit(n);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '9' && heldDigitRef.current === parseInt(e.key, 10)) {
        heldDigitRef.current = null;
        setHeldDigit(null);
      }
    };
    const clear = () => {
      heldDigitRef.current = null;
      setHeldDigit(null);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    // Belt-and-suspenders: if the user Cmd-tabs away or the window blurs
    // while the digit is held, the keyup may never fire — drop the held
    // state on blur so a stale digit can't haunt the next click.
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(versionBlobUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      versionBlobUrlsRef.current = {};
    };
  }, []);

  useEffect(() => {
    const activeKeys = new Set(
      generation?.versions.map((item) => getVersionImageKey(generation.id, item.id)) || []
    );
    const staleKeys = Object.keys(versionBlobUrlsRef.current).filter((key) => !activeKeys.has(key));
    if (staleKeys.length === 0) return;

    staleKeys.forEach((key) => {
      URL.revokeObjectURL(versionBlobUrlsRef.current[key]);
      delete versionBlobUrlsRef.current[key];
    });

    setVersionImageSrcByKey((prev) => {
      const next = { ...prev };
      staleKeys.forEach((key) => delete next[key]);
      return next;
    });
  }, [generation?.id, generation?.versions]);

  useEffect(() => {
    if (!isSvg || !svgContainerRef.current) return;
    const container = svgContainerRef.current;
    const svgEls = container.querySelectorAll('svg');
    svgEls.forEach(svg => {
      if (animationPaused) {
        svg.pauseAnimations?.();
        svg.style.animationPlayState = 'paused';
        svg.querySelectorAll('*').forEach(el => {
          (el as HTMLElement).style.animationPlayState = 'paused';
        });
      } else {
        svg.unpauseAnimations?.();
        svg.style.animationPlayState = 'running';
        svg.querySelectorAll('*').forEach(el => {
          (el as HTMLElement).style.animationPlayState = 'running';
        });
      }
    });
  }, [animationPaused, isSvg, version?.id]);

  const showNotice = (msg: string, tone: 'neutral' | 'error' = 'neutral') => {
    if (noticeTimer) window.clearTimeout(noticeTimer);
    setCopyNotice(msg);
    setCopyNoticeTone(tone);
    const timer = window.setTimeout(() => setCopyNotice(null), 2000);
    setNoticeTimer(timer);
  };

  useEffect(() => {
    // Cleanup the star-feedback timer on unmount so a late tick doesn't
    // call setState on a torn-down component.
    return () => {
      if (starFeedbackTimerRef.current) window.clearTimeout(starFeedbackTimerRef.current);
    };
  }, []);

  const modelLabelMap: Record<string, string> = {
    gemini: 'Nano Banana Pro',
    'gemini-3.1-flash-image-preview': 'Nano Banana 2',
    'openai-2.5': 'GPT Image 2.5',
    'openai-flare': 'GPT Image 2.5 Flare',
    'openai-2': 'GPT Image 2',
    'openai-mini': 'GPT Image Mini',
    openai: 'GPT Image 1.5',
    'gemini-svg': 'Gemini SVG'
  };
  // Compact labels used in the thumbnail rail chip and tight UI surfaces
  // where the full marketing name would wrap or get clipped.
  const modelShortLabelMap: Record<string, string> = {
    gemini: 'Nano Pro',
    'gemini-3.1-flash-image-preview': 'Nano 2',
    'openai-2.5': 'GPT 2.5',
    'openai-flare': 'GPT Flare',
    'openai-2': 'GPT 2',
    'openai-mini': 'GPT Mini',
    openai: 'GPT 1.5',
    'gemini-svg': 'SVG'
  };

  const getLabel = (id: string | undefined, list: any[]) => {
    if (!id) return '';
    const item = list.find((i: any) => i.id === id || i.value === id);
    return item?.name || item?.label || id;
  };

  /**
   * Returns CSS-ready dimensions for the thumbnail hover preview so it shows
   * the *actual* shape of the generated image instead of a black-letterboxed
   * square. Landscape/wide ratios render at full width; portrait/tall ratios
   * are width-clamped so the popover doesn't get absurdly tall.
   */
  const getHoverPreviewStyle = (ratioStr?: string | null): React.CSSProperties => {
    const MAX_W = 320;
    const MAX_H = 360;
    const parsed = /^(\d+(?:\.\d+)?)[:xX](\d+(?:\.\d+)?)$/.exec(String(ratioStr || '').trim());
    if (!parsed) return { width: MAX_W, aspectRatio: '1 / 1' };
    const w = parseFloat(parsed[1]);
    const h = parseFloat(parsed[2]);
    if (!w || !h) return { width: MAX_W, aspectRatio: '1 / 1' };
    const r = w / h;
    const heightIfFullW = MAX_W / r;
    if (heightIfFullW <= MAX_H) {
      return { width: MAX_W, aspectRatio: `${w} / ${h}` };
    }
    return { width: Math.round(MAX_H * r), aspectRatio: `${w} / ${h}` };
  };

  /**
   * Estimated total height of the rail's hover preview card, including the
   * bottom label footer. Used by the rail to clamp the preview's vertical
   * position so it never extends above the rail's visible scroll area
   * (which would clip the top of the image — the original bug) or below
   * it (which would clip the label / footer when hovering the bottom-most
   * thumb). Footer is ~36px (px-3 py-2 + 12px text + a hairline border).
   */
  const FOOTER_H = 36;
  const getHoverPreviewHeight = (ratioStr?: string | null): number => {
    const style = getHoverPreviewStyle(ratioStr);
    const width = typeof style.width === 'number' ? style.width : 320;
    const aspect = String(style.aspectRatio || '1 / 1');
    const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(aspect);
    if (!m) return width + FOOTER_H;
    const aw = parseFloat(m[1]);
    const ah = parseFloat(m[2]);
    if (!aw || !ah) return width + FOOTER_H;
    return Math.round(width * (ah / aw)) + FOOTER_H;
  };

  const getColors = (id: string | undefined) => {
    if (!id) return [];
    const palette = options.brandColors.find(c => c.id === id);
    return palette?.colors || [];
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const rawH = d.getHours();
    const hh = String(rawH % 12 === 0 ? 12 : rawH % 12).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ampm = rawH >= 12 ? 'PM' : 'AM';
    return `${mm}-${dd} ${hh}:${mi} ${ampm}`;
  };

  const handleSvgContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // --- SVG Export Helpers ---

  const handleDownloadHtml = () => {
    if (!generation || !version?.svgCode) return;
    const title = generation.config.prompt.slice(0, 60).trim() || 'SVG Graphic';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0d1117; }
  svg { max-width: 100vw; max-height: 100vh; width: auto; height: auto; }
</style>
</head>
<body>
${version.svgCode}
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const filename = buildExportFilename(generation.config.prompt, version.number, 'html');
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showNotice('HTML download started');
  };

  const handleDownloadSvg = () => {
    if (!generation || !version?.svgCode) return;
    const filename = buildExportFilename(generation.config.prompt, version.number, 'svg');
    const blob = new Blob([version.svgCode], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showNotice('SVG download started');
  };

  const handleDownloadSvgAsPng = useCallback(async () => {
    if (!generation || !version?.svgCode) return;
    try {
      const svgStr = version.svgCode;
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2;
        canvas.width = img.naturalWidth * scale;
        canvas.height = img.naturalHeight * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); return; }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(pngBlob => {
          if (!pngBlob) { URL.revokeObjectURL(url); return; }
          const pngUrl = URL.createObjectURL(pngBlob);
          const filename = buildExportFilename(generation.config.prompt, version.number, 'png');
          const link = document.createElement('a');
          link.href = pngUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(pngUrl);
          URL.revokeObjectURL(url);
          showNotice('PNG download started');
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        showNotice('PNG export failed', 'error');
      };
      img.src = url;
    } catch {
      showNotice('PNG export failed', 'error');
    }
  }, [generation, version]);

  const handleCopySvgCode = async () => {
    if (!version?.svgCode) return;
    try {
      await navigator.clipboard.writeText(version.svgCode);
      showNotice('SVG code copied');
    } catch {
      showNotice('Copy failed', 'error');
    }
  };

  // --- Raster Export Helpers ---

  const handleDownloadWebP = () => {
    if (!generation || !version) return;
    const filename = buildExportFilename(generation.config.prompt, version.number, 'webp');
    const link = document.createElement('a');
    link.href = renderImageSrc || version.imageUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotice('WebP download started');
  };

  const handleDownloadPng = async () => {
    if (!generation || !version) return;
    try {
      const blob = await webpToPngBlob(version.imageData);
      const url = URL.createObjectURL(blob);
      const filename = buildExportFilename(generation.config.prompt, version.number, 'png');
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showNotice('PNG download started');
    } catch {
      handleDownloadWebP();
    }
  };

  const handleCopyImageUrl = async () => {
    if (!version) return;
    try {
      await navigator.clipboard.writeText(version.imageUrl);
      showNotice('Image URL copied');
    } catch (err) {
      console.error('Failed to copy image URL:', err);
    }
  };

  const handleCopyImageToClipboard = async () => {
    if (!version) return;
    const clipboardSupportsImages =
      typeof navigator !== 'undefined' &&
      !!navigator.clipboard &&
      'write' in navigator.clipboard &&
      typeof ClipboardItem !== 'undefined';

    const writePng = async (pngBlob: Blob) => {
      if (!clipboardSupportsImages) return false;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      return true;
    };

    // Prefer local sources to avoid Storage CORS entirely:
    //   1) inline base64 (fresh generations)
    //   2) IndexedDB blob cache (everything else, populated at save time)
    //   3) fetch the live URL (may fail on VPN or cross-origin without CORS headers)
    try {
      if (version.imageData) {
        const png = await imageDataToPngBlob(version.imageData, version.mimeType || 'image/webp');
        if (await writePng(png)) { showNotice('Image copied'); return; }
      }

      if (generation?.id) {
        const cached = await getCachedImageBlob(generation.id, version.id);
        if (cached) {
          const png = await imageBlobToPngBlob(cached);
          if (await writePng(png)) { showNotice('Image copied'); return; }
        }
      }

      const sourceUrl = renderImageSrc || version.imageUrl;
      if (sourceUrl) {
        const response = await fetch(sourceUrl, { mode: 'cors' });
        if (response.ok) {
          const blob = await response.blob();
          const png = await imageBlobToPngBlob(blob);
          if (await writePng(png)) { showNotice('Image copied'); return; }
        }
      }
    } catch (err) {
      console.warn('[ImageDisplay] Copy image failed, falling back to URL:', err);
    }

    try {
      await navigator.clipboard.writeText(version?.imageUrl || '');
      showNotice('Copied image URL (image not available offline)');
    } catch {
      showNotice('Copy failed', 'error');
    }
  };

  const handleCopyPrompt = () => {
    if (onCopy) {
      onCopy();
      showNotice('Prompt copied');
    }
  };

  // Inline "click twice to confirm" pattern, applied to every delete control
  // in this component. The previous flow relied on an App-level modal that
  // could be silenced by a preference toggle, so it was possible to lose a
  // generation on a single misclick. Double-tap is always on, doesn't need a
  // preference, and matches the rail/popover delete experience below.
  const confirmGenerationDelete = useConfirmAction<'current'>({
    onConfirm: () => {
      if (onDelete) onDelete();
    },
  });
  const isGenerationDeleteArmed = confirmGenerationDelete.isArmed('current');
  const handleDeleteWithNotice = () => {
    if (!confirmGenerationDelete.trigger('current')) {
      showNotice('Click delete again to confirm');
    }
  };

  const confirmVersionDelete = useConfirmAction<string>({
    onConfirm: (versionId) => {
      void runDeleteRefinement(versionId);
    },
  });

  const runDeleteRefinement = async (versionId: string) => {
    if (deletingRefinementId) return;
    setDeletingRefinementId(versionId);
    try {
      await onDeleteRefinementVersion(versionId);
      showNotice('Version deleted');
      setVersionDropdownOpen(false);
    } catch (error: any) {
      showNotice(error?.message || 'Failed to delete version', 'error');
    } finally {
      setDeletingRefinementId(null);
    }
  };

  const handleVersionDeleteClick = (versionId: string) => {
    if (!confirmVersionDelete.trigger(versionId)) {
      showNotice('Click delete again to confirm');
    }
  };

  const cleanupRefinementPromptForSubmission = (input: string): string => {
    const normalized = input
      .replace(/\r\n/g, '\n')
      .replace(/\u00A0/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');

    return normalized.replace(/\s+/g, ' ').trim();
  };

  const submitRefinementOrResize = (): boolean => {
    const preparedInput = cleanupRefinementPromptForSubmission(refinementInput);
    if (preparedInput) {
      setAiBusySource('refine');
      onRefine(preparedInput);
      setRefinementInput('');
      return true;
    }
    if (canResizeToSelected) {
      setAiBusySource('refine');
      void handleResizeCanvasClick();
      return true;
    }
    return false;
  };

  const handleRefineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitRefinementOrResize();
  };

  const isSubmitShortcut = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean =>
    (event.metaKey || event.ctrlKey) && event.key === 'Enter';

  const handleInlinePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSubmitShortcut(event)) return;
    event.preventDefault();
    submitRefinementOrResize();
  };

  const handleModalPromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSubmitShortcut(event)) return;
    event.preventDefault();
    if (submitRefinementOrResize()) {
      setIsPromptEditorOpen(false);
    }
  };

  // Submit the prompt editor when it's in 'rerun' mode — fires N fresh
  // re-rolls via onRerun (no image input, no preservation directives), then
  // closes the editor. Returns true when the submit landed.
  const submitRerunFromEditor = (): boolean => {
    const text = rerunDraft.trim();
    if (!text || !onRerun) return false;
    const safeCount = Math.max(1, Math.min(9, Math.floor(rerunCount || 1)));
    onRerun(text, safeCount);
    return true;
  };

  const handleRerunModalKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSubmitShortcut(event)) return;
    event.preventDefault();
    if (submitRerunFromEditor()) {
      setIsPromptEditorOpen(false);
    }
  };

  const handleAnalyzeRefineClick = async () => {
    if (refinementControlsLocked) return;
    setIsAnalyzingRefinePrompt(true);
    try {
      const prompt = await onAnalyzeRefinePrompt();
      if (prompt?.trim()) {
        setRefinementInput(prompt.trim());
        setPromptEditorMode('refine');
        setIsPromptEditorOpen(true);
        showNotice('Analysis complete. Detailed fix prompt added.');
      } else {
        showNotice('Analysis finished with no prompt.');
      }
    } catch (error: any) {
      showNotice(error?.message || 'Analysis failed', 'error');
    } finally {
      setIsAnalyzingRefinePrompt(false);
    }
  };

  const handleExpandRefinementClick = async () => {
    if (refinementControlsLocked) return;
    setIsExpandingRefinement(true);
    try {
      const expanded = await onExpandRefinementPrompt(refinementInput);
      if (expanded?.trim()) {
        setRefinementInput(expanded.trim());
        showNotice('Prompt expanded.');
      } else {
        showNotice('Expand finished with no text.');
      }
    } catch (error: any) {
      showNotice(error?.message || 'Expand failed', 'error');
    } finally {
      setIsExpandingRefinement(false);
    }
  };

  const handleResizeCanvasClick = async () => {
    if (refinementControlsLocked) return;
    const sourceAspect = normalizeAspectRatio(version?.aspectRatio || generation?.config.aspectRatio || '');
    const targetAspect = normalizeAspectRatio(resizeAspectRatio);
    if (!targetAspect || !sourceAspect || targetAspect === sourceAspect) {
      showNotice('Choose a different target size first', 'error');
      return;
    }
    setIsResizingCanvas(true);
    try {
      await onResizeCanvasRefine(resizeAspectRatio);
      showNotice('Canvas resize complete');
    } catch (error: any) {
      showNotice(error?.message || 'Resize failed', 'error');
    } finally {
      setIsResizingCanvas(false);
    }
  };


  const handleImageError = async () => {
    if (!version) return;
    if (renderImageSrc.startsWith('blob:')) return;

    // Path 1 — fresh generation, base64 still inline. Cheap, synchronous.
    const inlineBlobUrl = createBlobUrlFromImage({
      imageUrl: version.imageUrl,
      base64Data: version.imageData,
      mimeType: version.mimeType
    });
    if (inlineBlobUrl) {
      if (fallbackBlobUrl) URL.revokeObjectURL(fallbackBlobUrl);
      setFallbackBlobUrl(inlineBlobUrl);
      setRenderImageSrc(inlineBlobUrl);
      return;
    }

    // Path 2 — history loaded from Firestore (no inline bytes). Try the
    // IndexedDB cache. This is what restores the main preview when the
    // network blocks Firebase Storage.
    if (!generation || !version.id) return;
    try {
      const cachedBlobUrl = await getCachedImageBlobUrl(generation.id, version.id);
      if (!cachedBlobUrl) return;
      // Bail if the user navigated to a different version while we waited.
      const stillCurrentVersion = getCurrentVersion(generation);
      if (!stillCurrentVersion || stillCurrentVersion.id !== version.id) {
        URL.revokeObjectURL(cachedBlobUrl);
        return;
      }
      if (renderImageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(cachedBlobUrl);
        return;
      }
      if (fallbackBlobUrl) URL.revokeObjectURL(fallbackBlobUrl);
      setFallbackBlobUrl(cachedBlobUrl);
      setRenderImageSrc(cachedBlobUrl);
    } catch (error) {
      console.warn('[ImageDisplay] Failed to load cached blob URL:', error);
    }
  };

  const handleVersionImageError = async (generationId: string, targetVersion: GenerationVersion) => {
    const key = getVersionImageKey(generationId, targetVersion.id);
    const currentSource = versionImageSrcByKey[key];
    if (currentSource?.startsWith('blob:')) return;

    // Path 1 — inline bytes available.
    const inlineBlobUrl = createBlobUrlFromImage({
      imageUrl: targetVersion.imageUrl,
      base64Data: targetVersion.imageData,
      mimeType: targetVersion.mimeType
    });
    if (inlineBlobUrl) {
      const previousBlobUrl = versionBlobUrlsRef.current[key];
      if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl);
      versionBlobUrlsRef.current[key] = inlineBlobUrl;
      setVersionImageSrcByKey((prev) => ({ ...prev, [key]: inlineBlobUrl }));
      return;
    }

    // Path 2 — IndexedDB cache lookup.
    if (!targetVersion.id) return;
    try {
      const cachedBlobUrl = await getCachedImageBlobUrl(generationId, targetVersion.id);
      if (!cachedBlobUrl) return;
      // Re-check the slot wasn't filled while we awaited IDB.
      if (versionBlobUrlsRef.current[key]) {
        URL.revokeObjectURL(cachedBlobUrl);
        return;
      }
      versionBlobUrlsRef.current[key] = cachedBlobUrl;
      setVersionImageSrcByKey((prev) => ({ ...prev, [key]: cachedBlobUrl }));
    } catch (error) {
      console.warn('[ImageDisplay] Failed to load cached version blob URL:', error);
    }
  };

  const refineModelOptions = SUPPORTED_MODELS.filter((model) =>
    isSvg ? true : model.format !== 'vector'
  );
  // Default the refine model to whichever model produced the active version.
  // For comparison tiles this means switching between marks made by Nano
  // Banana Pro vs GPT Image 2 also flips the refine dropdown to that model,
  // which is what users intuitively want ("refine THIS image"). Falls back
  // to the existing selection or the tile's primary model if nothing matches.
  const versionModelId = version?.modelId;
  const tileModelId = generation?.modelId;
  const preferredRefineModelId = (() => {
    if (versionModelId && refineModelOptions.some((m) => m.id === versionModelId)) {
      return versionModelId;
    }
    if (refineModelOptions.some((m) => m.id === selectedModel)) return selectedModel;
    if (tileModelId && refineModelOptions.some((m) => m.id === tileModelId)) {
      return tileModelId;
    }
    return refineModelOptions[0]?.id || selectedModel;
  })();
  const safeRefineModelId = preferredRefineModelId;

  const refineModelSyncKey = generation && version ? `${generation.id}|${version.id}` : null;
  useEffect(() => {
    if (!refineModelSyncKey) {
      lastRefineModelSyncKeyRef.current = null;
      return;
    }
    if (lastRefineModelSyncKeyRef.current === refineModelSyncKey) return;
    lastRefineModelSyncKeyRef.current = refineModelSyncKey;
    if (safeRefineModelId !== selectedModel) {
      onModelChange(safeRefineModelId);
    }
  }, [refineModelSyncKey, safeRefineModelId, selectedModel, onModelChange]);

  useEffect(() => {
    if (!generation || !version) return;
    const source = normalizeAspectRatio(version.aspectRatio || generation.config.aspectRatio || '');
    const normalizedOptions = resizeAspectRatios
      .map((ratio) => normalizeAspectRatio(ratio.value))
      .filter(Boolean);
    if (normalizedOptions.length === 0) return;

    const firstDifferent = normalizedOptions.find((value) => value !== source) || normalizedOptions[0];
    setResizeAspectRatio((current) => {
      const normalizedCurrent = normalizeAspectRatio(current);
      if (normalizedCurrent && normalizedOptions.includes(normalizedCurrent)) {
        return normalizedCurrent;
      }
      return firstDifferent;
    });
  }, [generation?.id, generation?.config.aspectRatio, version?.id, version?.aspectRatio, resizeAspectRatios]);

  if (!generation || !version) {
    // When a brand-new batch is starting (`isBatchStarting`) or preview pipelines
    // are busy before the first tile mounts, show "Generating…" instead of "Ready".
    if (isBatchStarting || isRefining) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center h-full min-h-[60vh] text-slate-900 dark:text-white">
          <div className="w-24 h-24 rounded-3xl bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] flex items-center justify-center mb-6 shadow-xl shadow-slate-200 dark:shadow-black/50">
            <span
              className="h-10 w-10 rounded-full border-[3px] border-brand-teal/25 border-t-brand-teal animate-spin"
              role="progressbar"
              aria-label="Generating"
            />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Generating…</h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-md mt-3 text-sm leading-relaxed">
            Your first result will land here as soon as the model responds. Track progress in the Active Generations panel.
          </p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center h-full min-h-[60vh] text-slate-900 dark:text-white">
        <div className="w-24 h-24 rounded-3xl bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] flex items-center justify-center mb-6 shadow-xl shadow-slate-200 dark:shadow-black/50 rotate-3 transition-transform hover:rotate-0">
          <ImageIcon size={40} className="text-slate-400 dark:text-slate-600" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Ready to Create</h2>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mt-3 text-sm leading-relaxed">
          Configure your brand settings in the toolbar above and enter a prompt to generate professional, consistent graphics instantly.
        </p>
      </div>
    );
  }

  const cfg = generation.config;
  const hasMultipleVersions = generation.versions.length > 1;
  // True when this tile holds versions from more than one model (i.e. a
  // comparison run). Triggers the per-thumb model chip + mixed-model badge
  // in the details panel.
  const distinctVersionModels = new Set(
    generation.versions.map((v) => v.modelId).filter(Boolean) as string[]
  );
  const hasMixedModels = distinctVersionModels.size > 1;
  const resizeSourceAspectRatio = normalizeAspectRatio(version.aspectRatio || generation.config.aspectRatio || '');
  const resizeSourceLabel = getLabel(resizeSourceAspectRatio, resizeAspectRatios) || resizeSourceAspectRatio;
  const resizeAspectLabel = getLabel(resizeAspectRatio, resizeAspectRatios) || resizeAspectRatio;
  const canResizeToSelected = Boolean(
    resizeAspectRatio &&
      resizeSourceAspectRatio &&
      normalizeAspectRatio(resizeAspectRatio) !== normalizeAspectRatio(resizeSourceAspectRatio)
  );
  const refineModelSelectOptions: RichSelectOption[] = refineModelOptions.map((model) => ({
    value: model.id,
    label: modelLabelMap[model.id] || model.name,
    description: model.description,
    group: model.group
  }));
  const resizeTargetOptions = resizeAspectRatios.reduce<RichSelectOption[]>((acc, ratio) => {
    const normalizedValue = normalizeAspectRatio(ratio.value);
    if (!normalizedValue || acc.some((option) => option.value === normalizedValue)) {
      return acc;
    }
    const optionLabel = ratio.label || ratio.name || normalizedValue;
    acc.push({
      value: normalizedValue,
      label: optionLabel,
      description: normalizedValue === resizeSourceAspectRatio ? 'Current size' : undefined
    });
    return acc;
  }, []);

  const ActionButton = ({ onClick, title, children, tooltip, variant = 'default', className: extraClass }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    tooltip: string;
    variant?: 'default' | 'danger' | 'busy';
    className?: string;
  }) => (
    <button
      onClick={onClick}
      className={`group/btn ${variant === 'danger'
        ? 'bg-white/85 dark:bg-[#2b1c1c]/85 border border-red-200/80 dark:border-red-900/40 text-red-600 dark:text-red-200 hover:bg-red-600 hover:border-red-600 hover:text-white'
        : variant === 'busy'
          ? 'bg-brand-red border border-brand-red text-white cursor-default animate-pulse'
          : 'bg-white/90 dark:bg-[#1f252d]/90 border border-gray-300/80 dark:border-white/15 text-slate-800 dark:text-slate-200 hover:bg-brand-teal hover:border-brand-teal hover:text-white'
      } p-2.5 lg:p-3 rounded-xl shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-teal/70 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-[#161b22] transition relative ${extraClass || ''}`}
      title={title}
    >
      {children}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity">
        {tooltip}
      </span>
    </button>
  );

  // Roman-numeral suffix of `version.label`. Labels look like "Mark III"
  // (see `toMarkLabel` in versionUtils), so stripping the prefix gives us
  // just the numeral for the compact in-image chip.
  const versionRomanNumeral = version
    ? version.label.replace(/^Mark\s+/, '')
    : '';

  // Derived counters used by the fullscreen chrome. We render even when the
  // counter is 1/1 so the user always knows where they are while flipping.
  const fullscreenPositionLabel =
    currentIdxInHistory >= 0 && navHistory.length > 0
      ? `${currentIdxInHistory + 1} / ${navHistory.length}`
      : '';
  const fullscreenMarkLabel =
    version && generation && generation.versions.length > 1
      ? `${version.label} · ${generation.currentVersionIndex + 1} / ${generation.versions.length}`
      : version?.label || '';

  return (
    <>
    <div className={`relative flex flex-col ${toolbarCollapsed ? '' : 'flex-1 h-full'}`}>
      {/* Main Viewport — the thumbnail rail (when multiple versions exist)
          lives inside the same centered row as the image card so its height
          tracks the image, not the full viewport. This avoids a tall,
          mostly-empty rail when there are only a handful of marks.

          In focus mode (toolbar hidden) the area HUGS the image instead of
          stretching to fill: a wide (e.g. 16:9) graphic is width-constrained,
          so a flex-1 area just wraps it in big empty bands above and below.
          Hugging removes that dead space; the gallery sits right under the
          image. Expanded mode keeps flex-1 so the image shrinks to fit
          alongside the open toolbar without forcing a scroll. */}
      <div
        className={`overflow-auto flex items-center justify-center ${
          toolbarCollapsed ? 'p-2 md:p-3' : 'flex-1 p-4 md:p-8 min-h-0'
        }`}
      >
        {/* Keep a concrete row width so compare mode can't shrink-wrap around
            the slider surface. Without `w-full`, this row can collapse to the
            intrinsic width of its children. `group` drives the hover-reveal
            behavior of the in-image overlays AND the rail — hover anywhere
            over the preview area to surface the chrome. The rail is
            absolutely positioned (see below) so it floats over the image's
            left edge instead of reserving width; the image card therefore
            reclaims the rail's footprint at rest and gets the full row
            width to render itself. `relative` is needed for the absolute
            rail to anchor against this row. */}
        <div
          ref={mainPreviewGroupRef}
          // `data-[idle=true]:cursor-none` hides the system cursor when the
          // idle tracker flips `data-idle="true"` (5s with no mouse motion
          // over this area, or after arrow-key history nav). Mouse motion
          // restores it instantly via the effect above. `cursor-none`
          // cascades to child elements that don't set their own cursor,
          // which covers the image, edge buttons, and history arrows.
          className="group relative w-full min-w-0 flex items-stretch gap-3 max-h-full mx-auto max-w-7xl data-[idle=true]:cursor-none"
          data-dragging={isSliderDragging ? 'true' : undefined}
          data-idle={isPreviewMouseIdle ? 'true' : undefined}
        >

          {/* Thumbnail rail — absolutely positioned so it floats on top of
              the row's left edge instead of taking 124px out of layout.
              At rest the image card therefore renders edge-to-edge and the
              rail is invisible; rolling over the preview row reveals the
              rail with a small slide-in. While picking/comparing the rail
              stays at full opacity (and pointer-events on) so the user can
              drive the two-mark flow without their cursor having to
              babysit the image. The inner scroller is `absolute inset-0`
              against THIS wrapper, so the wrapper still needs a concrete
              height — `top-0 bottom-0` does that against the row.

              Rendered for any generation with at least one version (i.e.
              always) so the "Add a new Mark" plus button at the bottom of
              the rail is reachable even on single-version generations —
              that's how users iterate on a fresh result without hunting
              for the refine bar. The Compare control inside the rail is
              still gated on hasMultipleVersions below since you can't
              compare a mark against itself. */}
          {generation.versions.length >= 1 && (
            <div
              className={`absolute top-0 bottom-0 left-0 w-[124px] z-30 transition-all duration-200 group-data-[dragging=true]:!opacity-0 group-data-[dragging=true]:!pointer-events-none ${
                isCompareMode || isComparing
                  ? 'opacity-100 translate-x-0 pointer-events-auto'
                  : 'opacity-0 -translate-x-2 pointer-events-none group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-x-0 group-focus-within:pointer-events-auto group-data-[idle=true]:!opacity-0 group-data-[idle=true]:!pointer-events-none'
              }`}
            >
              <div
                ref={railInnerRef}
                onScroll={() => setHoveredVersionIdx(null)}
                onMouseLeave={() => setHoveredVersionIdx(null)}
                className="absolute inset-0 overflow-y-auto py-2 px-2 flex flex-col gap-2 rounded-lg border border-gray-200 dark:border-[#30363d] bg-gray-50/60 dark:bg-[#0d1117]/60"
                role="listbox"
                aria-label="Generation versions"
              >
                {/* Persistent "Compare" affordance at the top of the rail.
                    Clicking toggles compare-picker mode so users who don't
                    realize the hidden toolbar button or the shift-click
                    shortcut exist still have a visible path to the slider.
                    Sticky so it stays anchored while scrolling long rails.
                    Docked (faded out) at rest so it doesn't compete with
                    the large image; reveals when the user rolls over the
                    preview row. While actively in compare/picking mode the
                    button stays at full opacity so the user can always
                    bail out. */}
                {hasMultipleVersions && onEnterComparePicker && onExitComparePicker && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isCompareMode || isComparing) {
                        onExitComparePicker();
                      } else {
                        handleEnterCompareFromButton();
                      }
                    }}
                    title={
                      isCompareMode
                        ? 'Cancel — exit compare mode'
                        : isComparing
                          ? 'Close the comparison viewer'
                          : 'Open compare: click two marks (or Shift-click to pick without toggling)'
                    }
                    className={`sticky top-0 z-10 -mx-2 -mt-2 mb-1 px-2 py-1.5 flex items-center gap-1.5 justify-center text-[11px] font-bold uppercase tracking-wider border-b transition-all ${
                      isCompareMode || isComparing
                        ? 'opacity-100 bg-brand-teal text-white border-brand-teal hover:bg-brand-teal/90'
                        : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 bg-gray-100 dark:bg-[#161b22] text-slate-600 dark:text-slate-300 border-gray-200 dark:border-[#30363d] hover:bg-brand-teal/10 hover:text-brand-teal hover:border-brand-teal/40'
                    }`}
                  >
                    <GitCompare size={12} />
                    {isCompareMode ? 'Cancel' : isComparing ? 'Close' : 'Compare'}
                  </button>
                )}
                {generation.versions.map((v, idx) => {
                  const isCommitted = idx === generation.currentVersionIndex;
                  const isHovered = idx === hoveredVersionIdx;
                  const isSvgThumb = v.mimeType === 'image/svg+xml';
                  const pickSide = isMarkPicked(generation.id, v.id);
                  // Per-version model wins over the tile's primary model so
                  // comparison runs (mixed-model tiles) pick the right model
                  // for the slider label / refine fan-out.
                  const thumbModelId = v.modelId || generation.modelId;
                  const thumbImageUrl = getVersionDisplayImageUrl(generation.id, v);
                  const markRef: ImageDisplayMarkRef = {
                    generationId: generation.id,
                    versionId: v.id,
                    imageUrl: thumbImageUrl,
                    mimeType: v.mimeType,
                    modelId: thumbModelId,
                    markLabel: v.label,
                    aspectRatio: v.aspectRatio || generation.config.aspectRatio,
                  };
                  // Anchor the popover so its TOP edge lines up with the
                  // hovered thumbnail's TOP edge — i.e. it tracks the
                  // square thumbnails as the user scrubs the rail. We
                  // compute viewport coordinates (used with
                  // `position: fixed`) so the popover can sit anywhere on
                  // screen without being clipped by overflow:auto ancestors
                  // or covered by the higher-z page header. The vertical
                  // position is clamped to keep the entire card within an
                  // 8px safe area at the top and bottom of the viewport.
                  const positionPreview = (btn: HTMLButtonElement) => {
                    const ratio = v.aspectRatio || generation.config.aspectRatio;
                    const previewHeight = getHoverPreviewHeight(ratio);
                    const rect = btn.getBoundingClientRect();
                    const safeTop = 8;
                    const safeBottom = 8;
                    const minTop = safeTop;
                    const maxTop = Math.max(safeTop, window.innerHeight - previewHeight - safeBottom);
                    const top = Math.min(Math.max(rect.top, minTop), maxTop);
                    const left = rect.right + 12;
                    setPopoverPos({ top, left });
                  };
                  const handleEnter: React.MouseEventHandler<HTMLButtonElement> = (event) => {
                    setHoveredVersionIdx(idx);
                    positionPreview(event.currentTarget);
                  };
                  const handleFocus: React.FocusEventHandler<HTMLButtonElement> = (event) => {
                    setHoveredVersionIdx(idx);
                    positionPreview(event.currentTarget);
                  };
                  // Hover-delete affordance on the rail. Sits absolutely on
                  // top of the thumb button as a sibling (not nested) so it
                  // doesn't violate the no-button-in-button rule. Hidden when
                  // a generation has only one version (the underlying
                  // handler refuses to delete the last one) and while in
                  // compare-pick / comparing mode so it can't fight with the
                  // pick-two flow. Visible whenever the thumb is hovered or
                  // keyboard-focused so it's discoverable without obscuring
                  // the image at rest.
                  const showRailDelete =
                    generation.versions.length > 1 && !isCompareMode && !isComparing;
                  const isRailDeleteArmed = confirmVersionDelete.isArmed(v.id);
                  const railDeleteVisible =
                    showRailDelete && (isHovered || deletingRefinementId === v.id || isRailDeleteArmed);
                  const isStarredVersion = generation.starredVersionId === v.id;
                  return (
                    <div key={v.id} className="relative w-full group/railThumb">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isCommitted}
                      title={v.label}
                      onMouseEnter={handleEnter}
                      onFocus={handleFocus}
                      onBlur={() => setHoveredVersionIdx((prev) => (prev === idx ? null : prev))}
                      onClick={(event) => handleMarkActivate(event, markRef, () => onVersionChange(idx))}
                      className={`relative shrink-0 w-full aspect-square rounded-md overflow-hidden border transition-all ${
                        pickSide
                          ? 'border-2 border-amber-400 ring-2 ring-amber-400/50 ring-offset-2 ring-offset-gray-50 dark:ring-offset-[#0d1117]'
                          : isCompareMode
                            ? 'border-dashed border-brand-teal/60 hover:border-brand-teal'
                            : isCommitted
                              ? 'border-[3px] border-brand-teal ring-2 ring-brand-teal/50 ring-offset-2 ring-offset-gray-50 dark:ring-offset-[#0d1117] shadow-lg shadow-brand-teal/20'
                              : isHovered
                                ? 'border-brand-teal/70'
                                : 'border-gray-200 dark:border-[#30363d] hover:border-brand-teal/40'
                      }`}
                    >
                      {isSvgThumb && v.svgCode ? (
                        <div
                          className="w-full h-full bg-white flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                          dangerouslySetInnerHTML={{ __html: sanitizeSvg(v.svgCode) }}
                        />
                      ) : v.imageUrl ? (
                        <img
                          src={thumbImageUrl}
                          alt={v.label}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={() => handleVersionImageError(generation.id, v)}
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-100 dark:bg-[#161b22]" />
                      )}
                      {pickSide && (
                        <span className="absolute top-1 left-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-[10px] font-bold text-slate-900 shadow">
                          {pickSide.toUpperCase()}
                        </span>
                      )}
                      {isCommitted && !pickSide && (
                        <span
                          aria-hidden="true"
                          className="absolute top-1 right-1 inline-flex items-center justify-center w-2.5 h-2.5 rounded-full bg-brand-teal shadow ring-2 ring-white dark:ring-[#0d1117]"
                          title="Currently shown"
                        />
                      )}
                      {hasMixedModels && thumbModelId && (
                        <span
                          className="absolute bottom-1 left-1 right-1 inline-flex items-center justify-center px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-black/70 text-white shadow truncate"
                          title={modelLabelMap[thumbModelId] || getModelDisplayName(thumbModelId)}
                        >
                          {modelShortLabelMap[thumbModelId] || modelLabelMap[thumbModelId] || getModelDisplayName(thumbModelId)}
                        </span>
                      )}
                    </button>
                    {showRailDelete && (
                      <button
                        type="button"
                        onMouseEnter={() => setHoveredVersionIdx(idx)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleVersionDeleteClick(v.id);
                        }}
                        disabled={Boolean(deletingRefinementId)}
                        aria-label={isRailDeleteArmed ? `Click again to confirm deleting ${v.label}` : `Delete ${v.label}`}
                        title={isRailDeleteArmed ? `Click again to confirm` : `Delete ${v.label}`}
                        className={`absolute top-1 right-1 z-10 inline-flex items-center justify-center h-5 w-5 rounded-full shadow ring-1 ring-white/40 dark:ring-black/40 transition-all focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-400/70 ${
                          railDeleteVisible
                            ? 'opacity-100'
                            : 'opacity-0 group-hover/railThumb:opacity-100'
                        } ${
                          deletingRefinementId
                            ? 'cursor-not-allowed bg-red-400 text-white'
                            : isRailDeleteArmed
                              ? 'bg-amber-500 text-white hover:bg-amber-600 animate-pulse'
                              : 'bg-red-600 text-white hover:bg-red-700'
                        }`}
                      >
                        {deletingRefinementId === v.id ? (
                          <RefreshCw size={11} className="animate-spin" />
                        ) : isRailDeleteArmed ? (
                          <Check size={11} strokeWidth={3} />
                        ) : (
                          <X size={11} strokeWidth={3} />
                        )}
                      </button>
                    )}
                    {/* "Best Mark" star toggle on each rail thumb. Hidden by
                        default (revealed on hover of the thumb) when not
                        starred; persistently visible with a filled amber glyph
                        when starred. Top-left corner pairs with the delete X
                        on the right; suppressed during compare-pick so the
                        A/B letter pill in the same corner stays unambiguous. */}
                    {onToggleStarred && !pickSide && (
                      <button
                        type="button"
                        onMouseEnter={() => setHoveredVersionIdx(idx)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleStarToggle(v.id);
                        }}
                        aria-label={isStarredVersion ? `Unstar ${v.label}` : `Star ${v.label} as the best Mark`}
                        aria-pressed={isStarredVersion}
                        title={isStarredVersion ? `Starred — Unstar ${v.label}` : `Star ${v.label} as the best Mark (S)`}
                        className={`absolute top-1 left-1 z-10 inline-flex items-center justify-center h-5 w-5 rounded-full shadow ring-1 ring-white/40 dark:ring-black/40 transition-all focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-amber-400/70 ${
                          isStarredVersion
                            ? 'opacity-100 bg-amber-400 text-white hover:bg-amber-300'
                            : 'opacity-0 group-hover/railThumb:opacity-100 bg-black/50 text-white hover:bg-amber-400'
                        }`}
                      >
                        <Star
                          size={11}
                          strokeWidth={2.5}
                          className={isStarredVersion ? 'fill-current' : ''}
                        />
                      </button>
                    )}
                    </div>
                  );
                })}

                {/* In-flight "Add a new Mark" placeholders. When the user
                    batches re-rolls (hold 1-9 + click + / pick a count in
                    the editor) we want them to immediately see N pending
                    boxes — not a single spinner that swaps places — so the
                    upcoming Marks are visible the moment they click. Each
                    placeholder shows a spinning loader and clears as the
                    real Mark lands (App decrements `pendingRerunCount`). */}
                {!isCompareMode && !isComparing && pendingRerunCount > 0 && (
                  Array.from({ length: pendingRerunCount }).map((_, i) => (
                    <div
                      key={`pending-rerun-${i}`}
                      className="shrink-0 w-full aspect-square rounded-md border-2 border-dashed border-brand-teal/50 bg-brand-teal/5 flex items-center justify-center text-brand-teal animate-pulse"
                      role="status"
                      aria-label={`Mark ${i + 1} of ${pendingRerunCount} generating`}
                      title={`Generating Mark ${i + 1} of ${pendingRerunCount}…`}
                    >
                      <RefreshCw size={22} strokeWidth={2.5} className="animate-spin" aria-hidden="true" />
                    </div>
                  ))
                )}

                {/* "Add a new Mark" affordance — sits after the last thumb so
                    users can iterate on the current image without hunting for
                    the refine bar. One-click "re-roll": runs the original
                    generation prompt through a FRESH generation (no previous
                    image input, no preservation directives) so the new Mark
                    is a creative re-take on the same brief — the model is
                    free to rethink layout, palette application, and
                    composition rather than just nudging the existing image.
                    Shift-click opens the full prompt editor for users who
                    want to tweak before sending. Hidden in compare-pick /
                    comparing mode so it can't fight with the two-mark
                    selection flow. */}
                {!isCompareMode && !isComparing && (() => {
                  // Prefer the tile's ORIGINAL generation prompt over the
                  // current version's refinementPrompt — the refine prompt
                  // is an incremental edit instruction ("make the title
                  // bigger") that isn't useful as a standalone prompt for a
                  // fresh image. The original prompt is what produced the
                  // tile and is the right brief to re-roll against.
                  const lastPrompt =
                    (generation.config.prompt && generation.config.prompt.trim()) ||
                    (version?.refinementPrompt && version.refinementPrompt.trim()) ||
                    '';
                  const hasLastPrompt = Boolean(lastPrompt);
                  const canRerun = hasLastPrompt && !!onRerun;
                  const handleAddMarkClick = (event: React.MouseEvent) => {
                    const heldDigit = heldDigitRef.current;
                    if (event.shiftKey || !canRerun) {
                      setPromptEditorMode('rerun');
                      setRerunDraft(lastPrompt);
                      setRerunCount(heldDigit ?? 1);
                      setIsPromptEditorOpen(true);
                      return;
                    }
                    onRerun!(lastPrompt, heldDigit ?? 1);
                  };
                  const titleText = canRerun
                    ? 'Add a new Mark — re-roll the original prompt. Hold 1-9 to batch; Shift-click to edit prompt or count.'
                    : 'Add a new Mark — open the refine editor';
                  // Show the "×N" badge whenever a digit is held, even
                  // briefly — gives the user immediate visual confirmation
                  // that the next click will batch N re-rolls. We only
                  // render when canRerun (no point teasing if the rerun
                  // path won't fire) and never for "1" (that's the default
                  // and would just be visual noise).
                  const showHeldBadge = canRerun && heldDigit !== null && heldDigit > 1;
                  const openTip = (e: React.MouseEvent | React.FocusEvent) => {
                    if (!canRerun) return;
                    const wrapper = e.currentTarget as HTMLElement;
                    const r = wrapper.getBoundingClientRect();
                    setAddMarkTipAnchor({ top: r.top, bottom: r.bottom, right: r.right });
                    setAddMarkTipVisible(true);
                  };
                  const closeTip = () => setAddMarkTipVisible(false);
                  return (
                    <div
                      className="group/addmark relative shrink-0 w-full"
                      onMouseEnter={openTip}
                      onMouseLeave={closeTip}
                      onFocus={openTip}
                      onBlur={closeTip}
                    >
                      <button
                        type="button"
                        onClick={handleAddMarkClick}
                        onMouseEnter={() => setHoveredVersionIdx(null)}
                        onFocus={() => setHoveredVersionIdx(null)}
                        disabled={refinementControlsLocked}
                        aria-label={canRerun ? 'Add a new Mark — re-roll the original prompt' : 'Add a new Mark'}
                        // Keep the native `title` as a short fallback for
                        // screen readers / browser-default tooltips. The rich
                        // panel below is the primary discovery surface.
                        title={titleText}
                        className="block w-full aspect-square rounded-md border-2 border-dashed border-gray-300 dark:border-[#30363d] text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-[#161b22]/60 hover:border-brand-teal hover:text-brand-teal hover:bg-brand-teal/5 focus:outline-none focus:ring-2 focus:ring-brand-teal/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="w-full h-full flex items-center justify-center">
                          {/* Always show the Plus glyph so the button stays
                              recognizable as "add another Mark". In-flight
                              work is conveyed by the separate spinner
                              placeholder boxes rendered above the "+", so
                              swapping the icon would just be redundant —
                              and confusing, because it makes the affordance
                              look like a generating tile rather than a
                              clickable target. */}
                          <Plus size={28} strokeWidth={2.5} aria-hidden="true" />
                        </span>
                      </button>
                      {showHeldBadge && (
                        <span
                          role="status"
                          aria-live="polite"
                          aria-label={`Hold ${heldDigit}: next click adds ${heldDigit} Marks`}
                          className="pointer-events-none absolute -top-1.5 -right-1.5 z-10 min-w-6 h-6 px-1.5 inline-flex items-center justify-center rounded-full bg-brand-teal text-white text-[11px] font-bold shadow-lg ring-2 ring-white dark:ring-[#0d1117] tabular-nums animate-in zoom-in-50 duration-150"
                        >
                          ×{heldDigit}
                        </span>
                      )}
                    </div>
                  );
                })()}

                {/* Portaled rich tooltip for the "+" button. Lives outside
                    the rail's `overflow-y-auto` container so it can extend
                    to the right of the rail without being clipped. Anchored
                    to the wrapper's rect, captured on enter/focus. */}
                {addMarkTipVisible && addMarkTipAnchor && typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      role="tooltip"
                      style={{
                        position: 'fixed',
                        top: Math.max(8, Math.min(addMarkTipAnchor.bottom - 234, window.innerHeight - 242)),
                        left: addMarkTipAnchor.right + 12,
                        zIndex: 80,
                      }}
                      className="pointer-events-none w-64 px-3 py-2.5 rounded-xl bg-black/90 text-white shadow-xl"
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Add a new Mark
                      </div>
                      <div className="text-[11px] leading-relaxed text-slate-100 mb-2">
                        Re-rolls the original prompt as a fresh generation — the model is free to rethink layout, palette, and composition.
                      </div>
                      <div className="pt-2 border-t border-white/10 space-y-1.5 text-[11px] text-slate-300">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 shrink-0">
                            <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">Click</kbd>
                          </span>
                          <span>Add one Mark</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 shrink-0">
                            <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">1-9</kbd>
                            <span className="text-slate-400">+</span>
                            <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">Click</kbd>
                          </span>
                          <span>Add that many Marks</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="inline-flex items-center gap-1 shrink-0 mt-0.5">
                            <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">⇧</kbd>
                            <span className="text-slate-400">+</span>
                            <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">Click</kbd>
                          </span>
                          <span>Open the editor (edit the prompt or pick a count)</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="inline-flex items-center gap-1 shrink-0 mt-0.5">
                            <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">1-9</kbd>
                            <span className="text-slate-400">+</span>
                            <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">⇧</kbd>
                            <span className="text-slate-400">+</span>
                            <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">Click</kbd>
                          </span>
                          <span>Open the editor pre-filled with that count</span>
                        </div>
                      </div>
                    </div>,
                    document.body
                  )
                }
              </div>

              {/* Ephemeral "shift-click another to compare" hint. Pops up for
                  ~4s after a normal thumbnail click so users discover the
                  compare shortcut without a modal/onboarding flow. Anchored
                  to the bottom of the rail so it never overlaps thumbs. */}
              {compareHintVisible && onPickMark && !isCompareMode && !isComparing && (
                <div
                  className="pointer-events-none absolute left-full ml-3 bottom-2 z-20 animate-in fade-in slide-in-from-left-2 duration-200"
                  role="status"
                  aria-live="polite"
                >
                  <div className="px-3 py-2 rounded-lg bg-slate-900 dark:bg-[#161b22] text-white text-xs font-medium shadow-lg border border-slate-800 dark:border-[#30363d] whitespace-nowrap flex items-center gap-2">
                    <GitCompare size={13} className="text-brand-teal" />
                    <span>
                      <span className="text-brand-teal font-bold">Shift-click</span>{' '}
                      another thumbnail to compare
                    </span>
                  </div>
                </div>
              )}

              {/* Floating hover/focus preview — uses `position: fixed` so
                  the page header (z-50) and the main viewport's
                  overflow:auto can't clip or cover it. Coordinates are
                  computed from the hovered thumb's bounding rect and
                  clamped to stay fully on-screen. Purely visual
                  (pointer-events: none) so it never steals clicks from
                  the next thumb. */}
              {hoveredVersionIdx !== null && generation.versions[hoveredVersionIdx] && (() => {
                const v = generation.versions[hoveredVersionIdx];
                const isCommitted = hoveredVersionIdx === generation.currentVersionIndex;
                const isSvgThumb = v.mimeType === 'image/svg+xml';
                const previewStyle = getHoverPreviewStyle(v.aspectRatio || generation.config.aspectRatio);
                const previewImageUrl = getVersionDisplayImageUrl(generation.id, v);
                return (
                  <div
                    className="pointer-events-none fixed z-[60] animate-in fade-in zoom-in-95 duration-150"
                    style={{ top: popoverPos.top, left: popoverPos.left }}
                    aria-hidden="true"
                  >
                    <div
                      className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg shadow-2xl overflow-hidden"
                      style={{ width: previewStyle.width }}
                    >
                      <div
                        className="bg-gray-50 dark:bg-[#0d1117] flex items-center justify-center"
                        style={{ aspectRatio: previewStyle.aspectRatio }}
                      >
                        {isSvgThumb && v.svgCode ? (
                          <div
                            className="w-full h-full bg-white flex items-center justify-center p-3 [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                            dangerouslySetInnerHTML={{ __html: sanitizeSvg(v.svgCode) }}
                          />
                        ) : v.imageUrl ? (
                          <img
                            src={previewImageUrl}
                            alt=""
                            className="w-full h-full object-contain"
                            onError={() => handleVersionImageError(generation.id, v)}
                          />
                        ) : null}
                      </div>
                      <div className="px-3 py-2 flex items-center justify-between gap-2 border-t border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22]">
                        <span className={`text-xs font-semibold ${isCommitted ? 'text-brand-teal' : 'text-slate-700 dark:text-slate-200'}`}>
                          {v.label}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400">
                          {v.type === 'refinement' ? 'Refinement' : 'Original'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Keep preview + rail as one centered block. Using `flex-1` here
              stretches the preview column across all remaining width, which
              makes `items-start` look like a global left align and
              `items-center` create a big gap from the rail. */}
          <div className="min-w-0 w-full max-w-7xl flex flex-col items-center">
          <div className={`relative ${isSvg || isComparing ? 'w-full' : 'max-w-full max-h-full'}`}>
          <div className="absolute inset-0 bg-brand-red/20 blur-3xl rounded-full opacity-20 pointer-events-none"></div>
          <div className="relative shadow-2xl shadow-slate-300 dark:shadow-black rounded-lg overflow-visible border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117]">

            {/* Carousel arrows — step to a neighboring generation in history.
                Hidden while the comparison slider is active so we don't pile
                on top of its own controls, and individually disabled at the
                edges of the history list. Mirrors the keyboard ←/→ shortcut.
                The LEFT arrow used to sit at `left-3` of the card, but now
                that the rail floats over the row's leftmost 124px the arrow
                would get hidden behind it. Pushing the arrow past the
                rail's footprint (left-[136px] = 124px rail + 12px gap)
                keeps it reachable when the row is hovered and the rail is
                visible alongside the navigation controls. */}
            {canNavigate && (canGoNewer || canGoOlder) && (
              <>
                <div className="hidden sm:block absolute top-1/2 -translate-y-1/2 left-[136px] z-20 group/arrowBtn opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity group-data-[dragging=true]:!opacity-0 group-data-[dragging=true]:!pointer-events-none group-data-[idle=true]:!opacity-0 group-data-[idle=true]:!pointer-events-none">
                  <button
                    type="button"
                    onClick={goNewer}
                    disabled={!canGoNewer}
                    aria-label="Previous generation (newer)"
                    className="inline-flex items-center justify-center h-11 w-11 rounded-full border border-gray-300/80 dark:border-white/15 bg-white/90 dark:bg-[#1f252d]/90 text-slate-800 dark:text-slate-200 shadow-lg backdrop-blur-sm hover:bg-brand-teal hover:border-brand-teal hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-teal/70 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-[#0d1117] disabled:opacity-30 disabled:pointer-events-none transition"
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <div
                    className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 w-60 px-3 py-2.5 rounded-xl bg-black/90 text-white shadow-xl opacity-0 group-hover/arrowBtn:opacity-100 group-focus-within/arrowBtn:opacity-100 transition-opacity z-30"
                    role="tooltip"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Previous generation</div>
                    <div className="text-[11px] leading-relaxed text-slate-100 mb-2">
                      {canGoNewer ? 'Step back to the previous tile in your history.' : 'No newer generation in history.'}
                    </div>
                    <div className="pt-2 border-t border-white/10 space-y-1 text-[11px] text-slate-300">
                      <div className="flex items-center gap-2">
                        <kbd className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">←</kbd>
                        <kbd className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">→</kbd>
                        <span>switch generations</span>
                      </div>
                      {hasMultipleVersions && (
                        <div className="flex items-center gap-2">
                          <kbd className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">↑</kbd>
                          <kbd className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">↓</kbd>
                          <span>cycle Marks</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="hidden sm:block absolute top-1/2 -translate-y-1/2 right-3 z-20 group/arrowBtn opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity group-data-[dragging=true]:!opacity-0 group-data-[dragging=true]:!pointer-events-none group-data-[idle=true]:!opacity-0 group-data-[idle=true]:!pointer-events-none">
                  <button
                    type="button"
                    onClick={goOlder}
                    disabled={!canGoOlder}
                    aria-label="Next generation (older)"
                    className="inline-flex items-center justify-center h-11 w-11 rounded-full border border-gray-300/80 dark:border-white/15 bg-white/90 dark:bg-[#1f252d]/90 text-slate-800 dark:text-slate-200 shadow-lg backdrop-blur-sm hover:bg-brand-teal hover:border-brand-teal hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-teal/70 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-[#0d1117] disabled:opacity-30 disabled:pointer-events-none transition"
                  >
                    <ChevronRight size={22} />
                  </button>
                  <div
                    className="pointer-events-none absolute right-full mr-3 top-1/2 -translate-y-1/2 w-60 px-3 py-2.5 rounded-xl bg-black/90 text-white shadow-xl opacity-0 group-hover/arrowBtn:opacity-100 group-focus-within/arrowBtn:opacity-100 transition-opacity z-30"
                    role="tooltip"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Next generation</div>
                    <div className="text-[11px] leading-relaxed text-slate-100 mb-2">
                      {canGoOlder ? 'Step forward to the next tile in your history.' : 'No older generation in history.'}
                    </div>
                    <div className="pt-2 border-t border-white/10 space-y-1 text-[11px] text-slate-300">
                      <div className="flex items-center gap-2">
                        <kbd className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">←</kbd>
                        <kbd className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">→</kbd>
                        <span>switch generations</span>
                      </div>
                      {hasMultipleVersions && (
                        <div className="flex items-center gap-2">
                          <kbd className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">↑</kbd>
                          <kbd className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded bg-white/10 border border-white/15 text-[10px] font-mono">↓</kbd>
                          <span>cycle Marks</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* Position counter — small, unobtrusive label so users know
                    where they are in the history without scrolling down. */}
                <div className="hidden sm:flex absolute bottom-3 left-1/2 -translate-x-1/2 z-20 items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-black/60 text-white backdrop-blur-sm shadow opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition pointer-events-none group-data-[dragging=true]:!opacity-0 group-data-[idle=true]:!opacity-0">
                  {currentIdxInHistory + 1} / {history.length}
                </div>
              </>
            )}


            {/* Main viewport renders the committed version — OR, when two
                marks have been picked for comparison, the Juxtapose slider
                fills the same shadow card directly (no inner padding, no
                embedded header) so it gets the same footprint as the plain
                preview. */}
            {isComparing && comparisonA && comparisonB ? (
              <JuxtaposeSlider
                imageA={comparisonA.imageUrl}
                imageB={comparisonB.imageUrl}
                labelA={comparisonA.markLabel}
                labelB={comparisonB.markLabel}
                aspectRatio={comparisonA.aspectRatio || comparisonB.aspectRatio}
                maxHeight={previewMaxHeight}
                toolbarOverlay
                className="block"
                onDraggingChange={setIsSliderDragging}
              />
            ) : isSvg && version.svgCode ? (
              <div
                ref={svgContainerRef}
                onClick={handleSvgContainerClick}
                className="w-full max-h-[70vh] overflow-auto p-4 flex items-center justify-center [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[65vh]"
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(version.svgCode) }}
              />
            ) : (
              <img
                src={renderImageSrc || version.imageUrl}
                alt="Generated Output"
                style={{ maxHeight: previewMaxHeight }}
                className="max-w-full object-contain block rounded-lg transition-[max-height] duration-300"
                onError={handleImageError}
              />
            )}

          {/* Persistent "this Mark is starred" indicator on the canvas. Shows
              whenever the displayed version is the one marked as the user's
              best for this tile. Top-left of the image so it stays out of
              the way of the bottom-right info overlay and the on-canvas
              chrome (delete / fullscreen) at top-right. */}
          {generation.starredVersionId && generation.starredVersionId === version.id && (
            <div
              className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-400 text-white shadow-lg ring-2 ring-white/60 dark:ring-black/40 animate-in fade-in slide-in-from-left-2 duration-150"
              role="status"
              aria-label={`${version.label} is starred as the best Mark`}
              title={`${version.label} is starred as the best Mark — press S to unstar`}
            >
              <Star size={12} strokeWidth={2.5} className="fill-current" />
              <span className="text-[10px] font-bold uppercase tracking-wider leading-none">
                Best
              </span>
            </div>
          )}

          {/* Info overlay (toggle) */}
          {infoVisible && (
            <div className="absolute right-4 bottom-4 z-10 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <div className="bg-black/80 backdrop-blur-sm text-white rounded-lg max-w-[420px] max-h-[220px] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Details</span>
                  <button onClick={() => setInfoVisible(false)} className="p-0.5 hover:text-brand-teal transition-colors">
                    <X size={14} />
                  </button>
                </div>
                <div className="px-3 pb-2.5 overflow-y-auto flex items-start gap-1.5 flex-wrap">
                  {(() => {
                    const val = getLabel(cfg?.graphicTypeId, options.graphicTypes);
                    return val ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-gray-500/60 bg-[#11151d] text-slate-100">
                        {val}
                      </span>
                    ) : null;
                  })()}
                  {(() => {
                    const val = getLabel(cfg?.visualStyleId, options.visualStyles);
                    return val ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-gray-500/60 bg-[#11151d] text-slate-100">
                        {val}
                      </span>
                    ) : null;
                  })()}
                  {(() => {
                    const val = cfg?.aspectRatio;
                    const label = val ? getLabel(val, options.aspectRatios) : '';
                    return label ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-gray-500/60 bg-[#11151d] text-slate-100">
                        {label}
                      </span>
                    ) : null;
                  })()}
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-brand-teal/15 text-brand-teal border border-brand-teal/50"
                    title={hasMixedModels ? 'Model that produced this version' : undefined}
                  >
                    {modelLabelMap[version.modelId || generation.modelId || ''] || getModelDisplayName(version.modelId || generation.modelId)}
                  </span>
                  {isSvg && cfg?.svgMode && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-purple-500/15 text-purple-400 border border-purple-500/50 capitalize">
                      {cfg.svgMode}
                    </span>
                  )}
                  {hasMultipleVersions && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/50">
                      {version.label}
                    </span>
                  )}
                  {version.timestamp && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-gray-500/60 bg-[#11151d] text-slate-100">
                      {formatTimestamp(version.timestamp)}
                    </span>
                  )}
                  {(() => {
                    const colors = getColors(cfg?.colorSchemeId);
                    if (!colors.length) return null;
                    return (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border border-gray-500/60 bg-[#11151d] text-slate-100 gap-1">
                      Colors
                        <span className="flex h-2 w-12 rounded-sm overflow-hidden ring-1 ring-black/20">
                          {colors.map((hex, idx) => (
                            <span key={idx} className="flex-1 h-full" style={{ backgroundColor: hex }} />
                          ))}
                        </span>
                      </span>
                    );
                  })()}
                  {cfg?.prompt && (
                    <span className="inline-flex px-2.5 py-1 rounded text-xs border border-gray-500/60 bg-[#11151d] text-slate-100 max-w-full break-words whitespace-normal leading-relaxed">
                      {cfg.prompt}
                    </span>
                  )}
                  {version.refinementPrompt && (
                    <span className="inline-flex px-2.5 py-1 rounded text-xs border border-amber-500/40 bg-amber-900/30 text-amber-200 max-w-full break-words whitespace-normal leading-relaxed">
                      Refined: {version.refinementPrompt}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
            
            {/* Docked compare overlay (top-center). The pick-mode banner
                ("Pick the second mark to compare") and the active-comparison
                header ("Comparing A vs B" + Close) used to live ABOVE the
                preview, eating vertical space. They're now in-image
                overlays that follow the same hover-reveal pattern as the
                action buttons and version chip — invisible by default,
                fade in when the user rolls over the preview area. */}
            {(isCompareMode || (isComparing && comparisonA && comparisonB)) && (
              <div
                className="absolute top-4 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-7rem)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[dragging=true]:!opacity-0 group-data-[dragging=true]:!pointer-events-none group-data-[idle=true]:!opacity-0 group-data-[idle=true]:!pointer-events-none transition-opacity"
                role="status"
                aria-live="polite"
              >
                {isComparing && comparisonA && comparisonB ? (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/90 dark:bg-[#161b22]/90 border border-gray-200 dark:border-white/15 shadow-lg backdrop-blur-md text-sm font-semibold text-brand-teal max-w-full">
                    <GitCompare size={14} className="shrink-0" />
                    {/* Compact label: just the two Mark names. Hovering the
                        corner chips on the slider surface still surfaces the
                        full model + mark identity if the user needs it. */}
                    <span
                      className="px-2 py-0.5 rounded bg-brand-teal/15 border border-brand-teal/40 text-brand-teal text-xs whitespace-nowrap"
                      title={`${modelLabelMap[comparisonA.modelId] || getModelDisplayName(comparisonA.modelId)} · ${comparisonA.markLabel}`}
                    >
                      {comparisonA.markLabel}
                    </span>
                    <span className="text-slate-400 shrink-0">vs</span>
                    <span
                      className="px-2 py-0.5 rounded bg-brand-teal/15 border border-brand-teal/40 text-brand-teal text-xs whitespace-nowrap"
                      title={`${modelLabelMap[comparisonB.modelId] || getModelDisplayName(comparisonB.modelId)} · ${comparisonB.markLabel}`}
                    >
                      {comparisonB.markLabel}
                    </span>
                    {onExitComparePicker && (
                      <button
                        type="button"
                        onClick={onExitComparePicker}
                        title="Close the comparison viewer"
                        aria-label="Close the comparison viewer"
                        className="ml-1 inline-flex items-center justify-center h-7 w-7 shrink-0 rounded-md text-slate-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-brand-teal/40 bg-brand-teal/10 backdrop-blur-md text-brand-teal text-sm font-medium shadow-lg max-w-full">
                    <GitCompare size={14} className="shrink-0" />
                    <span className="truncate">
                      {comparisonA
                        ? 'Pick the second mark to compare'
                        : 'Pick two marks to compare'}
                    </span>
                    {onExitComparePicker && (
                      <button
                        type="button"
                        onClick={onExitComparePicker}
                        title="Cancel compare"
                        aria-label="Cancel compare"
                        className="ml-1 text-[11px] uppercase tracking-wider font-bold text-brand-teal/80 hover:text-brand-teal underline-offset-2 hover:underline shrink-0"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* In-image version chip (top-left). Replaces the standalone
                "Mark III · Original" pill that previously sat above the
                preview and ate vertical space. Compact icon-only display
                with just the Roman numeral; hover/focus expands the chip
                to reveal the full label and a rich switcher menu listing
                every version with delete affordances. */}
            {hasMultipleVersions && !isComparing && (
              <div
                className={`absolute top-4 left-4 z-20 transition-opacity group-data-[dragging=true]:!opacity-0 group-data-[dragging=true]:!pointer-events-none ${
                  versionDropdownOpen
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[idle=true]:!opacity-0 group-data-[idle=true]:!pointer-events-none'
                }`}
              >
                <div className="relative group/version">
                  <button
                    type="button"
                    onClick={() => setVersionDropdownOpen(!versionDropdownOpen)}
                    aria-label={`Switch version (current: ${version.label}${version.type === 'refinement' ? ', refinement' : ''})`}
                    aria-haspopup="menu"
                    aria-expanded={versionDropdownOpen}
                    className={`inline-flex items-center gap-1.5 h-9 pl-2.5 pr-2 rounded-full border backdrop-blur-md shadow-lg transition-colors ${
                      versionDropdownOpen
                        ? 'bg-brand-teal text-white border-brand-teal'
                        : 'bg-white/90 dark:bg-[#161b22]/90 border-gray-200/80 dark:border-white/15 text-slate-900 dark:text-white hover:bg-brand-teal hover:text-white hover:border-brand-teal'
                    } focus:outline-none focus:ring-2 focus:ring-brand-teal/70`}
                  >
                    <Layers size={14} className="shrink-0" />
                    <span className="font-mono text-xs font-bold leading-none tracking-wider">{versionRomanNumeral}</span>
                    <ChevronDown size={13} className={`transition-transform ${versionDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Rich hover popover — only visible while the menu is
                      closed, so it doesn't fight with the open dropdown. */}
                  {!versionDropdownOpen && (
                    <div className="pointer-events-none absolute top-full left-0 mt-2 w-60 origin-top-left rounded-xl bg-black/90 text-white shadow-xl ring-1 ring-white/10 px-3 py-2.5 opacity-0 group-hover/version:opacity-100 transition-opacity duration-150 z-30">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Version</span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {(generation.currentVersionIndex ?? 0) + 1} / {generation.versions.length}
                        </span>
                      </div>
                      <div className="text-sm font-semibold">{version.label}</div>
                      {version.type === 'refinement' && version.refinementPrompt && (
                        <div className="mt-1 text-[11px] leading-snug text-amber-200 line-clamp-3">
                          Refined: {version.refinementPrompt}
                        </div>
                      )}
                      <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-slate-400">
                        Click to switch versions
                      </div>
                    </div>
                  )}

                  {versionDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setVersionDropdownOpen(false)} />
                      <div className="absolute top-full left-0 mt-2 w-auto min-w-[10rem] bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-20 overflow-hidden p-1">
                        {generation.versions.map((v, idx) => (
                          <div
                            key={v.id}
                            className={`flex items-center gap-0.5 rounded-lg ${
                              idx === generation.currentVersionIndex
                                ? 'bg-brand-teal/10'
                                : 'hover:bg-gray-50 dark:hover:bg-[#21262d]'
                            }`}
                          >
                            <button
                              onClick={() => {
                                onVersionChange(idx);
                                setVersionDropdownOpen(false);
                              }}
                              title={v.type === 'refinement' && v.refinementPrompt ? `Refined: ${v.refinementPrompt}` : v.label}
                              className={`flex-1 min-w-0 text-left pl-3 pr-2 py-2 text-sm font-mono inline-flex items-center gap-1.5 transition-colors ${
                                idx === generation.currentVersionIndex
                                  ? 'text-brand-teal font-semibold'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <span className="whitespace-nowrap">{v.label}</span>
                              {v.type === 'refinement' && (
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0"
                                  aria-label="Refinement"
                                />
                              )}
                            </button>
                            {/* Allow deleting any version, not just refinements.
                                When a generation contains only one version, the
                                handler would throw "Cannot delete the last version"
                                — surface that as a disabled state instead so the
                                button is informative rather than error-producing. */}
                            {(() => {
                              const isOnlyVersion = generation.versions.length <= 1;
                              const isBusy = Boolean(deletingRefinementId);
                              const disabled = isOnlyVersion || isBusy;
                              const isPopoverArmed = confirmVersionDelete.isArmed(v.id);
                              const tooltip = isOnlyVersion
                                ? 'Cannot delete the only version — use the tile trash to remove the whole generation'
                                : isPopoverArmed
                                  ? 'Click again to confirm'
                                  : `Delete ${v.label}`;
                              return (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleVersionDeleteClick(v.id);
                                  }}
                                  disabled={disabled}
                                  className={`h-8 w-8 mr-1 inline-flex items-center justify-center rounded-md border transition-colors ${
                                    disabled
                                      ? 'border-gray-200 dark:border-[#30363d] text-slate-400 dark:text-slate-500 cursor-not-allowed'
                                      : isPopoverArmed
                                        ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600 hover:border-amber-600 animate-pulse'
                                        : 'border-red-200/80 dark:border-red-900/40 text-red-500 dark:text-red-300 hover:bg-red-600 hover:border-red-600 hover:text-white'
                                  }`}
                                  aria-label={tooltip}
                                  title={tooltip}
                                >
                                  {deletingRefinementId === v.id ? (
                                    <RefreshCw size={13} className="animate-spin" />
                                  ) : isPopoverArmed ? (
                                    <Check size={13} />
                                  ) : (
                                    <Trash2 size={13} />
                                  )}
                                </button>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons (top right). Hidden while the inline
                comparison slider is active — they target a single version
                (download, refine, info, etc.) which doesn't apply to the
                two-up view, and their absolute position was overlapping the
                slider's own Close / Swap / Side-by-side controls. */}
            <div
              className={`absolute top-4 right-4 flex flex-wrap justify-end items-center gap-2 lg:gap-3 max-w-[calc(100%-2rem)] transition-opacity group-data-[dragging=true]:!opacity-0 group-data-[dragging=true]:!pointer-events-none ${
                isComparing
                  ? 'opacity-0 pointer-events-none'
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[idle=true]:!opacity-0 group-data-[idle=true]:!pointer-events-none'
              }`}
            >
              {/* Refine / Recompose toggle. Used to be a permanent docked
                  panel beneath the preview; now it's a single icon that
                  pops the panel open as a popover anchored beneath the
                  icon, so the main image keeps all its vertical room.
                  Active state (panel open) highlights teal, matching
                  Compare. */}
              <div className="relative">
                <ActionButton
                  onClick={() => setIsRefinePanelOpen((p) => !p)}
                  title={isRefinePanelOpen ? 'Hide refine & recompose panel' : 'Show refine & recompose panel'}
                  tooltip={aiBusySource === 'refine' ? 'AI is working…' : isRefinePanelOpen ? 'Hide refine' : 'Refine'}
                  variant={aiBusySource === 'refine' ? 'busy' : 'default'}
                  className={aiBusySource !== 'refine' && isRefinePanelOpen ? 'text-brand-teal' : undefined}
                >
                  <Wand2 size={18} />
                </ActionButton>
                {isRefinePanelOpen && (
                  <>
                    {/* Outside-click backdrop closes the popover. Same
                        z-10 + z-30 pairing the Copy menu uses so click
                        events on the popover still register. */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setIsRefinePanelOpen(false)}
                    />
                    <div
                      ref={refinePanelRef}
                      role="dialog"
                      aria-label="Refine and recompose"
                      // Anchored to the right edge of the wand button so
                      // the popover hangs down and extends leftward into
                      // the image area (the wand button lives near the
                      // left of the action bar; this direction has the
                      // most room). Width is capped to the viewport so
                      // narrow screens don't push the panel off-canvas.
                      className="absolute top-full right-0 mt-2 z-30 w-[40rem] max-w-[calc(100vw-2rem)] bg-white/95 dark:bg-[#161b22]/95 backdrop-blur-xl border border-gray-200 dark:border-[#30363d] p-2 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-black/50"
                      style={{ transform: `translate(${refinePanelOffset.x}px, ${refinePanelOffset.y}px)` }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Header with title + close. Matches dismissibility
                          of the prompt-editor modal so the panel can be
                          closed from inside itself as well as via the
                          in-image Wand2 toggle or outside-click. */}
                      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
                        <div className="flex min-w-0 items-center gap-1">
                          <button
                            type="button"
                            onPointerDown={handleRefinePanelDragStart}
                            onPointerMove={handleRefinePanelDragMove}
                            onPointerUp={handleRefinePanelDragEnd}
                            onPointerCancel={handleRefinePanelDragEnd}
                            onLostPointerCapture={handleRefinePanelDragEnd}
                            onDoubleClick={resetRefinePanelOffset}
                            onKeyDown={handleRefinePanelMoveKeyDown}
                            aria-label="Move refine panel. Use arrow keys to move and Home to reset."
                            className="group/move relative h-7 w-7 shrink-0 touch-none cursor-grab active:cursor-grabbing inline-flex items-center justify-center rounded-md text-slate-400 hover:bg-gray-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-teal/70 dark:text-slate-500 dark:hover:bg-[#21262d] dark:hover:text-slate-200"
                          >
                            <GripVertical size={14} />
                            <span className="pointer-events-none absolute top-full left-0 z-20 mt-2 whitespace-nowrap rounded-md bg-black/90 px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-white opacity-0 shadow-lg transition-opacity group-hover/move:opacity-100 group-focus/move:opacity-100">
                              Drag to move · double-click to reset
                            </span>
                          </button>
                          <span className="inline-flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <Wand2 size={12} className="shrink-0 text-brand-teal" />
                            Refine &amp; Recompose
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsRefinePanelOpen(false)}
                          aria-label="Close refine panel"
                          title="Close refine panel"
                          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-[#21262d] hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="px-1 pb-1 flex flex-wrap items-center gap-2">
                        <div className="min-w-[180px] flex-1">
                          <RichSelect
                            value={safeRefineModelId}
                            onChange={onModelChange}
                            options={refineModelSelectOptions}
                            placeholder="Refine model"
                            icon={Wand2}
                            compact
                            disabled={refinementControlsLocked}
                            buttonClassName="rounded-xl"
                            menuClassName="max-w-[22rem] z-[220]"
                            groupOrder={[...MODEL_GROUP_ORDER]}
                            hideOptionDescriptions
                          />
                        </div>
                        <div className="min-w-[170px] flex-1">
                          <RichSelect
                            value={resizeAspectRatio}
                            onChange={setResizeAspectRatio}
                            options={resizeTargetOptions}
                            placeholder="Target size"
                            icon={Maximize2}
                            compact
                            disabled={refinementControlsLocked}
                            buttonClassName="rounded-xl"
                            menuClassName="max-w-[18rem] z-[220]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleResizeCanvasClick}
                          disabled={refinementControlsLocked || !canResizeToSelected}
                          className={`relative inline-flex h-9 items-center gap-1.5 px-3.5 rounded-xl border text-xs font-semibold transition-all group/recomposeBtn ${
                            refinementControlsLocked || !canResizeToSelected
                              ? 'bg-gray-100 dark:bg-[#21262d] text-slate-400 dark:text-slate-500 border-gray-200 dark:border-[#30363d] cursor-not-allowed'
                              : 'bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 border-gray-200 dark:border-[#30363d] hover:bg-brand-teal hover:border-brand-teal hover:text-white shadow-sm'
                          }`}
                          aria-label={`Recompose image from ${resizeSourceAspectRatio || 'current'} to ${resizeAspectLabel} while preserving style`}
                          title={canResizeToSelected ? `Recompose to ${resizeAspectLabel}` : 'Select a different target size'}
                        >
                          {isResizingCanvas ? <RefreshCw size={12} className="animate-spin" /> : <Maximize2 size={12} />}
                          {isResizingCanvas ? 'Recomposing…' : 'Recompose'}
                          <span className="pointer-events-none absolute top-full mt-2 right-0 w-72 text-left text-[11px] leading-relaxed px-3 py-2 rounded-lg bg-black/90 text-white shadow-xl opacity-0 group-hover/recomposeBtn:opacity-100 transition-opacity z-20">
                            Rebuilds the image for {resizeAspectLabel} while preserving the same style and palette.
                          </span>
                        </button>
                      </div>
                      <div className="px-1 pb-2 text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
                        <span>
                          Current size: <span className="text-slate-700 dark:text-slate-300 font-medium">{resizeSourceLabel}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => { setPromptEditorMode('refine'); setIsPromptEditorOpen(true); }}
                          aria-expanded={isPromptEditorOpen}
                          aria-controls="refine-prompt-modal"
                          className="text-sm font-semibold text-brand-teal dark:text-teal-400 hover:underline decoration-brand-teal/60 underline-offset-2 min-h-11 px-2 rounded-lg hover:bg-brand-teal/10 dark:hover:bg-teal-950/40 transition-colors"
                        >
                          Open full editor
                        </button>
                      </div>
                      <form onSubmit={handleRefineSubmit} className="flex gap-2 items-center">
                        <textarea
                          value={refinementInput}
                          onChange={(e) => setRefinementInput(e.target.value)}
                          onKeyDown={handleInlinePromptKeyDown}
                          placeholder={isSvg ? "Refine this SVG (e.g. 'Add a subtle gradient')..." : "Refine this image (e.g. 'Make the background darker')..."}
                          rows={1}
                          className="flex-1 h-11 max-h-11 p-3 bg-transparent text-sm leading-snug text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none resize-none overflow-hidden"
                          disabled={refinementControlsLocked}
                        />
                        <button
                          type="button"
                          onClick={handleExpandRefinementClick}
                          disabled={refinementControlsLocked}
                          className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all group/expandBtn ${
                            refinementControlsLocked
                              ? 'bg-gray-100 dark:bg-[#21262d] text-slate-400 dark:text-slate-500 border-gray-200 dark:border-[#30363d] cursor-not-allowed'
                              : 'bg-white dark:bg-[#161b22] text-slate-800 dark:text-slate-100 border-gray-200 dark:border-[#30363d] hover:bg-brand-teal hover:border-brand-teal hover:text-white shadow-sm'
                          }`}
                          aria-label="Expand refine prompt with richer creative detail"
                          title="Expand prompt — uses your text, or the tile's original prompt if empty"
                        >
                          {isExpandingRefinement ? <RefreshCw size={16} className="animate-spin" /> : <Expand size={16} />}
                          <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/expandBtn:opacity-100 transition-opacity">
                            Expand prompt
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setPromptEditorMode('refine'); setIsPromptEditorOpen(true); }}
                          disabled={refinementControlsLocked}
                          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all ${
                            refinementControlsLocked
                              ? 'bg-gray-100 dark:bg-[#21262d] text-slate-400 dark:text-slate-500 border-gray-200 dark:border-[#30363d] cursor-not-allowed'
                              : 'bg-white dark:bg-[#161b22] text-slate-800 dark:text-slate-100 border-gray-200 dark:border-[#30363d] hover:bg-brand-teal hover:border-brand-teal hover:text-white shadow-sm'
                          }`}
                          aria-label="Open refine prompt in full-screen editor"
                          title="Open full editor (modal)"
                        >
                          <Maximize2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={handleAnalyzeRefineClick}
                          disabled={refinementControlsLocked}
                          className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all group/analyzeBtn ${
                            refinementControlsLocked
                              ? 'bg-gray-100 dark:bg-[#21262d] text-slate-400 dark:text-slate-500 border-gray-200 dark:border-[#30363d] cursor-not-allowed'
                              : 'bg-white dark:bg-[#161b22] text-slate-800 dark:text-slate-100 border-gray-200 dark:border-[#30363d] hover:bg-brand-teal hover:border-brand-teal hover:text-white shadow-sm'
                          }`}
                          aria-label="Analyze current image for spelling, factual, and annotation issues and generate a correction prompt"
                          title="Run analysis"
                        >
                          {isAnalyzingRefinePrompt ? <RefreshCw size={16} className="animate-spin" /> : <ScanSearch size={16} />}
                          <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/analyzeBtn:opacity-100 transition-opacity">
                            Run analysis
                          </span>
                          <span className="pointer-events-none absolute top-full mt-2 right-0 w-72 text-left text-[11px] leading-relaxed px-3 py-2 rounded-lg bg-black/90 text-white shadow-xl opacity-0 group-hover/analyzeBtn:opacity-100 transition-opacity z-20">
                            Checks text accuracy, spelling, and label/factual issues, then drafts a detailed correction prompt and switches refine model to Nano Banana Pro. Uses a fast vision model (not image generation) with the same API provider as your toolbar when your keys allow it.
                          </span>
                        </button>
                        <button
                          type="submit"
                          title={
                            !refinementInput.trim() && !canResizeToSelected
                              ? 'Enter a refine prompt, or choose a different target size and use Recompose'
                              : 'Apply refine or recompose'
                          }
                          disabled={(!refinementInput.trim() && !canResizeToSelected) || refinementControlsLocked}
                          className={`h-11 w-11 shrink-0 rounded-xl font-medium text-white inline-flex items-center justify-center transition-all ${
                            (!refinementInput.trim() && !canResizeToSelected) || refinementControlsLocked
                              ? 'bg-gray-200 dark:bg-[#30363d] text-slate-400 dark:text-slate-500 cursor-not-allowed'
                              : 'bg-brand-red hover:bg-red-700 text-white shadow-lg shadow-brand-red/20'
                          }`}
                        >
                          {isRefining || isResizingCanvas ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <Send size={16} />
                          )}
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </div>

              {/* Simplify for animation — same canned cleanup refine as the
                  Sparkles button inside Build Studio. Sits right after
                  Refine so the two AI actions read as a pair. Runs through
                  the normal refine pipeline, so the usual refine spinner
                  shows and the result lands as a new Mark on this tile. */}
              <ActionButton
                onClick={() => {
                  if (aiBusy) return;
                  setAiBusySource('simplify');
                  onRefine(CLEANUP_FOR_ANIMATION_PROMPT);
                }}
                title="AI redraws this image with each block isolated on a flat background — easier to animate in Build Studio. Adds a new Mark (your original stays) · uses your image model."
                tooltip={aiBusySource === 'simplify' ? 'AI is working…' : 'Simplify'}
                variant={aiBusySource === 'simplify' ? 'busy' : 'default'}
              >
                <Sparkles size={18} />
              </ActionButton>

              {/* Compare is only meaningful when there's a second mark to
                  pair with — otherwise the picker would open with nothing
                  to pick. Match the gating on the rail Compare button so the
                  affordance only appears when it can actually do something. */}
              {hasMultipleVersions && onEnterComparePicker && onExitComparePicker && (
                <ActionButton
                  onClick={() => {
                    if (isCompareMode) onExitComparePicker();
                    else handleEnterCompareFromButton();
                  }}
                  title="Click two marks to open a before/after slider (or Shift-click any mark)"
                  tooltip={isCompareMode ? 'Cancel compare' : 'Compare'}
                  className={isCompareMode ? 'text-brand-teal' : undefined}
                >
                  <GitCompare size={18} />
                </ActionButton>
              )}

              {/* Info toggle. Hidden while the info box is open — the box has
                  its own X close button, so showing both is redundant clutter
                  in the same corner. Re-appears when the user closes the box. */}
              {!infoVisible && (
                <ActionButton
                  onClick={() => setInfoVisible(true)}
                  title="Show details"
                  tooltip="Info"
                >
                  <Info size={18} />
                </ActionButton>
              )}

              {/* Fullscreen / slideshow toggle. Shortcut: F. Inside fullscreen
                  H hides the chrome, ← → walk the current folder. */}
              <ActionButton
                onClick={toggleFullscreen}
                title="Fullscreen slideshow (F) — H hides chrome, ←/→ navigates the folder"
                tooltip="Fullscreen (F)"
              >
                <Maximize size={18} />
              </ActionButton>

              {/* Build Studio — turn this image into a sequential reveal
                  animation (draw boxes, zoom/fade-in tour) and export MP4. */}
              {onOpenBuildStudio && (
                <ActionButton
                  onClick={onOpenBuildStudio}
                  title="Build Studio — reveal parts of this image as an animation you can play and export"
                  tooltip="Animate"
                >
                  <Film size={18} />
                </ActionButton>
              )}

              {/* Animation toggle (SVG only) */}
              {isSvg && (
                <ActionButton
                  onClick={() => setAnimationPaused(p => !p)}
                  title={animationPaused ? 'Resume animation' : 'Pause animation'}
                  tooltip={animationPaused ? 'Play' : 'Pause'}
                >
                  {animationPaused ? <Play size={18} /> : <Pause size={18} />}
                </ActionButton>
              )}

              {/* Unified Copy menu. Replaces what used to be 2-3 separate
                  copy icons (prompt, image, URL, SVG code) — those buttons
                  all did the same conceptual thing ("put something on the
                  clipboard") and crowded the action bar. Now a single
                  trigger opens a popover with the targets relevant to the
                  current asset (raster vs SVG). Matches the
                  one-icon-many-actions pattern that DownloadMenu already
                  established. */}
              {(onCopy || !isSvg || (isSvg && version.svgCode)) && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCopyMenuOpen((p) => !p)}
                    aria-haspopup="menu"
                    aria-expanded={copyMenuOpen}
                    title="Copy…"
                    className="group/btn bg-white/90 dark:bg-[#1f252d]/90 border border-gray-300/80 dark:border-white/15 text-slate-800 dark:text-slate-200 hover:bg-brand-teal hover:border-brand-teal hover:text-white p-2.5 lg:p-3 rounded-xl shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-teal/70 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-[#161b22] transition relative inline-flex items-center gap-1"
                  >
                    <Copy size={18} />
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${copyMenuOpen ? 'rotate-180' : ''}`}
                    />
                    <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity">
                      Copy
                    </span>
                  </button>
                  {copyMenuOpen && (
                    <>
                      {/* Outside-click backdrop — same pattern as the
                          version dropdown above. `z-10` keeps it below
                          the menu (`z-20`) so menu clicks still register. */}
                      <div className="fixed inset-0 z-10" onClick={() => setCopyMenuOpen(false)} />
                      <div
                        role="menu"
                        className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-20 overflow-hidden p-1"
                      >
                        {onCopy && (
                          <button
                            role="menuitem"
                            onClick={() => {
                              setCopyMenuOpen(false);
                              handleCopyPrompt();
                            }}
                            className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-md transition-colors"
                          >
                            <Copy size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
                            <span>Prompt</span>
                          </button>
                        )}
                        {!isSvg && (
                          <>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setCopyMenuOpen(false);
                                handleCopyImageToClipboard();
                              }}
                              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-md transition-colors"
                            >
                              <ImageIcon size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
                              <span>Image</span>
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setCopyMenuOpen(false);
                                handleCopyImageUrl();
                              }}
                              className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-md transition-colors"
                            >
                              <Link size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
                              <span>Image URL</span>
                            </button>
                          </>
                        )}
                        {isSvg && version.svgCode && (
                          <button
                            role="menuitem"
                            onClick={() => {
                              setCopyMenuOpen(false);
                              handleCopySvgCode();
                            }}
                            className="w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-md transition-colors"
                          >
                            <Code size={14} className="text-slate-500 dark:text-slate-400 shrink-0" />
                            <span>SVG code</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Unified Download menu (this + all) */}
              <DownloadMenu
                mode="this-and-all"
                currentGeneration={generation}
                // In the main tile viewer, "Download all" should scope to the
                // current tile only (all marks/versions inside this generation),
                // not the entire history gallery.
                allGenerations={[generation]}
                allLabel="Export all in this tile"
                triggerClassName="group/btn bg-white/90 dark:bg-[#1f252d]/90 border border-gray-300/80 dark:border-white/15 text-slate-800 dark:text-slate-200 hover:bg-brand-teal hover:border-brand-teal hover:text-white p-2.5 lg:p-3 rounded-xl shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-teal/70 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-[#161b22] transition inline-flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                triggerTitle="Download"
                icon={<Download size={18} />}
                onNotify={showNotice}
                align="right"
              />


              {onDelete && (
                <button
                  onClick={handleDeleteWithNotice}
                  title={isGenerationDeleteArmed ? 'Click again to confirm delete' : 'Delete'}
                  aria-label={isGenerationDeleteArmed ? 'Click again to confirm delete' : 'Delete'}
                  className={`group/btn p-2.5 lg:p-3 rounded-xl shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-[#161b22] transition relative border ${
                    isGenerationDeleteArmed
                      ? 'bg-amber-500 border-amber-500 text-white hover:bg-amber-600 hover:border-amber-600 focus:ring-amber-400/70 animate-pulse'
                      : 'bg-white/85 dark:bg-[#2b1c1c]/85 border-red-200/80 dark:border-red-900/40 text-red-600 dark:text-red-200 hover:bg-red-600 hover:border-red-600 hover:text-white focus:ring-brand-teal/70'
                  }`}
                >
                  {isGenerationDeleteArmed ? <Check size={18} /> : <Trash2 size={18} />}
                  <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity">
                    {isGenerationDeleteArmed ? 'Confirm delete' : 'Delete'}
                  </span>
                </button>
              )}
            </div>
          </div>
          </div>

          {/* Mobile carousel controls — at small widths the floating overlay
              arrows would crowd the image, so we surface a normal-flow row
              under the card with the same prev/next/position info. */}
          {canNavigate && (canGoNewer || canGoOlder) && (
            <div className="sm:hidden mt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={goNewer}
                disabled={!canGoNewer}
                aria-label="Previous generation (newer)"
                className="inline-flex items-center justify-center h-11 w-11 rounded-full border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 shadow hover:border-brand-teal hover:text-brand-teal disabled:opacity-40 disabled:pointer-events-none transition"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums min-w-[3.5rem] text-center">
                {currentIdxInHistory + 1} / {history.length}
              </span>
              <button
                type="button"
                onClick={goOlder}
                disabled={!canGoOlder}
                aria-label="Next generation (older)"
                className="inline-flex items-center justify-center h-11 w-11 rounded-full border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 shadow hover:border-brand-teal hover:text-brand-teal disabled:opacity-40 disabled:pointer-events-none transition"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      </div>
      </div>

      {copyNotice && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className={`text-white text-base px-6 py-4 rounded-2xl shadow-2xl border animate-in fade-in duration-150 pointer-events-none ${copyNoticeTone === 'error' ? 'bg-brand-red border-brand-red/70' : 'bg-black/90 border-white/10'}`} role="status" aria-live="polite">
            {copyNotice}
          </div>
        </div>
      )}

      {/* Star-toggle feedback. Centered amber pill with a filled / outline
          star glyph that matches the on/off state. Pointer-events disabled
          so it never intercepts a follow-up click. Auto-dismisses ~1.6s
          after the toggle. */}
      {starFeedback && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div
            className={`inline-flex items-center gap-2.5 px-5 py-3 rounded-2xl shadow-2xl border animate-in fade-in zoom-in-95 duration-150 ${
              starFeedback.on
                ? 'bg-amber-400 text-white border-amber-300'
                : 'bg-slate-800 text-white border-slate-700'
            }`}
            role="status"
            aria-live="polite"
          >
            <Star
              size={20}
              strokeWidth={2.5}
              className={starFeedback.on ? 'fill-current' : ''}
            />
            <span className="text-base font-semibold">{starFeedback.message}</span>
          </div>
        </div>
      )}

      {isPromptEditorOpen && promptEditorMode === 'refine' && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 pointer-events-auto">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsPromptEditorOpen(false)} aria-hidden />
          <div
            id="refine-prompt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="refine-prompt-modal-title"
            className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-2xl p-4 sm:p-5"
          >
            <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
              <h3 id="refine-prompt-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
                Refine prompt
              </h3>
              <button
                type="button"
                onClick={() => setIsPromptEditorOpen(false)}
                className="h-11 min-w-11 shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-[#30363d] text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                aria-label="Close prompt editor"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              value={refinementInput}
              onChange={(e) => setRefinementInput(e.target.value)}
              onKeyDown={handleModalPromptKeyDown}
              placeholder={isSvg ? "Refine this SVG (e.g. 'Add a subtle gradient')..." : "Refine this image (e.g. 'Make the background darker')..."}
              rows={18}
              className="w-full min-h-[min(70vh,28rem)] max-h-[min(70vh,36rem)] p-4 rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] text-base leading-relaxed text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-teal/60 overflow-y-auto shrink"
              disabled={refinementControlsLocked}
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 shrink-0">
              Press Esc to close. Cmd/Ctrl+Enter submits from this editor.
            </p>
            <div className="mt-4 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsPromptEditorOpen(false)}
                className="min-h-11 px-4 rounded-lg border border-gray-200 dark:border-[#30363d] text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  if (submitRefinementOrResize()) {
                    setIsPromptEditorOpen(false);
                  }
                }}
                disabled={(!refinementInput.trim() && !canResizeToSelected) || refinementControlsLocked}
                className={`min-h-11 px-4 rounded-lg text-sm font-semibold text-white transition-colors ${
                  (!refinementInput.trim() && !canResizeToSelected) || refinementControlsLocked
                    ? 'bg-gray-300 dark:bg-[#30363d] cursor-not-allowed'
                    : 'bg-brand-red hover:bg-red-700'
                }`}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {isPromptEditorOpen && promptEditorMode === 'rerun' && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 pointer-events-auto">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsPromptEditorOpen(false)} aria-hidden />
          <div
            id="rerun-prompt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rerun-prompt-modal-title"
            className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-2xl p-4 sm:p-5"
          >
            <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
              <div>
                <h3 id="rerun-prompt-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
                  Add Marks — re-roll the prompt
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Generates fresh takes from this brief — the model is free to rethink layout, palette, and composition.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPromptEditorOpen(false)}
                className="h-11 min-w-11 shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-[#30363d] text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                aria-label="Close prompt editor"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              value={rerunDraft}
              onChange={(e) => setRerunDraft(e.target.value)}
              onKeyDown={handleRerunModalKeyDown}
              placeholder="Prompt for the new Marks (e.g. 'A friendly illustration of a robot teaching kids how to code...')"
              rows={18}
              className="w-full min-h-[min(70vh,28rem)] max-h-[min(70vh,36rem)] p-4 rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] text-base leading-relaxed text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-teal/60 overflow-y-auto shrink"
              disabled={refinementControlsLocked}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3 shrink-0">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                Marks to add
                {/* 1-9 segmented picker — direct tap target instead of a
                    spinner so the user can pick a count in one click. */}
                <span className="inline-flex rounded-lg border border-gray-200 dark:border-[#30363d] overflow-hidden">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRerunCount(n)}
                      className={`w-8 h-9 text-xs font-semibold transition-colors ${
                        rerunCount === n
                          ? 'bg-brand-teal text-white'
                          : 'bg-white dark:bg-[#0d1117] text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d]'
                      }`}
                      aria-pressed={rerunCount === n}
                      aria-label={`Add ${n} Mark${n === 1 ? '' : 's'}`}
                    >
                      {n}
                    </button>
                  ))}
                </span>
              </label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Esc to close · Cmd/Ctrl+Enter to submit · Tip: hold 1-9 while clicking <kbd className="font-mono px-1 rounded bg-gray-100 dark:bg-[#21262d]">+</kbd> to skip this editor.
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsPromptEditorOpen(false)}
                className="min-h-11 px-4 rounded-lg border border-gray-200 dark:border-[#30363d] text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  if (submitRerunFromEditor()) {
                    setIsPromptEditorOpen(false);
                  }
                }}
                disabled={!rerunDraft.trim() || refinementControlsLocked || !onRerun}
                className={`min-h-11 px-4 rounded-lg text-sm font-semibold text-white transition-colors ${
                  !rerunDraft.trim() || refinementControlsLocked || !onRerun
                    ? 'bg-gray-300 dark:bg-[#30363d] cursor-not-allowed'
                    : 'bg-brand-teal hover:bg-teal-600'
                }`}
              >
                Add {rerunCount} Mark{rerunCount === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>

    {/* Fullscreen / slideshow overlay. Rendered as a sibling of the main
        layout (inside a fragment) so its `position: fixed` covers the entire
        viewport regardless of any flex/overflow constraints on the regular
        ImageDisplay tree. We keep the underlying layout mounted so React
        state, refs, and effects don't churn when toggling F. */}
    {isFullscreen && generation && version && (
      <div
        ref={fullscreenContainerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Fullscreen slideshow"
        // `animate-[fullscreenOverlayIn_...]` fades the black backdrop in
        // over 180ms so the page underneath doesn't snap out of view in a
        // single frame. Combined with the image's own scale-up below, the
        // entrance reads as the image "expanding into" the screen rather
        // than a hard cut. Keyframes live in index.css.
        //
        // Cursor class swap is driven by `isFullscreenCursorVisible` — the
        // effect above arms a 5s idle timer and flips this off until the
        // next mouse move (or back on for arrow / H keyboard nav). Applied
        // on the overlay so child buttons inherit the same state without
        // each having to opt in.
        className={`fixed inset-0 z-[200] bg-black flex items-center justify-center select-none animate-[fullscreenOverlayIn_180ms_ease-out] ${
          isFullscreenCursorVisible ? 'cursor-default' : 'cursor-none'
        }`}
        onDoubleClick={exitFullscreen}
      >
        {/* The image. Wrapped in a sized container so the entrance
            animation (subtle scale + fade) targets a single element and
            doesn't recompute the underlying `object-contain` layout on
            each frame. The wrapper itself is the viewport; transforming
            it scales the image visually without affecting how the image
            fits inside (which is still `object-contain`). */}
        <div
          className="w-screen h-screen flex items-center justify-center animate-[fullscreenContentIn_220ms_cubic-bezier(0.16,1,0.3,1)] will-change-transform"
        >
          {isSvg && version.svgCode ? (
            // SVG is forced to span the full viewport; the SVG's own
            // `preserveAspectRatio` (default `xMidYMid meet`) keeps the
            // art centered and aspect-preserved while filling the
            // dominant axis. `max-w/max-h` would let small SVGs render at
            // intrinsic viewBox size and leave bars on all four sides.
            <div
              className="w-full h-full [&>svg]:block [&>svg]:w-[100vw] [&>svg]:h-[100vh]"
              dangerouslySetInnerHTML={{ __html: sanitizeSvg(version.svgCode) }}
            />
          ) : (
            // `w-screen h-screen` + `object-contain` makes the `<img>`
            // element physically span the viewport while the image
            // content scales up (or down) to fill the dominant axis
            // without distortion. Using `max-w/max-h` instead lets
            // smaller-than-viewport images render at their intrinsic
            // resolution and leaves the user staring at a postage stamp
            // surrounded by black — the bug this fixes.
            <img
              src={renderImageSrc || version.imageUrl}
              alt="Generated output (fullscreen)"
              className="w-screen h-screen object-contain block"
              draggable={false}
              onError={handleImageError}
            />
          )}
        </div>

        {/* Edge tap zones — clicking the left or right side advances the
            slideshow. We render these always (even with chrome hidden) so
            slideshow navigation stays available on touch / trackpad without
            needing the keyboard. They're transparent and don't capture the
            center of the image. */}
        {canGoNewer && (
          <button
            type="button"
            onClick={goNewer}
            aria-label="Previous (newer in history)"
            className="absolute inset-y-0 left-0 w-[20%] max-w-[160px] focus:outline-none"
          />
        )}
        {canGoOlder && (
          <button
            type="button"
            onClick={goOlder}
            aria-label="Next (older in history)"
            className="absolute inset-y-0 right-0 w-[20%] max-w-[160px] focus:outline-none"
          />
        )}

        {/* Chrome — hidden when H is pressed OR when the cursor-idle timer
            has flipped to invisible. Tying chrome to the cursor gives the
            standard video-player feel: mouse motion surfaces the controls,
            5s of stillness drops everything back to a clean photo view, and
            arrow-key history nav hides instantly. We use opacity + pointer-
            events instead of an unmount so the user can flip H or wiggle
            the mouse without re-renders or transitions stuttering. */}
        <div
          className={`absolute inset-0 transition-opacity duration-200 ${
            hideChromeInFullscreen || !isFullscreenCursorVisible
              ? 'opacity-0 pointer-events-none'
              : 'opacity-100'
          }`}
          aria-hidden={hideChromeInFullscreen || !isFullscreenCursorVisible}
        >
          {/* Top bar: position counter + exit. */}
          <div className="absolute top-0 left-0 right-0 px-4 sm:px-6 py-3 flex items-center justify-between bg-gradient-to-b from-black/60 via-black/30 to-transparent">
            <div className="flex items-baseline gap-3 text-white/90">
              {fullscreenPositionLabel && (
                <span className="text-sm font-semibold tabular-nums">
                  {fullscreenPositionLabel}
                </span>
              )}
              {fullscreenMarkLabel && (
                <span className="text-xs text-white/60">{fullscreenMarkLabel}</span>
              )}
            </div>
            <button
              type="button"
              onClick={exitFullscreen}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-black/40 px-3 text-xs font-medium text-white/90 backdrop-blur hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="Exit fullscreen (F or Esc)"
              title="Exit fullscreen (F or Esc)"
            >
              <Minimize size={14} />
              <span>Exit</span>
            </button>
          </div>

          {/* Side arrows. We render them above the tap-zone buttons so
              hovering near the edge surfaces a visible affordance. */}
          {canGoNewer && (
            <button
              type="button"
              onClick={goNewer}
              aria-label="Previous (newer in history)"
              className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/90 backdrop-blur hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <ChevronLeft size={22} />
            </button>
          )}
          {canGoOlder && (
            <button
              type="button"
              onClick={goOlder}
              aria-label="Next (older in history)"
              className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/90 backdrop-blur hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <ChevronRight size={22} />
            </button>
          )}

          {/* Bottom hint strip. Lists the keyboard map so the gesture set is
              learnable without a separate help dialog. */}
          <div className="absolute bottom-0 left-0 right-0 px-4 sm:px-6 py-3 flex justify-center bg-gradient-to-t from-black/60 via-black/30 to-transparent">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] font-medium text-white/70">
              <span><kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/90">←</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/90">→</kbd> navigate</span>
              {canCycleVersions && (
                <span><kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/90">↑</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/90">↓</kbd> marks</span>
              )}
              <span><kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/90">H</kbd> hide UI</span>
              <span><kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/90">F</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/90">Esc</kbd> exit</span>
            </div>
          </div>
        </div>

        {/* Always-on minimal hint when chrome is hidden via H. Shows the
            single keystroke that brings the UI back so the user is never
            stranded on a black screen wondering what to press. Hidden during
            cursor-idle so a still pointer (and now a still hint) both fade
            together — moving the mouse brings everything back. */}
        {hideChromeInFullscreen && isFullscreenCursorVisible && (
          <div className="pointer-events-none absolute bottom-3 right-3 text-[10px] font-medium uppercase tracking-wider text-white/30">
            Press H to show UI
          </div>
        )}
      </div>
    )}
    </>
  );
};
