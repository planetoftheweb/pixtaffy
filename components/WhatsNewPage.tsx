import React, { useEffect, useRef } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckSquare,
  ChevronLeft,
  Clipboard,
  CreditCard,
  Edit,
  Eye,
  EyeOff,
  ExternalLink,
  Film,
  Folder,
  FolderInput,
  HelpCircle,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers,
  Pencil,
  Palette,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { WhatsNewEntry, WhatsNewStep } from '../types';

interface WhatsNewPageProps {
  entries: WhatsNewEntry[];
  unseenIds: Set<string>;
  /**
   * Currently-focused entry id (controlled by the parent). When null, the
   * page renders the discovery list; when set, it renders the detail view
   * for that release. The parent owns this state so deep-links (e.g.
   * clicking a bell row or the spotlight's "Read the guide" button) can
   * pick the right entry without an extra round-trip.
   */
  selectedEntryId: string | null;
  /** Switch between list view (null) and detail view (entry id). */
  onSelectEntry: (id: string | null) => void;
  /** Exit the page entirely (chrome back-arrow). */
  onBack: () => void;
}

/**
 * Allowlist of Lucide icon names that author content in `data/whatsNew.ts`
 * may reference from a step's `icon` field. Kept narrow on purpose so the
 * bundle doesn't have to dynamic-import the entire Lucide tree, and so
 * authors get predictable rendering. Unknown names fall back to a neutral
 * help glyph rather than crashing the page.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Archive,
  Bell,
  ArrowRight,
  BookOpen,
  Check,
  CheckSquare,
  Clipboard,
  CreditCard,
  Edit,
  Eye,
  EyeOff,
  ExternalLink,
  Film,
  Folder,
  FolderInput,
  Image: ImageIcon,
  Info,
  KeyRound,
  Layers,
  Palette,
  Pencil,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
};

const formatLongDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

/**
 * Inline marker rendered to the right of step text. Mirrors how the real
 * app surfaces these affordances so users can match instructions to the
 * actual UI at a glance:
 *   - icon: small rounded-md "pill" echoing an icon button
 *   - kbd: monospace key chips for keyboard shortcuts
 */
const StepMarker: React.FC<{ step: WhatsNewStep }> = ({ step }) => {
  const Icon = step.icon ? ICON_MAP[step.icon] ?? HelpCircle : null;
  const keys = step.kbd ? step.kbd.split('+').map((k) => k.trim()).filter(Boolean) : [];

  if (!Icon && keys.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      {Icon && (
        <span
          aria-hidden="true"
          className="inline-flex w-7 h-7 items-center justify-center rounded-md bg-gray-100 dark:bg-[#21262d] border border-gray-200 dark:border-[#30363d] text-brand-teal"
        >
          <Icon size={14} />
        </span>
      )}
      {keys.map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-gray-100 dark:bg-[#21262d] border border-gray-200 dark:border-[#30363d] rounded text-slate-700 dark:text-slate-200"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
};

/**
 * Full-page "blog-style" discovery view + per-release detail view.
 *
 * Sibling to {@link WhatsNewBell} (compact dropdown) and `WhatsNewSpotlight`
 * (one-time modal). Internally renders one of two layouts driven by
 * `selectedEntryId`:
 *
 *   1. List view (`selectedEntryId === null`): a generous hero card for the
 *      latest release followed by an image-top card grid of the rest.
 *      Cards are clickable and call `onSelectEntry(id)`.
 *
 *   2. Detail view (`selectedEntryId === <id>`): a single release rendered
 *      as a step-by-step guide. Loads the hero image, blurb, then walks
 *      through each `section` with numbered `steps`, optional icon pills,
 *      and optional keyboard-shortcut chips.
 *
 * Page chrome (header with back arrow + icon + title) matches `CatalogPage`
 * so all top-level pages feel consistent. The scroll container resets to
 * the top whenever the selection switches so users don't land mid-page.
 */
export const WhatsNewPage: React.FC<WhatsNewPageProps> = ({
  entries,
  unseenIds,
  selectedEntryId,
  onSelectEntry,
  onBack,
}) => {
  const selectedEntry = selectedEntryId
    ? entries.find((e) => e.id === selectedEntryId) ?? null
    : null;

  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset scroll whenever the selection changes so detail->list and
  // list->detail transitions don't land mid-page from prior scroll state.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [selectedEntryId]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 dark:bg-[#0d1117]">
      {/* Header — matches CatalogPage chrome */}
      <div className="flex justify-between items-center px-6 py-6 border-b border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117]">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="p-2 -ml-2 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 dark:bg-[#21262d] rounded-lg text-brand-teal">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="pixtaffy-display text-2xl font-bold text-slate-900 dark:text-white">
                What&rsquo;s new
              </h2>
              <p className="text-sm text-slate-500">
                {selectedEntry
                  ? 'Step-by-step guide for this launch.'
                  : 'The biggest PixTaffy launches, all in one place.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="text-center py-24 text-slate-500">
            <p className="mb-2">No launches yet.</p>
            <p className="text-xs">
              Check back soon — new highlights land here as we ship them.
            </p>
          </div>
        ) : selectedEntry ? (
          <DetailView
            entry={selectedEntry}
            onBackToList={() => onSelectEntry(null)}
          />
        ) : (
          <ListView
            entries={entries}
            unseenIds={unseenIds}
            onSelectEntry={onSelectEntry}
          />
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                                  List view                                 */
/* -------------------------------------------------------------------------- */

const ListView: React.FC<{
  entries: WhatsNewEntry[];
  unseenIds: Set<string>;
  onSelectEntry: (id: string) => void;
}> = ({ entries, unseenIds, onSelectEntry }) => {
  const [hero, ...rest] = entries;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-12">
      {/* Hero entry — newest release gets the most visual real-estate. */}
      {hero && (
        <button
          type="button"
          onClick={() => onSelectEntry(hero.id)}
          className="group block w-full text-left relative overflow-hidden rounded-2xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-sm hover:shadow-md transition-all"
        >
          <div className="md:grid md:grid-cols-5 md:items-stretch">
            {/* Image — top on mobile, right column on desktop. */}
            <div className="md:col-span-2 md:order-2 aspect-[16/9] md:aspect-auto md:min-h-[18rem] bg-gradient-to-br from-brand-teal/20 via-brand-orange/15 to-brand-red/15 dark:from-brand-teal/15 dark:via-brand-orange/10 dark:to-brand-red/10 border-b md:border-b-0 md:border-l border-gray-200 dark:border-[#30363d] overflow-hidden">
              {hero.image ? (
                <img
                  src={hero.image}
                  alt=""
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-brand-teal/60">
                  <Sparkles size={64} />
                </div>
              )}
            </div>

            <div className="md:col-span-3 md:order-1 p-6 md:p-10 flex flex-col justify-center">
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-teal/10 text-brand-teal text-[11px] font-bold uppercase tracking-wide">
                  <Sparkles size={12} />
                  Latest launch
                </span>
                {hero.version && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    v{hero.version}
                  </span>
                )}
                {unseenIds.has(hero.id) && (
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-red/10 text-brand-red border border-brand-red/30">
                    New
                  </span>
                )}
              </div>

              <h3 className="pixtaffy-display text-2xl md:text-3xl font-bold text-slate-900 dark:text-white leading-tight">
                {hero.title}
              </h3>
              <p className="mt-4 text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                {hero.blurb}
              </p>

              <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-brand-teal">
                Read the guide
                <ArrowRight
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-500">
                Released {formatLongDate(hero.publishedAt)}
              </div>
            </div>
          </div>
        </button>
      )}

      {/* Earlier launches use the same image-top card grid. */}
      {rest.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 mb-4 px-1">
            Earlier launches
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {rest.map((entry) => {
              const isUnseen = unseenIds.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelectEntry(entry.id)}
                  className="group text-left flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <div className="aspect-[16/9] bg-gradient-to-br from-brand-teal/15 via-brand-orange/10 to-brand-red/10 dark:from-brand-teal/10 dark:via-brand-orange/10 dark:to-brand-red/10 border-b border-gray-200 dark:border-[#30363d] overflow-hidden">
                    {entry.image ? (
                      <img
                        src={entry.image}
                        alt=""
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-brand-teal/50">
                        <Sparkles size={40} />
                      </div>
                    )}
                  </div>

                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex items-baseline gap-2 flex-wrap mb-2">
                      {entry.version && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-brand-teal">
                          v{entry.version}
                        </span>
                      )}
                      {isUnseen && (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-red/10 text-brand-red border border-brand-red/30">
                          New
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-500">
                        {formatLongDate(entry.publishedAt)}
                      </span>
                    </div>

                    <h4 className="pixtaffy-display text-base font-semibold text-slate-900 dark:text-white leading-snug">
                      {entry.title}
                    </h4>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed flex-1">
                      {entry.blurb}
                    </p>

                    <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-brand-teal">
                      Read the guide
                      <ArrowRight
                        size={11}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-slate-500 dark:text-slate-500 pt-2">
        That&rsquo;s everything so far. New highlights land here as we ship them.
      </p>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                                Detail view                                 */
/* -------------------------------------------------------------------------- */

const DetailView: React.FC<{
  entry: WhatsNewEntry;
  onBackToList: () => void;
}> = ({ entry, onBackToList }) => {
  return (
    <article className="max-w-3xl mx-auto px-6 py-8 md:py-10">
      {/* Internal back link — distinct from the chrome back arrow which
          exits the page entirely. */}
      <button
        type="button"
        onClick={onBackToList}
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-teal dark:hover:text-brand-teal transition-colors mb-4"
      >
        <ChevronLeft size={14} />
        All launches
      </button>

      {/* Hero image */}
      {entry.image && (
        <div className="aspect-[16/9] rounded-2xl overflow-hidden border border-gray-200 dark:border-[#30363d] bg-gradient-to-br from-brand-teal/20 via-brand-orange/15 to-brand-red/15 dark:from-brand-teal/15 dark:via-brand-orange/10 dark:to-brand-red/10">
          <img
            src={entry.image}
            alt=""
            className="w-full h-full object-cover"
            loading="eager"
            decoding="async"
          />
        </div>
      )}

      <header className="mt-8">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {entry.version && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-teal/10 text-brand-teal text-[11px] font-bold uppercase tracking-wide">
              <Sparkles size={12} />
              v{entry.version}
            </span>
          )}
          <span className="text-xs text-slate-500 dark:text-slate-500">
            Released {formatLongDate(entry.publishedAt)}
          </span>
        </div>

        <h1 className="pixtaffy-display text-3xl md:text-4xl font-bold text-slate-900 dark:text-white leading-tight">
          {entry.title}
        </h1>

        <p className="mt-4 text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
          {entry.blurb}
        </p>
      </header>

      {/* Section walkthroughs */}
      {entry.sections && entry.sections.length > 0 ? (
        <div className="mt-10 space-y-10">
          {entry.sections.map((section, idx) => (
            <section key={`${entry.id}-section-${idx}`}>
              <h2 className="pixtaffy-display text-xl md:text-2xl font-bold text-slate-900 dark:text-white leading-tight">
                {section.heading}
              </h2>
              {section.body && (
                <p className="mt-3 text-base text-slate-600 dark:text-slate-300 leading-relaxed">
                  {section.body}
                </p>
              )}
              {section.steps && section.steps.length > 0 && (
                <ol className="mt-5 space-y-3">
                  {section.steps.map((step, stepIdx) => (
                    <li
                      key={`${entry.id}-section-${idx}-step-${stepIdx}`}
                      className="flex items-start gap-3 p-3 rounded-lg bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d]"
                    >
                      <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-brand-teal text-white text-xs font-bold shrink-0 mt-px">
                        {stepIdx + 1}
                      </span>
                      <div className="flex-1 flex items-center gap-3 flex-wrap text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                        <span className="flex-1 min-w-[10rem]">{step.text}</span>
                        <StepMarker step={step} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-10 p-5 rounded-xl border border-dashed border-gray-300 dark:border-[#30363d] text-sm text-slate-500 dark:text-slate-400">
          A detailed walkthrough hasn&rsquo;t been written for this launch yet.
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t border-gray-200 dark:border-[#30363d] flex items-center justify-between gap-4 flex-wrap">
        <button
          type="button"
          onClick={onBackToList}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-teal hover:bg-brand-teal/90 text-white text-sm font-semibold shadow-sm shadow-brand-teal/30 transition-colors"
        >
          <ChevronLeft size={14} />
          Back to all launches
        </button>
        {entry.learnMoreHref && (
          <a
            href={entry.learnMoreHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-teal hover:underline"
          >
            Learn more <ExternalLink size={12} />
          </a>
        )}
      </footer>
    </article>
  );
};
