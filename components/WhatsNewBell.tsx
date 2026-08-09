import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bell, Sparkles } from 'lucide-react';
import type { WhatsNewEntry } from '../types';

interface WhatsNewBellProps {
  entries: WhatsNewEntry[];
  unreadCount: number;
  unseenIds: Set<string>;
  isOpen: boolean;
  focusedEntryId: string | null;
  onOpen: () => void;
  onClose: () => void;
  onClearFocusedEntry: () => void;
  /**
   * Opens the full-page `WhatsNewPage` in *list* (discovery) mode. Wired to
   * the dropdown's footer affordance.
   */
  onOpenPage: () => void;
  /**
   * Opens the full-page `WhatsNewPage` in *detail* mode for the entry the
   * user clicked. Wired to each row, so the dropdown acts as a launchpad
   * for the per-release guides instead of trying to cram instructions
   * into a tiny popover.
   */
  onSelectEntry: (id: string) => void;
}

/**
 * Compact relative time label. Falls back to an absolute date for
 * anything older than ~4 weeks so the dropdown stays readable for the
 * long tail of historical entries.
 */
function formatRelativeTime(timestamp: number, now: number): string {
  const diffMs = Math.max(0, now - timestamp);
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  if (diffD < 30) return `${Math.round(diffD / 7)}w ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const WhatsNewBell: React.FC<WhatsNewBellProps> = ({
  entries,
  unreadCount,
  unseenIds,
  isOpen,
  focusedEntryId,
  onOpen,
  onClose,
  onClearFocusedEntry,
  onOpenPage,
  onSelectEntry,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusedRowRef = useRef<HTMLLIElement>(null);
  const now = Date.now();

  // Tracks which row the pointer / keyboard focus is currently on so we can
  // float a larger preview of its image to the left of the dropdown. Cleared
  // whenever the dropdown closes so the overlay never lingers from a prior
  // session.
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  // Vertical offset of the hovered row's top edge relative to the wrapper.
  // Drives the floating preview so it always anchors next to whichever row
  // the user is currently engaging with, instead of being pinned to the
  // dropdown's top edge.
  const [hoverRowTop, setHoverRowTop] = useState<number | null>(null);
  useEffect(() => {
    if (!isOpen) {
      setHoveredEntryId(null);
      setHoverRowTop(null);
    }
  }, [isOpen]);
  const hoveredEntry = useMemo<WhatsNewEntry | null>(() => {
    if (!hoveredEntryId) return null;
    return entries.find((e) => e.id === hoveredEntryId) ?? null;
  }, [hoveredEntryId, entries]);

  // Measures the hovered row against the wrapper so the floating preview
  // can be absolutely positioned with `top: <px>`. Run on every hover/focus
  // because the list is scrollable — the same row's offset shifts when the
  // user scrolls within the dropdown.
  const trackRowPosition = (rowEl: HTMLElement) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const rowRect = rowEl.getBoundingClientRect();
    setHoverRowTop(rowRect.top - wrapperRect.top);
  };

  // Scroll the deep-link target into view once the panel paints, then
  // clear the focus so a manual close+reopen doesn't keep highlighting it.
  useEffect(() => {
    if (!isOpen || !focusedEntryId) return;
    const node = focusedRowRef.current;
    if (node) {
      node.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    const timer = window.setTimeout(() => {
      onClearFocusedEntry();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [isOpen, focusedEntryId, onClearFocusedEntry]);

  // Escape closes the dropdown — matches the convention used by the user
  // menu and SearchModal elsewhere in the app.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const hasUnread = unreadCount > 0;
  const badgeLabel = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => (isOpen ? onClose() : onOpen())}
        aria-label={hasUnread ? `What's new (${unreadCount} unread)` : "What's new"}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="relative p-2 text-slate-500 hover:text-brand-teal dark:hover:text-brand-teal hover:bg-slate-100 dark:hover:bg-[#21262d] rounded-lg transition-colors"
        title={hasUnread ? `What's new (${unreadCount} unread)` : "What's new"}
      >
        <Bell size={20} />
        {hasUnread && (
          // Classic count "bubble" — half outside the icon's top-right so it
          // reads as a discrete pill rather than ink stuck to the glyph. The
          // ring matches the header's surface (white in light mode, GitHub
          // gray in dark) so the bubble stays crisp on either background.
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-brand-red text-white text-[10px] font-extrabold leading-none ring-2 ring-white dark:ring-[#0d1117] shadow-sm shadow-brand-red/30"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="What's new"
            className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.75rem)] bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:bottom-auto sm:mt-2 sm:w-[32rem] sm:max-w-[calc(100vw-2rem)] sm:max-h-[calc(100dvh-6rem)] flex flex-col bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#30363d]">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-brand-teal" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  What&rsquo;s new
                </h2>
              </div>
              {hasUnread && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-brand-teal">
                  {unreadCount} new
                </span>
              )}
            </div>

            {entries.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-500">
                No updates yet.
              </p>
            ) : (
              <ul
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch] py-1 sm:max-h-[26rem]"
                // mouseleave / focusout are intentionally on the list (not on
                // each row) so transitions between adjacent rows don't briefly
                // null out `hoveredEntryId` and re-fire the overlay's
                // mount-time animation, which would read as a faint blink.
                onMouseLeave={() => {
                  setHoveredEntryId(null);
                  setHoverRowTop(null);
                }}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setHoveredEntryId(null);
                    setHoverRowTop(null);
                  }
                }}
              >
                {entries.map((entry) => {
                  const isUnseen = unseenIds.has(entry.id);
                  const isFocused = focusedEntryId === entry.id;
                  return (
                    <li
                      key={entry.id}
                      ref={isFocused ? focusedRowRef : undefined}
                      className="border-b border-gray-100 dark:border-[#21262d] last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectEntry(entry.id)}
                        onMouseEnter={(e) => {
                          setHoveredEntryId(entry.id);
                          trackRowPosition(e.currentTarget);
                        }}
                        onFocus={(e) => {
                          setHoveredEntryId(entry.id);
                          trackRowPosition(e.currentTarget);
                        }}
                        className={`group w-full px-4 py-3 text-left transition-colors ${
                          isFocused
                            ? 'bg-brand-teal/10 dark:bg-brand-teal/15'
                            : 'hover:bg-brand-teal/5 dark:hover:bg-brand-teal/10'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {entry.image ? (
                            <img
                              src={entry.image}
                              alt=""
                              className="w-24 h-16 sm:w-36 sm:h-20 rounded-lg object-cover shrink-0 border border-gray-200 dark:border-[#30363d] bg-gray-100 dark:bg-[#21262d] transition-shadow group-hover:ring-2 group-hover:ring-brand-teal/60 group-focus-visible:ring-2 group-focus-visible:ring-brand-teal/60"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <div className="w-24 h-16 sm:w-36 sm:h-20 rounded-lg shrink-0 border border-gray-200 dark:border-[#30363d] bg-gradient-to-br from-brand-teal/15 via-brand-orange/10 to-brand-red/10 flex items-center justify-center text-brand-teal/60 transition-shadow group-hover:ring-2 group-hover:ring-brand-teal/60 group-focus-visible:ring-2 group-focus-visible:ring-brand-teal/60">
                              <Sparkles size={22} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug transition-colors group-hover:text-brand-teal dark:group-hover:text-brand-teal">
                                {entry.title}
                              </h3>
                              {isUnseen && (
                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-red/10 text-brand-red border border-brand-red/30">
                                  New
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                              {entry.summary}
                            </p>
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-500">
                              {entry.version && (
                                <>
                                  <span>v{entry.version}</span>
                                  <span className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-600" />
                                </>
                              )}
                              <span>{formatRelativeTime(entry.publishedAt, now)}</span>
                            </div>
                          </div>
                          {/* Hover-only chevron — signals "click to read the
                              full guide" without cluttering the row at rest.
                              Self-centered so it lines up visually with the
                              thumbnail's vertical midpoint. */}
                          <ArrowRight
                            size={14}
                            aria-hidden
                            className="hidden sm:block self-center shrink-0 text-brand-teal opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0"
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {entries.length > 0 && (
              <button
                type="button"
                onClick={onOpenPage}
                className="shrink-0 w-full flex items-center justify-center gap-1.5 px-4 py-3 text-xs font-semibold text-brand-teal hover:bg-brand-teal/5 dark:hover:bg-brand-teal/10 border-t border-gray-200 dark:border-[#30363d] transition-colors"
              >
                View all updates
                <ArrowRight size={12} />
              </button>
            )}
          </div>

          {/* Floating preview — when the user hovers (or keyboard-focuses) a
              row, this overlay shows a much larger version of that entry's
              image directly to the left of the dropdown, vertically anchored
              to the hovered row (`top: hoverRowTop`). Rendered as a sibling
              to the dropdown (not a child) so the panel's `overflow-hidden`
              doesn't clip it. Limited to `lg:` and up because narrower
              viewports don't have enough horizontal room to fit an 18rem
              preview alongside the 32rem dropdown.

              `pointer-events-none` keeps it from intercepting hover on the
              dropdown rows that drive it. `aria-hidden` keeps it out of the
              a11y tree — the row itself already announces the title/summary
              and the entry image is decorative. */}
          {hoveredEntry?.image && hoverRowTop !== null && (
            <div
              aria-hidden="true"
              // Inline `transition` (not a Tailwind class) so we don't fight
              // `duration-150` on the mount-time `animate-in` — the fade/zoom
              // entry animation stays snappy, and only the `top` property
              // glides between rows on subsequent hovers.
              style={{ top: `${hoverRowTop}px`, transition: 'top 180ms ease-out' }}
              className="hidden lg:block pointer-events-none absolute right-[33rem] w-72 z-50 animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-2xl">
                <img
                  src={hoveredEntry.image}
                  alt=""
                  className="w-full h-auto max-h-[60vh] object-contain block bg-gray-50 dark:bg-[#0d1117]"
                  loading="lazy"
                  decoding="async"
                />
                <div className="px-3 py-2 border-t border-gray-100 dark:border-[#21262d]">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {hoveredEntry.title}
                  </div>
                  {hoveredEntry.version && (
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-500 mt-0.5">
                      v{hoveredEntry.version}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
