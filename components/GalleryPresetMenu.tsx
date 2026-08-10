import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, ChevronDown, MoreHorizontal } from 'lucide-react';
import { ToolbarPreset } from '../types';
import {
  presetToolbarDiffersFromSnapshot,
  ToolbarPresetSnapshot,
} from '../utils/toolbarPresetUtils';
import { AnchorRect, PresetActionPopover } from './PresetActionPopover';
import { PresetHoverPreview, PresetLabels } from './PresetHoverPreview';

export type GalleryPresetSource = 'global' | 'folder';

interface GalleryPresetMenuProps {
  presets: ToolbarPreset[];
  presetSource: GalleryPresetSource;
  onPresetSourceChange: (source: GalleryPresetSource) => void;
  currentSnapshot: ToolbarPresetSnapshot;
  onApplyPreset: (preset: ToolbarPreset) => void;
  onSavePreset?: (name: string) => Promise<void>;
  onUpdatePreset?: (presetId: string) => Promise<void>;
  onRenamePreset?: (presetId: string, name: string) => Promise<void>;
  onDeletePreset?: (presetId: string) => Promise<void>;
  onEditPresetInstructions?: (presetId: string, instructions: string) => Promise<void>;
  getPresetLabels?: (preset: ToolbarPreset) => PresetLabels;
  folderName?: string;
  disabled?: boolean;
}

export const GalleryPresetMenu: React.FC<GalleryPresetMenuProps> = ({
  presets,
  presetSource,
  onPresetSourceChange,
  currentSnapshot,
  onApplyPreset,
  onSavePreset,
  onUpdatePreset,
  onRenamePreset,
  onDeletePreset,
  onEditPresetInstructions,
  getPresetLabels,
  folderName,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isNamingPreset, setIsNamingPreset] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [actionMenuPresetId, setActionMenuPresetId] = useState<string | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<AnchorRect | null>(null);
  const [hoverPresetId, setHoverPresetId] = useState<string | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<AnchorRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const presetNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      const insideContainer = containerRef.current?.contains(target);
      const insidePortal = target.closest?.('[data-preset-popover]');
      if (insideContainer || insidePortal) return;
      setIsOpen(false);
      setIsNamingPreset(false);
      setPresetError(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (actionMenuPresetId) {
        setActionMenuPresetId(null);
        setActionMenuAnchor(null);
        return;
      }
      setIsOpen(false);
      setIsNamingPreset(false);
      setPresetError(null);
    };
    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, actionMenuPresetId]);

  // Close the side popover when the user scrolls (inside the list or page),
  // since its position is anchored to viewport coords and would otherwise drift.
  useEffect(() => {
    if (!actionMenuPresetId && !hoverPresetId) return;
    const close = () => {
      setActionMenuPresetId(null);
      setActionMenuAnchor(null);
      setHoverPresetId(null);
      setHoverAnchor(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [actionMenuPresetId, hoverPresetId]);

  useEffect(() => {
    if (isNamingPreset) presetNameInputRef.current?.focus();
  }, [isNamingPreset]);

  useEffect(() => {
    if (!isOpen) {
      setActionMenuPresetId(null);
      setActionMenuAnchor(null);
      setHoverPresetId(null);
      setHoverAnchor(null);
    }
  }, [isOpen]);

  const sortedPresets = useMemo(
    () =>
      [...presets].sort((a, b) => {
        const aApplied = !presetToolbarDiffersFromSnapshot(a, currentSnapshot);
        const bApplied = !presetToolbarDiffersFromSnapshot(b, currentSnapshot);
        if (aApplied && !bApplied) return -1;
        if (!aApplied && bApplied) return 1;
        return a.name.localeCompare(b.name);
      }),
    [presets, currentSnapshot]
  );

  const activeActionPreset = useMemo(
    () => (actionMenuPresetId ? sortedPresets.find((p) => p.id === actionMenuPresetId) ?? null : null),
    [sortedPresets, actionMenuPresetId]
  );

  const activeHoverPreset = useMemo(
    () => (hoverPresetId ? sortedPresets.find((p) => p.id === hoverPresetId) ?? null : null),
    [sortedPresets, hoverPresetId]
  );

  const handleToggleActionMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    presetId: string
  ) => {
    e.stopPropagation();
    if (actionMenuPresetId === presetId) {
      setActionMenuPresetId(null);
      setActionMenuAnchor(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setActionMenuAnchor({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    });
    setActionMenuPresetId(presetId);
    // Suppress hover preview while the action popover is showing so the two
    // panels don't compete for the same screen real estate.
    setHoverPresetId(null);
    setHoverAnchor(null);
  };

  const handleRowEnter = (
    e: React.MouseEvent<HTMLDivElement>,
    presetId: string
  ) => {
    if (actionMenuPresetId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverAnchor({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    });
    setHoverPresetId(presetId);
  };

  const handleRowLeave = () => {
    setHoverPresetId(null);
    setHoverAnchor(null);
  };

  const handleConfirmSavePreset = async () => {
    if (!onSavePreset) return;
    setIsSavingPreset(true);
    setPresetError(null);
    try {
      await onSavePreset(presetNameDraft);
      setIsNamingPreset(false);
      setPresetNameDraft('');
    } catch (err: unknown) {
      setPresetError(err instanceof Error ? err.message : 'Failed to save preset.');
    } finally {
      setIsSavingPreset(false);
    }
  };

  const sourceLabel =
    presetSource === 'folder'
      ? folderName
        ? `${folderName} presets`
        : 'Folder presets'
      : 'Global presets';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Presets: ${presets.length} saved (${sourceLabel})`}
        className={`group/tip-presets relative inline-flex items-center justify-center gap-1 px-3 py-2 min-h-11 rounded-lg border transition shrink-0 disabled:opacity-50 disabled:pointer-events-none ${
          isOpen
            ? 'border-brand-teal bg-brand-teal/10 text-brand-teal'
            : 'border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-slate-700 dark:text-slate-200 hover:border-brand-teal hover:text-brand-teal'
        }`}
      >
        <Bookmark size={16} aria-hidden />
        <ChevronDown size={14} className="opacity-70" aria-hidden />
        <span
          role="tooltip"
          className="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip-presets:opacity-100 group-focus-visible/tip-presets:opacity-100 transition-opacity z-20"
        >
          {presets.length === 0 ? 'Presets' : `${presets.length} preset${presets.length === 1 ? '' : 's'}`}
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-2 w-72 sm:w-80 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-[45] overflow-hidden flex flex-col"
        >
          <div className="px-3 py-2 border-b border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Preset source
            </p>
            <div className="flex rounded-lg border border-gray-200 dark:border-[#30363d] overflow-hidden">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={presetSource === 'global'}
                onClick={() => onPresetSourceChange('global')}
                className={`flex-1 px-2 py-2 text-[11px] font-semibold transition min-h-[44px] sm:min-h-0 ${
                  presetSource === 'global'
                    ? 'bg-brand-teal text-white'
                    : 'bg-white dark:bg-[#161b22] text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-[#21262d]'
                }`}
              >
                Global
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={presetSource === 'folder'}
                onClick={() => onPresetSourceChange('folder')}
                className={`flex-1 px-2 py-2 text-[11px] font-semibold transition min-h-[44px] sm:min-h-0 ${
                  presetSource === 'folder'
                    ? 'bg-brand-teal text-white'
                    : 'bg-white dark:bg-[#161b22] text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-[#21262d]'
                }`}
              >
                This folder
              </button>
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">
              {presetSource === 'folder'
                ? 'Saves and lists presets for this folder only. Switch to Global to use account-wide presets.'
                : 'Uses your account presets. Switch to This folder to override with folder-specific presets.'}
            </p>
          </div>

          <div className="max-h-52 overflow-y-auto custom-scrollbar p-1">
            {sortedPresets.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs text-slate-500">
                No saved presets in this source yet.
              </div>
            ) : (
              sortedPresets.map((preset) => {
                const isDirty = presetToolbarDiffersFromSnapshot(preset, currentSnapshot);
                const isApplied = !isDirty;
                const isActionMenuOpen = actionMenuPresetId === preset.id;
                const hasAnyAction = !!(onRenamePreset || onUpdatePreset || onDeletePreset || onEditPresetInstructions);
                return (
                  <div
                    key={preset.id}
                    onMouseEnter={(e) => handleRowEnter(e, preset.id)}
                    onMouseLeave={handleRowLeave}
                    className={`rounded-md border transition-colors ${
                      isApplied
                        ? 'bg-brand-teal/10 ring-1 ring-brand-teal/30 border-transparent'
                        : 'border-transparent hover:bg-gray-100 dark:hover:bg-[#21262d]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 p-2">
                      <button
                        type="button"
                        className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        onClick={() => {
                          onApplyPreset(preset);
                          setIsOpen(false);
                        }}
                      >
                        <Bookmark size={14} className="shrink-0 text-brand-teal mt-0.5" />
                        <div className="flex flex-col min-w-0">
                          <span
                            className={`text-xs truncate font-semibold ${
                              isApplied ? 'text-brand-teal' : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {preset.name}
                          </span>
                          <span className="text-[10px] text-slate-500 truncate">
                            {[preset.selectedModel, preset.aspectRatio]
                              .filter(Boolean)
                              .join(' · ') || 'Toolbar snapshot'}
                          </span>
                        </div>
                      </button>
                      {hasAnyAction && (
                        <button
                          type="button"
                          onClick={(e) => handleToggleActionMenu(e, preset.id)}
                          aria-expanded={isActionMenuOpen}
                          aria-label={
                            isActionMenuOpen
                              ? `Close actions for ${preset.name}`
                              : `Actions for ${preset.name}`
                          }
                          className={`p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 shrink-0 flex items-center justify-center rounded-md transition-colors ${
                            isActionMenuOpen
                              ? 'bg-gray-200 dark:bg-[#30363d] text-slate-700 dark:text-slate-200'
                              : 'hover:bg-gray-100 dark:hover:bg-[#30363d] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                          }`}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {onSavePreset && (
            <div className="border-t border-gray-200 dark:border-[#30363d] p-2 bg-gray-50 dark:bg-[#0d1117]">
              {isNamingPreset ? (
                <div className="space-y-2">
                  <input
                    ref={presetNameInputRef}
                    type="text"
                    value={presetNameDraft}
                    onChange={(e) => {
                      setPresetNameDraft(e.target.value);
                      if (presetError) setPresetError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleConfirmSavePreset();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setIsNamingPreset(false);
                        setPresetNameDraft('');
                        setPresetError(null);
                      }
                    }}
                    placeholder="Preset name"
                    maxLength={60}
                    className="w-full bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] text-sm rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-brand-teal"
                  />
                  {presetError && (
                    <p className="text-[11px] text-red-500">{presetError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleConfirmSavePreset()}
                      disabled={isSavingPreset || !presetNameDraft.trim()}
                      className="flex-1 rounded-md bg-brand-teal text-white text-xs font-semibold py-2 min-h-[44px] sm:min-h-0 disabled:opacity-50"
                    >
                      {isSavingPreset ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsNamingPreset(false);
                        setPresetNameDraft('');
                        setPresetError(null);
                      }}
                      className="rounded-md border border-gray-200 dark:border-[#30363d] text-xs font-semibold px-3 py-2 min-h-[44px] sm:min-h-0"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsNamingPreset(true);
                    setPresetNameDraft('');
                    setPresetError(null);
                  }}
                  className="w-full rounded-md border border-dashed border-brand-teal/50 text-brand-teal text-xs font-semibold py-2 min-h-[44px] sm:min-h-0 hover:bg-brand-teal/10"
                >
                  Save current toolbar as preset
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {actionMenuPresetId && actionMenuAnchor && activeActionPreset && (
        <PresetActionPopover
          preset={activeActionPreset}
          anchor={actionMenuAnchor}
          isApplied={!presetToolbarDiffersFromSnapshot(activeActionPreset, currentSnapshot)}
          onClose={() => {
            setActionMenuPresetId(null);
            setActionMenuAnchor(null);
          }}
          onUpdate={onUpdatePreset}
          onDelete={onDeletePreset}
          onRename={onRenamePreset}
          onEditInstructions={onEditPresetInstructions}
        />
      )}

      {hoverPresetId &&
        hoverAnchor &&
        activeHoverPreset &&
        getPresetLabels && (
          <PresetHoverPreview
            anchor={hoverAnchor}
            name={activeHoverPreset.name}
            labels={getPresetLabels(activeHoverPreset)}
          />
        )}
    </div>
  );
};
