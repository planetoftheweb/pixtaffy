import React, { useEffect } from 'react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import type { WhatsNewEntry } from '../types';

interface WhatsNewSpotlightProps {
  entry: WhatsNewEntry;
  onDismiss: (id: string) => void;
  /**
   * Invoked when the user clicks the primary "Read the guide" button.
   * The parent is expected to dismiss the spotlight and navigate to the
   * full-page `WhatsNewPage` detail view for *this* entry, so this
   * component doesn't need to know about routing.
   */
  onReadGuide: () => void;
}

/**
 * One-time-per-release announcement overlay. Mirrors the visual treatment of
 * the in-app Help modal so it feels native (`bg-white dark:bg-[#161b22]`,
 * `rounded-2xl`, `animate-in zoom-in-95 duration-200`). The parent decides
 * when this renders — it just needs to know which entry is being shown and
 * how to dismiss / route to the per-release guide.
 *
 * Button hierarchy:
 *   - Primary: "Read the guide \u2192" \u2014 dismisses + opens the detail page.
 *     This is the action most users want after seeing a feature highlight.
 *   - Secondary text: "Got it" \u2014 just dismisses; for users who already
 *     understand the feature and don't need the walkthrough.
 */
export const WhatsNewSpotlight: React.FC<WhatsNewSpotlightProps> = ({
  entry,
  onDismiss,
  onReadGuide,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss(entry.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry.id, onDismiss]);

  const formattedDate = new Date(entry.publishedAt).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={() => onDismiss(entry.id)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-spotlight-title"
        className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl w-full max-w-lg shadow-2xl relative animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onDismiss(entry.id)}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#30363d] transition-colors"
        >
          <X size={20} />
        </button>

        {entry.image && (
          <div className="w-full aspect-[16/9] bg-gradient-to-br from-brand-teal/20 via-brand-orange/15 to-brand-red/15 dark:from-brand-teal/15 dark:via-brand-orange/10 dark:to-brand-red/10 border-b border-gray-200 dark:border-[#30363d] overflow-hidden">
            <img
              src={entry.image}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="p-6">
          <div className="inline-flex items-center gap-1.5 mb-3 px-2 py-1 rounded-full bg-brand-teal/10 text-brand-teal text-[11px] font-bold uppercase tracking-wide">
            <Sparkles size={12} />
            New in PixTaffy
            {entry.version && (
              <span className="text-brand-teal/70">&middot; v{entry.version}</span>
            )}
          </div>

          <h2
            id="whats-new-spotlight-title"
            className="text-xl font-bold leading-tight"
          >
            {entry.title}
          </h2>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {entry.blurb}
          </p>

          <p className="mt-4 text-xs text-slate-500 dark:text-slate-500">
            Released {formattedDate}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onReadGuide}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-teal hover:bg-brand-teal/90 text-white text-sm font-semibold transition-colors shadow-sm shadow-brand-teal/30"
            >
              Read the guide
              <ArrowRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => onDismiss(entry.id)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-brand-teal dark:hover:text-brand-teal hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
            >
              Got it
            </button>
            {entry.learnMoreHref && (
              <a
                href={entry.learnMoreHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-sm font-medium text-brand-teal hover:underline"
              >
                Learn more
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
