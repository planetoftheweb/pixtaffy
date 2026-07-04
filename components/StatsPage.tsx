import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  RefreshCw,
  Users,
  ImageIcon,
  Wand2,
  Crown,
  Lock,
  KeyRound,
  Activity,
  Layers,
  Sparkles,
  Ratio,
  Palette,
  Loader2,
  AlertCircle,
  TrendingUp,
  User as UserIcon,
  ArrowLeft,
  CalendarClock,
  Hash,
  DollarSign,
} from 'lucide-react';
import {
  statsService,
  AdminStats,
  StatsBucketEntry,
  UserStats,
} from '../services/statsService';
import { MODEL_COST_PER_IMAGE_USD, DEFAULT_COST_PER_IMAGE_USD } from '../constants';
import { buildProfileImageCacheKey } from '../services/imageCache';
import { CachedImage } from './CachedImage';

// -----------------------------------------------------------------------------
// Tiny local chart primitives (no chart library; keeps the bundle small).
// These are intentionally simple: CSS-based bars + an SVG mini-timeseries.
// -----------------------------------------------------------------------------

const numFmt = new Intl.NumberFormat();

interface StatTileProps {
  label: string;
  value: number | string;
  hint?: string;
  icon: React.ReactNode;
  accent?: 'teal' | 'amber' | 'rose' | 'slate' | 'indigo';
}

const ACCENTS: Record<NonNullable<StatTileProps['accent']>, string> = {
  teal: 'text-brand-teal bg-brand-teal/10',
  amber: 'text-amber-600 dark:text-amber-300 bg-amber-500/10',
  rose: 'text-rose-600 dark:text-rose-300 bg-rose-500/10',
  slate: 'text-slate-600 dark:text-slate-300 bg-slate-500/10',
  indigo: 'text-indigo-600 dark:text-indigo-300 bg-indigo-500/10',
};

const StatTile: React.FC<StatTileProps> = ({ label, value, hint, icon, accent = 'teal' }) => (
  <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-4 flex items-start gap-3">
    <div className={`p-2 rounded-lg ${ACCENTS[accent]}`}>{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">
        {typeof value === 'number' ? numFmt.format(value) : value}
      </p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</p>}
    </div>
  </div>
);

/**
 * Estimated API spend from per-image counts × the price table in constants.
 * Estimates at standard settings — real bills vary with resolution/quality.
 */
const EstimatedSpendCard: React.FC<{ entries: StatsBucketEntry[] }> = ({ entries }) => {
  const rows = entries.map((e) => ({
    ...e,
    unit: MODEL_COST_PER_IMAGE_USD[e.key] ?? DEFAULT_COST_PER_IMAGE_USD,
  }));
  const total = rows.reduce((sum, r) => sum + r.count * r.unit, 0);
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold">
          <DollarSign size={16} />
          Estimated image spend
        </div>
        <span className="text-lg font-bold text-white tabular-nums">${total.toFixed(2)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No images yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{r.label}</span>
              <span className="text-slate-400 tabular-nums">
                {r.count.toLocaleString()} × ${r.unit.toFixed(3)}
                <span className="text-slate-200 font-semibold ml-2">${(r.count * r.unit).toFixed(2)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-500">
        Estimated at standard settings (≈1K output) — providers bill by resolution/quality, so
        actuals vary. Auxiliary calls (prompt expansion, analysis, auto-select) not included.
      </p>
    </div>
  );
};

interface HorizontalBarListProps {
  title: string;
  icon: React.ReactNode;
  entries: StatsBucketEntry[];
  /** When totals across entries are meaningful, render a percentage label. */
  showPercent?: boolean;
  emptyMessage?: string;
}

const HorizontalBarList: React.FC<HorizontalBarListProps> = ({
  title,
  icon,
  entries,
  showPercent = true,
  emptyMessage = 'No data yet.',
}) => {
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0);
  const total = entries.reduce((s, e) => s + e.count, 0);

  return (
    <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-slate-500">{icon}</div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
          {emptyMessage}
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const pct = max > 0 ? Math.round((entry.count / max) * 100) : 0;
            const totalPct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
            return (
              <li key={entry.key} className="text-sm">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span
                    className="truncate text-slate-700 dark:text-slate-200"
                    title={entry.label}
                  >
                    {entry.label}
                  </span>
                  <span className="tabular-nums text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                    {numFmt.format(entry.count)}
                    {showPercent && total > 0 && (
                      <span className="ml-2 text-slate-400">{totalPct}%</span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-[#0d1117] overflow-hidden">
                  <div
                    className="h-full bg-brand-teal rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// Time series — stacked daily bars for images + refinements, 30 days.
// -----------------------------------------------------------------------------

interface DailyDatum {
  date: string;
  images: number;
  refinements?: number;
}

interface DailyBarChartProps {
  title: string;
  icon: React.ReactNode;
  data: DailyDatum[];
  /** Color class for the primary series (defaults to brand teal). */
  primaryClass?: string;
  /** Color class for the secondary series (refinements). */
  secondaryClass?: string;
  /** Labels for the legend. */
  primaryLabel?: string;
  secondaryLabel?: string;
}

const DailyBarChart: React.FC<DailyBarChartProps> = ({
  title,
  icon,
  data,
  primaryClass = 'bg-brand-teal',
  secondaryClass = 'bg-indigo-400 dark:bg-indigo-500',
  primaryLabel = 'Images',
  secondaryLabel = 'Refinements',
}) => {
  const max = Math.max(1, ...data.map((d) => d.images + (d.refinements ?? 0)));
  const total = data.reduce((s, d) => s + d.images + (d.refinements ?? 0), 0);
  const peakDay: DailyDatum | null = data.reduce(
    (acc: DailyDatum | null, d) =>
      acc && acc.images + (acc.refinements ?? 0) >= d.images + (d.refinements ?? 0) ? acc : d,
    null as DailyDatum | null
  );

  return (
    <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="text-slate-500">{icon}</div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${primaryClass}`} />
            {primaryLabel}
          </span>
          {data.some((d) => (d.refinements ?? 0) > 0) && (
            <span className="inline-flex items-center gap-1.5">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${secondaryClass}`} />
              {secondaryLabel}
            </span>
          )}
        </div>
      </div>

      {/* Bars */}
      <div className="h-32 flex items-end gap-[2px]">
        {data.map((d) => {
          const imageH = (d.images / max) * 100;
          const refinementH = ((d.refinements ?? 0) / max) * 100;
          const hoverTitle = `${d.date} — ${d.images} image${d.images === 1 ? '' : 's'}${
            (d.refinements ?? 0) > 0 ? `, ${d.refinements} refinement${d.refinements === 1 ? '' : 's'}` : ''
          }`;
          return (
            <div
              key={d.date}
              className="flex-1 h-full flex flex-col justify-end min-w-[4px]"
              title={hoverTitle}
            >
              {refinementH > 0 && (
                <div
                  className={`${secondaryClass} rounded-t-sm`}
                  style={{ height: `${refinementH}%` }}
                />
              )}
              <div
                className={`${primaryClass} ${refinementH === 0 ? 'rounded-t-sm' : ''}`}
                style={{ height: `${imageH}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* X-axis: first, middle, last */}
      <div className="flex justify-between text-[10px] text-slate-400 mt-2 tabular-nums">
        <span>{data[0]?.date ?? ''}</span>
        <span>{data[Math.floor(data.length / 2)]?.date ?? ''}</span>
        <span>{data[data.length - 1]?.date ?? ''}</span>
      </div>

      {/* Summary line */}
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Total: <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{numFmt.format(total)}</span></span>
        {peakDay && (peakDay.images + (peakDay.refinements ?? 0)) > 0 && (
          <span>
            Peak <span className="tabular-nums">{peakDay.date}</span>:
            {' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
              {numFmt.format(peakDay.images + (peakDay.refinements ?? 0))}
            </span>
          </span>
        )}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Main Stats page
// -----------------------------------------------------------------------------

const formatRelative = (fromMs: number): string => {
  const diff = Date.now() - fromMs;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(fromMs).toLocaleString();
};

/** Format an ms-epoch as a short absolute date, or em-dash if missing. */
const formatDate = (ms: number | null): string => {
  if (ms == null) return '—';
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
};

// -----------------------------------------------------------------------------
// Focused (single-user) stats view.
// Mirrors the layout of the full dashboard, but with user-centric tiles
// and no leaderboard.
// -----------------------------------------------------------------------------

interface FocusedUserViewProps {
  userStats: UserStats;
}

const FocusedUserView: React.FC<FocusedUserViewProps> = ({ userStats }) => {
  const u = userStats.user;
  const g = userStats.generations;

  // Avg per active day across the visible 30-day window.
  const activeDaysIn30 = g.perDayLast30.filter(
    (d) => d.images + d.refinements > 0
  ).length;
  const totalLast30 = g.perDayLast30.reduce(
    (s, d) => s + d.images + d.refinements,
    0
  );
  const avgPerActiveDay =
    activeDaysIn30 > 0 ? (totalLast30 / activeDaysIn30).toFixed(1) : '0';

  return (
    <>
      {/* Profile card */}
      <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-4 flex items-center gap-4">
        {u.photoURL || u.photoDataUrl ? (
          <CachedImage
            src={u.photoURL}
            fallbackSrc={u.photoDataUrl}
            fallback={
              <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#21262d] flex items-center justify-center text-slate-500">
                <UserIcon size={24} />
              </div>
            }
            cacheKey={buildProfileImageCacheKey(u.uid)}
            alt=""
            className="w-14 h-14 rounded-full object-cover border border-gray-200 dark:border-[#30363d]"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#21262d] flex items-center justify-center text-slate-500">
            <UserIcon size={24} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">
              {u.name || '(unnamed)'}
            </h2>
            {u.isLegacyAdminSignal && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
                <Crown size={10} />
                Admin
              </span>
            )}
            {u.isDisabled && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[11px] font-semibold">
                <Lock size={10} />
                Suspended
              </span>
            )}
          </div>
          <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
            {u.username && <span>@{u.username}</span>}
            {u.username && u.email && <span className="mx-1.5 text-slate-400">·</span>}
            {u.email && <span>{u.email}</span>}
          </div>
        </div>
        <div className="hidden sm:flex items-center text-xs text-slate-400 font-mono truncate max-w-[160px]" title={u.uid}>
          <Hash size={12} className="mr-1" />
          {u.uid}
        </div>
      </div>

      {/* Tiles row 1: generations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Images generated"
          value={g.totalImages}
          hint={`${numFmt.format(g.totalTiles)} tiles total`}
          icon={<ImageIcon size={18} />}
          accent="teal"
        />
        <StatTile
          label="Refinements"
          value={g.totalRefinements}
          hint="Edit / recompose passes"
          icon={<Wand2 size={18} />}
          accent="indigo"
        />
        <StatTile
          label="Tiles created"
          value={g.totalTiles}
          hint={
            g.totalTiles > 0
              ? `${(g.totalImages / g.totalTiles).toFixed(1)} images per tile`
              : 'No history yet'
          }
          icon={<Layers size={18} />}
          accent="slate"
        />
        <StatTile
          label="Avg per active day"
          value={avgPerActiveDay}
          hint={`${activeDaysIn30} active day${activeDaysIn30 === 1 ? '' : 's'} in last 30`}
          icon={<TrendingUp size={18} />}
          accent="amber"
        />
      </div>

      {/* Tiles row 2: account state */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Member since"
          value={formatDate(u.createdAtMs)}
          hint={
            u.createdAtMs
              ? `${Math.max(
                  0,
                  Math.floor((Date.now() - u.createdAtMs) / 86_400_000)
                )} days ago`
              : 'Unknown'
          }
          icon={<CalendarClock size={18} />}
          accent="slate"
        />
        <StatTile
          label="Last sign-in"
          value={formatDate(u.lastSignInAtMs)}
          hint={
            u.lastSignInAtMs ? formatRelative(u.lastSignInAtMs) : 'No record'
          }
          icon={<Activity size={18} />}
          accent="indigo"
        />
        <StatTile
          label="API key configured"
          value={u.hasApiKey ? 'Yes' : 'No'}
          hint={u.hasApiKey ? 'BYOK ready' : 'Cannot generate without one'}
          icon={<KeyRound size={18} />}
          accent={u.hasApiKey ? 'teal' : 'rose'}
        />
        <StatTile
          label="Account status"
          value={u.isDisabled ? 'Suspended' : 'Active'}
          hint={u.isDisabled ? 'Hard-blocked at login' : 'Allowed to sign in'}
          icon={u.isDisabled ? <Lock size={18} /> : <UserIcon size={18} />}
          accent={u.isDisabled ? 'rose' : 'teal'}
        />
      </div>

      {/* Time-series row */}
      <div className="grid grid-cols-1 gap-3">
        <DailyBarChart
          title="Activity — last 30 days"
          icon={<ImageIcon size={16} />}
          data={g.perDayLast30}
          primaryLabel="Images"
          secondaryLabel="Refinements"
        />
      </div>

      {/* Breakdown row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <EstimatedSpendCard entries={g.byModelImages} />
        <HorizontalBarList
          title="By model"
          icon={<Layers size={16} />}
          entries={g.byModel}
          emptyMessage="This user hasn't generated anything yet."
        />
        <HorizontalBarList
          title="By graphic type"
          icon={<Palette size={16} />}
          entries={g.byGraphicType}
          emptyMessage="No typed generations yet."
        />
      </div>

      {/* Breakdown row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <HorizontalBarList
          title="By visual style (top 10)"
          icon={<Sparkles size={16} />}
          entries={g.byVisualStyle}
          emptyMessage="No styled generations yet."
        />
        <HorizontalBarList
          title="By aspect ratio"
          icon={<Ratio size={16} />}
          entries={g.byAspectRatio}
          emptyMessage="No ratios recorded yet."
        />
      </div>
    </>
  );
};

export const StatsPage: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [focusedUid, setFocusedUid] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Used so the "computed Xs ago" label ticks visibly.
  const [, setTickNow] = useState(0);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const snap = await statsService.getStats({ topUsersLimit: 10 });
      setStats(snap);
    } catch (e: any) {
      const code = e?.code ? ` (${e.code})` : '';
      setError(`Failed to load stats${code}: ${e?.message || 'unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUser = async (uid: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const snap = await statsService.getUserStats(uid);
      setUserStats(snap);
    } catch (e: any) {
      const code = e?.code ? ` (${e.code})` : '';
      setError(`Failed to load user stats${code}: ${e?.message || 'unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load.
  useEffect(() => {
    load();
  }, []);

  // When a user is focused, fetch their slice. Reset when un-focusing.
  useEffect(() => {
    if (focusedUid) {
      loadUser(focusedUid);
    } else {
      setUserStats(null);
    }
  }, [focusedUid]);

  // Keep the "computed 12s ago" label fresh.
  useEffect(() => {
    if (!stats && !userStats) return;
    const iv = window.setInterval(() => setTickNow((n) => n + 1), 5_000);
    return () => window.clearInterval(iv);
  }, [stats, userStats]);

  const signupSeries = useMemo(
    () =>
      stats?.users.signupsLast30Days.map((d) => ({
        date: d.date,
        images: d.signups,
      })) ?? [],
    [stats]
  );

  const isUserView = focusedUid !== null;

  const handleRefresh = () => {
    if (focusedUid) {
      loadUser(focusedUid);
    } else {
      load();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header / refresh */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 min-w-0">
          {isUserView && (
            <button
              type="button"
              onClick={() => setFocusedUid(null)}
              className="inline-flex items-center gap-1.5 px-2 py-1 -ml-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-[#21262d]"
              title="Back to all users"
            >
              <ArrowLeft size={14} />
              <span className="text-sm font-medium">All users</span>
            </button>
          )}
          <BarChart3 size={16} className="text-slate-500 shrink-0" />
          {isUserView && userStats ? (
            <span className="truncate">
              Scanned{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                {numFmt.format(userStats.scannedHistoryDocs)}
              </span>{' '}
              tiles for{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {userStats.user.name || userStats.user.username || 'this user'}
              </span>{' '}
              in {(userStats.durationMs / 1000).toFixed(1)}s — last refreshed{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {formatRelative(userStats.generatedAt)}
              </span>
              .
            </span>
          ) : !isUserView && stats ? (
            <span>
              Scanned{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                {numFmt.format(stats.scannedHistoryDocs)}
              </span>{' '}
              history tiles across{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                {numFmt.format(stats.users.total)}
              </span>{' '}
              users in {(stats.durationMs / 1000).toFixed(1)}s — last refreshed{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {formatRelative(stats.generatedAt)}
              </span>
              .
            </span>
          ) : (
            <span>Aggregating usage data…</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-[#21262d] disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3">
          <AlertCircle size={20} className="text-red-600 dark:text-red-300 mt-0.5" />
          <div className="text-sm text-red-800 dark:text-red-200">
            <p className="font-semibold">Could not load stats</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-xs text-red-700/80 dark:text-red-300/80">
              If the error mentions <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">permission-denied</code>,
              the Firestore <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">collectionGroup('history')</code>
              rule hasn't been deployed yet. See <code className="bg-red-100 dark:bg-red-900/40 px-1 rounded">firestore.rules</code>.
            </p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {((isUserView && !userStats) || (!isUserView && !stats)) && isLoading && (
        <div className="py-16 flex items-center justify-center text-slate-500">
          <Loader2 size={24} className="animate-spin mr-3" />
          {isUserView ? 'Loading user activity…' : 'Building usage snapshot…'}
        </div>
      )}

      {/* Focused user view */}
      {isUserView && userStats && (
        <FocusedUserView userStats={userStats} />
      )}

      {!isUserView && stats && (
        <>
          {/* Tiles row 1: generations */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              label="Images generated"
              value={stats.generations.totalImages}
              hint={`${numFmt.format(stats.generations.totalTiles)} tiles total`}
              icon={<ImageIcon size={18} />}
              accent="teal"
            />
            <StatTile
              label="Refinements"
              value={stats.generations.totalRefinements}
              hint="Edit / recompose passes"
              icon={<Wand2 size={18} />}
              accent="indigo"
            />
            <StatTile
              label="Total users"
              value={stats.users.total}
              hint={`${numFmt.format(stats.users.activeLast7d)} active last 7d`}
              icon={<Users size={18} />}
              accent="slate"
            />
            <StatTile
              label="Active last 30d"
              value={stats.users.activeLast30d}
              hint={`${numFmt.format(stats.users.withApiKey)} have an API key`}
              icon={<Activity size={18} />}
              accent="amber"
            />
          </div>

          {/* Tiles row 2: account state */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              label="Admin signals"
              value={stats.users.legacyAdminSignals}
              hint="Matches persisted admin signals"
              icon={<Crown size={18} />}
              accent="amber"
            />
            <StatTile
              label="Suspended users"
              value={stats.users.disabled}
              hint={stats.users.disabled === 0 ? 'None' : 'Hard-blocked at login'}
              icon={<Lock size={18} />}
              accent="rose"
            />
            <StatTile
              label="With API key"
              value={stats.users.withApiKey}
              hint={
                stats.users.total > 0
                  ? `${Math.round((stats.users.withApiKey / stats.users.total) * 100)}% of all users`
                  : undefined
              }
              icon={<KeyRound size={18} />}
              accent="teal"
            />
            <StatTile
              label="Avg images / user"
              value={
                stats.users.total > 0
                  ? (stats.generations.totalImages / stats.users.total).toFixed(1)
                  : '0'
              }
              hint="Lifetime, generation-type marks only"
              icon={<TrendingUp size={18} />}
              accent="indigo"
            />
          </div>

          {/* Time-series row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <DailyBarChart
              title="Images generated — last 30 days"
              icon={<ImageIcon size={16} />}
              data={stats.generations.perDayLast30}
              primaryLabel="Images"
              secondaryLabel="Refinements"
            />
            <DailyBarChart
              title="New signups — last 30 days"
              icon={<Users size={16} />}
              data={signupSeries}
              primaryClass="bg-indigo-500"
              primaryLabel="Signups"
            />
          </div>

          {/* Breakdown row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <EstimatedSpendCard entries={stats.generations.byModelImages} />
            <HorizontalBarList
              title="By model"
              icon={<Layers size={16} />}
              entries={stats.generations.byModel}
              emptyMessage="No generations recorded yet."
            />
            <HorizontalBarList
              title="By graphic type"
              icon={<Palette size={16} />}
              entries={stats.generations.byGraphicType}
              emptyMessage="No typed generations yet."
            />
          </div>

          {/* Breakdown row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <HorizontalBarList
              title="By visual style (top 10)"
              icon={<Sparkles size={16} />}
              entries={stats.generations.byVisualStyle}
              emptyMessage="No styled generations yet."
            />
            <HorizontalBarList
              title="By aspect ratio"
              icon={<Ratio size={16} />}
              entries={stats.generations.byAspectRatio}
              emptyMessage="No ratios recorded yet."
            />
          </div>

          {/* Leaderboard */}
          <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-[#30363d]">
              <TrendingUp size={16} className="text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Top users by images generated
              </h3>
            </div>
            {stats.generations.topUsers.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 px-4 py-8 text-center">
                No generation activity yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-[#0d1117] text-slate-500 uppercase text-[11px] tracking-wider">
                    <tr>
                      <th className="text-left font-semibold px-4 py-2.5">#</th>
                      <th className="text-left font-semibold px-4 py-2.5">User</th>
                      <th className="text-left font-semibold px-4 py-2.5">Email</th>
                      <th className="text-right font-semibold px-4 py-2.5">Images</th>
                      <th className="text-right font-semibold px-4 py-2.5">Refinements</th>
                      <th className="text-right font-semibold px-4 py-2.5">Tiles</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#21262d]">
                    {stats.generations.topUsers.map((u, i) => (
                      <tr
                        key={u.uid}
                        onClick={() => setFocusedUid(u.uid)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setFocusedUid(u.uid);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`View stats for ${u.name || u.username || u.email || 'user'}`}
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-[#0d1117]/60 focus:outline-none focus:bg-gray-50 dark:focus:bg-[#0d1117]/60"
                      >
                        <td className="px-4 py-2.5 text-slate-500 tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {u.photoURL || u.photoDataUrl ? (
                              <CachedImage
                                src={u.photoURL}
                                fallbackSrc={u.photoDataUrl}
                                fallback={
                                  <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-[#21262d] flex items-center justify-center text-slate-500">
                                    <UserIcon size={12} />
                                  </div>
                                }
                                cacheKey={buildProfileImageCacheKey(u.uid)}
                                alt=""
                                className="w-6 h-6 rounded-full object-cover border border-gray-200 dark:border-[#30363d]"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-[#21262d] flex items-center justify-center text-slate-500">
                                <UserIcon size={12} />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-slate-900 dark:text-white truncate">
                                {u.name || '(unnamed)'}
                              </div>
                              {u.username && (
                                <div className="text-xs text-slate-500 truncate">@{u.username}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300 truncate max-w-[240px]">
                          {u.email || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900 dark:text-white">
                          {numFmt.format(u.images)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 dark:text-slate-300">
                          {numFmt.format(u.refinements)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                          {numFmt.format(u.tiles)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
