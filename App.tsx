import React, { Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { ImageDisplay } from './components/ImageDisplay';
import { RecentGenerations } from './components/RecentGenerations';
import type { GalleryPresetSource } from './components/GalleryPresetMenu';
import { ToolbarPresetSnapshot } from './utils/toolbarPresetUtils';
import { GenerationConfig, GeneratedImage, BrandColor, VisualStyle, GraphicType, AspectRatioOption, User, Generation, GenerationVersion, UserSettings, BrandGuidelinesAnalysis, ToolbarPreset, Folder, INBOX_FOLDER_ID, PromptImageStyleReference } from './types';
import { 
  BRAND_COLORS,
  VISUAL_STYLES,
  GRAPHIC_TYPES,
  ASPECT_RATIOS,
  SUPPORTED_MODELS,
  OPENROUTER_MODEL_PREFIX,
  OPENROUTER_CURATED_MODELS
} from './constants';
import {
  generateGraphic,
  generateGraphicWithStyleReference,
  refineGraphic,
  analyzeBrandGuidelines,
  describeImagePrompt,
  analyzeImageForCorrectionPrompt,
  expandPrompt
} from './services/geminiService';
import {
  generateOpenAIImage,
  refineOpenAIImage,
  analyzeImageForCorrectionPromptOpenAI,
  expandPromptOpenAI,
} from './services/openaiService';
import { resolveAuxiliaryByokProvider, getApiKeyForModelFromUser, getGeminiApiKeyForAnalysis, getOpenRouterKeyFromUser } from './services/correctionAnalysisRouter';
import { generateOpenRouterImage } from './services/openRouterService';
import { generateSvg, refineSvg } from './services/svgService';
import { getAspectRatiosForModel, getSafeAspectRatioForModel, extractAspectRatioFromText, normalizeAspectRatio } from './services/aspectRatioService';
import { authService } from './services/authService';
import { presetService } from './services/presetService';
import { folderService } from './services/folderService';
import {
  getDescendantFolderIds,
  mergeFolderInstructionsWithSystemPrompt,
} from './services/folderTreeUtils';
import {
  historyService,
  createGeneration,
  addRefinementVersion,
  getCurrentVersion,
  createVersionFromImage,
} from './services/historyService';
import { expandPromptPermutations } from './services/promptExpansionService';
import {
  runBatchGenerations,
  batchCapFor,
  BatchJob,
  BatchError,
  BatchProgress,
  DEFAULT_BATCH_CONCURRENCY,
} from './services/batchGenerationService';
import {
  formatDuration,
  getModelSecondsPerGen,
  recordModelDuration,
} from './services/timeEstimationService';
import { detectLikelyCanvasPadding } from './services/recomposeQualityService';
import { toMarkLabel } from './services/versionUtils';
import { buildProfileImageCacheKey, getCachedImageBlob } from './services/imageCache';
import { fetchProfileThumbnailDataUrl } from './services/imageService';
import { CachedImage } from './components/CachedImage';
import { WhatsNewBell } from './components/WhatsNewBell';
import { WhatsNewSpotlight } from './components/WhatsNewSpotlight';
import { useWhatsNew } from './hooks/useWhatsNew';
// import { seedCatalog } from './services/seeder'; // Removed
import { seedStructures } from './services/structureSeeder'; // Import structure seeder
import { resourceService } from './services/resourceService'; // Import resource service
import { missingKeys } from './services/firebase';
import { 
  AlertCircle, 
  Sun, 
  Moon, 
  X,
  KeyRound,
  Sparkles,
  ArrowRight,
  RefreshCw,
  LogIn,
  LogOut,
  User as UserIcon,
  Settings as SettingsIcon,
  Globe,
  Github,
  ShieldCheck,
  Minimize2,
  Maximize2
} from 'lucide-react';

const AuthModal = lazy(() =>
  import('./components/AuthModal').then((mod) => ({ default: mod.AuthModal }))
);
const BrandAnalysisModal = lazy(() =>
  import('./components/BrandAnalysisModal').then((mod) => ({ default: mod.BrandAnalysisModal }))
);
const SettingsPage = lazy(() =>
  import('./components/SettingsPage').then((mod) => ({ default: mod.SettingsPage }))
);
const CatalogPage = lazy(() =>
  import('./components/CatalogPage').then((mod) => ({ default: mod.CatalogPage }))
);
const AdminPage = lazy(() =>
  import('./components/AdminPage').then((mod) => ({ default: mod.AdminPage }))
);
const WhatsNewPage = lazy(() =>
  import('./components/WhatsNewPage').then((mod) => ({ default: mod.WhatsNewPage }))
);
const SearchModal = lazy(() =>
  import('./components/SearchModal').then((mod) => ({ default: mod.SearchModal }))
);
const BuildStudio = lazy(() =>
  import('./components/BuildStudio').then((mod) => ({ default: mod.BuildStudio }))
);

interface ToolbarSelectionCache {
  colorSchemeId?: string;
  visualStyleId?: string;
  graphicTypeId?: string;
  aspectRatio?: string;
  selectedModel?: string;
  openaiImageQuality?: 'low' | 'medium' | 'high' | 'auto';
}

type OpenAIImageQuality = 'low' | 'medium' | 'high' | 'auto';
const OPENAI_QUALITY_SET = new Set<OpenAIImageQuality>(['low', 'medium', 'high', 'auto']);

/**
 * Reference to a single mark (version) in the app's history, used as A/B
 * selection for the comparison slider. We snapshot `imageUrl` / `mimeType` at
 * pick-time so the slider keeps working even if the originating tile scrolls
 * out of view or is otherwise unmounted.
 */
export interface MarkRef {
  generationId: string;
  versionId: string;
  imageUrl: string;
  mimeType: string;
  modelId: string;
  markLabel: string;
  aspectRatio?: string;
}

interface BatchModelProgressSummary {
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
}

const LazyPageFallback: React.FC<{ label?: string }> = ({ label = 'Loading...' }) => (
  <main className="flex-1 min-h-[50vh] bg-gray-50 dark:bg-[#0d1117] flex items-center justify-center px-4">
    <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] px-4 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 shadow-sm">
      <RefreshCw size={16} className="animate-spin text-brand-teal" />
      {label}
    </div>
  </main>
);

const LazyModalFallback: React.FC = () => (
  <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white dark:bg-[#161b22] px-4 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 shadow-xl">
      <RefreshCw size={16} className="animate-spin text-brand-teal" />
      Loading...
    </div>
  </div>
);

interface ActiveGenerationCurrentJob {
  key: string;
  modelId: string;
  prompt: string;
}

type ActiveGenerationJobStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'stopped';

interface ActiveGenerationJob {
  id: string;
  prompt: string;
  modelIds: string[];
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
  startedAt: number;
  /** When `completed + failed` last increased — anchors the observed-speed
   * term of the remaining-time estimate so the countdown keeps ticking
   * between completions instead of stalling. */
  lastProgressAt?: number;
  finishedAt?: number;
  status: ActiveGenerationJobStatus;
  errors: BatchError[];
  modelProgress: Record<string, BatchModelProgressSummary>;
  currentJobs: ActiveGenerationCurrentJob[];
  latest?: Generation;
  message?: string;
}

const TOOLBAR_SELECTION_KEY_PREFIX = 'brandoit_toolbar_selection_v1';
const TOOLBAR_SELECTION_LAST_KEY = `${TOOLBAR_SELECTION_KEY_PREFIX}:last`;
const MODEL_ID_SET = new Set(SUPPORTED_MODELS.map(model => model.id));
const isKnownModelId = (id: string): boolean =>
  MODEL_ID_SET.has(id) || id.startsWith(OPENROUTER_MODEL_PREFIX);
const MODEL_NAME_BY_ID: Record<string, string> = SUPPORTED_MODELS.reduce<Record<string, string>>((acc, model) => {
  acc[model.id] = model.name;
  return acc;
}, OPENROUTER_CURATED_MODELS.reduce<Record<string, string>>((acc, model) => {
  acc[`${OPENROUTER_MODEL_PREFIX}${model.slug}`] = model.name;
  return acc;
}, {}));

const GITHUB_REPO_BASE = 'https://github.com/planetoftheweb/brandoit';
const GITHUB_CHANGELOG_URL = `${GITHUB_REPO_BASE}/blob/main/CHANGELOG.md`;
const GITHUB_RELEASES_URL = `${GITHUB_REPO_BASE}/releases`;

const getToolbarSelectionKey = (userId?: string | null) =>
  `${TOOLBAR_SELECTION_KEY_PREFIX}:${userId || 'guest'}`;

const normalizeToolbarSelection = (value: unknown): ToolbarSelectionCache | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const normalized: ToolbarSelectionCache = {};

  if (typeof source.colorSchemeId === 'string') normalized.colorSchemeId = source.colorSchemeId;
  if (typeof source.visualStyleId === 'string') normalized.visualStyleId = source.visualStyleId;
  if (typeof source.graphicTypeId === 'string') normalized.graphicTypeId = source.graphicTypeId;
  if (typeof source.aspectRatio === 'string') normalized.aspectRatio = source.aspectRatio;
  if (typeof source.selectedModel === 'string' && isKnownModelId(source.selectedModel)) {
    normalized.selectedModel = source.selectedModel;
  }
  if (
    typeof source.openaiImageQuality === 'string' &&
    OPENAI_QUALITY_SET.has(source.openaiImageQuality as OpenAIImageQuality)
  ) {
    normalized.openaiImageQuality = source.openaiImageQuality as OpenAIImageQuality;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
};

const readToolbarSelection = (userId?: string | null): ToolbarSelectionCache | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getToolbarSelectionKey(userId));
    if (!raw) return null;
    return normalizeToolbarSelection(JSON.parse(raw));
  } catch {
    return null;
  }
};

const readLastToolbarSelection = (): ToolbarSelectionCache | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOOLBAR_SELECTION_LAST_KEY);
    if (!raw) return null;
    return normalizeToolbarSelection(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeToolbarSelection = (selection: ToolbarSelectionCache, userId?: string | null) => {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify(selection);
    window.localStorage.setItem(TOOLBAR_SELECTION_LAST_KEY, payload);
    window.localStorage.setItem(getToolbarSelectionKey(userId), payload);
  } catch {
    // Ignore storage write failures.
  }
};

const isToolbarTextInputFocused = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable;
};

const ConfigurationErrorScreen: React.FC<{ keys: string[] }> = ({ keys }) => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0d1117] p-4 font-sans">
    <div className="bg-white dark:bg-[#161b22] p-8 rounded-xl shadow-2xl max-w-lg w-full border border-red-200 dark:border-red-900">
      <div className="flex items-center gap-3 text-red-600 mb-6">
        <AlertCircle size={32} />
        <h1 className="text-2xl font-bold">Configuration Error</h1>
      </div>
      <p className="text-slate-600 dark:text-slate-300 mb-4">
        The following Firebase configuration keys are missing from your environment. The app cannot start without them.
      </p>
      <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-100 dark:border-red-900/50 mb-6">
        <ul className="list-disc pl-5 space-y-1">
          {keys.map((key) => (
            <li key={key} className="text-red-700 dark:text-red-300 font-mono text-sm">
              {key}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Please check your <code>.env</code> file. Ensure keys start with <code>VITE_</code> and the file is in the project root. Restart the dev server after changes.
      </p>
    </div>
  </div>
);

const App: React.FC = () => {
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true; // Default to dark
  });
  const [settingsMode, setSettingsMode] = useState(false);
  const [catalogMode, setCatalogMode] = useState<'style' | 'color' | null>(null);
  const [adminMode, setAdminMode] = useState(false);
  // Full-page "What's new" blog view (siblings: WhatsNewBell dropdown, WhatsNewSpotlight modal).
  // Reachable from the bell footer "View all updates" link, the bell rows
  // (which open the per-entry detail), the spotlight's "Read the guide"
  // button, or `?whatsnewpage=1` deep links.
  const [whatsNewMode, setWhatsNewMode] = useState(false);
  // When non-null, the page renders the detail walkthrough for that entry
  // instead of the discovery list. Reset when the user clicks "All updates"
  // inside the page or fully exits the page.
  const [whatsNewEntryId, setWhatsNewEntryId] = useState<string | null>(null);
  
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  // Latest user state, readable at async flush time (see queuePreferencesWrite).
  const latestUserRef = useRef<User | null>(null);
  useEffect(() => {
    latestUserRef.current = user;
  }, [user]);
  // Serialized, latest-state preference persistence. Rapid successive
  // preference changes (preset apply = model + quality, quick model
  // switches) used to each fire their own read-modify-write against
  // Firestore; those pairs interleave, so a STALE write could land last and
  // become what a reload "remembers". The queue runs writes one at a time
  // and each write snapshots the freshest state when it actually runs, so
  // burst updates coalesce to the correct final value.
  const prefsWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const queuePreferencesWrite = useCallback(() => {
    prefsWriteChainRef.current = prefsWriteChainRef.current.then(async () => {
      // Let React flush the state update that triggered this write first.
      await new Promise((r) => setTimeout(r, 0));
      const u = latestUserRef.current;
      if (!u) return;
      await authService.updateUserPreferences(u.id, u.preferences).catch(console.error);
    });
  }, []);
  // Tracks whether Firebase auth has reported in at least once. Until this is
  // true, `user` is null because the session is still being restored — not
  // because the visitor is a guest. Several UI affordances (the BYOK setup
  // modal in particular) must wait for this before assuming "no user means
  // new visitor", otherwise returning users see a flash of the onboarding
  // screen on every page load.
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // Build Studio (reveal animator) target — the generation+version to animate.
  const [buildStudioTarget, setBuildStudioTarget] = useState<
    { generation: Generation; version: GenerationVersion } | null
  >(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);

  // Application State for Options (allows adding/removing)
  const [brandColors, setBrandColors] = useState<BrandColor[]>([]);
  const [visualStyles, setVisualStyles] = useState<VisualStyle[]>([]);
  const [graphicTypes, setGraphicTypes] = useState<GraphicType[]>([]);
  const [aspectRatios, setAspectRatios] = useState<AspectRatioOption[]>([]);

  // Configuration State
  const [config, setConfig] = useState<GenerationConfig>(() => {
    const cached = readLastToolbarSelection();
    return {
      prompt: '',
      colorSchemeId: cached?.colorSchemeId || '',
      visualStyleId: cached?.visualStyleId || '',
      graphicTypeId: cached?.graphicTypeId || '',
      aspectRatio: cached?.aspectRatio || ''
    };
  });
  const [promptImageStyleReference, setPromptImageStyleReference] =
    useState<PromptImageStyleReference | null>(null);
  const [guestSelectedModel, setGuestSelectedModel] = useState<string>(() => {
    const cachedSelection = readToolbarSelection() || readLastToolbarSelection();
    const cachedModel = cachedSelection?.selectedModel;
    return cachedModel && MODEL_ID_SET.has(cachedModel)
      ? cachedModel
      : 'gemini-3.1-flash-image-preview';
  });
  const [hasHydratedToolbarState, setHasHydratedToolbarState] = useState(false);

  const [currentGeneration, setCurrentGeneration] = useState<Generation | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  // Folder state. `folders` is hydrated from the user doc (or localStorage
  // for guests) on every auth change. New generations land in whichever
  // folder the gallery is currently showing (`galleryViewFolderId`).
  const [folders, setFolders] = useState<Folder[]>([]);
  /** Recents gallery folder tab; persisted (Firestore / guest localStorage). */
  const [galleryViewFolderId, setGalleryViewFolderId] = useState<string>(INBOX_FOLDER_ID);
  /** Refine / recompose jobs: depth > 0 drives in-flight spinners; work is serialized to avoid version races. */
  const [previewPipelineDepth, setPreviewPipelineDepth] = useState(0);
  const previewWorkChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const currentGenerationRef = useRef<Generation | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeGenerationJobs, setActiveGenerationJobs] = useState<ActiveGenerationJob[]>([]);
  const hasRunningGenerationJobs = activeGenerationJobs.some((job) =>
    job.status === 'running' || job.status === 'stopping'
  );

  useEffect(() => {
    currentGenerationRef.current = currentGeneration;
  }, [currentGeneration]);

  const enqueuePreviewWork = useCallback((work: () => Promise<void>) => {
    setPreviewPipelineDepth((n) => n + 1);
    const next = previewWorkChainRef.current.then(() => work());
    previewWorkChainRef.current = next.catch((err: unknown) => {
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Operation failed';
      setError(msg);
    });
    void next.finally(() => {
      setPreviewPipelineDepth((n) => Math.max(0, n - 1));
    });
    return next;
  }, []);
  // Active Generations panel can be docked to a small floating pill so it
  // doesn't cover the main preview while batches run.
  const [isGenerationsPanelCollapsed, setIsGenerationsPanelCollapsed] = useState(false);
  // Count of in-flight "Add a new Mark" re-rolls. The version rail renders
  // this many spinner placeholders after the real versions so the user can
  // see how many more Marks are coming when they batch (hold 1-9 + click +,
  // or pick a count in the rerun editor). Decremented in the work item's
  // finally so failures also clear the placeholder.
  const [pendingRerunCount, setPendingRerunCount] = useState(0);
  // Toolbar (Type/Style/Colors/Size/Model row) can be collapsed so the user
  // can focus on previews. We auto-collapse on scroll-down past the toolbar
  // and restore on scroll-up; a header button lets the user pin the choice
  // ("user override" wins until the next scroll past the threshold).
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  // Ticks once per second while background generations are running so the
  // monitor's elapsed/remaining labels stay live.
  const [batchClockTick, setBatchClockTick] = useState(0);
  const generationJobAbortControllersRef = useRef<Record<string, AbortController>>({});
  const generationJobDismissTimersRef = useRef<Record<string, number>>({});
  // Set while we are running a `window.scrollTo` (e.g. snapping to the top
  // after restoring a generation from history). The auto-collapse scroll
  // listener consults this so the synthetic scroll events fired during the
  // smooth scroll don't toggle `isToolbarCollapsed` back off — and so the
  // listener doesn't compete with the in-flight animation while the user
  // tries to take over with their wheel/trackpad.
  const isProgrammaticScrollRef = useRef(false);
  // Sentinel sits directly under the toolbar; IntersectionObserver uses it
  // instead of scroll deltas (which fight layout reflow at scrollY ≈ 0).
  const toolbarDockSentinelRef = useRef<HTMLDivElement>(null);
  // After a dock/undock height animation, ignore observer callbacks briefly.
  const toolbarCollapseIgnoreUntilRef = useRef(0);
  // Manual header toggle pins until the user scrolls away from that choice.
  const toolbarUserPinnedRef = useRef<'collapsed' | 'expanded' | null>(null);
  // False after auto-docking for a new preview; re-enabled once the user
  // scrolls down so scrolling back to the top can undock again.
  const toolbarAutoUndockEnabledRef = useRef(true);

  const setToolbarCollapsed = useCallback((collapsed: boolean) => {
    setIsToolbarCollapsed((prev) => {
      if (prev === collapsed) return prev;
      toolbarCollapseIgnoreUntilRef.current = Date.now() + 400;
      return collapsed;
    });
  }, []);

  const toggleToolbarCollapsed = useCallback(() => {
    setIsToolbarCollapsed((prev) => {
      const next = !prev;
      toolbarUserPinnedRef.current = next ? 'collapsed' : 'expanded';
      toolbarAutoUndockEnabledRef.current = true;
      toolbarCollapseIgnoreUntilRef.current = Date.now() + 400;
      return next;
    });
  }, []);

  // Discoverability hint: when the toolbar collapses there's nothing left on
  // screen explaining where it went, so flash a brief auto-fading pill telling
  // the user how to bring it back. Throttled so rapid scroll-driven collapses
  // (auto-dock) don't nag — shows at most once every 12s. (The effect that
  // drives it lives below, after `isStudioRoute` is defined.)
  const [showToolbarHint, setShowToolbarHint] = useState(false);
  const toolbarHintCooldownRef = useRef(0);
  const toolbarHintTimerRef = useRef<number | undefined>(undefined);

  // Analysis Modal State
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<BrandGuidelinesAnalysis | null>(null);

  // Delete confirmation state
  const [confirmDeleteModal, setConfirmDeleteModal] = useState<{ type: 'history' | 'current'; id?: string } | null>(null);
  const [skipFutureConfirm, setSkipFutureConfirm] = useState(false);

  const pickResourceId = <T extends { id: string }>(
    items: T[],
    preferredId?: string,
    fallbackId?: string
  ) => {
    if (preferredId && items.some(item => item.id === preferredId)) return preferredId;
    if (fallbackId && items.some(item => item.id === fallbackId)) return fallbackId;
    return items[0]?.id || '';
  };

  // Load Resources (Structures)
  const loadResources = async (activeUser?: User | null) => {
    const resources = await resourceService.getAllResources(activeUser?.id);
    setBrandColors(resources.brandColors);
    setVisualStyles(resources.visualStyles);
    setGraphicTypes(resources.graphicTypes);
    setAspectRatios(resources.aspectRatios);

    // Prefer any user-specific cache first; for signed-out visits also fall
    // back to the "last" guest cache so a returning visitor doesn't lose
    // their picks. A cross-account signed-in view should NOT leak defaults
    // from the prior account, which is why the activeUser branch stays
    // scoped to that user's key.
    const cachedSelection = activeUser
      ? (readToolbarSelection(activeUser.id) || readLastToolbarSelection())
      : (readToolbarSelection() || readLastToolbarSelection());
    const settings = activeUser?.preferences.settings;
    const selectedModelForDefaults =
      cachedSelection?.selectedModel ||
      activeUser?.preferences.selectedModel ||
      (!activeUser ? guestSelectedModel : undefined) ||
      // Default model for fresh accounts: Nano Banana 2 (Gemini 3.1 Flash).
      // Chosen because it's the fast Gemini option — users can upgrade to
      // Pro or switch to GPT from the model dropdown.
      'gemini-3.1-flash-image-preview';
    if (!activeUser && selectedModelForDefaults !== guestSelectedModel) {
      setGuestSelectedModel(selectedModelForDefaults);
    }
    const modelAspectRatios = getAspectRatiosForModel(selectedModelForDefaults, resources.aspectRatios);
    const preferredAspectRatio = cachedSelection?.aspectRatio || settings?.defaultAspectRatio;

    // Code-level fallbacks for brand-new users with no cache and no saved
    // defaults yet. Uses canonical constant IDs; if the ID isn't in the
    // user's resource list (e.g. they removed 'hand-drawn') pickResourceId
    // degrades to items[0].
    const DEFAULT_GRAPHIC_TYPE_ID = 'infographic';
    const DEFAULT_VISUAL_STYLE_ID = 'hand-drawn';
    const DEFAULT_ASPECT_RATIO = '16:9';

    setConfig(prev => ({
      ...prev,
      colorSchemeId: pickResourceId(
        resources.brandColors,
        cachedSelection?.colorSchemeId || settings?.defaultColorSchemeId,
        prev.colorSchemeId
      ),
      visualStyleId: pickResourceId(
        resources.visualStyles,
        cachedSelection?.visualStyleId || settings?.defaultVisualStyleId,
        prev.visualStyleId || DEFAULT_VISUAL_STYLE_ID
      ),
      graphicTypeId: pickResourceId(
        resources.graphicTypes,
        cachedSelection?.graphicTypeId || settings?.defaultGraphicTypeId,
        prev.graphicTypeId || DEFAULT_GRAPHIC_TYPE_ID
      ),
      aspectRatio: preferredAspectRatio
        ? getSafeAspectRatioForModel(selectedModelForDefaults, preferredAspectRatio, resources.aspectRatios)
        : getSafeAspectRatioForModel(
            selectedModelForDefaults,
            prev.aspectRatio || DEFAULT_ASPECT_RATIO || modelAspectRatios[0]?.value || '',
            resources.aspectRatios
          )
    }));
    setHasHydratedToolbarState(true);
  };

  useEffect(() => {
    // Reset selection state when account context changes so defaults can be applied per user.
    setHasHydratedToolbarState(false);
    setConfig(prev => ({
      ...prev,
      colorSchemeId: '',
      visualStyleId: '',
      graphicTypeId: '',
      aspectRatio: ''
    }));
  }, [user?.id]);

  useEffect(() => {
    // Seed structures only for admins. Prefer the Firebase Auth custom claim
    // via `user.isAdmin`; keep the `planetoftheweb` username as a bootstrap
    // fallback so the legacy admin can seed even before the claim is minted.
    const canSeed = Boolean(user && (user.isAdmin || user.username === 'planetoftheweb'));
    if (canSeed && user) {
       seedStructures(user).then(() => loadResources(user));
    } else {
       loadResources(user);
    }

    // Hydrate folder state alongside resources so the gallery has a folder
    // list ready by the time history finishes loading. `loadFolders` also
    // auto-seeds Inbox the first time it's called for a user/device.
    let cancelled = false;
    folderService.loadFolders(user || null)
      .then(({ folders: nextFolders, galleryViewFolderId: nextGallery }) => {
        if (cancelled) return;
        setFolders(nextFolders);
        setGalleryViewFolderId(nextGallery ?? INBOX_FOLDER_ID);
      })
      .catch(err => {
        console.warn('[App] Failed to hydrate folders:', err);
      });

    // Seed catalog (legacy community items) - can probably be removed or gated too
    // seedCatalog().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.username, user?.isAdmin]); // Run when account context changes

  // If the saved gallery folder no longer exists (deleted on another device),
  // fall back to Inbox and persist the correction.
  useEffect(() => {
    if (folders.length === 0) return;
    if (folders.some((f) => f.id === galleryViewFolderId)) return;
    const next = INBOX_FOLDER_ID;
    setGalleryViewFolderId(next);
    void folderService.setGalleryViewFolder(user || null, next).then(() => {
      if (user) {
        setUser(prev =>
          prev ? { ...prev, preferences: { ...prev.preferences, galleryViewFolderId: next } } : prev
        );
      }
    });
  }, [folders, galleryViewFolderId, user?.id]);

  // Effect to toggle body class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Restore user session on page load
  useEffect(() => {
    const unsubscribe = authService.onAuthStateChange(async (restoredUser) => {
      if (restoredUser) {
        // The account preference is the source of truth for the model. The
        // local toolbar cache only fills in when the account has none —
        // letting it OVERRIDE the preference (as it used to) meant any stale
        // cache from an older tab or session silently resurrected an old
        // model on reload, and the next preference write persisted it: the
        // "I picked Seedream but it generated/remembered GPT Image 2" drift.
        const cachedModel = readToolbarSelection(restoredUser.id)?.selectedModel;
        const hydratedUser =
          !restoredUser.preferences.selectedModel && cachedModel
            ? {
                ...restoredUser,
                preferences: {
                  ...restoredUser.preferences,
                  selectedModel: cachedModel
                }
              }
            : restoredUser;
        setUser(hydratedUser);
        try {
          const mergeResult = await historyService.mergeLocalToRemote(hydratedUser.id, hydratedUser.isAdmin === true);
          if (mergeResult.failed > 0) {
            setError(`Synced ${mergeResult.synced} item(s), but ${mergeResult.failed} local item(s) are still pending sync.`);
          }
        } catch (mergeErr) {
          console.error("Failed to merge pending local history on session restore:", mergeErr);
        }
        // Load history for restored user
        const updatedHistory = await historyService.getHistory(hydratedUser);
        setHistory(updatedHistory);
      } else {
        setUser(null);
        setHistory([]);
      }
      setIsAuthResolved(true);
    });

    return () => unsubscribe();
  }, []); // Run once on mount

  useEffect(() => {
    if (!user?.id || !user.photoURL || user.photoDataUrl) return;
    let cancelled = false;

    void fetchProfileThumbnailDataUrl(user.photoURL).then((thumbnailDataUrl) => {
      if (cancelled || !thumbnailDataUrl) return;
      setUser((prev) => {
        if (!prev || prev.id !== user.id || prev.photoDataUrl) return prev;
        return { ...prev, photoDataUrl: thumbnailDataUrl };
      });
      void authService.updateUserProfile(user.id, { photoDataUrl: thumbnailDataUrl }).catch((error) => {
        console.warn('[App] Failed to persist profile thumbnail fallback:', error);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.photoURL, user?.photoDataUrl]);

  // Sync preferences to Auth Service when they change AND a user is logged in.
  // We pass the full `user.preferences` (not a hand-picked subset) because
  // `authService.updateUserPreferences` fully replaces the `preferences` map
  // in Firestore. Sending a subset wipes any field we forgot to include —
  // historically this clobbered `presets` / `folders` / `activeFolderId` on
  // every page load, so a saved preset would vanish on the next refresh.
  // `sanitizePreferences` already strips icons, arrays, and the admin flag.
  useEffect(() => {
    if (user) {
      authService.updateUserPreferences(user.id, user.preferences).catch(err => {
        // Silently fail if it's just a sync issue (not a critical error)
        console.warn("Failed to sync preferences:", err);
      });
    }
  }, [
    user?.preferences.settings,
    user?.preferences.apiKeys,
    user?.preferences.selectedModel,
    user?.preferences.systemPrompt,
    user?.preferences.lastSeenWhatsNewId,
    user?.preferences.dismissedSpotlightIds,
  ]); // Only trigger on actual preference changes, not user object changes

  // What's New panel state (bell + spotlight). The hook handles guest vs
  // signed-in persistence; for signed-in users we patch the local user
  // preferences object and let the auto-sync effect above push it to
  // Firestore on the next tick.
  const whatsNew = useWhatsNew({
    user,
    // Don't surface anything (spotlight, bell badge) until Firebase has
    // reported in at least once. Otherwise signed-in users who already
    // dismissed the latest spotlight or read the newest entry see a
    // flash of the modal/badge on every reload while their preferences
    // are still being hydrated from Firestore.
    isAuthResolved,
    onPersistSignedIn: (patch) => {
      setUser((prev) =>
        prev ? { ...prev, preferences: { ...prev.preferences, ...patch } } : prev
      );
    },
  });

  // Navigate to the full-page What's New view. Used by the bell footer
  // link, the bell rows (passing a specific entry id for the detail view),
  // and the spotlight modal's "Read the guide" button. Resets the other
  // page modes so we don't stack rendering paths, dismisses the spotlight if
  // one is open, and closes the bell dropdown.
  //
  // Pass an `entryId` to land directly on the per-release detail view;
  // pass `null` (default) to land on the discovery list.
  //
  // This is also the single engagement-signal choke point for the bell's
  // unread badge: any path that lands here counts as "I've read what's
  // new," so we call `markAllAsSeen` once here instead of duplicating the
  // call at every entry point.
  const openWhatsNewPage = React.useCallback(
    (entryId: string | null = null) => {
      setWhatsNewMode(true);
      setWhatsNewEntryId(entryId);
      setSettingsMode(false);
      setAdminMode(false);
      setCatalogMode(null);
      whatsNew.closeBell();
      whatsNew.markAllAsSeen();
    },
    [whatsNew]
  );

  const handleLoginSuccess = async (loggedInUser: User) => {
    setUser(loggedInUser);
    // Resources are loaded via the useEffect([user?.id]) hook now
    
    // Ensure selected IDs in config are still valid... (Logic handled in loadResources mostly)
    
    // Merge local history if any
    try {
      const mergeResult = await historyService.mergeLocalToRemote(loggedInUser.id, loggedInUser.isAdmin === true);
      if (mergeResult.failed > 0) {
        setError(`Synced ${mergeResult.synced} item(s), but ${mergeResult.failed} local item(s) could not be synced yet. They were kept locally.`);
      }
    } catch (e) {
      console.error("Failed to merge local history:", e);
      setError("Some local history could not be synced to your account. Your local copies were kept.");
    }
    const updatedHistory = await historyService.getHistory(loggedInUser);
    setHistory(updatedHistory);
  };

  const handleLogout = () => {
    authService.logout();
    setUser(null);
    setIsUserMenuOpen(false);
    // Resources will reload defaults via useEffect([user?.id]) -> user is null
  };

  // Grouped context for easier passing
  const context = { brandColors, visualStyles, graphicTypes, aspectRatios };
  const selectedModel = user?.preferences.selectedModel || guestSelectedModel;

  // Newest generation whose settings match the preset's PINNED fields —
  // shown as a sample thumbnail in the hover preview so the user can see
  // what a preset produces before applying it. Partial presets match on
  // the fields they carry only (a style-only preset matches by style).
  const findPresetSampleUrl = useCallback(
    (preset: ToolbarPreset): string | undefined => {
      const gen = history.find((g) => {
        const c = g.config;
        if (!c) return false;
        if (preset.graphicTypeId && c.graphicTypeId !== preset.graphicTypeId) return false;
        if (preset.visualStyleId && c.visualStyleId !== preset.visualStyleId) return false;
        if (preset.colorSchemeId && c.colorSchemeId !== preset.colorSchemeId) return false;
        // Normalized compare: legacy presets store ratios like "16_9" while
        // applying coerces to "16:9" — a literal compare would never match.
        if (
          preset.aspectRatio &&
          normalizeAspectRatio(c.aspectRatio) !== normalizeAspectRatio(preset.aspectRatio)
        ) return false;
        if (preset.selectedModel && g.modelId !== preset.selectedModel) return false;
        return true;
      });
      if (!gen) return undefined;
      const v = getCurrentVersion(gen);
      if (!v) return undefined;
      return v.imageUrl || (v.imageData ? `data:${v.mimeType};base64,${v.imageData}` : undefined);
    },
    [history]
  );

  // Build a human-readable label map for a preset's snapshot. Used by the
  // hover preview in both the toolbar preset menu and the gallery preset menu
  // so the user can scan stored parameters without applying the preset first.
  const getPresetLabels = useCallback(
    (preset: ToolbarPreset) => {
      const ratio = preset.aspectRatio
        ? aspectRatios.find((r) => r.value === preset.aspectRatio)
        : undefined;
      return {
        sampleUrl: findPresetSampleUrl(preset),
        type: preset.graphicTypeId
          ? graphicTypes.find((t) => t.id === preset.graphicTypeId)?.name
          : undefined,
        style: preset.visualStyleId
          ? visualStyles.find((s) => s.id === preset.visualStyleId)?.name
          : undefined,
        colors: preset.colorSchemeId
          ? brandColors.find((c) => c.id === preset.colorSchemeId)?.name
          : undefined,
        size: ratio?.label || preset.aspectRatio,
        svgMode:
          preset.svgMode && preset.svgMode !== 'static' ? preset.svgMode : undefined,
        model: preset.selectedModel
          ? MODEL_NAME_BY_ID[preset.selectedModel] || preset.selectedModel
          : undefined,
        quality: preset.openaiImageQuality,
        instructions: preset.customInstructions,
      };
    },
    [brandColors, visualStyles, graphicTypes, aspectRatios, findPresetSampleUrl]
  );

  // Multi-model "compare" selection. When length > 1, handleGenerate fans the
  // batch out across every selected model, tagging every produced history tile
  // with a shared comparisonBatchId. Single-model generation is the default
  // and leaves this at [selectedModel].
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([selectedModel]);

  useEffect(() => {
    setSelectedModelIds((prev) => {
      if (prev.length <= 1) return [selectedModel];
      if (!prev.includes(selectedModel)) return [selectedModel, ...prev];
      return prev;
    });
  }, [selectedModel]);

  // --- Comparison (Juxtapose) state machine -------------------------------
  // Picks up to two marks from anywhere in the app (thumbnail rail, current
  // viewport, or Recent Generations tile). Once two are selected we render
  // either an inline or full-screen JuxtaposeSlider. Intentionally live-only
  // — nothing about the comparison itself is persisted.
  const [comparisonState, setComparisonState] = useState<{
    mode: 'idle' | 'picking';
    a: MarkRef | null;
    b: MarkRef | null;
  }>({ mode: 'idle', a: null, b: null });

  // `seed` lets callers pre-populate slot A when entering picker mode. This is
  // the common case coming from the main viewport: a thumbnail is already
  // committed, and the user just wants to pick a second mark to compare it
  // against. Without seeding, users had to redundantly click the already-
  // selected thumb to make it A, then click the second to make it B.
  const enterComparePickerMode = (seed?: MarkRef) => {
    setComparisonState((prev) => {
      if (prev.mode === 'picking') {
        // Already picking. Seed A if it's still empty so a late-arriving
        // default (e.g. viewport committing after mode flip) doesn't get
        // dropped, but leave user-chosen marks alone.
        if (seed && !prev.a && !prev.b) return { ...prev, a: seed };
        return prev;
      }
      return { mode: 'picking', a: seed || null, b: null };
    });
  };
  const exitComparePickerMode = () => {
    setComparisonState({ mode: 'idle', a: null, b: null });
  };
  const pickMarkForComparison = (ref: MarkRef) => {
    setComparisonState((prev) => {
      const isSameMark = (x: MarkRef | null) =>
        !!x && x.generationId === ref.generationId && x.versionId === ref.versionId;
      if (isSameMark(prev.a)) {
        return { ...prev, a: prev.b, b: null, mode: 'picking' };
      }
      if (isSameMark(prev.b)) {
        return { ...prev, b: null, mode: 'picking' };
      }
      if (!prev.a) {
        return { ...prev, a: ref, mode: 'picking' };
      }
      if (!prev.b) {
        return { mode: 'idle', a: prev.a, b: ref };
      }
      // Both already set — replace B with the new pick and re-open the slider.
      return { mode: 'idle', a: prev.a, b: ref };
    });
  };

  // Escape exits picker mode.
  useEffect(() => {
    if (comparisonState.mode !== 'picking') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitComparePickerMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [comparisonState.mode]);

  // Cmd+K (Mac) / Ctrl+K (Windows/Linux) opens the search modal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isStudioRoute =
    !adminMode && !settingsMode && !catalogMode && !whatsNewMode;

  useEffect(() => {
    if (!isStudioRoute) {
      setShowToolbarHint(false);
      return;
    }
    if (isToolbarCollapsed) {
      const now = Date.now();
      if (now - toolbarHintCooldownRef.current < 12000) return;
      toolbarHintCooldownRef.current = now;
      setShowToolbarHint(true);
      window.clearTimeout(toolbarHintTimerRef.current);
      toolbarHintTimerRef.current = window.setTimeout(
        () => setShowToolbarHint(false),
        4000
      );
    } else {
      // Toolbar is back — drop the hint immediately, don't let it linger.
      setShowToolbarHint(false);
      window.clearTimeout(toolbarHintTimerRef.current);
    }
    return () => window.clearTimeout(toolbarHintTimerRef.current);
  }, [isToolbarCollapsed, isStudioRoute]);

  // Re-enable scroll-to-top undock after the user has scrolled into the gallery.
  useEffect(() => {
    const onScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      if (window.scrollY > 64) {
        toolbarAutoUndockEnabledRef.current = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Dock when the sentinel scrolls off-screen; undock when it returns to the
  // top — avoids scroll-delta feedback loops from toolbar height animations.
  useEffect(() => {
    if (!isStudioRoute) return;
    const sentinel = toolbarDockSentinelRef.current;
    if (!sentinel) return;

    const applyFromIntersection = (isAtTop: boolean) => {
      if (Date.now() < toolbarCollapseIgnoreUntilRef.current) return;
      if (isProgrammaticScrollRef.current) return;
      if (isToolbarTextInputFocused()) return;

      const pin = toolbarUserPinnedRef.current;

      if (pin === 'expanded') {
        if (!isAtTop) {
          toolbarUserPinnedRef.current = null;
          setToolbarCollapsed(true);
        } else {
          setToolbarCollapsed(false);
        }
        return;
      }
      if (pin === 'collapsed') {
        setToolbarCollapsed(true);
        return;
      }

      if (isAtTop) {
        if (toolbarAutoUndockEnabledRef.current) {
          setToolbarCollapsed(false);
        }
      } else {
        toolbarUserPinnedRef.current = null;
        setToolbarCollapsed(true);
      }
    };

    let rafId = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const isAtTop = entry.isIntersecting;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => applyFromIntersection(isAtTop));
      },
      { root: null, threshold: 0, rootMargin: '0px' }
    );
    observer.observe(sentinel);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [isStudioRoute, setToolbarCollapsed]);

  // Reversible scroll-to-toggle at the very top. When you're already at the
  // top the sentinel observer has nothing to react to (no scroll room — the
  // focus-mode preview hugs the image, so the page often doesn't scroll at
  // all), which left the toolbar stuck: scroll-up wouldn't show it, scroll-
  // down wouldn't hide it. Catch the wheel/trackpad gesture at the top and
  // drive it directly — up shows, down hides — so it's fully reversible
  // without reaching for the ⤢ button.
  useEffect(() => {
    if (!isStudioRoute) return;
    const onWheel = (e: WheelEvent) => {
      if (window.scrollY > 8) return; // only act at the very top
      // Don't collapse the toolbar when the wheel is over the toolbar itself or
      // one of its open dropdown panels — the user is scrolling a menu, not the
      // page. Without this, scrolling a long dropdown hides the toolbar and
      // closes the menu.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-toolbar-region]')) return;
      if (isToolbarCollapsed && e.deltaY < 0) {
        toolbarUserPinnedRef.current = 'expanded';
        toolbarAutoUndockEnabledRef.current = true;
        toolbarCollapseIgnoreUntilRef.current = Date.now() + 400;
        setIsToolbarCollapsed(false);
      } else if (!isToolbarCollapsed && e.deltaY > 0) {
        toolbarUserPinnedRef.current = null;
        toolbarAutoUndockEnabledRef.current = false;
        toolbarCollapseIgnoreUntilRef.current = Date.now() + 400;
        setIsToolbarCollapsed(true);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, [isStudioRoute, isToolbarCollapsed]);

  // Auto-collapse whenever the user lands on a new large preview. Without
  // this, a freshly-selected image that fits inside the viewport never
  // triggers docking — the user would have to scroll just to get focus mode.
  // Keying on the generation id (not the object) avoids re-collapsing on
  // every refinement-version change for the same image.
  useEffect(() => {
    if (!currentGeneration?.id) return;
    if (toolbarUserPinnedRef.current === 'expanded') return;
    toolbarUserPinnedRef.current = null;
    toolbarAutoUndockEnabledRef.current = false;
    setToolbarCollapsed(true);
  }, [currentGeneration?.id, setToolbarCollapsed]);

  useEffect(() => {
    setConfig(prev => {
      const safeAspectRatio = getSafeAspectRatioForModel(selectedModel, prev.aspectRatio, aspectRatios);
      if (safeAspectRatio === prev.aspectRatio) return prev;
      return { ...prev, aspectRatio: safeAspectRatio };
    });
  }, [selectedModel, aspectRatios]);

  useEffect(() => {
    if (!hasHydratedToolbarState) return;
    writeToolbarSelection(
      {
        colorSchemeId: config.colorSchemeId,
        visualStyleId: config.visualStyleId,
        graphicTypeId: config.graphicTypeId,
        aspectRatio: config.aspectRatio,
        selectedModel,
        openaiImageQuality: user?.preferences.settings?.openaiImageQuality
      },
      user?.id
    );
  }, [
    hasHydratedToolbarState,
    config.colorSchemeId,
    config.visualStyleId,
    config.graphicTypeId,
    config.aspectRatio,
    selectedModel,
    user?.preferences.settings?.openaiImageQuality,
    user?.id
  ]);

  // First-time bootstrap of the user's persistent Firestore defaults from
  // whatever is currently in the toolbar. This only fills in defaults the
  // user has NEVER explicitly set — once a `default*` field exists in
  // settings, it's owned by the Settings page and toolbar tweaks must not
  // clobber it (otherwise picking 1:1 for a one-off generation would
  // silently overwrite the user's saved Widescreen preference).
  // The localStorage cache continues to remember the most recent toolbar
  // state for fast hydration on reload; that's separate from the explicit
  // user-set defaults synced to Firestore.
  // Always runs after hydration so the selected model still syncs to
  // Firestore when it changes (model is a live selection, not a default).
  useEffect(() => {
    if (!user || !hasHydratedToolbarState) return;
    const existingSettings = user.preferences.settings || { contributeByDefault: false };
    // Only seed defaults that don't have a saved value yet — never overwrite.
    const seededDefaults: Partial<UserSettings> = {};
    if (!existingSettings.defaultGraphicTypeId && config.graphicTypeId) {
      seededDefaults.defaultGraphicTypeId = config.graphicTypeId;
    }
    if (!existingSettings.defaultVisualStyleId && config.visualStyleId) {
      seededDefaults.defaultVisualStyleId = config.visualStyleId;
    }
    if (!existingSettings.defaultColorSchemeId && config.colorSchemeId) {
      seededDefaults.defaultColorSchemeId = config.colorSchemeId;
    }
    if (!existingSettings.defaultAspectRatio && config.aspectRatio) {
      seededDefaults.defaultAspectRatio = config.aspectRatio;
    }
    const defaultsSeeded = Object.keys(seededDefaults).length > 0;
    const modelChanged = selectedModel !== user.preferences.selectedModel;
    if (!defaultsSeeded && !modelChanged) return;

    setUser(prev =>
      prev
        ? {
            ...prev,
            preferences: {
              ...prev.preferences,
              selectedModel,
              settings: defaultsSeeded
                ? { ...existingSettings, ...seededDefaults }
                : existingSettings,
            },
          }
        : prev
    );
  }, [
    hasHydratedToolbarState,
    user?.id,
    config.colorSchemeId,
    config.visualStyleId,
    config.graphicTypeId,
    config.aspectRatio,
    selectedModel,
  ]);

  const getApiKeyForModel = (modelId: string): string | undefined =>
    getApiKeyForModelFromUser(user, modelId);

  // Extra models unlocked by an OpenRouter key: the user's enabled slugs
  // (defaults = curated top benchmark picks), minus vendors already covered
  // by a direct provider key — direct APIs always win over OpenRouter routing.
  const openRouterModels = useMemo(() => {
    if (!user || !getOpenRouterKeyFromUser(user)) return [];
    const hasGeminiKey = !!getApiKeyForModelFromUser(user, 'gemini');
    const hasOpenAIKey = !!getApiKeyForModelFromUser(user, 'openai');
    const enabledSlugs =
      user.preferences.openRouterModels ?? OPENROUTER_CURATED_MODELS.map((m) => m.slug);
    const curatedBySlug = new Map(OPENROUTER_CURATED_MODELS.map((m) => [m.slug, m]));
    return enabledSlugs
      .filter((slug) =>
        !(hasGeminiKey && slug.startsWith('google/')) &&
        !(hasOpenAIKey && slug.startsWith('openai/'))
      )
      .map((slug) => {
        const curated = curatedBySlug.get(slug);
        return {
          id: `${OPENROUTER_MODEL_PREFIX}${slug}`,
          name: curated?.name || slug.split('/').pop() || slug,
          description: curated?.goodAt || `Custom OpenRouter model (${slug})`,
          format: 'raster' as const,
          group: 'OpenRouter' as const
        };
      });
  }, [user?.preferences.apiKeys, user?.preferences.geminiApiKey, user?.preferences.openRouterModels]);

  const getActiveApiKey = (): string | undefined => getApiKeyForModel(selectedModel);

  const activeApiKey = getActiveApiKey();
  const needsSetup = !user || !activeApiKey;

  // Open the BYOK "Quick Start" modal only after Firebase auth has actually
  // resolved. Without this guard, returning users see a flash of the
  // onboarding modal on every page load while their session is still being
  // restored (user is null for one tick → needsSetup is true → modal opens
  // → auth resolves → user populates → modal closes). Waiting for
  // `isAuthResolved` means the modal only appears for genuine guests or
  // signed-in users who really have no API key configured.
  useEffect(() => {
    if (!isAuthResolved) return;
    setIsSetupModalOpen(needsSetup);
  }, [isAuthResolved, needsSetup, user?.id]);

  // If the currently selected model has no usable API key but the user has
  // configured a key for some other supported model, auto-switch to that
  // model so the user can start generating immediately instead of being
  // stuck behind the "One setup step left" banner.
  useEffect(() => {
    if (!user) return;
    if (activeApiKey) return;
    const fallbackModel = [...SUPPORTED_MODELS, ...openRouterModels].find(
      (model) => model.id !== selectedModel && !!getApiKeyForModel(model.id)
    );
    if (!fallbackModel) return;
    const updatedUser = {
      ...user,
      preferences: {
        ...user.preferences,
        selectedModel: fallbackModel.id
      }
    };
    setUser(updatedUser);
    authService.updateUserPreferences(user.id, updatedUser.preferences).catch(console.error);
  }, [user?.id, user?.preferences.apiKeys, user?.preferences.geminiApiKey, selectedModel, activeApiKey]);

  // Keep the generation monitor's elapsed/remaining display live by nudging a
  // tick once per second while at least one background generation is running.
  useEffect(() => {
    if (!hasRunningGenerationJobs) return;
    const interval = window.setInterval(() => {
      setBatchClockTick((t) => (t + 1) % 1_000_000);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [hasRunningGenerationJobs]);

  useEffect(() => {
    return () => {
      Object.values(generationJobAbortControllersRef.current).forEach((controller) => controller.abort());
      generationJobAbortControllersRef.current = {};
      Object.values(generationJobDismissTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      generationJobDismissTimersRef.current = {};
    };
  }, []);

  const executeDeleteHistory = async (generationId: string) => {
    if (user) {
      await historyService.deleteFromRemote(user.id, generationId, user.isAdmin === true);
      const updatedHistory = await historyService.getHistory(user);
      setHistory(updatedHistory);
    } else {
      historyService.deleteFromLocal(generationId);
      const updatedHistory = historyService.getFromLocal();
      setHistory(updatedHistory);
    }
  };

  const requestDeleteHistory = (historyId: string) => {
    // Tile-trash is destructive enough that we always force the confirmation
    // modal here, even when the user has previously checked "Don't ask me
    // again". The setting is still respected for the main-image trash button
    // (`requestDeleteCurrent`), where you're explicitly working with one
    // image and there's no risk of an accidental misclick on a thumbnail.
    setSkipFutureConfirm(false);
    setConfirmDeleteModal({ type: 'history', id: historyId });
  };

  const buildStructuredPrompt = (currentConfig: GenerationConfig): string => {
    const typeLabel = context.graphicTypes.find(g => g.id === currentConfig.graphicTypeId)?.name || currentConfig.graphicTypeId;
    const styleObj = context.visualStyles.find(s => s.id === currentConfig.visualStyleId);
    const styleLabel = styleObj?.name || currentConfig.visualStyleId;
    const styleDesc = styleObj?.description ? ` (${styleObj.description})` : '';
    const colorsObj = context.brandColors.find(c => c.id === currentConfig.colorSchemeId);
    const colorsLabel = colorsObj ? `${colorsObj.name}: ${colorsObj.colors.join(', ')}` : '';
    const modelAspectRatios = getAspectRatiosForModel(selectedModel, context.aspectRatios);
    const aspectLabel = modelAspectRatios.find(a => a.value === currentConfig.aspectRatio)?.label || currentConfig.aspectRatio;

    const instructions = currentConfig.customInstructions?.trim() || '';

    const expanded = [
      `Generate a ${typeLabel}`,
      aspectLabel ? `at ${aspectLabel} aspect ratio` : '',
      styleLabel ? `in the ${styleLabel}${styleDesc}` : '',
      colorsLabel ? `painted with the palette ${colorsLabel}` : '',
      `Subject/Content: ${currentConfig.prompt}`
    ].filter(Boolean).join('. ');

    return [
      `Original Prompt: ${currentConfig.prompt}`,
      `Structured Prompt: ${expanded}`,
      `Type: ${typeLabel}`,
      styleLabel ? `Style: ${styleLabel}${styleDesc}` : '',
      colorsLabel ? `Colors (paint the artwork WITH these — NEVER draw the hex codes, palette name, or color swatches as visible elements): ${colorsLabel}` : '',
      aspectLabel ? `Size: ${aspectLabel}` : '',
      instructions ? `Additional art direction: ${instructions}` : '',
      // Weaker models transcribe settings into the artwork (hex codes drawn
      // as swatch chips, style names as captions). Strong models ignore this
      // line at no cost; weak ones need it stated flatly.
      'Note: Type, Style, Colors, and Size above are generation settings, not content — never render their labels, names, hex codes, or swatches anywhere in the image.'
    ].filter(Boolean).join('\n');
  };

  const fetchImageAsBase64 = async (url: string): Promise<{ base64: string; mime: string }> => {
    const res = await fetch(url);
    const blob = await res.blob();
    const mime = blob.type || 'image/png';
    const buffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return { base64, mime };
  };

  const handleCopyCurrent = async () => {
    if (!currentGeneration) return;
    const version = getCurrentVersion(currentGeneration);
    try {
      let imageDescription = '';
      try {
        const geminiKey = getGeminiApiKeyForAnalysis(user);
        if (geminiKey) {
          const { base64, mime } = await fetchImageAsBase64(version.imageUrl);
          imageDescription = await describeImagePrompt(base64, mime, geminiKey);
        }
      } catch (err) {
        console.warn('Image describe fallback (main image):', err);
      }

      const structured = buildStructuredPrompt(currentGeneration.config);
      const finalText = imageDescription
        ? `${structured}\n\nImage-Based Prompt: ${imageDescription}`
        : structured;
      await navigator.clipboard.writeText(finalText);
    } catch (err) {
      console.error("Failed to copy prompt:", err);
      setError("Failed to copy prompt.");
    }
  };

  const executeDeleteCurrent = async () => {
    if (!currentGeneration) return;
    await executeDeleteHistory(currentGeneration.id);
    setCurrentGeneration(null);
  };

  const requestDeleteCurrent = () => {
    if (!currentGeneration) return;
    const needConfirm = user?.preferences?.settings?.confirmDeleteCurrent ?? true;
    if (needConfirm) {
      setSkipFutureConfirm(false);
      setConfirmDeleteModal({ type: 'current', id: currentGeneration.id });
    } else {
      executeDeleteCurrent().catch((err) => {
        console.error("Failed to delete current image:", err);
        setError(err.message || "Failed to delete image.");
      });
    }
  };

  const applySkipFuture = async (type: 'history' | 'current') => {
    if (!skipFutureConfirm || !user) return;
    const newSettings = {
      ...user.preferences.settings,
      confirmDeleteHistory: type === 'history' ? false : user.preferences.settings?.confirmDeleteHistory ?? true,
      confirmDeleteCurrent: type === 'current' ? false : user.preferences.settings?.confirmDeleteCurrent ?? true,
    };
    const updatedUser = {
      ...user,
      preferences: {
        ...user.preferences,
        settings: newSettings,
      }
    };
    setUser(updatedUser);
    try {
      await authService.updateUserPreferences(user.id, { ...user.preferences, settings: newSettings });
    } catch (err) {
      console.error("Failed to update preferences for confirmations:", err);
    }
  };

  const handleConfirmDeleteModal = async () => {
    if (!confirmDeleteModal) return;
    const { type, id } = confirmDeleteModal;
    try {
      if (type === 'history' && id) {
        await executeDeleteHistory(id);
        await applySkipFuture('history');
      } else if (type === 'current') {
        await executeDeleteCurrent();
        await applySkipFuture('current');
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete item.");
    } finally {
      setConfirmDeleteModal(null);
      setSkipFutureConfirm(false);
    }
  };

  const handleCancelDeleteModal = () => {
    setConfirmDeleteModal(null);
    setSkipFutureConfirm(false);
  };

  const openAuthModal = (mode: 'login' | 'signup' = 'login') => {
    setAuthModalMode(mode);
    setIsAuthModalOpen(true);
    // Close the Quick Start / Setup modal so it doesn't sit on top of
    // the auth modal (the setup modal has a higher z-index).
    setIsSetupModalOpen(false);
  };

  const updateGenerationJob = (
    jobId: string,
    updater: (job: ActiveGenerationJob) => ActiveGenerationJob
  ) => {
    setActiveGenerationJobs((prev) =>
      prev.map((job) => (job.id === jobId ? updater(job) : job))
    );
  };

  const clearGenerationJob = (jobId: string) => {
    const dismissTimer = generationJobDismissTimersRef.current[jobId];
    if (dismissTimer) {
      window.clearTimeout(dismissTimer);
      delete generationJobDismissTimersRef.current[jobId];
    }
    delete generationJobAbortControllersRef.current[jobId];
    setActiveGenerationJobs((prev) => prev.filter((job) => job.id !== jobId));
  };

  const scheduleGenerationJobDismissal = (jobId: string, delayMs = 9000) => {
    const existing = generationJobDismissTimersRef.current[jobId];
    if (existing) window.clearTimeout(existing);
    generationJobDismissTimersRef.current[jobId] = window.setTimeout(() => {
      clearGenerationJob(jobId);
    }, delayMs);
  };

  const handleStopGenerationJob = (jobId: string) => {
    const controller = generationJobAbortControllersRef.current[jobId];
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    updateGenerationJob(jobId, (job) => ({ ...job, status: 'stopping' }));
  };

  const modelSupportsStyleReferenceImage = (modelId: string): boolean =>
    modelId.startsWith('gemini') && modelId !== 'gemini-svg';

  const withPromptImageStyleInstruction = (
    prompt: string,
    reference: PromptImageStyleReference
  ): string => {
    const styleInstruction =
      reference.influenceMode === 'image'
        ? `Use this image-derived style as the primary visual style, overriding the selected Style menu if there is a conflict: ${reference.styleDescription}`
        : `Keep the selected Style menu authoritative. Use this image-derived style only as a soft secondary reference and ignore it where it conflicts: ${reference.styleDescription}`;
    return `${prompt}\n\nStyle reference note: ${styleInstruction}`;
  };

  const handleGenerate = async (count: number = 1) => {
    // Fresh generations should always leave compare mode. Keeping an old
    // A/B selection active while new tiles are being produced is confusing,
    // because the viewport appears "stuck" on a stale comparison.
    setComparisonState({ mode: 'idle', a: null, b: null });
    setError(null);
    setBatchClockTick(0);
    // Clear the main preview so the user gets immediate visual feedback that
    // a brand-new run is starting. Without this, the previous result keeps
    // showing for several seconds while the first API call resolves and the
    // user can't tell whether their click registered. The "Generating…"
    // placeholder kicks in via `hasRunningGenerationJobs` below.
    setCurrentGeneration(null);
    // Re-open the Active Generations panel for every new submit, even if the
    // user docked it during a previous run. They explicitly asked for this
    // run, so showing progress by default is the right call; they can dock
    // it again with the minimize button.
    setIsGenerationsPanelCollapsed(false);

    let jobId = '';
    try {
      if (!user) {
        openAuthModal('signup');
        throw new Error('Free accounts use your own API key (BYOK). Create an account, then add your key in Settings to start generating.');
      }
      if (!config.prompt.trim()) {
        throw new Error('Enter a prompt before generating.');
      }

      const modelIdsToRun = selectedModelIds.length > 0 ? selectedModelIds : [selectedModel];
      const apiKeysByModel = modelIdsToRun.reduce<Record<string, string>>((acc, modelId) => {
        const key = getApiKeyForModel(modelId);
        if (key) acc[modelId] = key;
        return acc;
      }, {});
      // Verify every selected model has an API key wired up before we start.
      const missingKeys = modelIdsToRun.filter((id) => !apiKeysByModel[id]);
      if (missingKeys.length > 0) {
        setSettingsMode(true);
        throw new Error(
          missingKeys.length === modelIdsToRun.length
            ? 'Add your API key in Settings before generating. Free accounts use BYOK keys.'
            : `Missing API key(s) for: ${missingKeys.join(', ')}. Add them in Settings or deselect those models.`
        );
      }

      const safeAspectRatioPrimary = getSafeAspectRatioForModel(selectedModel, config.aspectRatio, aspectRatios);
      const safeConfig = safeAspectRatioPrimary === config.aspectRatio ? config : { ...config, aspectRatio: safeAspectRatioPrimary };
      if (safeAspectRatioPrimary !== config.aspectRatio) {
        setConfig(prev => ({ ...prev, aspectRatio: safeAspectRatioPrimary }));
      }

      const expansion = expandPromptPermutations(safeConfig.prompt || '');
      const { prompts } = expansion;
      const promptEntryIndexByPromptIndex = expansion.promptEntries.flatMap((entry, entryIndex) =>
        entry.prompts.map(() => entryIndex)
      );
      const safeCount = Math.max(1, Math.floor(count || 1));
      const perModelRuns = prompts.length * safeCount;
      const totalRuns = perModelRuns * modelIdsToRun.length;
      const cap = batchCapFor(user);
      if (Number.isFinite(cap) && totalRuns > cap) {
        throw new Error(
          `Batch would run ${totalRuns} generation${totalRuns === 1 ? '' : 's'} (limit ${cap}). Reduce prompt-list entries, brace options, count, or selected models.`
        );
      }

      // Comparison batch id — only stamped when running more than one model.
      // It still acts as a "this tile is a multi-model comparison run" marker
      // for UI chrome (badge in Recent Generations), even though all marks now
      // live in a single Generation tile rather than across siblings.
      const comparisonBatchId =
        modelIdsToRun.length > 1
          ? `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          : undefined;

      // Shared per top-level prompt entry in this Generate click. Plain prompts
      // and brace-only batches still create one tile, while JSON-array entries
      // each get their own tile. Within a tile, selected models still append as
      // versions so comparisons stay side-by-side.
      // Persistence is serialised through `persistQueue` so concurrent workers
      // don't race when appending versions or saving to Firestore.
      const sharedBatchGenerations: Record<number, Generation | undefined> = {};
      const sharedPersistQueues: Record<number, Promise<Generation | null>> = {};
      const primaryModelId = modelIdsToRun[0];
      const runUser = user;
      const runContext = context;
      const runFolderId = galleryViewFolderId || INBOX_FOLDER_ID;
      const runSystemPrompt = mergeFolderInstructionsWithSystemPrompt(
        folders,
        runFolderId,
        user.preferences.systemPrompt
      );
      const runOpenAIQuality = user.preferences.settings?.openaiImageQuality || 'auto';
      // Snapshot the open gallery folder at click time so every tile from
      // this Generate run lands together, even if the user switches folders
      // while the batch is in flight.
      const startedAt = Date.now();
      jobId = `run-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const abortController = new AbortController();
      generationJobAbortControllersRef.current[jobId] = abortController;
      const initialModelProgress = modelIdsToRun.reduce<Record<string, BatchModelProgressSummary>>((acc, modelId) => {
        acc[modelId] = {
          total: perModelRuns,
          completed: 0,
          failed: 0,
          inFlight: 0,
        };
        return acc;
      }, {});

      setActiveGenerationJobs((prev) => [
        {
          id: jobId,
          prompt: safeConfig.prompt,
          modelIds: modelIdsToRun,
          total: totalRuns,
          completed: 0,
          failed: 0,
          inFlight: 0,
          startedAt,
          status: 'running',
          errors: [],
          modelProgress: initialModelProgress,
          currentJobs: [],
        },
        ...prev
      ]);

      // Aggregate progress across all per-model batches. Models run in
      // parallel (see Promise.all below), so we can't just add a running
      // total — progress events from different models arrive interleaved.
      // Instead, each model reports its own latest BatchProgress into
      // `perModelProgress` and we re-sum across all known models on every
      // event. Single-source-of-truth and concurrency-safe.
      const perModelProgress: Record<string, BatchProgress> = {};
      const aggregate = {
        errors: [] as BatchError[],
        lastGeneration: undefined as Generation | undefined,
        fatalError: undefined as BatchError | undefined,
        /** Which model hit the fatal error (surfaced in the banner copy). */
        fatalErrorModelId: undefined as string | undefined,
      };

      const summarizeAcrossModels = (latest?: Generation) => {
        const entries = Object.values(perModelProgress);
        const completed = entries.reduce((acc, p) => acc + p.completed, 0);
        const failed = entries.reduce((acc, p) => acc + p.failed, 0);
        const inFlight = entries.reduce((acc, p) => acc + p.inFlight, 0);
        const errors = entries.flatMap((p) => p.errors);
        const currentJobs = Object.entries(perModelProgress).flatMap(([modelId, progress]) =>
          (progress.currentJobs || []).map((job) => ({
            key: `${modelId}:${job.jobId}`,
            modelId,
            prompt: job.prompt,
          }))
        );
        return {
          total: totalRuns,
          completed,
          failed,
          inFlight,
          errors,
          latest: latest || aggregate.lastGeneration,
          currentJobs,
        };
      };

      const runBatchForModel = async (modelId: string) => {
        const modelKey = apiKeysByModel[modelId];
        if (!modelKey) throw new Error(`Missing API key for ${modelId}.`);
        // Per-model aspect-ratio coercion: GPT Image 2 supports wider ratios
        // than GPT Image 1.5, Gemini models support different ones, etc.
        const safeAspectRatioForModel = getSafeAspectRatioForModel(modelId, safeConfig.aspectRatio, runContext.aspectRatios);
        const modelSafeConfig = safeAspectRatioForModel === safeConfig.aspectRatio
          ? safeConfig
          : { ...safeConfig, aspectRatio: safeAspectRatioForModel };

        const runOne = async (job: BatchJob): Promise<Generation> => {
          const jobConfig: GenerationConfig = { ...modelSafeConfig, prompt: job.prompt };
          const activeStyleReference = promptImageStyleReference;
          const requestConfig: GenerationConfig =
            activeStyleReference && !modelSupportsStyleReferenceImage(modelId)
              ? {
                  ...jobConfig,
                  prompt: withPromptImageStyleInstruction(job.prompt, activeStyleReference),
                }
              : jobConfig;
          const structuredPrompt = buildStructuredPrompt(requestConfig);

          const jobStart = performance.now();
          let result;
          if (modelId === 'gemini-svg') {
            result = await generateSvg(requestConfig, runContext, modelKey, runSystemPrompt);
          } else if (modelId.startsWith(OPENROUTER_MODEL_PREFIX)) {
            result = await generateOpenRouterImage(structuredPrompt, requestConfig, modelKey, {
              modelSlug: modelId.slice(OPENROUTER_MODEL_PREFIX.length),
              systemPrompt: runSystemPrompt
            });
          } else if (modelId === 'openai' || modelId === 'openai-2' || modelId === 'openai-mini') {
            result = await generateOpenAIImage(structuredPrompt, requestConfig, modelKey, {
              modelId,
              quality: runOpenAIQuality,
              systemPrompt: runSystemPrompt
            });
          } else if (activeStyleReference && modelSupportsStyleReferenceImage(modelId)) {
            result = await generateGraphicWithStyleReference(
              activeStyleReference.image,
              job.prompt,
              jobConfig,
              runContext,
              modelKey,
              runSystemPrompt,
              modelId,
              {
                influenceMode: activeStyleReference.influenceMode,
                imageStyleDescription: activeStyleReference.styleDescription,
              }
            );
          } else {
            result = await generateGraphic(requestConfig, runContext, modelKey, runSystemPrompt, modelId);
          }
          recordModelDuration(modelId, performance.now() - jobStart);

          // Safety net: occasionally a model API returns a 200 with an empty
          // payload (no base64 / no svg) — the call doesn't throw, but the
          // resulting "image" is a 0-byte tile that renders solid black in
          // the gallery and Compare rail. Without this guard we persisted
          // those blanks as `type: 'generation'` versions, which the user
          // could not remove individually. Treat empties as a failure so
          // they're counted in `state.failed` and never make it to the
          // version list.
          const isSvgResult = result?.mimeType === 'image/svg+xml';
          const hasUsableBytes = isSvgResult
            ? Boolean(result?.svgCode && result.svgCode.trim().length > 0)
            : Boolean(result?.base64Data && result.base64Data.length > 100);
          if (!hasUsableBytes) {
            throw new Error('Model returned an empty image — skipping');
          }
          const actualModelId = result.modelId || modelId;

          // Append into the SHARED tile for this top-level prompt entry. The
          // first version in that entry creates the Generation; everything
          // afterwards in that entry becomes another version, regardless of
          // which model produced it.
          // The Generation's primary modelId stays as the first selected
          // model; per-version `modelId` tracks which model made each mark.
          const promptEntryIndex = promptEntryIndexByPromptIndex[job.promptIndex] ?? 0;
          const prev = sharedPersistQueues[promptEntryIndex] || Promise.resolve(null);
          const next: Promise<Generation> = prev.then(async () => {
            const sharedBatchGeneration = sharedBatchGenerations[promptEntryIndex];
            if (!sharedBatchGeneration) {
              // The first version is created via createGeneration so the tile's
              // top-level config/modelId is set. We use the *primary* model id
              // for the Generation so the tile's overall identity stays stable
              // even if the first job to finish was from a secondary model.
              const generation = await createGeneration(
                result,
                { ...jobConfig },
                primaryModelId === modelId ? actualModelId : primaryModelId,
                comparisonBatchId,
                runFolderId
              );
              // Tag this first version with whichever model actually produced it.
              if (generation.versions[0]) {
                generation.versions[0].modelId = actualModelId;
                generation.versions[0].aspectRatio = jobConfig.aspectRatio;
              }
              sharedBatchGenerations[promptEntryIndex] = generation;
              await historyService.saveGeneration(runUser, generation);
              return generation;
            }
            const nextNumber = sharedBatchGeneration.versions.length + 1;
            const newVersion = await createVersionFromImage(
              result,
              nextNumber,
              'generation',
              job.prompt,
              sharedBatchGeneration.versions[sharedBatchGeneration.currentVersionIndex]?.id,
              jobConfig.aspectRatio,
              actualModelId
            );
            const updated: Generation = {
              ...sharedBatchGeneration,
              versions: [...sharedBatchGeneration.versions, newVersion],
              currentVersionIndex: sharedBatchGeneration.versions.length,
            };
            sharedBatchGenerations[promptEntryIndex] = updated;
            await historyService.updateGeneration(runUser, updated);
            return updated;
          });

          sharedPersistQueues[promptEntryIndex] = next;
          return next;
        };

        const perModelResult = await runBatchGenerations({
          prompts,
          copiesPerPrompt: safeCount,
          concurrency: DEFAULT_BATCH_CONCURRENCY,
          signal: abortController.signal,
          runOne,
          onProgress: (progress) => {
            // Store THIS model's latest snapshot, then recompute the cross-
            // model summary. Because onProgress can fire concurrently from
            // different models, we always re-sum from the shared map rather
            // than accumulating deltas.
            perModelProgress[modelId] = progress;
            const summary = summarizeAcrossModels(progress.latest);
            updateGenerationJob(jobId, (job) => ({
              ...job,
              completed: summary.completed,
              failed: summary.failed,
              lastProgressAt:
                summary.completed + summary.failed > job.completed + job.failed
                  ? Date.now()
                  : job.lastProgressAt,
              inFlight: summary.inFlight,
              errors: summary.errors,
              latest: summary.latest || job.latest,
              currentJobs: summary.currentJobs,
              modelProgress: {
                ...job.modelProgress,
                [modelId]: {
                  total: perModelRuns,
                  completed: progress.completed,
                  failed: progress.failed,
                  inFlight: progress.inFlight,
                }
              }
            }));
            if (progress.latest) {
              const latest = progress.latest;
              aggregate.lastGeneration = latest;
              setCurrentGeneration(latest);
              setHistory((prev) => {
                const idx = prev.findIndex((g) => g.id === latest.id);
                if (idx >= 0) {
                  const nextHistory = [...prev];
                  nextHistory[idx] = latest;
                  return nextHistory;
                }
                return [latest, ...prev];
              });
            }
          }
        });

        aggregate.errors.push(...perModelResult.errors);
        if (perModelResult.lastGeneration) aggregate.lastGeneration = perModelResult.lastGeneration;
        if (perModelResult.fatalError && !aggregate.fatalError) {
          aggregate.fatalError = perModelResult.fatalError;
          aggregate.fatalErrorModelId = modelId;
        }
        return perModelResult;
      };

      // Run all selected models in PARALLEL. Previously this was a sequential
      // for-await loop, which meant a 2-model compare run waited for model A
      // to finish before firing the first request for model B — so a user
      // ever saw at most `DEFAULT_BATCH_CONCURRENCY` API calls in flight
      // regardless of how many models they picked. With Promise.all, each
      // model runs its own workers independently, giving N × concurrency
      // total in-flight.
      //
      // Fatal-error short-circuiting still works: the per-model batch runner
      // self-stops on billing/key/quota errors. Sibling models sharing the
      // same API key will independently hit the same error and stop; we don't
      // try to pre-cancel them because Promise.all starts them simultaneously.
      await Promise.all(modelIdsToRun.map((modelId) => runBatchForModel(modelId)));

      try {
        const updatedHistory = await historyService.getHistory(runUser);
        setHistory(updatedHistory);
      } catch (historyErr) {
        console.warn('History refresh after batch failed:', historyErr);
      }

      const finalSummary = summarizeAcrossModels();
      const totalCompleted = finalSummary.completed;
      const totalFailed = finalSummary.failed;

      const wasAborted = abortController.signal.aborted;
      let finalStatus: ActiveGenerationJobStatus = 'completed';
      let finalMessage = `Completed ${totalCompleted} of ${totalRuns}.`;
      if (wasAborted) {
        finalStatus = 'stopped';
        finalMessage = `Stopped after ${totalCompleted} of ${totalRuns}. Kept the completed generation${totalCompleted === 1 ? '' : 's'}.`;
      } else if (aggregate.fatalError) {
        // Provider refused further calls outright (billing / key / quota).
        // Prefer the friendly fatal message over the generic "N failed" wording.
        finalStatus = 'failed';
        finalMessage = `${aggregate.fatalError.message} (Completed ${totalCompleted} of ${totalRuns}.)`;
        setError(finalMessage);
      } else if (totalFailed > 0) {
        const sample = aggregate.errors[0]?.message;
        finalStatus = 'failed';
        finalMessage = `Completed ${totalCompleted} of ${totalRuns}. ${totalFailed} failed${sample ? `: ${sample}` : '.'}`;
        setError(finalMessage);
      }
      updateGenerationJob(jobId, (job) => ({
        ...job,
        completed: totalCompleted,
        failed: totalFailed,
        inFlight: 0,
        currentJobs: [],
        errors: finalSummary.errors,
        latest: finalSummary.latest || job.latest,
        status: finalStatus,
        finishedAt: Date.now(),
        message: finalMessage,
      }));
      scheduleGenerationJobDismissal(jobId, finalStatus === 'failed' ? 14000 : 9000);
    } catch (err: any) {
      const message = err.message || 'An unexpected error occurred.';
      setError(message);
      if (jobId) {
        updateGenerationJob(jobId, (job) => ({
          ...job,
          status: 'failed',
          inFlight: 0,
          currentJobs: [],
          finishedAt: Date.now(),
          message,
        }));
        scheduleGenerationJobDismissal(jobId, 14000);
      }
    } finally {
      if (jobId) {
        delete generationJobAbortControllersRef.current[jobId];
      }
    }
  };

  // Core refine: appends a refined Mark to `targetGeneration`, using
  // `baseVersion` as the source image. Shared by the refine bar (current
  // tile) and Build Studio's "Clean up for animation" (the studio's own
  // target, which may not be the current tile). Returns the updated
  // generation; throws on failure.
  const runRefineOn = async (
    targetGeneration: Generation,
    baseVersion: GenerationVersion,
    refinementText: string
  ): Promise<Generation> => {
    const currentGeneration = targetGeneration;
    {
        if (!user) {
          openAuthModal('signup');
          throw new Error('Free accounts use your own API key (BYOK). Create an account, then add your key in Settings to refine images.');
        }

        const customKey = getActiveApiKey();
        if (!customKey) {
          setSettingsMode(true);
          throw new Error('Add your API key in Settings before refining. Free accounts use BYOK keys.');
        }

        const currentVersion = baseVersion;
      const refineFolderId = currentGeneration.folderId || INBOX_FOLDER_ID;
      const refineSystemPrompt = mergeFolderInstructionsWithSystemPrompt(
        folders,
        refineFolderId,
        user.preferences.systemPrompt
      );
      const requestedAspectRatio = extractAspectRatioFromText(refinementText, selectedModel, aspectRatios);
      const currentVersionAspectRatio =
        normalizeAspectRatio(currentVersion.aspectRatio || currentGeneration.config.aspectRatio || config.aspectRatio);
      const desiredAspectRatio = requestedAspectRatio || currentVersionAspectRatio || config.aspectRatio;
      const safeAspectRatio = getSafeAspectRatioForModel(selectedModel, desiredAspectRatio, aspectRatios);
      const safeConfig = safeAspectRatio === config.aspectRatio ? config : { ...config, aspectRatio: safeAspectRatio };
      if (safeAspectRatio !== config.aspectRatio) {
        setConfig(prev => ({ ...prev, aspectRatio: safeAspectRatio }));
      }
      const currentImage: GeneratedImage = {
        imageUrl: currentVersion.imageUrl,
        base64Data: currentVersion.imageData,
        mimeType: currentVersion.mimeType,
      };

      let result;
      if (selectedModel === 'gemini-svg') {
        const svgCode = currentVersion.svgCode || '';
        result = await refineSvg(svgCode, refinementText, safeConfig, context, customKey, refineSystemPrompt);
      } else if (
        selectedModel === 'openai' ||
        selectedModel === 'openai-2' ||
        selectedModel === 'openai-mini'
      ) {
        if (!customKey) throw new Error('OpenAI API key is required for image generation.');
        result = await refineOpenAIImage(
          currentImage,
          refinementText,
          safeConfig,
          context,
          customKey,
          {
            modelId: selectedModel,
            quality: user?.preferences.settings?.openaiImageQuality || 'auto',
            systemPrompt: refineSystemPrompt,
          }
        );
      } else {
        result = await refineGraphic(
          currentImage,
          refinementText,
          safeConfig,
          context,
          customKey,
          refineSystemPrompt,
          selectedModel,
          currentVersionAspectRatio || currentGeneration.config.aspectRatio
        );
      }

      const updatedGeneration = await addRefinementVersion(
        currentGeneration,
        result,
        refinementText,
        selectedModel,
        safeAspectRatio
      );
      setCurrentGeneration(updatedGeneration);
      currentGenerationRef.current = updatedGeneration;

      await historyService.updateGeneration(user, updatedGeneration);
      const updatedHistory = await historyService.getHistory(user);
      setHistory(updatedHistory);
      return updatedGeneration;
    }
  };

  const handleRefine = (refinementText: string) => {
    void enqueuePreviewWork(async () => {
      const currentGeneration = currentGenerationRef.current;
      if (!currentGeneration) return;

      setError(null);
      try {
        await runRefineOn(currentGeneration, getCurrentVersion(currentGeneration), refinementText);
      } catch (err: any) {
        setError(err.message || 'Failed to refine image.');
      }
    });
  };

  // Build Studio "Clean up for animation": refine the STUDIO's generation +
  // version (which may not be the current tile — the old code refined the
  // current tile and silently no-oped when there wasn't one), then swap the
  // studio to the freshly created Mark. Returns true on success so the
  // studio can flash a failure message without closing.
  const handleBuildStudioCleanup = async (refinementText: string): Promise<boolean> => {
    const target = buildStudioTarget;
    if (!target) return false;
    setError(null);
    try {
      const updated = await runRefineOn(target.generation, target.version, refinementText);
      const newVersion = updated.versions[updated.versions.length - 1];
      if (!newVersion) return false;
      setBuildStudioTarget({ generation: updated, version: newVersion });
      return true;
    } catch (err: any) {
      console.warn('[BuildStudio] cleanup refine failed:', err?.message || err);
      return false;
    }
  };

  // Re-roll: produce a brand-new image for the same prompt and append it as
  // a "generation"-type Mark on the current tile. Unlike `handleRefine`, this
  // does NOT pass the previous image into the model and is NOT wrapped in the
  // "preserve composition / framing / layout" directives that make refine
  // outputs hug the source — so each new Mark is a fresh take on the prompt
  // with the model free to rethink layout, palette application, and
  // organization. Hooked up to the "+" plus button at the end of the version
  // rail; refine-bar text submissions still go through `handleRefine` because
  // those are intentional edits on top of the current image.
  const handleRerun = (rerunPrompt: string, count: number = 1) => {
    // Hold a number key (1-9) while clicking the "+" button to batch this:
    // the queue runs each unit serially so the user sees each new Mark
    // appear in order, and each unit picks up the latest tile state via
    // `currentGenerationRef.current` so multiple re-rolls stack on the
    // same tile.
    const safeCount = Math.max(1, Math.min(9, Math.floor(count || 1)));
    setPendingRerunCount((n) => n + safeCount);
    for (let i = 0; i < safeCount; i++) {
      void enqueuePreviewWork(runOneRerun);
    }

    async function runOneRerun() {
      const currentGeneration = currentGenerationRef.current;
      if (!currentGeneration) return;

      setError(null);
      try {
        if (!user) {
          openAuthModal('signup');
          throw new Error('Free accounts use your own API key (BYOK). Create an account, then add your key in Settings to add new Marks.');
        }

        const customKey = getActiveApiKey();
        if (!customKey) {
          setSettingsMode(true);
          throw new Error('Add your API key in Settings before adding a new Mark. Free accounts use BYOK keys.');
        }

        const currentVersion = getCurrentVersion(currentGeneration);
        const previousAspect =
          normalizeAspectRatio(currentVersion?.aspectRatio || currentGeneration.config.aspectRatio || config.aspectRatio);
        const safeAspectRatio = getSafeAspectRatioForModel(
          selectedModel,
          previousAspect || config.aspectRatio,
          aspectRatios
        );
        const rerunConfig: GenerationConfig = {
          ...config,
          ...currentGeneration.config,
          prompt: rerunPrompt,
          aspectRatio: safeAspectRatio,
        };
        const folderId = currentGeneration.folderId || INBOX_FOLDER_ID;
        const rerunSystemPrompt = mergeFolderInstructionsWithSystemPrompt(
          folders,
          folderId,
          user.preferences.systemPrompt
        );
        const structuredPrompt = buildStructuredPrompt(rerunConfig);
        const runQuality = user.preferences.settings?.openaiImageQuality || 'auto';

        let result: GeneratedImage;
        if (selectedModel === 'gemini-svg') {
          result = await generateSvg(rerunConfig, context, customKey, rerunSystemPrompt);
        } else if (selectedModel.startsWith(OPENROUTER_MODEL_PREFIX)) {
          result = await generateOpenRouterImage(structuredPrompt, rerunConfig, customKey, {
            modelSlug: selectedModel.slice(OPENROUTER_MODEL_PREFIX.length),
            systemPrompt: rerunSystemPrompt
          });
        } else if (
          selectedModel === 'openai' ||
          selectedModel === 'openai-2' ||
          selectedModel === 'openai-mini'
        ) {
          result = await generateOpenAIImage(structuredPrompt, rerunConfig, customKey, {
            modelId: selectedModel,
            quality: runQuality,
            systemPrompt: rerunSystemPrompt,
          });
        } else {
          result = await generateGraphic(
            rerunConfig,
            context,
            customKey,
            rerunSystemPrompt,
            selectedModel
          );
        }

        const newVersion = await createVersionFromImage(
          result,
          currentGeneration.versions.length + 1,
          'generation',
          undefined,
          undefined,
          safeAspectRatio,
          selectedModel
        );
        const updatedVersions = [...currentGeneration.versions, newVersion];
        const updatedGeneration: Generation = {
          ...currentGeneration,
          versions: updatedVersions,
          currentVersionIndex: updatedVersions.length - 1,
          config: {
            ...currentGeneration.config,
            aspectRatio: safeAspectRatio || currentGeneration.config.aspectRatio,
          },
        };
        setCurrentGeneration(updatedGeneration);
        currentGenerationRef.current = updatedGeneration;

        await historyService.updateGeneration(user, updatedGeneration);
        const updatedHistory = await historyService.getHistory(user);
        setHistory(updatedHistory);
      } catch (err: any) {
        setError(err.message || 'Failed to add a new Mark.');
      } finally {
        // Always decrement so a failure doesn't leave a stale placeholder.
        setPendingRerunCount((n) => Math.max(0, n - 1));
      }
    }
  };

  // Star (or unstar) a Mark within the current generation. At most one Mark
  // per generation is starred — calling this with the already-starred id
  // clears the star; calling with a different id moves the star. Persists to
  // the same storage as every other generation mutation so the choice
  // survives reload + cross-device sync.
  const handleToggleStarred = useCallback(
    (versionId: string) => {
      const current = currentGenerationRef.current;
      if (!current) return;
      const alreadyStarred = current.starredVersionId === versionId;
      const next: Generation = alreadyStarred
        ? (() => {
            const { starredVersionId: _drop, ...rest } = current;
            return rest as Generation;
          })()
        : { ...current, starredVersionId: versionId };
      setCurrentGeneration(next);
      currentGenerationRef.current = next;
      setHistory((prev) => prev.map((g) => (g.id === next.id ? next : g)));
      void historyService.updateGeneration(user, next).catch((err) => {
        console.warn('[App] Failed to persist starred Mark:', err);
      });
    },
    [user]
  );

  const handleAnalyzeRefinePrompt = async (): Promise<string> => {
    if (!currentGeneration) {
      throw new Error('Restore or generate an image first.');
    }

    if (!user) {
      openAuthModal('signup');
      throw new Error('Create a free account and add your API key in Settings before running analysis.');
    }

    const analysisRoute = resolveAuxiliaryByokProvider(selectedModel, getApiKeyForModel);
    if (!analysisRoute) {
      setSettingsMode(true);
      throw new Error('Add an OpenAI or Gemini API key in Settings to run image analysis.');
    }

    const currentVersion = getCurrentVersion(currentGeneration);
    const currentImage: GeneratedImage = {
      imageUrl: currentVersion.imageUrl,
      base64Data: currentVersion.imageData,
      mimeType: currentVersion.mimeType,
    };

    // Post-0.6.0 the saved version usually has `imageData=''` because raster
    // bytes live in Firebase Storage. If the network can't reach
    // firebasestorage.googleapis.com (VPN, captive portal, transient DNS),
    // a plain `fetch(imageUrl)` inside the analysis service throws "Failed
    // to fetch" and the button looks broken. The IndexedDB image cache
    // (populated at upload time) is exactly the fallback we need.
    if (!currentImage.base64Data && currentVersion.id) {
      try {
        const cachedBlob = await getCachedImageBlob(currentGeneration.id, currentVersion.id);
        if (cachedBlob) {
          const buffer = await cachedBlob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          currentImage.base64Data = btoa(binary);
          currentImage.mimeType = currentImage.mimeType || cachedBlob.type || 'image/png';
        }
      } catch (cacheErr) {
        console.warn('Image cache read failed, falling back to network fetch:', cacheErr);
      }
    }

    let plan;
    try {
      plan =
        analysisRoute.provider === 'openai'
          ? await analyzeImageForCorrectionPromptOpenAI(
              currentImage,
              currentGeneration.config,
              context,
              analysisRoute.apiKey,
              user?.preferences.systemPrompt
            )
          : await analyzeImageForCorrectionPrompt(
              currentImage,
              currentGeneration.config,
              context,
              analysisRoute.apiKey,
              user?.preferences.systemPrompt
            );
    } catch (err: unknown) {
      const raw =
        err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      if (
        /API_KEY_INVALID|API key not valid|invalid api key|invalid_api_key|Incorrect API key/i.test(raw)
      ) {
        setSettingsMode(true);
        throw new Error(
          analysisRoute.provider === 'openai'
            ? 'OpenAI rejected your API key or refused this vision request. Open Settings → API keys, fix your OpenAI key, save, then try Run analysis again.'
            : 'Google rejected your Gemini API key. Open Settings → API keys, paste a fresh key from Google AI Studio (Generative Language API enabled for that project), save, then try Run analysis again.'
        );
      }
      throw err;
    }

    const issueLines = plan.issues.length > 0
      ? plan.issues.map((issue, idx) => `${idx + 1}. ${issue.trim()}`).join('\n')
      : '1. No explicit issues listed by analysis model.';

    // Route the fix through the stronger image-editing model by default.
    handleModelChange('gemini');

    const detailedPrompt = [
      'Correction Plan',
      `Summary: ${plan.analysisSummary || 'Review image text and labels for accuracy.'}`,
      '',
      'Detected Issues',
      issueLines,
      '',
      'Apply These Fixes',
      plan.fixPrompt || 'Correct all detected spelling, factual, and label alignment issues while preserving composition and style.'
    ].join('\n');

    return detailedPrompt.trim();
  };

  const handleExpandRefinementPrompt = async (draft: string): Promise<string> => {
    if (!currentGeneration) {
      throw new Error('Restore or generate an image first.');
    }
    if (!user) {
      openAuthModal('signup');
      throw new Error('Create a free account and add your API key in Settings before expanding prompts.');
    }
    const expandRoute = resolveAuxiliaryByokProvider(selectedModel, getApiKeyForModel);
    if (!expandRoute) {
      setSettingsMode(true);
      throw new Error('Add an OpenAI or Gemini API key in Settings to expand prompts.');
    }
    const seed = draft.trim() || (currentGeneration.config.prompt || '').trim();
    if (!seed) {
      throw new Error('Type a refinement idea, or open a generation that still has its original prompt.');
    }
    let expanded: string;
    try {
      expanded =
        expandRoute.provider === 'openai'
          ? await expandPromptOpenAI(
              seed,
              currentGeneration.config,
              context,
              expandRoute.apiKey,
              user.preferences.systemPrompt
            )
          : await expandPrompt(seed, currentGeneration.config, context, expandRoute.apiKey, user.preferences.systemPrompt);
    } catch (err: unknown) {
      const raw =
        err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      if (
        /API_KEY_INVALID|API key not valid|invalid api key|invalid_api_key|Incorrect API key/i.test(raw)
      ) {
        setSettingsMode(true);
        throw new Error(
          expandRoute.provider === 'openai'
            ? 'OpenAI rejected your API key or refused expand prompt. Open Settings → API keys, fix your OpenAI key, save, then try again.'
            : 'Google rejected your Gemini API key. Open Settings → API keys, paste a fresh key from Google AI Studio, save, then try Expand prompt again.'
        );
      }
      throw err;
    }
    return expanded.trim();
  };

  const handleResizeCanvasRefine = async (targetAspectRatioInput: string): Promise<void> => {
    return enqueuePreviewWork(async () => {
      const currentGeneration = currentGenerationRef.current;
      if (!currentGeneration) {
        throw new Error('Restore or generate an image first.');
      }

      if (!user) {
        openAuthModal('signup');
        throw new Error('Create a free account and add your API key in Settings before resizing canvas.');
      }

      const targetModel =
        selectedModel === 'gemini' || selectedModel === 'gemini-3.1-flash-image-preview'
          ? selectedModel
          : 'gemini';
      const customKey = getApiKeyForModel(targetModel);
      if (!customKey) {
        setSettingsMode(true);
        throw new Error('Add a Gemini API key in Settings to run canvas resize.');
      }

      const currentVersion = getCurrentVersion(currentGeneration);
      if (currentVersion.mimeType === 'image/svg+xml') {
        throw new Error('Resize Canvas is currently optimized for raster images.');
      }

      const targetAspectRatio = getSafeAspectRatioForModel(targetModel, targetAspectRatioInput, aspectRatios);
      const sourceAspectRatio = normalizeAspectRatio(currentVersion.aspectRatio || currentGeneration.config.aspectRatio || config.aspectRatio);
      const normalizedTarget = normalizeAspectRatio(targetAspectRatio);

      if (!normalizedTarget) {
        throw new Error('Choose a valid target Size before resizing.');
      }

      if (sourceAspectRatio === normalizedTarget) {
        throw new Error(`Target size is already ${normalizedTarget}. Choose a different Size first.`);
      }

      if (selectedModel !== targetModel) {
        handleModelChange(targetModel);
      }

      setError(null);
      try {
        const currentImage: GeneratedImage = {
          imageUrl: currentVersion.imageUrl,
          base64Data: currentVersion.imageData,
          mimeType: currentVersion.mimeType,
        };

        const resizeConfig: GenerationConfig = {
          ...config,
          aspectRatio: targetAspectRatio
        };

        const colorScheme = context.brandColors.find(c => c.id === resizeConfig.colorSchemeId);
        const style = context.visualStyles.find(s => s.id === resizeConfig.visualStyleId);
        const type = context.graphicTypes.find(t => t.id === resizeConfig.graphicTypeId);
        const lockedResizePrompt = [
          `Aspect-ratio recomposition only: ${sourceAspectRatio || 'current'} -> ${normalizedTarget}.`,
          `Output must fully use the ${normalizedTarget} canvas without blank margins, color bars, or simple padded background extension.`,
          `Treat the source image as authoritative. Keep the same subject, illustration style, typography style, color palette, and overall design language (${type?.name || 'infographic'} / ${style?.name || 'current style'} / ${colorScheme ? `${colorScheme.name} (${colorScheme.colors.join(', ')})` : 'source palette'}).`,
          'Preserve existing text and labels verbatim unless there is an obvious typo; do not invent unrelated copy or random detached icons.',
          'Recompose layout for the new ratio by repositioning/expanding existing callouts and decorative structure so the result feels intentionally designed for this canvas.',
          'Keep the central figure and core information hierarchy intact, avoid major redraws, and avoid style drift or photorealism.'
        ].join(' ');

        const firstPassResult = await refineGraphic(
          currentImage,
          lockedResizePrompt,
          resizeConfig,
          context,
          customKey,
          user?.preferences.systemPrompt,
          targetModel,
          sourceAspectRatio || currentGeneration.config.aspectRatio,
          {
            forceAspectOnlyEdit: true,
            forceFillCanvas: true
          }
        );

        let result = firstPassResult;
        try {
          let looksPadded = await detectLikelyCanvasPadding(firstPassResult);
          if (looksPadded) {
            const secondPassPrompt = [
              `Second pass correction for ${normalizedTarget}: remove any empty side/top/bottom margins, border framing, or padded background from the previous output.`,
              'Rebuild layout so designed content fills almost the entire canvas while keeping the same subject, style, text, and palette.',
              'Do not produce a centered poster look; preserve the original visual identity and information hierarchy.'
            ].join(' ');

            result = await refineGraphic(
              firstPassResult,
              secondPassPrompt,
              resizeConfig,
              context,
              customKey,
              user?.preferences.systemPrompt,
              targetModel,
              normalizedTarget,
              {
                forceAspectOnlyEdit: true,
                forceFillCanvas: true
              }
            );
            looksPadded = await detectLikelyCanvasPadding(result);
          }

          if (looksPadded) {
            const conceptBrief = await describeImagePrompt(
              currentVersion.imageData,
              currentVersion.mimeType,
              customKey
            );
            const styleReferencePrompt = [
              `Rebuild this as a new composition at ${normalizedTarget}.`,
              'Use the original image as style reference only, not as a layout template.',
              'Keep the same subject matter and information intent, but redesign layout for this canvas.',
              `Concept brief: ${conceptBrief}`,
              'Prioritize clean typography, coherent callout placement, and full-canvas composition with no side padding.'
            ].join(' ');

            result = await generateGraphicWithStyleReference(
              currentImage,
              styleReferencePrompt,
              resizeConfig,
              context,
              customKey,
              user?.preferences.systemPrompt,
              targetModel
            );
          }
        } catch (qualityCheckError) {
          console.warn('Resize quality check failed; keeping first pass result.', qualityCheckError);
        }

        const updatedGeneration = await addRefinementVersion(
          currentGeneration,
          result,
          `Recompose resize to ${normalizedTarget} (same style)`,
          targetModel,
          targetAspectRatio
        );
        setCurrentGeneration(updatedGeneration);
        currentGenerationRef.current = updatedGeneration;
        setConfig(prev => ({ ...prev, aspectRatio: targetAspectRatio }));

        await historyService.updateGeneration(user, updatedGeneration);
        const updatedHistory = await historyService.getHistory(user);
        setHistory(updatedHistory);
      } catch (err: any) {
        setError(err.message || 'Failed to resize canvas.');
        throw err;
      }
    });
  };

  const handleRestoreFromHistory = async (gen: Generation) => {
    let restoredGeneration = gen;
    try {
      const hydrated = await historyService.getGeneration(user, gen.id, gen);
      if (hydrated) {
        restoredGeneration = hydrated;
      }
    } catch (err) {
      console.error("Failed to hydrate generation on restore:", err);
    }

    setConfig(restoredGeneration.config);
    setCurrentGeneration(restoredGeneration);
    setHistory(prev =>
      prev.map(item => (item.id === restoredGeneration.id ? restoredGeneration : item))
    );

    if (user && restoredGeneration.modelId) {
      // Functional + queued (see handleModelChange): the old snapshot-based
      // setUser here could clobber interim preference changes, and the
      // restored model was never persisted — so a reload forgot it.
      setUser(prev => prev ? {
        ...prev,
        preferences: { ...prev.preferences, selectedModel: restoredGeneration.modelId }
      } : prev);
      queuePreferencesWrite();
    }
    // Snap the page back up so the restored generation is centered in the
    // preview. We mark the scroll as programmatic so the toolbar auto-
    // collapse listener doesn't react to the synthetic scroll events that
    // fire during the smooth animation (which would otherwise un-dock the
    // toolbar we just docked via the `currentGeneration?.id` effect). The
    // flag also keeps the listener from fighting the user if they try to
    // take over with their wheel mid-animation. `scrollend` clears it as
    // soon as motion settles; a setTimeout is the safety net for browsers
    // that don't fire scrollend (and for the trivial case where the page
    // was already at the top so no scroll actually happens).
    isProgrammaticScrollRef.current = true;
    const clearProgrammaticScroll = () => {
      isProgrammaticScrollRef.current = false;
      window.removeEventListener('scrollend', clearProgrammaticScroll);
    };
    window.addEventListener('scrollend', clearProgrammaticScroll, { once: true });
    window.setTimeout(clearProgrammaticScroll, 900);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleVersionChange = (index: number) => {
    if (!currentGeneration) return;
    const nextVersion = currentGeneration.versions[index];
    const nextAspectRatio = normalizeAspectRatio(
      nextVersion?.aspectRatio || currentGeneration.config.aspectRatio || config.aspectRatio
    );
    const updatedGeneration = {
      ...currentGeneration,
      currentVersionIndex: index,
      config: nextAspectRatio
        ? { ...currentGeneration.config, aspectRatio: nextAspectRatio }
        : currentGeneration.config
    };
    setCurrentGeneration(updatedGeneration);
    if (nextAspectRatio && nextAspectRatio !== config.aspectRatio) {
      setConfig((prev) => ({ ...prev, aspectRatio: nextAspectRatio }));
    }
  };

  const handleDeleteRefinementVersion = async (versionId: string) => {
    if (!currentGeneration) return;

    const targetIndex = currentGeneration.versions.findIndex((version) => version.id === versionId);
    if (targetIndex < 0) return;

    // Any single version can be removed (originals and refinements alike) —
    // the only hard constraint is that the generation must keep at least one
    // version. Removing the very last one would leave a phantom tile with no
    // image, so use the gallery-tile delete instead. This matters because
    // failed/blank-output runs are stored as `type: 'generation'` versions
    // (Compare/N-variation siblings), and previously only refinement-typed
    // versions were deletable, leaving users stuck with empty Mark I / II
    // tiles in the version dropdown and Compare rail.
    const remainingVersions = currentGeneration.versions.filter((version) => version.id !== versionId);
    if (remainingVersions.length === 0) {
      throw new Error('Cannot delete the last version.');
    }

    const renumberedVersions = remainingVersions.map((version, idx) => ({
      ...version,
      number: idx + 1,
      label: toMarkLabel(idx + 1)
    }));

    const currentIndex = currentGeneration.currentVersionIndex;
    const shiftedIndex =
      currentIndex > targetIndex
        ? currentIndex - 1
        : currentIndex === targetIndex
          ? targetIndex - 1
          : currentIndex;
    const nextCurrentVersionIndex = Math.min(
      Math.max(0, shiftedIndex),
      renumberedVersions.length - 1
    );

    const activeVersionAfterDelete = renumberedVersions[nextCurrentVersionIndex];
    const nextAspectRatio = normalizeAspectRatio(
      activeVersionAfterDelete?.aspectRatio || currentGeneration.config.aspectRatio || config.aspectRatio
    );

    const updatedGeneration: Generation = {
      ...currentGeneration,
      config: nextAspectRatio
        ? { ...currentGeneration.config, aspectRatio: nextAspectRatio }
        : currentGeneration.config,
      versions: renumberedVersions,
      currentVersionIndex: nextCurrentVersionIndex
    };

    setCurrentGeneration(updatedGeneration);
    if (nextAspectRatio && nextAspectRatio !== config.aspectRatio) {
      setConfig((prev) => ({ ...prev, aspectRatio: nextAspectRatio }));
    }
    setHistory((prev) =>
      prev.map((item) => (item.id === updatedGeneration.id ? updatedGeneration : item))
    );

    try {
      await historyService.updateGeneration(user, updatedGeneration);
      const updatedHistory = await historyService.getHistory(user);
      setHistory(updatedHistory);
    } catch (err: any) {
      setError(err.message || 'Failed to delete refinement.');
      throw err;
    }
  };

  const handleUploadGuidelines = async (file: File) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      if (!user) {
        openAuthModal('signup');
        throw new Error('Create a free account and add your API key in Settings before analyzing brand guidelines.');
      }

      const customKey = getGeminiApiKeyForAnalysis(user);
      if (!customKey) {
        setSettingsMode(true);
        throw new Error('Add a Gemini API key in Settings before analyzing brand guidelines.');
      }

      const result = await analyzeBrandGuidelines(file, customKey, user?.preferences.systemPrompt);
      setAnalysisResult(result);
      setIsAnalysisModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'Failed to analyze brand guidelines.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmAnalysis = async (selected: BrandGuidelinesAnalysis, scope: 'public' | 'private') => {
    // 1. Prepare items with temporary IDs for immediate UI update
    const tempColors: BrandColor[] = selected.brandColors.map((c, i) => ({
        ...c,
        id: `analyzed-color-${Date.now()}-${i}`,
        authorId: user?.id || 'temp',
        authorName: user?.name || 'You',
        scope: scope,
        votes: 0,
        voters: [],
        createdAt: Date.now()
    })) as BrandColor[];

    const tempStyles: VisualStyle[] = selected.visualStyles.map((s, i) => ({
        ...s,
        id: `analyzed-style-${Date.now()}-${i}`,
        authorId: user?.id || 'temp',
        authorName: user?.name || 'You',
        scope: scope,
        votes: 0,
        voters: [],
        createdAt: Date.now()
    })) as VisualStyle[];

    const tempTypes: GraphicType[] = selected.graphicTypes.map((t, i) => ({
        ...t,
        id: `analyzed-type-${Date.now()}-${i}`,
        authorId: user?.id || 'temp',
        authorName: user?.name || 'You',
        scope: scope,
        votes: 0,
        voters: [],
        createdAt: Date.now()
    })) as GraphicType[];

    // 2. Update local state
    if (tempColors.length) setBrandColors(prev => [...tempColors, ...prev]);
    if (tempStyles.length) setVisualStyles(prev => [...tempStyles, ...prev]);
    if (tempTypes.length) setGraphicTypes(prev => [...tempTypes, ...prev]);

    // 3. Set config to use the first new items
    setConfig(prev => ({
        ...prev,
        colorSchemeId: tempColors.length ? tempColors[0].id : prev.colorSchemeId,
        visualStyleId: tempStyles.length ? tempStyles[0].id : prev.visualStyleId,
        graphicTypeId: tempTypes.length ? tempTypes[0].id : prev.graphicTypeId
    }));

    // 4. Persist to Firestore if user is logged in
    if (user) {
        try {
            for (const item of selected.brandColors) {
                await resourceService.addCustomItem('brand_colors', { name: item.name, colors: item.colors }, user.id, scope);
            }
            for (const item of selected.visualStyles) {
                await resourceService.addCustomItem('visual_styles', { name: item.name, description: item.description }, user.id, scope);
            }
            for (const item of selected.graphicTypes) {
                await resourceService.addCustomItem('graphic_types', { name: item.name }, user.id, scope);
            }
        } catch (e) {
            console.error("Error saving analyzed items to Firestore", e);
            setError("Items added locally, but failed to save to account.");
        }
    }
  };

  const handleSaveSettings = async (
    newSettings: UserSettings,
    profileData?: { name: string; username: string; photoURL?: string; photoDataUrl?: string },
    geminiApiKey?: string,
    systemPrompt?: string,
    preferredModel?: string,
    apiKeys?: { [modelId: string]: string },
    openRouterModelSlugs?: string[]
  ) => {
    if (!user) return;
    const nextSelectedModel = preferredModel || user.preferences.selectedModel || 'gemini-3.1-flash-image-preview';

    // Use the apiKeys from SettingsPage as-is (it reflects the user's latest
    // edits, including deletions). Falling back to `user.preferences.apiKeys`
    // here would re-introduce the bug where cleared keys came back after Save.
    const nextApiKeys = apiKeys !== undefined ? apiKeys : (user.preferences.apiKeys || {});

    // Update local state for immediate feedback
    const updatedUser = {
        ...user,
        name: profileData?.name || user.name,
        username: profileData?.username || user.username,
        photoURL: profileData?.photoURL || user.photoURL,
        photoDataUrl: profileData?.photoDataUrl || user.photoDataUrl,
        preferences: {
            ...user.preferences,
            settings: newSettings,
            // Keep legacy geminiApiKey for backward compatibility if provided.
            // Using `!== undefined` preserves the empty string so the key can be cleared.
            geminiApiKey: geminiApiKey !== undefined ? geminiApiKey : user.preferences.geminiApiKey,
            systemPrompt: systemPrompt !== undefined ? systemPrompt : user.preferences.systemPrompt,
            selectedModel: nextSelectedModel,
            apiKeys: nextApiKeys,
            openRouterModels:
              openRouterModelSlugs !== undefined ? openRouterModelSlugs : user.preferences.openRouterModels
        }
    };
    setUser(updatedUser);

    // Apply defaults immediately if changed
    if (newSettings.defaultColorSchemeId && newSettings.defaultColorSchemeId !== config.colorSchemeId) {
        setConfig(prev => ({ ...prev, colorSchemeId: newSettings.defaultColorSchemeId! }));
    }
    if (newSettings.defaultVisualStyleId && newSettings.defaultVisualStyleId !== config.visualStyleId) {
        setConfig(prev => ({ ...prev, visualStyleId: newSettings.defaultVisualStyleId! }));
    }
    if (newSettings.defaultGraphicTypeId && newSettings.defaultGraphicTypeId !== config.graphicTypeId) {
        setConfig(prev => ({ ...prev, graphicTypeId: newSettings.defaultGraphicTypeId! }));
    }
    if (newSettings.defaultAspectRatio && newSettings.defaultAspectRatio !== config.aspectRatio) {
        const safeDefaultAspect = getSafeAspectRatioForModel(nextSelectedModel, newSettings.defaultAspectRatio, aspectRatios);
        setConfig(prev => ({ ...prev, aspectRatio: safeDefaultAspect }));
    }

    // Save to Firestore
    try {
        await Promise.all([
            authService.updateUserPreferences(user.id, updatedUser.preferences),
            profileData ? authService.updateUserProfile(user.id, profileData) : Promise.resolve()
        ]);
    } catch (e: any) {
        console.error("Failed to save settings", e);
        setError(e.message || "Failed to save changes.");
    }
  };

  const handleImportFromCatalog = (item: any) => {
    if (item.type === 'style') {
      const newStyle = item.data as VisualStyle;
      if (!visualStyles.find(s => s.id === newStyle.id)) {
        setVisualStyles(prev => [...prev, newStyle]);
      }
      setConfig(prev => ({ ...prev, visualStyleId: newStyle.id }));
    } else if (item.type === 'color') {
      const newColor = item.data as BrandColor;
      if (!brandColors.find(c => c.id === newColor.id)) {
        setBrandColors(prev => [...prev, newColor]);
      }
      setConfig(prev => ({ ...prev, colorSchemeId: newColor.id }));
    } else if (item.type === 'type') {
      const newType = item.data as GraphicType;
      if (!graphicTypes.find(t => t.id === newType.id)) {
        setGraphicTypes(prev => [...prev, newType]);
      }
      setConfig(prev => ({ ...prev, graphicTypeId: newType.id }));
    }
    setCatalogMode(null);
  };

  const handleResetToPreferenceDefaults = () => {
    const defaultModel = user?.preferences.selectedModel || guestSelectedModel;
    const settings = user?.preferences.settings;
    const modelRatios = getAspectRatiosForModel(defaultModel, aspectRatios);

    if (user && defaultModel !== selectedModel) {
      setUser(prev =>
        prev
          ? {
              ...prev,
              preferences: {
                ...prev.preferences,
                selectedModel: defaultModel
              }
            }
          : prev
      );
    }

    setConfig(prev => ({
      ...prev,
      colorSchemeId: pickResourceId(brandColors, settings?.defaultColorSchemeId),
      visualStyleId: pickResourceId(visualStyles, settings?.defaultVisualStyleId),
      graphicTypeId: pickResourceId(graphicTypes, settings?.defaultGraphicTypeId),
      aspectRatio: settings?.defaultAspectRatio
        ? getSafeAspectRatioForModel(defaultModel, settings.defaultAspectRatio, aspectRatios)
        : getSafeAspectRatioForModel(defaultModel, modelRatios[0]?.value || '', aspectRatios)
    }));
  };

  const handleModelChange = (modelId: string) => {
    if (!user) {
      setGuestSelectedModel(modelId);
      return;
    }
    // Functional update + queued persist: building the next user from a
    // captured `user` let two same-tick preference changes (e.g. a preset
    // applying model AND quality) clobber each other — the second setUser
    // rebuilt from the stale closure and silently reverted the first, and
    // their interleaved Firestore writes could land out of order, so the
    // reverted value was what got "remembered" after a reload.
    setUser(prev => prev ? { ...prev, preferences: { ...prev.preferences, selectedModel: modelId } } : prev);
    queuePreferencesWrite();
  };

  const handleOpenAIQualityChange = (quality: 'low' | 'medium' | 'high' | 'auto') => {
    if (!user) return;
    // Functional update + queued persist — see handleModelChange for why.
    setUser(prev => prev ? {
      ...prev,
      preferences: {
        ...prev.preferences,
        settings: {
          ...(prev.preferences.settings || { contributeByDefault: false }),
          openaiImageQuality: quality
        }
      }
    } : prev);
    queuePreferencesWrite();
  };

  // ----- Toolbar preset handlers -----
  // A preset captures a snapshot of the most-tweaked toolbar fields so users
  // can recall a frequently-used combination in one click. Persisted on the
  // user document under preferences.presets via presetService.
  const handleSavePreset = async (name: string, customInstructions?: string) => {
    if (!user) throw new Error('Sign in to save presets.');
    const instructions = (customInstructions ?? config.customInstructions)?.trim();
    const snapshot: Omit<ToolbarPreset, 'id' | 'name' | 'createdAt'> = {
      graphicTypeId: config.graphicTypeId || undefined,
      visualStyleId: config.visualStyleId || undefined,
      colorSchemeId: config.colorSchemeId || undefined,
      aspectRatio: config.aspectRatio || undefined,
      svgMode: config.svgMode,
      selectedModel,
      openaiImageQuality: user.preferences.settings?.openaiImageQuality,
      customInstructions: instructions || undefined
    };
    const { presets } = await presetService.savePreset(user, name, snapshot);
    setUser(prev => prev ? { ...prev, preferences: { ...prev.preferences, presets } } : prev);
    // The instructions the user just typed become the active art direction —
    // saving a preset shouldn't require re-applying it to take effect.
    if (instructions !== (config.customInstructions?.trim() || undefined)) {
      setConfig(prev => ({ ...prev, customInstructions: instructions || undefined }));
    }
  };

  const handleApplyPreset = (preset: ToolbarPreset) => {
    // Apply only the fields the preset actually carries — leave the rest
    // untouched so partial presets compose with the user's current setup.
    setConfig(prev => {
      const next = { ...prev };
      if (preset.graphicTypeId) next.graphicTypeId = preset.graphicTypeId;
      if (preset.visualStyleId) next.visualStyleId = preset.visualStyleId;
      if (preset.colorSchemeId) next.colorSchemeId = preset.colorSchemeId;
      if (preset.aspectRatio) {
        // Aspect ratios are model-locked, so coerce to whatever's safe for
        // the model that will end up active after applying the preset.
        const targetModel = preset.selectedModel || selectedModel;
        next.aspectRatio = getSafeAspectRatioForModel(targetModel, preset.aspectRatio, aspectRatios);
      }
      if (preset.svgMode) next.svgMode = preset.svgMode;
      if (preset.customInstructions?.trim()) {
        // Free-text art direction rides along with the preset. Visible (and
        // clearable) in the Presets menu so it never steers silently.
        next.customInstructions = preset.customInstructions.trim();
      }
      return next;
    });

    if (preset.selectedModel && preset.selectedModel !== selectedModel) {
      handleModelChange(preset.selectedModel);
      // Multi-model compare picks should follow the active selection so the
      // next Generate click runs against the preset's chosen model only.
      setSelectedModelIds([preset.selectedModel]);
    }

    if (preset.openaiImageQuality && user) {
      handleOpenAIQualityChange(preset.openaiImageQuality);
    }
  };

  // Edit a preset's art direction in place (⋯ menu). If the preset's old
  // instructions are the currently ACTIVE ones, swap the active copy too so
  // the next generation uses the edit without re-applying the preset.
  const handleEditPresetInstructions = async (presetId: string, instructions: string) => {
    if (!user) throw new Error('Sign in to edit presets.');
    const prev = user.preferences.presets?.find(p => p.id === presetId)?.customInstructions?.trim();
    const value = instructions.trim() || undefined;
    const presets = await presetService.updatePreset(user, presetId, { customInstructions: value });
    setUser(u => u ? { ...u, preferences: { ...u.preferences, presets } } : u);
    if (prev && config.customInstructions?.trim() === prev) {
      setConfig(c => ({ ...c, customInstructions: value }));
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!user) return;
    const presets = await presetService.deletePreset(user, presetId);
    setUser(prev => prev ? { ...prev, preferences: { ...prev.preferences, presets } } : prev);
  };

  // Overwrite an existing preset with the current toolbar snapshot. Mirrors
  // the same field set as `handleSavePreset` so updating produces an
  // equivalent shape — keeping name + createdAt intact via presetService so
  // the row identity (and sort order) survives the rewrite.
  const handleUpdatePreset = async (presetId: string) => {
    if (!user) throw new Error('Sign in to update presets.');
    const snapshot: Omit<ToolbarPreset, 'id' | 'name' | 'createdAt'> = {
      graphicTypeId: config.graphicTypeId || undefined,
      visualStyleId: config.visualStyleId || undefined,
      colorSchemeId: config.colorSchemeId || undefined,
      aspectRatio: config.aspectRatio || undefined,
      svgMode: config.svgMode,
      selectedModel,
      openaiImageQuality: user.preferences.settings?.openaiImageQuality,
      customInstructions: config.customInstructions?.trim() || undefined
    };
    const presets = await presetService.updatePreset(user, presetId, snapshot);
    setUser(prev => prev ? { ...prev, preferences: { ...prev.preferences, presets } } : prev);
  };

  const buildToolbarPresetSnapshot = useCallback((): ToolbarPresetSnapshot => ({
    customInstructions: config.customInstructions?.trim() || undefined,
    graphicTypeId: config.graphicTypeId || undefined,
    visualStyleId: config.visualStyleId || undefined,
    colorSchemeId: config.colorSchemeId || undefined,
    aspectRatio: config.aspectRatio || undefined,
    svgMode: config.svgMode,
    selectedModel,
    openaiImageQuality: user?.preferences.settings?.openaiImageQuality,
  }), [
    config.customInstructions,
    config.graphicTypeId,
    config.visualStyleId,
    config.colorSchemeId,
    config.aspectRatio,
    config.svgMode,
    selectedModel,
    user?.preferences.settings?.openaiImageQuality,
  ]);

  const galleryViewFolder = useMemo(
    () => folders.find((f) => f.id === galleryViewFolderId),
    [folders, galleryViewFolderId]
  );

  const galleryPresetSource: GalleryPresetSource = galleryViewFolder?.useFolderPresets
    ? 'folder'
    : 'global';

  const galleryPresets = useMemo(
    () =>
      galleryPresetSource === 'folder'
        ? galleryViewFolder?.presets ?? []
        : user?.preferences.presets ?? [],
    [galleryPresetSource, galleryViewFolder?.presets, user?.preferences.presets]
  );

  const syncFoldersToUser = useCallback(
    (nextFolders: Folder[]) => {
      setFolders(nextFolders);
      if (user) {
        setUser((prev) =>
          prev ? { ...prev, preferences: { ...prev.preferences, folders: nextFolders } } : prev
        );
      }
    },
    [user]
  );

  const handleGalleryPresetSourceChange = async (source: GalleryPresetSource) => {
    const nextFolders = await folderService.setFolderUseFolderPresets(
      user || null,
      folders,
      galleryViewFolderId,
      source === 'folder'
    );
    syncFoldersToUser(nextFolders);
  };

  const handleGallerySavePreset = async (name: string) => {
    const snapshot = buildToolbarPresetSnapshot();
    if (galleryPresetSource === 'folder') {
      const { folders: nextFolders } = await folderService.saveFolderPreset(
        user || null,
        folders,
        galleryViewFolderId,
        name,
        snapshot
      );
      syncFoldersToUser(nextFolders);
      return;
    }
    await handleSavePreset(name);
  };

  const handleGalleryUpdatePreset = async (presetId: string) => {
    const snapshot = buildToolbarPresetSnapshot();
    if (galleryPresetSource === 'folder') {
      const nextFolders = await folderService.updateFolderPreset(
        user || null,
        folders,
        galleryViewFolderId,
        presetId,
        snapshot
      );
      syncFoldersToUser(nextFolders);
      return;
    }
    await handleUpdatePreset(presetId);
  };

  const handleRenamePreset = async (presetId: string, name: string) => {
    if (!user) throw new Error('Sign in to rename presets.');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Preset name is required.');
    const presets = await presetService.updatePreset(user, presetId, { name: trimmed });
    setUser((prev) =>
      prev ? { ...prev, preferences: { ...prev.preferences, presets } } : prev
    );
  };

  const handleGalleryRenamePreset = async (presetId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Preset name is required.');
    if (galleryPresetSource === 'folder') {
      const nextFolders = await folderService.updateFolderPreset(
        user || null,
        folders,
        galleryViewFolderId,
        presetId,
        { name: trimmed }
      );
      syncFoldersToUser(nextFolders);
      return;
    }
    await handleRenamePreset(presetId, trimmed);
  };

  const handleGalleryEditPresetInstructions = async (presetId: string, instructions: string) => {
    if (galleryPresetSource === 'folder') {
      const nextFolders = await folderService.updateFolderPreset(
        user || null,
        folders,
        galleryViewFolderId,
        presetId,
        { customInstructions: instructions.trim() || undefined }
      );
      syncFoldersToUser(nextFolders);
      return;
    }
    await handleEditPresetInstructions(presetId, instructions);
  };

  const handleGalleryDeletePreset = async (presetId: string) => {
    if (galleryPresetSource === 'folder') {
      const nextFolders = await folderService.deleteFolderPreset(
        user || null,
        folders,
        galleryViewFolderId,
        presetId
      );
      syncFoldersToUser(nextFolders);
      return;
    }
    await handleDeletePreset(presetId);
  };

  // ----- Folder handlers -----
  // Folders group generation tiles for the gallery. Persistence routes
  // through `folderService` (Firestore for users, localStorage for guests).
  // Local state is updated optimistically alongside every async write so
  // the gallery reflects changes without waiting on a round-trip.
  const handleCreateFolder = async (name: string, parentId?: string): Promise<Folder> => {
    const result = await folderService.createFolder(user || null, name, folders, parentId);
    setFolders(result.folders);
    setGalleryViewFolderId(result.folder.id);
    if (user) {
      setUser((prev) =>
        prev
          ? {
              ...prev,
              preferences: {
                ...prev.preferences,
                folders: result.folders,
                galleryViewFolderId: result.folder.id,
              },
            }
          : prev
      );
    }
    return result.folder;
  };

  const handleRenameFolder = async (folderId: string, nextName: string) => {
    const nextFolders = await folderService.renameFolder(
      user || null,
      folders,
      folderId,
      nextName
    );
    setFolders(nextFolders);
    if (user) {
      setUser((prev) =>
        prev ? { ...prev, preferences: { ...prev.preferences, folders: nextFolders } } : prev
      );
    }
  };

  const handleMoveFolder = async (folderId: string, parentId: string | null) => {
    const nextFolders = await folderService.moveFolder(
      user || null,
      folders,
      folderId,
      parentId
    );
    setFolders(nextFolders);
    if (user) {
      setUser((prev) =>
        prev ? { ...prev, preferences: { ...prev.preferences, folders: nextFolders } } : prev
      );
    }
  };

  const handleReorderFolder = async (
    folderId: string,
    referenceFolderId: string,
    position: 'before' | 'after'
  ) => {
    const nextFolders = await folderService.reorderFolder(
      user || null,
      folders,
      folderId,
      referenceFolderId,
      position
    );
    setFolders(nextFolders);
    if (user) {
      setUser((prev) =>
        prev ? { ...prev, preferences: { ...prev.preferences, folders: nextFolders } } : prev
      );
    }
  };

  const handleSetFolderInstructions = async (folderId: string, customInstructions: string) => {
    const nextFolders = await folderService.setFolderInstructions(
      user || null,
      folders,
      folderId,
      customInstructions
    );
    setFolders(nextFolders);
    if (user) {
      setUser((prev) =>
        prev ? { ...prev, preferences: { ...prev.preferences, folders: nextFolders } } : prev
      );
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    // Sweep tiles into Inbox first so deletion never strands a tile in a
    // missing folder. The bulk move uses the same updateGeneration path
    // that refinements rely on, so writes are durable.
    const removedIds = getDescendantFolderIds(folders, folderId);
    removedIds.add(folderId);
    const orphanIds = history
      .filter((g) => removedIds.has(g.folderId || INBOX_FOLDER_ID))
      .map((g) => g.id);
    if (orphanIds.length > 0) {
      const moved = await historyService.moveGenerationsToFolder(
        user || null,
        history,
        orphanIds,
        INBOX_FOLDER_ID
      );
      if (moved.length > 0) {
        const movedById = new Map(moved.map(g => [g.id, g]));
        setHistory(prev => prev.map(g => movedById.get(g.id) || g));
      }
    }

    const result = await folderService.deleteFolder(
      user || null,
      folders,
      folderId
    );
    setFolders(result.folders);
    if (user) {
      setUser((prev) =>
        prev
          ? {
              ...prev,
              preferences: {
                ...prev.preferences,
                folders: result.folders,
              },
            }
          : prev
      );
    }
  };

  const handleGalleryViewFolderChange = async (folderId: string) => {
    setGalleryViewFolderId(folderId);
    try {
      await folderService.setGalleryViewFolder(user || null, folderId);
      if (user) {
        setUser(prev =>
          prev ? { ...prev, preferences: { ...prev.preferences, galleryViewFolderId: folderId } } : prev
        );
      }
    } catch (err) {
      console.warn('[App] Failed to persist gallery view folder:', err);
    }
  };

  const handleMoveGenerationsToFolder = async (generationIds: string[], folderId: string) => {
    const moved = await historyService.moveGenerationsToFolder(
      user || null,
      history,
      generationIds,
      folderId
    );
    if (moved.length === 0) return;
    const movedById = new Map(moved.map(g => [g.id, g]));
    setHistory(prev => prev.map(g => movedById.get(g.id) || g));
  };

  const generationModelIdsToRun = selectedModelIds.length > 0 ? selectedModelIds : [selectedModel];
  const missingGenerationApiKeyIds = user
    ? generationModelIdsToRun.filter((modelId) => !getApiKeyForModel(modelId))
    : generationModelIdsToRun;
  const isGenerateSetupRequired = !user || missingGenerationApiKeyIds.length > 0;
  const firstMissingModelId = missingGenerationApiKeyIds[0] || selectedModel;
  const generateSetupActionLabel = !user ? 'Create account' : 'Add API key';
  const generateSetupActionDescription = !user
    ? 'Create a free account before generating'
    : missingGenerationApiKeyIds.length > 1
      ? `Add API keys for ${missingGenerationApiKeyIds.map((id) => MODEL_NAME_BY_ID[id] || id).join(', ')}`
      : `Add an API key for ${MODEL_NAME_BY_ID[firstMissingModelId] || firstMissingModelId}`;

  const handleGenerateSetupAction = () => {
    setError(null);
    setIsSetupModalOpen(false);
    if (!user) {
      openAuthModal('signup');
      return;
    }
    setSettingsMode(true);
    setCatalogMode(null);
    setAdminMode(false);
  };

  if (missingKeys.length > 0) {
    return <ConfigurationErrorScreen keys={missingKeys} />;
  }

  // Suspended-account hard block. A signed-in user with `isDisabled === true`
  // is stopped here before any studio, history, catalog, settings, or admin UI
  // can render. Only a sign-out action is exposed.
  if (user?.isDisabled === true) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0d1117] px-6">
        <div className="w-full max-w-md bg-white dark:bg-[#161b22] border border-red-200 dark:border-red-900/50 rounded-xl p-8 text-center shadow-lg">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertCircle size={28} className="text-red-600 dark:text-red-300" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Account suspended
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {user.email || 'This account'} has been suspended by an administrator.
            If you think this is a mistake, contact support.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-screen font-sans transition-colors duration-200">

      {/* What's New spotlight — auto-fires for the newest featured entry the
          current user hasn't dismissed. Lives outside the scrollable layout
          so its fixed overlay covers the entire viewport including header. */}
      {whatsNew.isSpotlightPending && whatsNew.spotlightEntry && (
        <WhatsNewSpotlight
          entry={whatsNew.spotlightEntry}
          onDismiss={whatsNew.dismissSpotlight}
          onReadGuide={() => {
            const id = whatsNew.spotlightEntry!.id;
            whatsNew.dismissSpotlight(id);
            openWhatsNewPage(id);
          }}
        />
      )}

      {/* 1. Dedicated Header Row */}
      <header className="w-full flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => {
              setCatalogMode(null);
              setSettingsMode(false);
              setAdminMode(false);
              setWhatsNewMode(false);
              setWhatsNewEntryId(null);
            }}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity focus:outline-none"
          >
            <img 
              src="/brandoit.png" 
              alt="BranDoIt Logo" 
              className="w-12 h-12 rounded-full shadow-lg shadow-brand-red/20 object-cover" 
            />
            <h1 className="font-bold text-xl tracking-tight text-slate-900 dark:text-white">BranDoIt</h1>
          </button>
        </div>

        <div className="flex items-center gap-3">

          {/* Auth Buttons */}
          {user ? (
             <div className="relative">
               <button 
                 onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                 className="flex items-center gap-2 p-1 bg-gray-100 dark:bg-[#21262d] hover:bg-gray-200 dark:hover:bg-[#30363d] rounded-full transition-colors"
               >
                 <div className="w-8 h-8 rounded-full bg-brand-red flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                    {user.photoURL || user.photoDataUrl ? (
                      <CachedImage
                        src={user.photoURL}
                        fallbackSrc={user.photoDataUrl}
                        fallback={user.name.charAt(0).toUpperCase()}
                        cacheKey={buildProfileImageCacheKey(user.id)}
                        alt={user.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      user.name.charAt(0).toUpperCase()
                    )}
                 </div>
               </button>

              {isUserMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsUserMenuOpen(false)}
                    aria-hidden="true"
                  ></div>
                  {/* Account menu — spacing modeled on a section-grouped pattern:
                      identity → navigation actions → preference toggles → destructive
                      action, each separated by a hairline divider so the eye lands
                      on the right cluster instantly. Wider panel (`w-64`) gives the
                      Dark-mode toggle pill room to sit on the right without
                      crowding the label. Each row uses uniform `px-4 py-2.5` so the
                      hit targets stay finger-sized on touch. */}
                  <div
                    role="menu"
                    aria-label="Account menu"
                    className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                  >
                    {/* Identity header — display name on top, email below in
                        muted weight, both truncated so long emails don't blow
                        out the panel width. */}
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-[#30363d]">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {user.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {user.email}
                      </p>
                    </div>

                    {/* Navigation actions */}
                    <div className="py-1.5 border-b border-gray-200 dark:border-[#30363d]">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setSettingsMode(true);
                          setAdminMode(false);
                          setCatalogMode(null);
                          setWhatsNewMode(false);
                          setWhatsNewEntryId(null);
                          setIsUserMenuOpen(false);
                        }}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#21262d] hover:text-brand-teal dark:hover:text-brand-teal transition-colors"
                      >
                        <SettingsIcon size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
                        <span>Settings</span>
                      </button>
                      {/* Admin link: visible to users with the admin claim. The
                          `planetoftheweb` username is retained as a bootstrap
                          fallback so the first admin can self-promote even
                          before the claim is minted. */}
                      {(user.isAdmin || user.username === 'planetoftheweb') && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAdminMode(true);
                            setSettingsMode(false);
                            setCatalogMode(null);
                            setWhatsNewMode(false);
                            setWhatsNewEntryId(null);
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#21262d] hover:text-brand-teal dark:hover:text-brand-teal transition-colors"
                        >
                          <ShieldCheck size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
                          <span>Admin</span>
                        </button>
                      )}
                      {/* GitHub repo link — moved out of the header so the
                          right-side icon strip stays focused on Focus mode +
                          What's New. Anchor (not button) so the OS / browser
                          new-tab affordances work naturally. */}
                      <a
                        href={GITHUB_REPO_BASE}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#21262d] hover:text-brand-teal dark:hover:text-brand-teal transition-colors"
                      >
                        <Github size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
                        <span>View on GitHub</span>
                      </a>
                    </div>

                    {/* Preferences — the whole row is the toggle target; the
                        pill on the right is a visual indicator (aria-hidden)
                        so the button itself carries the switch semantics. The
                        thumb's translate values are tuned to the 36px track +
                        14px thumb + 3px end-padding so the pill reads as a
                        proper iOS-style switch. */}
                    <div className="py-1.5 border-b border-gray-200 dark:border-[#30363d]">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isDarkMode}
                        onClick={() => setIsDarkMode(prev => !prev)}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#21262d] transition-colors"
                      >
                        <Moon size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
                        <span className="flex-1">Dark mode</span>
                        <span
                          aria-hidden="true"
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                            isDarkMode ? 'bg-brand-teal' : 'bg-slate-300 dark:bg-slate-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform ${
                              isDarkMode ? 'translate-x-[18px]' : 'translate-x-[3px]'
                            }`}
                          />
                        </span>
                      </button>
                    </div>

                    {/* Destructive action sits on its own at the bottom — no
                        divider above, the visual break is the red tint. */}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-brand-red hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <LogOut size={16} className="shrink-0" />
                      <span>Logout</span>
                    </button>
                  </div>
                </>
              )}
             </div>
          ) : (
            <div className="flex items-center gap-2 mr-2">
              <button 
                onClick={() => openAuthModal('login')}
                className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-brand-teal dark:hover:text-brand-teal px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
              >
                Log In
              </button>
              <button 
                onClick={() => openAuthModal('signup')}
                className="text-sm font-bold text-white bg-brand-red hover:bg-red-700 px-4 py-2 rounded-lg shadow-lg shadow-brand-red/20 transition-all active:scale-95 hidden sm:block"
              >
                Sign Up
              </button>
            </div>
          )}

           <div className="h-6 w-px bg-gray-200 dark:bg-[#30363d]"></div>

           {/* Focus mode toggle — collapses BOTH the toolbar options row
               and the prompt input so the user can see more of the
               preview/gallery. Only meaningful in the main view (not
               admin/settings/catalog), where the ControlPanel is mounted.
               The header itself stays z-50 so the click target sits
               above the (z-40) toolbar even mid-collapse. */}
           {!adminMode && !settingsMode && !catalogMode && !whatsNewMode && (
             <button
               onClick={toggleToolbarCollapsed}
               className="hidden md:inline-flex p-2 text-slate-500 hover:text-brand-teal dark:hover:text-brand-teal hover:bg-slate-100 dark:hover:bg-[#21262d] rounded-lg transition-colors"
               title={isToolbarCollapsed ? 'Show toolbar and prompt' : 'Hide toolbar and prompt to focus on preview'}
               aria-pressed={isToolbarCollapsed}
               aria-label={isToolbarCollapsed ? 'Show toolbar and prompt' : 'Hide toolbar and prompt'}
             >
               {isToolbarCollapsed ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
             </button>
           )}

           {/* GitHub repo link lives inside the user dropdown for signed-in
               users; guests get it inline here so they can still find the
               source without having to sign in first. */}
           {!user && (
             <a
               href={GITHUB_REPO_BASE}
               target="_blank"
               rel="noopener noreferrer"
               className="p-2 text-slate-500 hover:text-brand-teal dark:hover:text-brand-teal hover:bg-slate-100 dark:hover:bg-[#21262d] rounded-lg transition-colors"
               title="View source code on GitHub"
               aria-label="View source code on GitHub"
             >
               <Github size={20} />
             </a>
           )}

           {/* Theme toggle for guests only. Signed-in users get this inside
               the user dropdown menu so the header stays uncluttered. */}
           {!user && (
             <button
               onClick={() => setIsDarkMode(!isDarkMode)}
               className="p-2 text-slate-500 hover:text-brand-teal dark:hover:text-brand-teal hover:bg-slate-100 dark:hover:bg-[#21262d] rounded-lg transition-colors"
               title="Toggle theme"
               aria-label="Toggle theme"
             >
               {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
             </button>
           )}

           {/* What's New bell — last icon in the row so the unread count
               bubble sits in the corner where users expect notification
               pings. Available to signed-in users and guests alike. */}
           <WhatsNewBell
             entries={whatsNew.entries}
             unreadCount={whatsNew.unreadCount}
             unseenIds={whatsNew.unseenIds}
             isOpen={whatsNew.isBellOpen}
             focusedEntryId={whatsNew.focusedEntryId}
             onOpen={whatsNew.openBell}
             onClose={whatsNew.closeBell}
             onClearFocusedEntry={whatsNew.clearFocusedEntry}
             onOpenPage={() => openWhatsNewPage(null)}
             onSelectEntry={(id) => openWhatsNewPage(id)}
           />
        </div>
      </header>

      {/* 2. Content Switching */}
      {adminMode && user ? (
        <Suspense fallback={<LazyPageFallback label="Loading admin..." />}>
          <AdminPage
            onBack={() => setAdminMode(false)}
            currentUser={user}
          />
        </Suspense>
      ) : settingsMode ? (
        user && (
          <Suspense fallback={<LazyPageFallback label="Loading settings..." />}>
            <SettingsPage
              onBack={() => setSettingsMode(false)}
              user={user}
              onSave={handleSaveSettings}
              graphicTypes={graphicTypes}
              visualStyles={visualStyles}
              brandColors={brandColors}
              aspectRatios={aspectRatios}
            />
          </Suspense>
        )
      ) : catalogMode ? (
        <Suspense fallback={<LazyPageFallback label="Loading catalog..." />}>
          <CatalogPage
            category={catalogMode}
            onBack={() => setCatalogMode(null)}
            onImport={handleImportFromCatalog}
            userId={user?.id}
          />
        </Suspense>
      ) : whatsNewMode ? (
        <Suspense fallback={<LazyPageFallback label="Loading updates..." />}>
          <WhatsNewPage
            entries={whatsNew.entries}
            unseenIds={whatsNew.unseenIds}
            selectedEntryId={whatsNewEntryId}
            onSelectEntry={(id) => setWhatsNewEntryId(id)}
            onBack={() => {
              setWhatsNewMode(false);
              setWhatsNewEntryId(null);
            }}
          />
        </Suspense>
      ) : (
        <>
          {/* Toolbar & Controls */}
          <ControlPanel 
            config={config} 
            setConfig={setConfig} 
            onGenerate={handleGenerate}
            isGenerating={hasRunningGenerationJobs}
            options={context}
            setOptions={{ setBrandColors, setVisualStyles, setGraphicTypes, setAspectRatios }}
            onUploadGuidelines={handleUploadGuidelines}
            isAnalyzing={isAnalyzing}
            user={user}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            extraModels={openRouterModels}
            openaiQuality={user?.preferences.settings?.openaiImageQuality || 'auto'}
            onOpenAIQualityChange={user ? handleOpenAIQualityChange : undefined}
            selectedModelIds={selectedModelIds}
            onModelIdsChange={setSelectedModelIds}
            setupRequired={isGenerateSetupRequired}
            setupActionLabel={generateSetupActionLabel}
            setupActionDescription={generateSetupActionDescription}
            onSetupAction={handleGenerateSetupAction}
            presets={user?.preferences.presets || []}
            onApplyPreset={handleApplyPreset}
            onSavePreset={user ? handleSavePreset : undefined}
            onUpdatePreset={user ? handleUpdatePreset : undefined}
            onRenamePreset={user ? handleRenamePreset : undefined}
            onEditPresetInstructions={user ? handleEditPresetInstructions : undefined}
            onDeletePreset={user ? handleDeletePreset : undefined}
            getPresetLabels={getPresetLabels}
            isOptionsCollapsed={isToolbarCollapsed}
            hasGenerated={!!currentGeneration}
            activePromptImageStyleReference={promptImageStyleReference}
            onPromptImageStyleReferenceChange={setPromptImageStyleReference}
          />

          {/* Auto-fading "where did the toolbar go?" hint. Always mounted so it
              can fade both ways via opacity; pointer-events off so it never
              eats clicks on the preview underneath. */}
          <div
            className={`pointer-events-none fixed left-1/2 top-[88px] z-[45] -translate-x-1/2 transition-opacity duration-500 ${
              showToolbarHint ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden={!showToolbarHint}
          >
            <div className="flex items-center gap-2 rounded-full bg-slate-900/90 dark:bg-[#161b22]/95 px-3.5 py-2 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm">
              <Maximize2 size={13} className="shrink-0 text-brand-teal" />
              <span>Toolbar hidden — scroll up or tap <span className="font-semibold">⤢</span> to show it</span>
            </div>
          </div>

          {/* When this leaves the viewport the toolbar docks; when it returns,
              undock (unless focus-mode just selected a preview at the top). */}
          <div
            ref={toolbarDockSentinelRef}
            className="h-px w-full shrink-0 pointer-events-none"
            aria-hidden="true"
          />

          {/* Main Content Area */}
          <main className="flex-1 relative flex flex-col min-w-0 bg-gray-50 dark:bg-[#0d1117] transition-colors duration-200">
            
            {/* Error Toast */}
            {error && (
              <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 bg-red-100 dark:bg-red-900/90 text-red-800 dark:text-red-100 px-4 py-3 rounded-lg shadow-lg border border-red-200 dark:border-red-800 flex items-center gap-2 animate-bounce-in backdrop-blur-sm">
                <AlertCircle size={20} />
                <span className="text-sm font-medium">{error}</span>
                <button onClick={() => setError(null)} className="ml-2 hover:bg-red-200 dark:hover:bg-red-800 p-1 rounded">
                  ✕
                </button>
              </div>
            )}

            {/* Background generation monitor */}
            {activeGenerationJobs.length > 0 && (() => {
              void batchClockTick;
              const runningCount = activeGenerationJobs.filter((job) =>
                job.status === 'running' || job.status === 'stopping'
              ).length;
              // Aggregate counts for the docked pill so the user knows at a
              // glance how much work is still pending without expanding the
              // full panel. "In flight" is what an API key is actively
              // producing right now; "queued" is everything still waiting on
              // a worker (these are the rows that don't show up in
              // `currentJobs`, which is why a 3-image batch with concurrency
              // 2 looked like only 2 generations were happening).
              const totalInFlight = activeGenerationJobs.reduce(
                (sum, job) => sum + job.inFlight,
                0
              );
              const totalQueued = activeGenerationJobs.reduce((sum, job) => {
                if (job.status !== 'running' && job.status !== 'stopping') return sum;
                const done = job.completed + job.failed;
                return sum + Math.max(0, job.total - done - job.inFlight);
              }, 0);
              const docLabel = totalQueued > 0
                ? `${totalInFlight} running · ${totalQueued} queued`
                : `${totalInFlight || runningCount} running`;
              if (isGenerationsPanelCollapsed) {
                return (
                  <div
                    className="absolute top-6 right-4 z-40"
                    role="status"
                    aria-live="polite"
                  >
                    <button
                      type="button"
                      onClick={() => setIsGenerationsPanelCollapsed(false)}
                      className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-[#30363d] bg-white/95 dark:bg-[#161b22]/95 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-lg backdrop-blur-sm hover:border-brand-teal hover:text-brand-teal transition-colors"
                      title="Show active generations"
                      aria-label={`Show active generations panel (${docLabel})`}
                    >
                      {runningCount > 0 ? (
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-brand-teal/30 border-t-brand-teal animate-spin" />
                      ) : (
                        <Sparkles size={13} className="text-brand-teal" />
                      )}
                      <span className="tabular-nums">{docLabel}</span>
                    </button>
                  </div>
                );
              }
              return (
                <div
                  className="absolute top-6 right-4 z-40 w-[min(440px,calc(100%-2rem))]"
                  role="status"
                  aria-live="polite"
                >
                  <div className="bg-white/95 dark:bg-[#161b22]/95 border border-gray-200 dark:border-[#30363d] rounded-xl shadow-lg backdrop-blur-sm p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkles size={15} className="text-brand-teal shrink-0" />
                        <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          Active Generations
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                          {docLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsGenerationsPanelCollapsed(true)}
                          className="inline-flex items-center justify-center h-6 w-6 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors"
                          title="Dock to corner"
                          aria-label="Minimize active generations panel"
                        >
                          <Minimize2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {activeGenerationJobs.map((job) => {
                        const doneCount = job.completed + job.failed;
                        const progressPct = Math.round((doneCount / Math.max(1, job.total)) * 100);
                        const running = job.status === 'running' || job.status === 'stopping';
                        const elapsedMs = (job.finishedAt || Date.now()) - job.startedAt;
                        const elapsedLabel = formatDuration(elapsedMs / 1000);
                        const remainingJobs = Math.max(0, job.total - doneCount);
                        // Projected-makespan countdown. Project total wall time
                        // from learned per-model speeds and count down with
                        // elapsed; once generations complete, infer per-job
                        // seconds from throughput (crediting in-flight jobs as
                        // half done) and blend with the baseline. The previous
                        // rate-only math froze for single generations and
                        // spiked ~2× right after a batch's first completion
                        // (simulated mean error 15-40s, worst >2min; this
                        // formula: 0-19s mean, worst 64s).
                        let remainingSeconds = 0;
                        if (remainingJobs > 0) {
                          const modelCount = Math.max(1, job.modelIds.length);
                          const effC = Math.max(1, Math.min(DEFAULT_BATCH_CONCURRENCY * modelCount, job.total));
                          const baselinePerGen =
                            job.modelIds.reduce((sum, modelId) => sum + Math.max(1, getModelSecondsPerGen(modelId)), 0) /
                            modelCount;
                          const elapsedSec = elapsedMs / 1000;
                          let perGen = baselinePerGen;
                          if (doneCount > 0) {
                            // Anchor the observed speed to the moment of the
                            // last completion — deriving it from live elapsed
                            // makes perGen grow 1s/s and cancels the countdown
                            // (the display stalls while a straggler runs).
                            const anchoredSec = Math.max(
                              1,
                              ((job.lastProgressAt || Date.now()) - job.startedAt) / 1000
                            );
                            const inFlightNow = Math.min(effC, remainingJobs);
                            const observed = (anchoredSec * effC) / (doneCount + 0.5 * inFlightNow);
                            const trust = doneCount / (doneCount + 1);
                            perGen = observed * trust + baselinePerGen * (1 - trust);
                          }
                          const projected = Math.ceil(job.total / effC) * perGen;
                          remainingSeconds = Math.max(Math.round(projected - elapsedSec), 3);
                        }
                        const remainingLabel = formatDuration(remainingSeconds);
                        const modelChips = job.modelIds
                          .map((modelId) => ({ modelId, stats: job.modelProgress[modelId] }))
                          .filter(({ stats }) => !!stats);
                        const statusLabel =
                          job.status === 'stopping' ? 'Stopping' :
                          job.status === 'completed' ? 'Done' :
                          job.status === 'failed' ? 'Needs attention' :
                          job.status === 'stopped' ? 'Stopped' :
                          'Generating';
                        const progressColor =
                          job.status === 'failed'
                            ? 'bg-red-500'
                            : job.status === 'stopped'
                              ? 'bg-slate-400'
                              : 'bg-brand-teal';

                        return (
                          <div
                            key={job.id}
                            className="rounded-lg border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] p-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  {running ? (
                                    <span className="h-3.5 w-3.5 rounded-full border-2 border-brand-teal/30 border-t-brand-teal animate-spin shrink-0" />
                                  ) : (
                                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${job.status === 'failed' ? 'bg-red-500' : 'bg-brand-teal'}`} />
                                  )}
                                  <span className="text-xs font-semibold text-slate-900 dark:text-white">
                                    {statusLabel}
                                  </span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {doneCount}/{job.total}
                                  </span>
                                  {job.inFlight > 0 && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      {job.inFlight} running
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-2 break-words">
                                  {job.prompt}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {job.latest && (
                                  <button
                                    type="button"
                                    onClick={() => void handleRestoreFromHistory(job.latest!)}
                                    className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-gray-200 dark:border-[#30363d] text-slate-500 dark:text-slate-300 hover:text-brand-teal hover:border-brand-teal transition-colors"
                                    title="View latest result"
                                    aria-label="View latest result"
                                  >
                                    <ArrowRight size={14} />
                                  </button>
                                )}
                                {running ? (
                                  <button
                                    type="button"
                                    onClick={() => handleStopGenerationJob(job.id)}
                                    disabled={job.status === 'stopping'}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 dark:border-[#30363d] text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    title={job.status === 'stopping'
                                      ? 'Waiting for in-flight generations to finish'
                                      : 'Stop queuing new generations for this run'}
                                  >
                                    <span className="block w-2 h-2 rounded-sm bg-red-500" aria-hidden="true" />
                                    {job.status === 'stopping' ? 'Stopping' : 'Stop'}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => clearGenerationJob(job.id)}
                                    className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-gray-200 dark:border-[#30363d] text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                                    title="Dismiss"
                                    aria-label="Dismiss generation status"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 h-1.5 bg-gray-200 dark:bg-[#30363d] rounded-full overflow-hidden">
                              <div
                                className={`h-full ${progressColor} transition-all duration-300 ${running ? 'animate-pulse' : ''}`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                              <span>{elapsedLabel} elapsed</span>
                              {running && remainingSeconds > 0 ? (
                                <span>~{remainingLabel} remaining</span>
                              ) : job.message ? (
                                <span className="truncate">{job.message}</span>
                              ) : (
                                <span>{statusLabel}</span>
                              )}
                            </div>
                            {(job.currentJobs.length > 0 || (running && remainingJobs > job.inFlight)) && (
                              <div className="mt-1.5 space-y-1">
                                {job.currentJobs.slice(0, 3).map((currentJob) => (
                                  <div
                                    key={currentJob.key}
                                    className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400"
                                  >
                                    <span className="font-medium truncate">
                                      {MODEL_NAME_BY_ID[currentJob.modelId] || currentJob.modelId}
                                    </span>
                                    <span className="truncate text-right">{currentJob.prompt}</span>
                                  </div>
                                ))}
                                {/* Queued items aren't tracked individually in
                                    state (the batch runner only emits the
                                    in-flight set), but we can derive how many
                                    are still waiting from total - done -
                                    inFlight. Without this row, a batch of 3
                                    with concurrency 2 looked like only 2
                                    generations were happening. */}
                                {running && remainingJobs > job.inFlight && (
                                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 italic">
                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                                    {remainingJobs - job.inFlight} queued
                                  </div>
                                )}
                              </div>
                            )}
                            {modelChips.length > 1 && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {modelChips.map(({ modelId, stats }) => (
                                  <span
                                    key={modelId}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-gray-200 dark:border-[#30363d] text-[10px] font-medium text-slate-600 dark:text-slate-300"
                                    title={`${MODEL_NAME_BY_ID[modelId] || modelId}: ${stats!.completed + stats!.failed}/${stats!.total} complete, ${stats!.inFlight} running`}
                                  >
                                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${stats!.inFlight > 0 ? 'bg-brand-teal animate-pulse' : 'bg-slate-400'}`} />
                                    {MODEL_NAME_BY_ID[modelId] || modelId}
                                    <span className="text-slate-400 dark:text-slate-500">
                                      {stats!.completed + stats!.failed}/{stats!.total}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Display — render the viewer when we have something to show,
                a new generation is starting up (so the "Generating…"
                placeholder is visible instead of stale art), or there's no
                history at all (true first-run). When the viewer is empty but
                the user already has prior generations, skip the
                "Ready to Create" placeholder so the Recent Generations gallery
                lands at the top of the page on load. */}
            {(currentGeneration || hasRunningGenerationJobs || history.length === 0) && (
              <ImageDisplay
                generation={currentGeneration}
                onRefine={handleRefine}
                onRerun={handleRerun}
                onToggleStarred={handleToggleStarred}
                pendingRerunCount={pendingRerunCount}
                onAnalyzeRefinePrompt={handleAnalyzeRefinePrompt}
                onExpandRefinementPrompt={handleExpandRefinementPrompt}
                onResizeCanvasRefine={handleResizeCanvasRefine}
                isBatchStarting={hasRunningGenerationJobs}
                isRefining={previewPipelineDepth > 0}
                onCopy={handleCopyCurrent}
                onDelete={() => {
                  // The ImageDisplay delete button now self-confirms via a
                  // double-tap pattern (see hooks/useConfirmAction), so we
                  // bypass the App-level modal here and fire the actual
                  // delete on the second click that reaches this handler.
                  executeDeleteCurrent().catch((err: any) => {
                    console.error('Failed to delete current image:', err);
                    setError(err?.message || 'Failed to delete image.');
                  });
                }}
                onVersionChange={handleVersionChange}
                onDeleteRefinementVersion={handleDeleteRefinementVersion}
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                resizeAspectRatios={getAspectRatiosForModel('gemini', aspectRatios)}
                options={context}
                history={history}
                galleryViewFolderId={galleryViewFolderId}
                comparisonState={comparisonState}
                onEnterComparePicker={enterComparePickerMode}
                onExitComparePicker={exitComparePickerMode}
                onPickMark={pickMarkForComparison}
                onNavigateToGeneration={handleRestoreFromHistory}
                toolbarCollapsed={isToolbarCollapsed}
                onOpenBuildStudio={
                  currentGeneration
                    ? () => {
                        const gen = currentGeneration;
                        const ver = gen.versions[gen.currentVersionIndex] || gen.versions[0];
                        if (ver) setBuildStudioTarget({ generation: gen, version: ver });
                      }
                    : undefined
                }
              />
            )}

            {/* History Gallery */}
            <RecentGenerations
              hasPreviewAbove={!!currentGeneration || hasRunningGenerationJobs || history.length === 0}
              toolbarCollapsed={isToolbarCollapsed}
              history={history}
              activeGenerationId={currentGeneration?.id}
              onSelect={handleRestoreFromHistory}
              onDelete={(historyId: string) => {
                // Tile delete is self-confirming via double-tap inside
                // RecentGenerations, so skip the App-level modal here too.
                executeDeleteHistory(historyId).catch((err: any) => {
                  console.error('Failed to delete history item:', err);
                  setError(err?.message || 'Failed to delete generation.');
                });
              }}
              options={context}
              isComparePicking={comparisonState.mode === 'picking'}
              onPickMark={pickMarkForComparison}
              pickedMarkIds={{
                a: comparisonState.a ? `${comparisonState.a.generationId}|${comparisonState.a.versionId}` : undefined,
                b: comparisonState.b ? `${comparisonState.b.generationId}|${comparisonState.b.versionId}` : undefined,
              }}
              folders={folders}
              galleryViewFolderId={galleryViewFolderId}
              onGalleryViewFolderChange={handleGalleryViewFolderChange}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onMoveToFolder={handleMoveGenerationsToFolder}
              onMoveFolder={handleMoveFolder}
              onReorderFolder={handleReorderFolder}
              onSetFolderInstructions={handleSetFolderInstructions}
              galleryPresets={galleryPresets}
              galleryPresetSource={galleryPresetSource}
              onGalleryPresetSourceChange={handleGalleryPresetSourceChange}
              galleryToolbarPresetSnapshot={buildToolbarPresetSnapshot()}
              onApplyGalleryPreset={handleApplyPreset}
              onSaveGalleryPreset={
                galleryPresetSource === 'folder' || user ? handleGallerySavePreset : undefined
              }
              onUpdateGalleryPreset={
                galleryPresetSource === 'folder' || user ? handleGalleryUpdatePreset : undefined
              }
              onRenameGalleryPreset={
                galleryPresetSource === 'folder' || user ? handleGalleryRenamePreset : undefined
              }
              onDeleteGalleryPreset={
                galleryPresetSource === 'folder' || user ? handleGalleryDeletePreset : undefined
              }
              onEditGalleryPresetInstructions={
                galleryPresetSource === 'folder' || user ? handleGalleryEditPresetInstructions : undefined
              }
              getPresetLabels={getPresetLabels}
              galleryFolderName={galleryViewFolder?.name}
            />
          </main>
        </>
      )}

      <footer
        className="mt-auto w-full border-t border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#0d1117] px-4 py-4 sm:px-6"
        role="contentinfo"
        aria-label="Site copyright and project links"
      >
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-2 text-center text-xs text-slate-500 dark:text-slate-400 sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1">
          <p>© {new Date().getFullYear()} BranDoIt. All rights reserved.</p>
          <nav
            className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2"
            aria-label="Project documentation"
          >
            <a
              href={GITHUB_CHANGELOG_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-medium text-brand-teal hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0d1117]"
            >
              Changelog
            </a>
            <span className="hidden text-slate-300 dark:text-slate-600 sm:inline" aria-hidden="true">
              |
            </span>
            <a
              href={GITHUB_RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-medium text-brand-teal hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0d1117]"
            >
              Releases
            </a>
          </nav>
        </div>
      </footer>

      {/* Search Modal (Cmd+K) */}
      {isSearchOpen && (
        <Suspense fallback={<LazyModalFallback />}>
          <SearchModal
            history={history}
            onSelect={(gen) => void handleRestoreFromHistory(gen)}
            onClose={() => setIsSearchOpen(false)}
            getGenerationLabels={(gen) =>
              getPresetLabels({
                id: gen.id,
                name: '',
                createdAt: gen.createdAt,
                graphicTypeId: gen.config.graphicTypeId,
                visualStyleId: gen.config.visualStyleId,
                colorSchemeId: gen.config.colorSchemeId,
                aspectRatio: gen.config.aspectRatio,
                svgMode: gen.config.svgMode,
                selectedModel: gen.modelId,
              })
            }
          />
        </Suspense>
      )}

      {/* Build Studio — reveal animator over the current image */}
      {buildStudioTarget && (
        <Suspense fallback={<LazyModalFallback />}>
          <BuildStudio
            key={`${buildStudioTarget.generation.id}|${buildStudioTarget.version.id}`}
            generation={buildStudioTarget.generation}
            version={buildStudioTarget.version}
            onClose={() => setBuildStudioTarget(null)}
            userId={user?.id}
            geminiApiKey={getGeminiApiKeyForAnalysis(user)}
            onCleanupRefine={handleBuildStudioCleanup}
          />
        </Suspense>
      )}

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <Suspense fallback={<LazyModalFallback />}>
          <AuthModal
            isOpen={isAuthModalOpen}
            onClose={() => setIsAuthModalOpen(false)}
            onLoginSuccess={handleLoginSuccess}
            initialMode={authModalMode}
          />
        </Suspense>
      )}

      {/* Brand Analysis Modal */}
      {isAnalysisModalOpen && (
        <Suspense fallback={<LazyModalFallback />}>
          <BrandAnalysisModal
            isOpen={isAnalysisModalOpen}
            onClose={() => setIsAnalysisModalOpen(false)}
            analysisResult={analysisResult}
            onConfirm={handleConfirmAnalysis}
          />
        </Suspense>
      )}

      {/* Catalog Modal Removed */}

      {/* Delete Confirmation Modal */}
      {confirmDeleteModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-200 flex items-center justify-center">
                <AlertCircle size={20} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {confirmDeleteModal.type === 'history' ? 'Delete generation?' : 'Delete current preview?'}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                  This action will remove the generation{confirmDeleteModal.type === 'current' ? ' and clear the main preview' : ''}.
                </p>
              </div>
            </div>

            {/* "Don't ask me again" is intentionally only available for the
                main-image trash. Tile-trash in the gallery always confirms,
                because a misclicked thumbnail is too easy to lose silently. */}
            {confirmDeleteModal.type === 'current' && (
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={skipFutureConfirm}
                  onChange={(e) => setSkipFutureConfirm(e.target.checked)}
                  className="h-4 w-4 text-brand-red rounded border-gray-300 focus:ring-brand-red cursor-pointer"
                />
                Don’t ask me again for this action
              </label>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleCancelDeleteModal}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-[#30363d] text-slate-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-[#21262d] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteModal}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold shadow-sm transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isAuthResolved && needsSetup && isSetupModalOpen && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center p-4 sm:p-6"
          onClick={() => setIsSetupModalOpen(false)}
        >
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-white/15 bg-white dark:bg-[#0d1117] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.18),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(239,68,68,0.15),transparent_40%)]" />
            <div className="relative p-6 sm:p-8">
              <button
                onClick={() => setIsSetupModalOpen(false)}
                className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#1f2937] transition-colors"
                aria-label="Close setup instructions"
              >
                <X size={18} />
              </button>

              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-900/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-200">
                <Sparkles size={12} />
                Quick Start
              </div>

              {!user ? (
                <>
                  <h2 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Start free with your own API key
                  </h2>
                  <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-300">
                    BranDoIt uses BYOK on free accounts. Create your account, add a Gemini or OpenAI key, and you are ready to generate.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                    One setup step left
                  </h2>
                  <p className="mt-3 text-sm sm:text-base text-slate-600 dark:text-slate-300">
                    Add your API key in Settings to start generating. Free accounts run on BYOK keys.
                  </p>
                </>
              )}

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 dark:border-[#30363d] bg-slate-50/80 dark:bg-[#111827]/70 p-4">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-sm">
                    <KeyRound size={14} className="text-sky-600 dark:text-sky-300" />
                    Free = BYOK
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Bring your own key, control your own usage.</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-[#30363d] bg-slate-50/80 dark:bg-[#111827]/70 p-4">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-sm">
                    <UserIcon size={14} className="text-sky-600 dark:text-sky-300" />
                    Account Benefits
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Save styles, color palettes, settings, and history.</p>
                </div>
                <div className="rounded-2xl border border-slate-200 dark:border-[#30363d] bg-slate-50/80 dark:bg-[#111827]/70 p-4">
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold text-sm">
                    <Sparkles size={14} className="text-sky-600 dark:text-sky-300" />
                    Paid Plans Soon
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">More model access and additional workspace features.</p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                {!user ? (
                  <>
                    <button
                      onClick={() => openAuthModal('login')}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1f2937] transition-colors"
                    >
                      <LogIn size={15} />
                      Log In
                    </button>
                    <button
                      onClick={() => openAuthModal('signup')}
                      className="inline-flex items-center gap-2 rounded-xl bg-brand-red hover:bg-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-red/20 transition-colors"
                    >
                      Create Free Account
                      <ArrowRight size={15} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setSettingsMode(true);
                      setIsSetupModalOpen(false);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand-red hover:bg-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-red/20 transition-colors"
                  >
                    <SettingsIcon size={15} />
                    Open Settings
                    <ArrowRight size={15} />
                  </button>
                )}
                <button
                  onClick={() => setIsSetupModalOpen(false)}
                  className="inline-flex items-center rounded-xl border border-transparent px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  Continue Exploring
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;
