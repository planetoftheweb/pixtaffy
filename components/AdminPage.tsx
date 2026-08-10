import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ShieldCheck,
  Search,
  Loader2,
  CheckCircle,
  AlertCircle,
  Users,
  Key,
  Sparkles,
  Lock,
  Unlock,
  Trash2,
  UserPlus,
  UserMinus,
  MoreHorizontal,
  Crown,
  ChevronRight,
  BarChart3,
  Mail,
  AtSign,
  CalendarPlus,
  Cpu,
} from 'lucide-react';
import { User } from '../types';
import {
  adminService,
  AdminUserRow,
  ListUsersPage,
} from '../services/adminService';
import { StatsPage } from './StatsPage';

type AdminTab = 'users' | 'stats';

interface AdminPageProps {
  onBack: () => void;
  currentUser: User;
}

type ConfirmableAction =
  | { type: 'clear-keys'; uid: string; name: string }
  | { type: 'wipe-prompt'; uid: string; name: string }
  | { type: 'disable'; uid: string; name: string; nextDisabled: boolean }
  | { type: 'promote'; uid: string; name: string }
  | { type: 'demote'; uid: string; name: string }
  | { type: 'delete'; uid: string; name: string };

type Banner = { kind: 'success' | 'error'; message: string } | null;

const coerceToMs = (value: any): number | null => {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().getTime();
      } catch {
        return null;
      }
    }
  }
  return null;
};

const formatTimestamp = (value: any): string => {
  const ms = coerceToMs(value);
  if (ms == null) return '—';
  return new Date(ms).toLocaleString();
};

const formatShortDate = (value: any): string => {
  const ms = coerceToMs(value);
  if (ms == null) return '—';
  const d = new Date(ms);
  return `${d.toLocaleString('en', { month: 'short' })} ${d.getDate()}, ${d.getFullYear()}`;
};

const formatRelative = (value: any): string => {
  const ms = coerceToMs(value);
  if (ms == null) return 'Never';
  const diff = Date.now() - ms;
  if (diff < 0) return 'Just now';
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;
  if (diff < minute) return 'Just now';
  if (diff < hour) {
    const n = Math.floor(diff / minute);
    return `${n} min${n === 1 ? '' : 's'} ago`;
  }
  if (diff < day) {
    const n = Math.floor(diff / hour);
    return `${n} hour${n === 1 ? '' : 's'} ago`;
  }
  if (diff < month) {
    const n = Math.floor(diff / day);
    return `${n} day${n === 1 ? '' : 's'} ago`;
  }
  if (diff < year) {
    const n = Math.floor(diff / month);
    return `${n} month${n === 1 ? '' : 's'} ago`;
  }
  const n = Math.floor(diff / year);
  return `${n} year${n === 1 ? '' : 's'} ago`;
};

const MODEL_LABELS: Record<string, string> = {
  gemini: 'Nano Banana Pro',
  'gemini-3.1-flash-image-preview': 'Nano Banana 2',
  'gemini-svg': 'Gemini SVG',
  'openai-2': 'GPT Image 2',
  'openai-mini': 'GPT Image Mini',
  openai: 'GPT Image 1.5'
};

const modelLabel = (id?: string) => (id ? MODEL_LABELS[id] || id : 'No model set');

/** Hover tooltip with consistent styling across the status icons. */
const Tooltip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <span className="relative group/tip inline-flex items-center">
    {children}
    <span className="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity z-20">
      {label}
    </span>
  </span>
);

/** Circular icon pill used as the status icons. ~44px to meet touch targets. */
const StatusIcon: React.FC<{
  label: string;
  icon: React.ElementType;
  active: boolean;
  tone?: 'teal' | 'amber' | 'red' | 'slate';
}> = ({ label, icon: Icon, active, tone = 'teal' }) => {
  const activeTone =
    tone === 'amber'
      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
      : tone === 'red'
        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
        : tone === 'slate'
          ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
          : 'bg-brand-teal/15 text-brand-teal border-brand-teal/30';
  const dimTone =
    'bg-transparent text-slate-300 dark:text-slate-600 border-slate-200 dark:border-[#30363d]';
  return (
    <Tooltip label={label}>
      <span
        className={`inline-flex items-center justify-center w-10 h-10 rounded-full border transition-colors ${
          active ? activeTone : dimTone
        }`}
        aria-label={label}
      >
        <Icon size={18} />
      </span>
    </Tooltip>
  );
};

export const AdminPage: React.FC<AdminPageProps> = ({ onBack, currentUser }) => {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<ListUsersPage['cursor']>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmableAction | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [bootstrapClaiming, setBootstrapClaiming] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRowExpanded = (uid: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);

  // Bootstrap banner: visible only for the legacy `planetoftheweb` username
  // when they haven't yet minted the admin custom claim. Click to self-promote.
  const showBootstrapBanner =
    currentUser.username === 'planetoftheweb' && currentUser.isAdmin !== true;

  const flashBanner = (next: Banner) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(next);
    if (next) {
      bannerTimer.current = setTimeout(() => setBanner(null), 4000);
    }
  };

  const loadFirstPage = async () => {
    setIsLoading(true);
    try {
      const [page, count] = await Promise.all([
        adminService.listUsers(),
        adminService.countUsers().catch(() => null),
      ]);
      setRows(page.rows);
      setCursor(page.cursor);
      if (typeof count === 'number') setTotalCount(count);
    } catch (err: any) {
      flashBanner({ kind: 'error', message: err?.message || 'Failed to load users.' });
    } finally {
      setIsLoading(false);
    }
  };

  const loadNextPage = async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await adminService.listUsers(cursor);
      setRows((prev) => [...prev, ...page.rows]);
      setCursor(page.cursor);
    } catch (err: any) {
      flashBanner({ kind: 'error', message: err?.message || 'Failed to load more users.' });
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadFirstPage();
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the row-action menu on outside click.
  useEffect(() => {
    if (!openRowMenu) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.(`[data-admin-row-menu-trigger="${openRowMenu}"]`)) return;
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) {
        setOpenRowMenu(null);
      }
    };
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  }, [openRowMenu]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const haystack = `${r.email ?? ''} ${r.name ?? ''} ${r.username ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, searchTerm]);

  const runAction = async (action: ConfirmableAction) => {
    const key = `${action.type}:${action.uid}`;
    setActionInFlight(key);
    try {
      switch (action.type) {
        case 'clear-keys':
          await adminService.clearUserApiKeys(action.uid);
          setRows((prev) =>
            prev.map((r) =>
              r.id === action.uid ? { ...r, hasGeminiKey: false, hasOpenAIKey: false } : r
            )
          );
          flashBanner({ kind: 'success', message: `Cleared API keys for ${action.name}.` });
          break;
        case 'wipe-prompt':
          await adminService.clearUserSystemPrompt(action.uid);
          flashBanner({ kind: 'success', message: `Wiped system prompt for ${action.name}.` });
          break;
        case 'disable':
          await adminService.setUserDisabled(action.uid, action.nextDisabled);
          setRows((prev) =>
            prev.map((r) =>
              r.id === action.uid ? { ...r, isDisabled: action.nextDisabled } : r
            )
          );
          flashBanner({
            kind: 'success',
            message: action.nextDisabled
              ? `Suspended ${action.name}.`
              : `Re-enabled ${action.name}.`,
          });
          break;
        case 'promote':
          await adminService.promoteToAdmin(action.uid);
          setRows((prev) =>
            prev.map((r) => (r.id === action.uid ? { ...r, isAdmin: true } : r))
          );
          flashBanner({ kind: 'success', message: `Promoted ${action.name} to admin.` });
          break;
        case 'demote':
          await adminService.demoteFromAdmin(action.uid);
          setRows((prev) =>
            prev.map((r) => (r.id === action.uid ? { ...r, isAdmin: false } : r))
          );
          flashBanner({ kind: 'success', message: `Demoted ${action.name}.` });
          break;
        case 'delete':
          await adminService.deleteUserCompletely(action.uid);
          setRows((prev) => prev.filter((r) => r.id !== action.uid));
          setTotalCount((prev) => (typeof prev === 'number' ? Math.max(0, prev - 1) : prev));
          flashBanner({ kind: 'success', message: `Deleted ${action.name}.` });
          break;
      }
    } catch (err: any) {
      flashBanner({
        kind: 'error',
        message: err?.message || 'Action failed. See console for details.',
      });
      // Best-effort: also log the raw error so admins can forward it.
      console.error('Admin action failed', action, err);
    } finally {
      setActionInFlight(null);
      setConfirm(null);
    }
  };

  const handleBootstrapSelfPromote = async () => {
    setBootstrapClaiming(true);
    try {
      await adminService.promoteToAdmin(currentUser.id);
      flashBanner({
        kind: 'success',
        message: 'Admin claim granted. Reload the page if the UI does not update immediately.',
      });
    } catch (err: any) {
      flashBanner({
        kind: 'error',
        message: err?.message || 'Failed to claim admin role.',
      });
    } finally {
      setBootstrapClaiming(false);
    }
  };

  const renderRowMenu = (row: AdminUserRow) => {
    const isSelf = row.id === currentUser.id;
    const isBusy = actionInFlight?.endsWith(`:${row.id}`);
    const handleMenuPick = (action: ConfirmableAction) => {
      setOpenRowMenu(null);
      setConfirm(action);
    };

    return (
      <div
        ref={rowMenuRef}
        className="absolute right-2 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] shadow-lg py-1 text-sm"
        role="menu"
      >
        <button
          type="button"
          disabled={isBusy}
          onClick={() =>
            handleMenuPick({ type: 'clear-keys', uid: row.id, name: row.email || row.username || row.id })
          }
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-700 dark:text-slate-200 disabled:opacity-50"
          role="menuitem"
        >
          <Key size={14} /> Clear API keys
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={() =>
            handleMenuPick({ type: 'wipe-prompt', uid: row.id, name: row.email || row.username || row.id })
          }
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-700 dark:text-slate-200 disabled:opacity-50"
          role="menuitem"
        >
          <Sparkles size={14} /> Wipe system prompt
        </button>
        <button
          type="button"
          disabled={isBusy || isSelf}
          onClick={() =>
            handleMenuPick({
              type: 'disable',
              uid: row.id,
              name: row.email || row.username || row.id,
              nextDisabled: !row.isDisabled,
            })
          }
          title={isSelf ? 'You cannot disable your own account.' : undefined}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-700 dark:text-slate-200 disabled:opacity-50"
          role="menuitem"
        >
          {row.isDisabled ? (
            <>
              <Unlock size={14} /> Enable account
            </>
          ) : (
            <>
              <Lock size={14} /> Suspend account
            </>
          )}
        </button>
        <div className="my-1 h-px bg-gray-200 dark:bg-[#30363d]" />
        <button
          type="button"
          disabled={isBusy}
          onClick={() =>
            handleMenuPick(
              row.isAdmin
                ? { type: 'demote', uid: row.id, name: row.email || row.username || row.id }
                : { type: 'promote', uid: row.id, name: row.email || row.username || row.id }
            )
          }
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-700 dark:text-slate-200 disabled:opacity-50"
          role="menuitem"
        >
          {row.isAdmin ? (
            <>
              <UserMinus size={14} /> Demote from admin
            </>
          ) : (
            <>
              <UserPlus size={14} /> Promote to admin
            </>
          )}
        </button>
        <div className="my-1 h-px bg-gray-200 dark:bg-[#30363d]" />
        <button
          type="button"
          disabled={isBusy || isSelf}
          onClick={() =>
            handleMenuPick({ type: 'delete', uid: row.id, name: row.email || row.username || row.id })
          }
          title={isSelf ? 'You cannot delete your own account here.' : undefined}
          className="w-full flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
          role="menuitem"
        >
          <Trash2 size={14} /> Delete account
        </button>
      </div>
    );
  };

  const confirmText = (action: ConfirmableAction): { title: string; body: string; button: string } => {
    switch (action.type) {
      case 'clear-keys':
        return {
          title: 'Clear API keys?',
          body: `This removes every API key stored on ${action.name}. They'll need to re-enter keys before generating.`,
          button: 'Clear keys',
        };
      case 'wipe-prompt':
        return {
          title: 'Wipe system prompt?',
          body: `This permanently removes ${action.name}'s custom system prompt.`,
          button: 'Wipe prompt',
        };
      case 'disable':
        return action.nextDisabled
          ? {
              title: `Suspend ${action.name}?`,
              body: 'Suspended users get a full-screen block on their next load. They can be re-enabled at any time.',
              button: 'Suspend',
            }
          : {
              title: `Enable ${action.name}?`,
              body: 'Re-enable this account. They regain normal access on their next load.',
              button: 'Enable',
            };
      case 'promote':
        return {
          title: `Promote ${action.name} to admin?`,
          body: 'Admins can see, modify, and delete every user account. They receive a Firebase Auth custom claim.',
          button: 'Promote',
        };
      case 'demote':
        return {
          title: `Demote ${action.name}?`,
          body: 'Removes the admin custom claim. They lose access to this page on their next token refresh.',
          button: 'Demote',
        };
      case 'delete':
        return {
          title: `Delete ${action.name}?`,
          body: 'This removes the user document, generation history, stored files, and Auth record. Teams and shared catalog items are kept. This cannot be undone.',
          button: 'Delete permanently',
        };
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0d1117] transition-colors duration-200">
      {/* Feedback banner */}
      {banner && (
        <div
          className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2 ${
            banner.kind === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          {banner.kind === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span className="text-sm font-medium">{banner.message}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8 flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-[#21262d] rounded-lg transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={20} className="text-slate-600 dark:text-slate-300" />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck size={24} className="text-brand-teal" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin</h1>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="mb-6 inline-flex items-center rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] p-1">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'users'
                ? 'bg-brand-teal text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
            aria-pressed={activeTab === 'users'}
          >
            <Users size={14} />
            Users
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stats')}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'stats'
                ? 'bg-brand-teal text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
            aria-pressed={activeTab === 'stats'}
          >
            <BarChart3 size={14} />
            Stats
          </button>
        </div>

        {/* Bootstrap banner: visible only when planetoftheweb doesn't have the claim yet */}
        {showBootstrapBanner && (
          <div className="mb-6 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
            <Crown size={20} className="text-amber-600 dark:text-amber-300 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Claim the admin role
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Your account (<code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40">planetoftheweb</code>) is recognised as the
                bootstrap admin but hasn't minted the custom claim yet. Click below to grant yourself the <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40">admin</code> claim.
              </p>
              <button
                type="button"
                onClick={handleBootstrapSelfPromote}
                disabled={bootstrapClaiming}
                className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {bootstrapClaiming ? <Loader2 size={14} className="animate-spin" /> : <Crown size={14} />}
                Claim admin role
              </button>
            </div>
          </div>
        )}

        {activeTab === 'stats' && <StatsPage />}

        {activeTab === 'users' && (
        <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl overflow-hidden">
          {/* Header row */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4 border-b border-gray-200 dark:border-[#30363d]">
            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <Users size={16} className="text-slate-500" />
              <span className="font-medium">
                {totalCount !== null
                  ? `${rows.length} loaded of ${totalCount.toLocaleString()} total users`
                  : `${rows.length} users loaded`}
              </span>
            </div>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by email, name, or username"
                className="w-full lg:w-80 pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] text-sm focus:ring-1 focus:ring-brand-teal focus:outline-none text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-[#0d1117] text-slate-500 uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">User</th>
                  <th className="text-left font-semibold px-4 py-3">Last seen</th>
                  <th className="text-left font-semibold px-4 py-3">Status</th>
                  <th className="text-right font-semibold px-4 py-3 sticky right-0 bg-gray-50 dark:bg-[#0d1117] shadow-[-8px_0_8px_-6px_rgba(0,0,0,0.08)] dark:shadow-[-8px_0_8px_-6px_rgba(0,0,0,0.5)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#21262d]">
                {isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-slate-500">
                      <Loader2 size={20} className="inline animate-spin mr-2" />
                      Loading users…
                    </td>
                  </tr>
                )}

                {!isLoading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-slate-500">
                      No users match your search.
                    </td>
                  </tr>
                )}

                {filteredRows.map((row) => {
                  const isExpanded = expandedRows.has(row.id);
                  const displayName = row.name || row.email || row.username || row.id;
                  const lastSignInFull = formatTimestamp(row.lastSignInAt);
                  const lastSignInRelative = formatRelative(row.lastSignInAt);
                  const createdFull = formatTimestamp(row.createdAt);
                  const createdShort = formatShortDate(row.createdAt);
                  const model = modelLabel(row.selectedModel);
                  return (
                    <React.Fragment key={row.id}>
                      <tr className="group hover:bg-gray-50 dark:hover:bg-[#0f141c] transition-colors align-middle">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => toggleRowExpanded(row.id)}
                            className="inline-flex items-center gap-2 text-left"
                            aria-expanded={isExpanded}
                            aria-label={`Toggle details for ${displayName}`}
                          >
                            <ChevronRight
                              size={16}
                              className={`text-slate-400 transition-transform ${
                                isExpanded ? 'rotate-90 text-brand-teal' : ''
                              }`}
                            />
                            <span className="font-medium text-slate-900 dark:text-white">
                              {displayName}
                            </span>
                            {row.id === currentUser.id && (
                              <span className="ml-1 inline-flex items-center rounded bg-brand-teal/10 text-brand-teal px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                                You
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap" title={lastSignInFull}>
                          <span className="relative group/cell inline-block">
                            {lastSignInRelative}
                            {row.lastSignInAt != null && (
                              <span className="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md bg-black/90 text-white shadow-lg opacity-0 group-hover/cell:opacity-100 transition-opacity z-20">
                                {lastSignInFull}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <StatusIcon
                              label={`Model: ${model}`}
                              icon={Cpu}
                              active={Boolean(row.selectedModel)}
                              tone="teal"
                            />
                            <StatusIcon
                              label={row.hasGeminiKey ? 'Gemini API key configured' : 'No Gemini key'}
                              icon={Key}
                              active={row.hasGeminiKey}
                              tone="teal"
                            />
                            <StatusIcon
                              label={row.hasOpenAIKey ? 'OpenAI API key configured' : 'No OpenAI key'}
                              icon={Sparkles}
                              active={row.hasOpenAIKey}
                              tone="teal"
                            />
                            <StatusIcon
                              label={row.isAdmin ? 'Admin' : 'Not an admin'}
                              icon={Crown}
                              active={row.isAdmin}
                              tone="amber"
                            />
                            <StatusIcon
                              label={row.isDisabled ? 'Suspended' : 'Active'}
                              icon={row.isDisabled ? Lock : Unlock}
                              active={row.isDisabled}
                              tone="red"
                            />
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 text-right relative sticky right-0 bg-white dark:bg-[#161b22] group-hover:bg-gray-50 dark:group-hover:bg-[#0f141c] shadow-[-8px_0_8px_-6px_rgba(0,0,0,0.08)] dark:shadow-[-8px_0_8px_-6px_rgba(0,0,0,0.5)] ${
                            openRowMenu === row.id ? 'z-30' : ''
                          }`}
                        >
                          <button
                            type="button"
                            data-admin-row-menu-trigger={row.id}
                            onClick={() =>
                              setOpenRowMenu((prev) => (prev === row.id ? null : row.id))
                            }
                            className="inline-flex items-center justify-center w-11 h-11 rounded-lg border border-gray-200 dark:border-[#30363d] hover:border-brand-teal bg-white dark:bg-[#0d1117] hover:bg-gray-100 dark:hover:bg-[#21262d] text-slate-600 dark:text-slate-300 hover:text-brand-teal transition-colors"
                            aria-label={`Actions for ${row.email || row.username || row.id}`}
                            aria-haspopup="menu"
                            aria-expanded={openRowMenu === row.id}
                            title="Actions"
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          {openRowMenu === row.id && renderRowMenu(row)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50/60 dark:bg-[#0d1117]/60">
                          <td colSpan={4} className="px-4 pt-1 pb-4">
                            <dl className="ml-6 grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-3 text-sm">
                              <div className="flex items-start gap-2">
                                <AtSign size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                <div>
                                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                    Username
                                  </dt>
                                  <dd className="text-slate-800 dark:text-slate-100">
                                    {row.username ? <code>{row.username}</code> : '—'}
                                  </dd>
                                </div>
                              </div>
                              <div className="flex items-start gap-2">
                                <Mail size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                <div>
                                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                    Email
                                  </dt>
                                  <dd className="text-slate-800 dark:text-slate-100 break-all">
                                    {row.email || '—'}
                                  </dd>
                                </div>
                              </div>
                              <div className="flex items-start gap-2">
                                <CalendarPlus size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                <div>
                                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                    Created
                                  </dt>
                                  <dd className="text-slate-800 dark:text-slate-100" title={createdFull}>
                                    {createdShort}
                                  </dd>
                                </div>
                              </div>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {cursor && (
            <div className="p-4 border-t border-gray-200 dark:border-[#30363d] text-center">
              <button
                type="button"
                onClick={loadNextPage}
                disabled={isLoadingMore}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-[#30363d] hover:bg-gray-50 dark:hover:bg-[#21262d] text-sm font-medium text-slate-700 dark:text-slate-200 disabled:opacity-50"
              >
                {isLoadingMore ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}
                Load more
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl w-full max-w-md p-6 shadow-xl">
            {(() => {
              const text = confirmText(confirm);
              const isDestructive = confirm.type === 'delete' || (confirm.type === 'disable' && confirm.nextDisabled);
              const busy = actionInFlight === `${confirm.type}:${confirm.uid}`;
              return (
                <>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{text.title}</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">{text.body}</p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => (busy ? null : setConfirm(null))}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg border border-gray-200 dark:border-[#30363d] text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-[#21262d] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(confirm)}
                      disabled={busy}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${
                        isDestructive
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'bg-brand-teal hover:bg-brand-teal/90'
                      }`}
                    >
                      {busy && <Loader2 size={14} className="animate-spin" />}
                      {text.button}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
