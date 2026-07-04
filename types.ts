export interface BaseResource {
  id: string;
  name: string;
  icon?: any;
  
  // Ownership & Visibility
  authorId: string;
  authorName: string;
  scope: 'system' | 'private' | 'public' | 'team';
  teamId?: string;

  // Social & Forking
  votes: number;
  voters: string[];
  forkedFromId?: string;
  createdAt: number;
}

export interface BrandColor extends BaseResource {
  colors: string[]; // Hex codes
}

export type StyleFormat = 'raster' | 'vector';

export interface VisualStyle extends BaseResource {
  description: string;
  supportedFormats?: StyleFormat[];
}

export interface GraphicType extends BaseResource {}

export interface AspectRatioOption extends BaseResource {
  label: string;
  value: string; // "1:1", "16:9", etc.
}

export type SvgMode = 'static' | 'animated' | 'interactive';

export interface GenerationConfig {
  prompt: string;
  colorSchemeId: string;
  visualStyleId: string;
  graphicTypeId: string;
  aspectRatio: string;
  svgMode?: SvgMode;
}

export interface GeneratedImage {
  imageUrl: string;
  base64Data: string;
  mimeType: string;
  modelId?: string;
  timestamp?: number;
  config?: GenerationConfig;
}

export type PromptImageStyleInfluenceMode = 'image' | 'menus';

export interface PromptImageStyleReference {
  image: GeneratedImage;
  fileName: string;
  styleName: string;
  styleDescription: string;
  influenceMode: PromptImageStyleInfluenceMode;
}

/** @deprecated Use Generation + GenerationVersion instead */
export interface GenerationHistoryItem extends GeneratedImage {
  id: string;
  timestamp: number;
  config: GenerationConfig;
  modelId?: string;
}

export type VersionType = 'generation' | 'refinement';

export interface GenerationVersion {
  id: string;
  number: number;
  label: string;
  timestamp: number;
  type: VersionType;

  imageData: string;
  imageUrl: string;
  imageStoragePath?: string;
  mimeType: string;
  aspectRatio?: string;

  svgCode?: string;

  refinementPrompt?: string;
  parentVersionId?: string;

  /**
   * Which model produced this specific version. Optional for backward compat
   * with legacy single-model history items (the parent Generation.modelId
   * applies in that case). For comparison tiles where multiple models share
   * one Generation, this is what tells the UI which chip / refine-default /
   * slider-label to use per mark.
   */
  modelId?: string;
}

export interface Generation {
  id: string;
  createdAt: number;
  config: GenerationConfig;
  modelId: string;
  versions: GenerationVersion[];
  currentVersionIndex: number;

  /**
   * Shared tag linking tiles produced by a single multi-model Generate click
   * (e.g. "Nano Banana Pro vs GPT Image 2 from the same prompt"). Absent on
   * normal single-model generations. Used only for grouping/badging in the UI;
   * comparisons themselves are not persisted.
   */
  comparisonBatchId?: string;

  /**
   * Folder this tile lives in. Every Generation belongs to exactly one
   * folder; legacy items without this field are normalized to
   * `INBOX_FOLDER_ID` at read time so the gallery can always group by
   * folder.
   */
  folderId: string;

  /**
   * Optional id of the user's "best" Mark within this generation. At most
   * one version is marked per tile. When set, the prev/next-generation
   * arrows on the canvas skip tiles without a starred Mark and land on
   * the starred version when navigating across history.
   */
  starredVersionId?: string;
}

/** A point in normalized image space (0..1 on each axis). */
export interface BuildPoint {
  x: number;
  y: number;
}

/** Where the camera zooms in from for a step. */
export type BuildZoomFrom = 'smart' | 'center';

/** Whether a shape adds to or subtracts from a step's revealed region. */
export type BuildShapeOp = 'add' | 'sub';

/** A filled polygon (freeform lasso, rectangle, or straight-line vertices). */
export interface BuildPolyShape {
  kind: 'poly';
  op: BuildShapeOp;
  points: BuildPoint[]; // normalized, 3+ points
}

/** A brush stroke: a thick path with round caps. `radius` is a fraction of min(imgW,imgH). */
export interface BuildBrushShape {
  kind: 'brush';
  op: BuildShapeOp;
  points: BuildPoint[]; // normalized path, 1+ points
  radius: number;
}

export type BuildShape = BuildPolyShape | BuildBrushShape;

/**
 * One reveal step in a Build: a region of the image built from one or more
 * shapes (add/subtract composited), stored normalized 0..1 so it survives any
 * display/export resolution. The camera centers and zooms on the region's
 * bounds.
 */
export interface BuildStep {
  id: string;
  shapes: BuildShape[];
  /** Short display name (e.g. from the AI auto-select pass). Falls back to "Item N". */
  label?: string;
  /** Per-step hold length. Falls back to the build's global default when unset. */
  durationMs?: number;
  /**
   * Per-step camera origin. 'smart' pans from the previous item; 'center'
   * pulls back to the whole image, then zooms in. Falls back to the build's
   * global default when unset.
   */
  zoomFrom?: BuildZoomFrom;
}

/** How the not-yet-revealed area of the image looks during a build. */
export type BuildBackground = 'dim' | 'blank' | 'blur';

/** How each step's region appears as it is revealed. */
export type BuildRevealStyle = 'fade' | 'wipe' | 'spotlight';

/**
 * A "build" turns a finished infographic into a sequential reveal animation
 * (PowerPoint-style builds): the camera zooms to each box as its content fades
 * in. Saved locally per generation+version (see services/buildStore.ts) and
 * rendered deterministically by services/buildAnimator.ts so the live player
 * and the exported MP4 stay identical.
 */
export interface ImageBuild {
  steps: BuildStep[];
  revealStyle: BuildRevealStyle; // default 'fade'
  /**
   * false (default): show one item at a time — the previous item hides as the
   * next appears; the end reveals all selected items together.
   * true: cumulative "build up" — each item stays visible as the next is added.
   */
  cumulative: boolean;
  zoom: number;                  // 0 = no camera zoom … 1 = fully frame each region
  fps: number;                   // export frame rate, default 30
  transitionMs: number;          // cross-step camera ease + content fade
  endShowFull: boolean;          // zoom back out to the whole image at the end
  /**
   * What the end zoom-out shows: 'items' reveals all selections together
   * (non-selected areas stay background); 'image' fades in the ENTIRE
   * unmasked image. Optional for builds saved before this existed → 'items'.
   */
  endStyle?: 'items' | 'image';
  background: BuildBackground;   // look of the not-yet-revealed area
  defaultDurationMs: number;     // global "seconds to show" per item (per-step override wins)
  defaultZoomFrom: BuildZoomFrom;// global camera origin (per-step override wins)
  autoPlay: boolean;             // Preview opens auto-playing vs. manual arrow-key advance
  /**
   * What Preview shows the instant it opens: 'blank' sits on the empty
   * pre-reveal state (nothing shown yet, first arrow/space press starts it);
   * 'first' jumps straight into the first item's reveal.
   */
  startMode: 'blank' | 'first';
}

/**
 * Reserved id of the always-present "Inbox" folder. Auto-created on first
 * init (per user / per guest device) and undeletable, but renameable. Used
 * as the default gallery folder and when a folder is deleted with tiles
 * still inside it.
 */
export const INBOX_FOLDER_ID = 'folder-inbox';

/**
 * A user-owned container that groups generation tiles. Folders persist on
 * the user document for signed-in users and in localStorage for guests.
 */
export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  /**
   * When set, this folder is nested under another folder. Omitted or
   * invalid ids are treated as a top-level folder (sibling of Inbox).
   */
  parentId?: string;
  /**
   * Sibling order within the same `parentId` (lower = higher in the list).
   * Omitted on legacy folders — falls back to `createdAt`.
   */
  sortOrder?: number;
  /**
   * Extra instructions merged into the system prompt for generations and
   * refinements on tiles in this folder. Ancestor folder instructions are
   * prepended (root → leaf) before this folder's own text.
   */
  customInstructions?: string;
  /**
   * When true, the gallery preset picker uses `presets` on this folder instead
   * of the account-wide list on `UserPreferences.presets`.
   */
  useFolderPresets?: boolean;
  /** Named toolbar snapshots scoped to this folder (used when `useFolderPresets`). */
  presets?: ToolbarPreset[];
}

export interface BrandGuidelinesAnalysis {
  brandColors: Omit<BrandColor, 'id' | 'authorId' | 'authorName' | 'scope' | 'votes' | 'voters' | 'createdAt'>[];
  visualStyles: Omit<VisualStyle, 'id' | 'authorId' | 'authorName' | 'scope' | 'votes' | 'voters' | 'createdAt'>[];
  graphicTypes: Omit<GraphicType, 'id' | 'authorId' | 'authorName' | 'scope' | 'votes' | 'voters' | 'createdAt'>[];
}

export interface UserPreferences {
  // References only, actual data stored in resource collections
  geminiApiKey?: string; // Legacy support
  apiKeys?: {
    [modelId: string]: string;
  };
  /**
   * OpenRouter image models enabled in the model picker (bare slugs, e.g.
   * "bytedance-seed/seedream-4.5"). Undefined = the curated defaults in
   * OPENROUTER_CURATED_MODELS. Only used when apiKeys.openrouter is set.
   */
  openRouterModels?: string[];
  selectedModel?: string;
  systemPrompt?: string;
  settings?: UserSettings;
  /**
   * Saved toolbar preset groups. Each entry captures a snapshot of the
   * configurable toolbar fields (type/style/colors/size/model/quality/svgMode)
   * so the user can recall a frequently-used combination with one click.
   */
  presets?: ToolbarPreset[];
  /**
   * User-owned folders that contain generation tiles. The reserved
   * `INBOX_FOLDER_ID` entry is auto-seeded on first init and cannot be
   * removed (only renamed). Sibling order uses `sortOrder` (then `createdAt`).
   */
  folders?: Folder[];
  /**
   * @deprecated Legacy sticky-folder pin — no longer written. New tiles use
   * `galleryViewFolderId` (the folder currently open in the gallery).
   */
  activeFolderId?: string;
  /**
   * Which folder the Recents gallery is currently showing. New generations
   * land here. Persisted across devices/sessions (Firestore or localStorage).
   * Invalid ids fall back to Inbox.
   */
  galleryViewFolderId?: string;
  /**
   * Most recent What's New entry id the user has acknowledged (by opening the
   * bell dropdown). Drives the unread badge: when the newest entry id differs
   * from this value, the bell shows the badge. Guests persist this in
   * localStorage instead.
   */
  lastSeenWhatsNewId?: string;
  /**
   * Ids of `featured: true` What's New entries the user has explicitly
   * dismissed from the spotlight modal. The modal never re-fires for a
   * dismissed id. Guests persist this in localStorage instead.
   */
  dismissedSpotlightIds?: string[];
}

/**
 * A single user-facing release / feature announcement. Drives both the
 * header bell dropdown (every entry) and the spotlight modal (only entries
 * with `featured: true`). Curated by hand in `data/whatsNew.ts` alongside
 * each CHANGELOG.md update so the prose stays user-voiced.
 */
/**
 * A single instruction inside a {@link WhatsNewSection}. Steps are rendered
 * as a numbered list on the detail page. They can optionally carry a tiny
 * visual marker so users can recognize the corresponding UI affordance:
 *   - `icon`: a Lucide-react icon *name* string (e.g., "Bell"). Rendered as
 *     a small pill that visually echoes the actual app button.
 *   - `kbd`: a keyboard-shortcut string (e.g., "Cmd+K"). The component
 *     splits on `+` and renders each token as a styled `<kbd>` chip.
 * If both are provided, both are rendered (icon then kbd).
 */
export interface WhatsNewStep {
  text: string;
  icon?: string;
  kbd?: string;
}

/**
 * One sub-topic inside a release's detail page (e.g., "The bell" vs.
 * "The discovery page"). A section is a heading + optional paragraph body
 * + optional ordered steps. Sections are rendered top-to-bottom in array
 * order, so authors control the narrative flow.
 */
export interface WhatsNewSection {
  heading: string;
  body?: string;
  steps?: WhatsNewStep[];
}

export interface WhatsNewEntry {
  /** Stable slug used for unread/dismissed tracking, e.g. `v0.15.0-prompt-image-drop`. */
  id: string;
  title: string;
  /**
   * One-sentence preview rendered in the bell dropdown. Keep it short — the
   * dropdown shows two lines max before truncation.
   */
  summary: string;
  /**
   * Medium-length user-voiced description rendered in the spotlight modal
   * and on the discovery-page card grid. One short paragraph is ideal.
   */
  blurb: string;
  /** Milliseconds since epoch; the list renders sorted descending by this. */
  publishedAt: number;
  /** Optional release tag, e.g. `0.15.0`. */
  version?: string;
  /** Optional public path or imported asset shown in bell row, spotlight hero, and detail page hero. */
  image?: string;
  /** When true, eligible to auto-open the spotlight modal on first load. */
  featured?: boolean;
  /** Optional URL for an external "Learn more" link rendered on the detail page footer. */
  learnMoreHref?: string;
  /**
   * Structured rich content rendered on the detail page. Each section is a
   * sub-feature of the release. If omitted, the detail page falls back to
   * showing only the blurb so older entries still render gracefully.
   */
  sections?: WhatsNewSection[];
}

/**
 * A named snapshot of toolbar settings the user wants to recall later.
 * Stored on the user document under preferences.presets. Empty/undefined
 * fields are treated as "leave the current value alone" when applied, so
 * a user can save partial presets (e.g. just a style + palette pair).
 */
export interface ToolbarPreset {
  id: string;
  name: string;
  createdAt: number;
  graphicTypeId?: string;
  visualStyleId?: string;
  colorSchemeId?: string;
  aspectRatio?: string;
  svgMode?: SvgMode;
  selectedModel?: string;
  openaiImageQuality?: 'low' | 'medium' | 'high' | 'auto';
}

export interface UserSettings {
  contributeByDefault: boolean;
  defaultGraphicTypeId?: string;
  defaultVisualStyleId?: string;
  defaultColorSchemeId?: string;
  defaultAspectRatio?: string;
  confirmDeleteHistory?: boolean;
  confirmDeleteCurrent?: boolean;
  /**
   * OpenAI GPT Image quality setting: 'low' | 'medium' | 'high' | 'auto'.
   * Only consumed by gpt-image-2 and gpt-image-1-mini; gpt-image-1.5 ignores it.
   */
  openaiImageQuality?: 'low' | 'medium' | 'high' | 'auto';
}

export interface User {
  id: string;
  name: string;
  username?: string; 
  email: string;
  photoURL?: string; 
  photoDataUrl?: string;
  preferences: UserPreferences;
  teamIds?: string[]; // IDs of teams the user belongs to

  /**
   * Derived from the Firebase Auth custom claim `admin` on every auth state
   * change. Never persisted to Firestore — sanitized out of every write path.
   */
  isAdmin?: boolean;

  /**
   * Persisted flag that hard-blocks the account from accessing the app.
   * Written by admins via `adminService.setUserDisabled`.
   */
  isDisabled?: boolean;
}

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  members: string[]; // List of user IDs
  createdAt: number;
}

// Deprecated: CatalogItem is no longer needed as resources are self-contained
// export interface CatalogItem { ... }
