# Changelog

All notable changes to BranDoIt Studio are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.21.0] - 2026-07-04

### Added

- **Build Studio AI auto-select.** New `services/buildAutoSelect.ts` sends the infographic to Gemini (BYOK, lazy-loaded) and returns an ordered list of regions — title/hook first, content blocks in reading order, conclusion last — with optional segmentation-mask polygons preferred over bounding boxes. The wand in Build Studio replaces the current items in one shot; ⌘Z restores the previous list. A follow-up naming pass labels each block for the sidebar (`components/BuildStudio.tsx`, `App.tsx` passes `geminiApiKey`).
- **"Clean up for animation" refine pass in Build Studio.** Sparkles button wires into the app's existing `onRefine` pipeline with a fixed instruction that redraws each section isolated on a solid background, making dense art easier to auto-select or trace manually. Creates a new Mark; the original stays (`components/BuildStudio.tsx`, `App.tsx`).
- **Build Studio UX polish.** Resizable sidebar (drag left edge, persisted), portal tooltips that never clip scroll ancestors, focus-mode canvas zoom (double-tap ⌥, ⌥1-9, pinch/⌘-scroll), undo/redo over step-structure edits (⌘Z / ⇧⌘Z), inline rename (double-click) and duration scrubbing (drag the readout), collapsible sidebar sections, and a draggable floating toolbar. UI principles captured in `CLAUDE.md`.
- **Animator improvements.** `netRegionBounds` caches per-step bounds including brush radii for accurate focus zoom; per-step camera framing and smoother reveal timing (`services/buildAnimator.ts`).

### Changed

- **`package.json` bumped to `0.21.0`** with a featured What's New entry, hero image, and walkthrough sections for Build Studio (`data/whatsNew.ts`, `public/whats-new/whatsnew-v0.21.0.png`).

## [0.20.0] - 2026-05-21

### Added

- **Re-roll on `+` instead of refine.** The "Add a new Mark" plus button at the end of the version rail used to call `handleRefine(lastPrompt)` — which routed through the refinement pipeline, feeding the previous image into the model along with strict preservation directives (`"Treat the attached raster as the only source of truth — edit it in place"`, `"Preserve composition, framing, subjects, poses, facial identity, layout, logos, icons, lighting"` — see `services/geminiService.ts`). Net effect: new Marks looked nearly identical to the parent. The button now calls a new `handleRerun(prompt, count)` in `App.tsx` that runs a fresh generation against the tile's original prompt — no previous-image input, no preservation directives — and appends the result as a `type: 'generation'` Mark on the current tile. The refine bar still goes through `handleRefine` for intentional incremental edits (`components/ImageDisplay.tsx`).
- **Hold 1-9 + Click to batch re-rolls.** Window-level `keydown`/`keyup` listeners track a held digit into both a ref (read at click time, latest value) and state (for rendering a `×N` teal badge floating on the `+` button's top-right corner). Form-field guard so typing "3" into the refine prompt doesn't arm the shortcut; `window.blur` clears the held state so a stale digit can't haunt the next click. `handleRerun(prompt, count)` enqueues `count` work items through the existing serialized `enqueuePreviewWork` queue (`components/ImageDisplay.tsx`, `App.tsx`).
- **N spinner placeholders while batches run.** New `pendingRerunCount` state in `App.tsx` increments by `count` at click time and decrements in the per-item `finally` (so failures also clear the placeholder). The rail renders that many teal-bordered, animate-pulsed boxes between the last real version and the `+` button — users see the upcoming Marks immediately rather than one-at-a-time as they finish (`components/ImageDisplay.tsx`).
- **New "Add Marks" editor for Shift-click +.** A second prompt-editor mode (`promptEditorMode: 'refine' | 'rerun'`) opens on Shift-click — pre-filled with the tile's original prompt, fully editable, with a 1-9 segmented count picker. Submit button reads "Add N Marks" and routes to `onRerun(text, count)`. The existing refine editor (Refine bar, Analyze → fill, Edit Prompt button) keeps using the refine path with its own state (`components/ImageDisplay.tsx`).
- **Rich hover tooltip on `+`.** Portaled to `document.body` with `position: fixed` so the rail's `overflow-y-auto` can't clip it. Surfaces all four interaction modes (Click / 1-9 + Click / Shift + Click / 1-9 + Shift + Click) with `<kbd>` chips and a one-line description for each, anchored to the wrapper's rect captured on `onMouseEnter`/`onFocus`. Same dark-glass style as the existing prev/next-generation tooltips.
- **`Plus` and `Info` icons added to `WhatsNewPage` ICON_MAP** so the new entry's steps can render real glyphs.

### Changed

- **`+` icon no longer swaps to a spinner.** The button used to render `<RefreshCw>` when `isRefining` was true; with placeholder boxes now carrying the loading visual, swapping the icon was redundant and made the affordance look like a generating tile rather than a clickable target. The `+` always renders `<Plus>` now (`components/ImageDisplay.tsx`).
- **`+` prompt-source priority swapped.** Re-roll now prefers the tile's original `generation.config.prompt` over `version.refinementPrompt` (which is an incremental edit instruction like "make the title bigger" — not a useful standalone brief for a fresh generation).

## [0.19.0] - 2026-05-21

### Added

- **Per-row hamburger action menu on presets.** Every preset row in the toolbar Presets dropdown and the gallery preset menu now ends in a `⋯` button that opens a portaled side popover (`components/PresetActionPopover.tsx`) with Rename / Overwrite with current toolbar / Delete preset. Overwrite is disabled when the row already matches the toolbar; delete uses the existing double-tap confirm pattern. Replaces the always-visible trash icon and auto-appearing "Overwrite" row that made destructive actions one accidental click away when the user just meant to apply a preset.
- **Hover preview for preset parameters.** Hovering a preset row pops a portaled side panel (`components/PresetHoverPreview.tsx`) listing every saved parameter — Type, Style, Colors, Size, SVG mode, Model, Quality — resolved to human-readable names via a new `getPresetLabels` callback in `App.tsx` that joins preset ids against `graphicTypes` / `visualStyles` / `brandColors` / `aspectRatios` / `MODEL_NAME_BY_ID`. Lets the user vet a preset before applying it.
- **Per-folder gallery presets.** Each folder can keep its own preset list separate from the user's global presets. The gallery preset menu (`components/GalleryPresetMenu.tsx`) has a Global / This folder toggle at the top; saving while in folder mode persists to that folder only via `folderService.saveFolderPreset` / `updateFolderPreset` / `deleteFolderPreset`.
- **Rename support for presets.** New `handleRenamePreset` / `handleGalleryRenamePreset` in `App.tsx` reuse the existing `presetService.updatePreset` and `folderService.updateFolderPreset` partial-update paths, plumbed through `ControlPanel` and `RecentGenerations` as the new `onRenamePreset` / `onRenameGalleryPreset` props.
- **Search modal redesign with a much larger preview.** `components/SearchModal.tsx` was rebuilt: the results column is now a narrow fixed-width rail (`sm:w-80`) with compact rows + small thumbnails, and the right preview panel takes the remaining flex space — much bigger image (constrained to 55vh), and the metadata pane below it now lists every parameter that produced the active generation in addition to the prompt and full creation date. Modal max-width grows from `max-w-md` (no preview) to `max-w-5xl` once results exist.
- **Folder instructions toolbar button and per-tile download menu.** Carried over from the unreleased `6c74e18` commit: gallery toolbar now has a dedicated "Add/Edit folder instructions" button and tiles expose a download menu for individual images.

### Changed

- **Toolbar / gallery preset menus share extracted components.** `PresetActionPopover` and `PresetHoverPreview` are now the single source for the action popover and hover preview; both menus consume them so behavior stays in lockstep. `useConfirmAction` for preset delete moved out of `ControlPanel` and `GalleryPresetMenu` into the shared popover (`ControlPanel` still uses it for catalog deletes).
- **Portaled-satellite outside-click awareness.** Click-outside handlers in both menus now check `event.target.closest('[data-preset-popover]')` so the portaled action popover and hover preview (rendered into `document.body`) don't count as "outside" and don't close their parent menu.

### Fixed

- **Toolbar dropdowns no longer clipped by the collapsible options grid.** The inner wrapper of the toolbar grid in `components/ControlPanel.tsx` now uses `overflow-visible` while expanded and only flips to `overflow-hidden` during the brief collapsed-state animation, so absolute-positioned dropdown panels (Type / Style / Colors / Size / Model / Quality / Presets) can escape the grid box again.
- **Search modal had a tiny preview.** Old layout was `max-w-3xl` with a fixed `w-56` preview column; the new layout doubles available preview width and lets the image breathe.

## [0.18.0] - 2026-05-20

### Added

- **Nested folders with inherited instructions.** Folders can have `parentId` and optional `sortOrder` among siblings; `folderTreeUtils` builds the tree, sorts children, and merges instructions down the chain so subfolders inherit parent guidance unless they override it (`types.ts`, `services/folderService.ts`, `services/folderTreeUtils.ts`, `services/authService.ts`).
- **Collapsible folder picker.** The gallery header folder chip opens a portaled tree dropdown with expand/collapse chevrons, per-folder counts, inline rename, create-subfolder, and row action menus (`components/RecentGenerations.tsx`).
- **Folder drag-and-drop: reorder and nest.** Drag a folder to the top or bottom ~25% of another row to reorder siblings (`reorderFolder`); drop on the middle ~50% to nest inside (`moveFolder`). Teal border lines show insert-before/after; full-row highlight shows nest target. Subfolder shortcut cards in the gallery grid use the same handlers.
- **Folder and tile context menus.** Right-click a folder row (or the Folders header) for open, subfolder, instructions, rename, and delete. Right-click a gallery tile for open, compare, move-to-folder, copy prompt, and delete — same double-tap discipline as toolbar buttons (`components/RecentGenerations.tsx`).

### Changed

- **New generations save to the open gallery folder.** `galleryViewFolderId` drives which folder receives new tiles so switching folders before generating lands work in the right place (`App.tsx`, `services/historyService.ts`).
- **Portaled header menus.** Folder picker, row ⋮ menus, page-size popover, and bulk move menu render via `createPortal` to `document.body` with viewport-aware positioning (flip above the trigger when near the bottom) so scroll containers no longer clip them (`components/RecentGenerations.tsx`).

### Fixed

- **React hooks order in gallery and app shell.** Moved hooks above early returns in `RecentGenerations` (empty gallery) and extracted `ConfigurationErrorScreen` so Firebase config checks run after all hooks (`App.tsx`, `components/RecentGenerations.tsx`).
- **Toolbar dock flicker in focus mode.** IntersectionObserver-based docking with stable collapse thresholds (`App.tsx`).

## [0.17.0] - 2026-05-15

### Added

- **Fullscreen slideshow for the main preview.** A new "Play" control above the canvas opens a fullscreen viewer that walks through every version of the active generation, with `←` / `→` keyboard navigation, an on-screen progress dot row, and visible-but-fading prev/next chevrons. A 4-second idle timer (reset by any pointer or keyboard event) hides the cursor and chrome — chevrons, dot row, exit affordance — so the image fills the screen without UI noise; the next mouse move or key press brings everything back instantly. `Esc` exits. Same idle-hide treatment now applies to the regular main preview when the canvas has the user's attention, so quietly studying an image no longer leaves stray buttons floating over it (`components/ImageDisplay.tsx`).
- **Double-tap delete on the main image preview.** The trash button in the preview toolbar now arms on first click ("Click again to delete this version", with a `text-red-400` arming state and a small inline countdown) and only deletes the active version on the second click within ~3 seconds. Same pattern as the gallery tile delete, so muscle memory transfers between the two surfaces (`components/ImageDisplay.tsx`, `hooks/useConfirmAction.ts`).
- **Bulk delete from selection mode.** While in selection mode, the toolbar now exposes a destructive bulk-delete button next to "Move to folder". Same double-tap discipline as single-tile delete: first click arms (button turns red, label flips to "Click again to delete N"), second click within the confirm window calls `onDeleteSelected` which fans out to `executeDeleteHistory` per ID and exits selection mode on success. Lets users prune large batches in one pass instead of double-tapping each tile in sequence; matches the existing "Move to folder" affordance so the toolbar reads as a balanced pair (`components/RecentGenerations.tsx` + new bulk-delete arming state via `useConfirmAction<'delete-selected'>`).
- **Calmer selection-mode tile UI.** Tiles in selection mode used to render two competing affordances: a corner checkbox _and_ a centered "Select" / "Selected" pill on a permanent dim overlay. Pointing at any tile lit the whole grid in a sea of "Select" badges. Now the corner checkbox is the canonical visible affordance; the central pill and always-on dim are gone, replaced by a subtle `bg-black/0 hover:bg-black/20` hover wash so individual tiles still feel interactive without shouting their own state. The "Restore" pill on hover in normal mode is preserved unchanged (`components/RecentGenerations.tsx`).
- **Quieter, more functional header.** GitHub link moved from the right-side action cluster into the bottom of the user-menu dropdown alongside Settings / Sign Out, so it stops competing with primary actions for visual weight at the top of the screen. The remaining top-right buttons (search, tutorial, what's new, theme, account) got a unified circular pill treatment with consistent hover/focus states, and the title row collapses gracefully to icons on narrow widths so the bell + spotlight don't clip on phones (`components/Header.tsx`).
- **Smarter Gemini SVG fallback chain (Nano Banana Pro).** When the primary `gemini-3.1-pro-preview` text model returns `INVALID_ARGUMENT` for an account, the SVG generator now keeps walking the candidate list (Pro → Flash → Flash-latest → 2.5 / 2.0 family → 1.5 family) before surfacing a `SvgGenerationFailure`, instead of bailing on the first 4xx. Net effect: users whose Google project doesn't have the very newest preview model enabled silently land on the next best one and still get an SVG, with the per-model attempt log preserved in the error for cases where _every_ model truly is gated (`services/svgService.ts`).

### Changed

- **`/deploy` is now a first-class Cursor command.** `.cursor/commands/deploy.md` defines the full release pipeline end-to-end: read git history since the last tag, decide patch / minor / major from conventional-commit prefixes, conditionally author a What's New entry (with the hero image generated as an explicit, unskippable substep so 0.17 doesn't ship with a broken `<img>` again), bump `package.json`, run `check:no-native-selects` and `npm run build` as gates, update `CHANGELOG.md` and `README.md`, single conventional commit, push to `origin/main` to fire the Render auto-deploy, create a GitHub release whose body is the CHANGELOG section, conditionally deploy Firebase rules, then poll the Render deploy via MCP until `live` and report. Mirrors the shape of the working `vibeit.work` deploy command and replaces the previous one-line placeholder.
- **What's New skill explicitly owns hero-image generation and `ICON_MAP`.** `.cursor/skills/whats-new/SKILL.md` now states up front that the agent is responsible for generating the brand-matched 16:9 hero illustration (no asking the user, no broken-image placeholder), documents the prompt anchor and reference-image pattern that produced the existing v0.13–v0.16 covers, and clarifies that section icons in `data/whatsNew.ts` must exist in `components/WhatsNewPage.tsx`'s `ICON_MAP` allowlist — and that extending `ICON_MAP` with new Lucide imports is expected when an entry needs new symbols. This release exercised that path: `CheckSquare`, `Eye`, `EyeOff`, and `Trash2` were added so the 0.17 sections render real glyphs instead of the generic `HelpCircle` fallback (`components/WhatsNewPage.tsx`, `data/whatsNew.ts`, `.cursor/skills/whats-new/SKILL.md`).

## [0.16.1] - 2026-05-15

### Added

- **Bulk move-to-folder progress feedback.** Picking a destination folder during selection mode now surfaces an immediate, persistent indicator of what's happening: a sticky bottom-center banner with a `Loader2` spinner reading `Moving N items to <folder>…`, plus the affected tiles in the grid get `opacity-60 animate-pulse pointer-events-none` so users can see exactly which items are in flight and can't double-click them mid-operation. The banner stays up until the awaited `onMoveToFolder` resolves; on success the existing confirmation toast (`Moved N items to <folder>`) takes over, on error the failure toast surfaces and tiles return to normal so retries are obvious. Necessary because `historyService.moveGenerationsToFolder` writes tiles to Firestore one at a time — a 50-tile batch is roughly 50 sequential network round-trips, easily several seconds, and the gallery used to look frozen for the whole window. New `moveProgress: { ids: Set<string>; folderName: string; total: number } | null` state in `RecentGenerations`; the IDs are snapshotted at click-time so the dimmed set stays stable even if `selectedIds` mutates during the await (`components/RecentGenerations.tsx`).

### Fixed

- **What's New spotlight no longer flashes on reload for users who already dismissed it.** During Firebase auth restoration `user` is `null` for the first ~half-second, which used to make `useWhatsNew` fall back to empty guest `localStorage` state and render the spotlight modal until the listener fired. Threaded the existing `isAuthResolved` flag (already used to silence the BYOK setup-modal flash) into `useWhatsNew` as a new option; while `!isAuthResolved` the hook returns `unreadCount: 0` and `spotlightEntry: null` so the bell badge and modal stay quiet through the auth-restoration window. Default `true` keeps the hook usable in tests/storybook without wiring auth state through (`hooks/useWhatsNew.ts`, `App.tsx`).
- **Refinement-panel tooltips no longer show by default.** A Tailwind `group` class on an outer container was unintentionally activating every nested `group-hover:` selector, so the Recompose / Expand prompt / Run analysis tooltips were visible at all times. Renamed each button's `group` to a scoped variant (`group/recomposeBtn`, `group/expandBtn`, `group/analyzeBtn`) and updated their tooltip spans to use the matching `group-hover/<name>:` selectors so they only trigger on direct hover (`components/ImageDisplay.tsx`).
- **Info card on the main preview repositioned and self-tucking.** The info overlay moved from `left-4 bottom-4` to `right-4 bottom-4` so it sits in the corner where users expect contextual cards, and the toggle `ActionButton` is now wrapped with `{!infoVisible && (...)}` so it disappears when the card is open — the card's own close `X` is the canonical exit (`components/ImageDisplay.tsx`).
- **Gemini SVG generation surfaces a real diagnosis instead of "API key not valid."** Three layered fixes: (1) `services/correctionAnalysisRouter.ts` now strictly validates per-provider key shapes (`isLikelyGoogleApiKey` requires `^AIza[A-Za-z0-9_-]+$` and 30–60 chars; `isLikelyOpenAIKey` enforces 20–256 chars on a known prefix) so a corrupted value pasted into a per-model override slot is rejected at resolution time and the system falls back to the shared key. (2) `services/svgService.ts`'s `getAiClient` checks `looksLikeGeminiKey` upfront and throws a labeled, actionable error before any network request — so a malformed key never reaches Google. (3) The single hardcoded `SVG_MODEL` is now an ordered `SVG_MODEL_CANDIDATES` chain (`gemini-3.1-pro-preview` → `gemini-2.5-pro` → `gemini-pro-latest` → `gemini-flash-latest` → `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-pro` → `gemini-1.5-flash`); image-preview models are deliberately excluded because they require IMAGE response modality, not TEXT. A new `SvgGenerationFailure` error class records a key fingerprint plus per-model attempt details, and `wrapSvgError` translates it into a self-service message that names every model that failed and points to AI Studio for project-level enablement.
- **Model selector no longer snaps back to GPT Image 2 after picking Gemini SVG.** A `useEffect` in `ImageDisplay` was firing `onModelChange` whenever the active generation or version object changed identity, including on harmless re-renders of the same item, which clobbered the toolbar's model state. The effect's dependency now keys on the active generation/version `id` instead of the object reference so it only fires on a real selection change (`components/ImageDisplay.tsx`).
- **Per-model API key clears actually persist.** `SettingsPage` previously wrote directly to Firestore via `authService.updateUserPreferences` and then asked the parent `App.tsx` to write again with stale state, which silently reverted clears. The component now routes every save and per-model clear through the parent's `onSave` callback (single source of truth), and the prop type was widened to `void | Promise<void>` so the await is real (`components/SettingsPage.tsx`).

### Internal

- **Extracted Gemini text-model fallback helper.** New `services/geminiTextModelService.ts` exports `GEMINI_TEXT_MODEL_FALLBACKS` (`gemini-flash-latest` → `2.5-flash` → `2.0-flash`) plus shared `stringifyGeminiCallError` / `formatUserFacingGeminiError` helpers so analysis, prompt-expand, and SVG callsites all retry the same way and format errors the same way without duplicating the chain.

## [0.16.0] - 2026-05-12

### Added

- **What's New authoring tooling + deploy gate.** New `scripts/whats-new.mjs` exposes two zero-dependency subcommands (`add` for interactive scaffolding, `check` for validation), wired through three npm scripts: `npm run whats-new` (scaffold), `npm run whats-new:check` (validate), and `prebuild` (auto-run on every `npm run build`). The gate compares `package.json`'s `major.minor` against every `version: '...'` entry in `data/whatsNew.ts` and fails the build with an actionable error when a feature release (minor or major bump) has no matching entry — so Render can't ship a new feature without an in-app announcement. Patch releases pass automatically because the parent minor entry covers `x.y.*`. Escape hatch: `SKIP_WHATS_NEW_CHECK=1` for genuine one-offs (hotfix on an old branch). The scaffolder prompts for version, title, summary, blurb, slug, image path, featured flag, and optional instructional sections / steps, refuses to clobber an existing version, inserts the new entry at the top of the array (newest-first convention), and prints next-step guidance. Authoring conventions, field rules, image guidelines, deploy-gate semantics, and a verify checklist live in the new Cursor skill at `.cursor/skills/whats-new/SKILL.md`, so future agent sessions pick up the workflow automatically. OpenSpec proposal at `openspec/changes/add-whats-new-tooling/`.
- **What's New: bell + spotlight + per-release guide pages.** Header gains a `Bell` icon with an unread-count badge (`components/WhatsNewBell.tsx`). The dropdown now uses a 16:9 hero thumbnail per row, a one-sentence `summary` (no more multi-paragraph blurb), and each row is a clickable button that opens the new per-release detail view. Entries marked `featured: true` auto-fire a one-time spotlight modal on first visit (`components/WhatsNewSpotlight.tsx`); the spotlight's primary CTA is now "Read the guide →" which dismisses + lands on that entry's detail page, with "Got it" as the secondary dismiss-only action. The full-page discovery view (`components/WhatsNewPage.tsx`) renders two layouts driven by a `selectedEntryId` prop: a list view with a hero card for the latest release + image-top grid of earlier updates (every card clickable), and a detail view for one release that pairs the hero illustration with a step-by-step walkthrough — each section has a heading, optional body, and a numbered list of steps that can carry icon pills (resolved through a Lucide allowlist with a help-glyph fallback) or keyboard-shortcut chips (split on `+`). Content is curated in `data/whatsNew.ts`, now including new `summary` and `sections` fields per entry, with structured `WhatsNewSection` / `WhatsNewStep` types added to `types.ts`. Each entry ships a brand-palette hero illustration in `public/whats-new/`. Per-user state (`lastSeenWhatsNewId`, `dismissedSpotlightIds`) persists to `UserPreferences` for signed-in users and `localStorage` under `brandoit_whats_new_v1` for guests. `?whatsnew=<id>` deep links open the bell scrolled to that entry. New `useWhatsNew` hook, extensions to `sanitizePreferences` / `hydratePreferences` in `services/authService.ts`, and a `whatsNewMode` + `whatsNewEntryId` route pair in `App.tsx` so the bell rows, spotlight CTA, and discovery cards all route through a single `openWhatsNewPage(entryId?)` helper. OpenSpec proposal at `openspec/changes/add-whats-new/`.

## [0.15.1] - 2026-05-12

### Fixed

- **Production blank page after the 0.15.0 deploy.** The Rollup `manualChunks` config in 0.15.0 split Firebase into per-service chunks (`vendor-firebase-app`, `vendor-firebase-shared`, `vendor-firebase-firestore`, `vendor-firebase-auth`, `vendor-firebase-storage`, `vendor-firebase-analytics`). Firebase ships a tightly cyclic module graph (`firebase/app` ↔ `@firebase/util` ↔ per-service packages); splitting them across chunks reordered evaluation and tripped a temporal-dead-zone error at `vendor-firebase-app:61` — `Uncaught ReferenceError: Cannot access 'g' before initialization` — which left the page blank. All `firebase/*` and `@firebase/*` modules now share a single `vendor-firebase` chunk so the cyclic graph is preserved. The other vendor splits (`vendor-react`, `vendor-ai`, `vendor-icons`, `vendor-zip`) and `React.lazy` page splits from 0.15.0 are unchanged (`vite.config.ts`).

## [0.15.0] - 2026-05-12

### Added

- **Drop an image into the prompt box for style or content.** Dragging an image onto the prompt textarea opens a small dialog with two paths: **Generate content prompt** uses vision to write a content-only prompt fragment that respects the toolbar menus (no layout/style/palette/aspect-ratio noise), and **Use image style** captures the image as a style reference with two influence modes — _image overrides menu style_ or _menus override image style_. The active reference shows as a removable chip near the prompt and is consumed by the next generation; Gemini image models receive the image directly via `generateGraphicWithStyleReference`, while OpenAI and SVG models get the equivalent textual style instructions in `requestConfig`. New `PromptImageStyleReference` / `PromptImageStyleInfluenceMode` types (`components/ControlPanel.tsx`, `App.tsx`, `services/geminiService.ts`, `types.ts`).
- **Multi-prompt batches via JSON array.** The prompt box now also accepts `["tile 1", "tile {a,b}", "tile 3"]` — each top-level array entry generates as its own tile, and brace expansion still applies inside each entry. `expandPromptPermutations` returns a `promptEntries` map so the batch runner routes each expansion to the right `sharedBatchGenerations[i]` slot, and the toolbar batch-info / cap message reflects the prompt-list count alongside model and brace permutations (`services/promptExpansionService.ts`, `App.tsx`, `components/ControlPanel.tsx`).

### Changed

- **Code-split the bundle for faster first paint.** `App.tsx` now lazy-loads `AdminPage`, `SettingsPage`, `CatalogPage`, `SearchModal`, `AuthModal`, and `BrandAnalysisModal` behind `Suspense` with shared `LazyPageFallback` / `LazyModalFallback` spinners. `vite.config.ts` adds Rollup `manualChunks` to split vendors into `vendor-react`, `vendor-ai`, `vendor-icons`, `vendor-zip`, and per-Firebase-service chunks (`vendor-firebase-firestore` / `auth` / `storage` / `analytics` / `app` / `shared`). Drops the main `index.js` from one ~700 KB chunk to ~340 KB and clears the Vite 500 KB chunk warning.
- **Shorter prompt placeholder.** Reads `Prompt or drop image ({a,b} or ["tile 1","tile 2"])...` so it fits the input at narrow widths without truncating (`components/ControlPanel.tsx`).

### Fixed

- **Dropped-image style/content analysis no longer dies on Google `API_KEY_INVALID`.** When Google rejects the configured Gemini key for Flash text/vision (a known project-enablement edge case where the same key still works for `gemini-3-pro-image-preview`), the prompt-image analyses now fall back to the existing OpenAI `gpt-4o-mini` vision path via `resolveAuxiliaryByokProvider` — same routing as **Run analysis** and **Expand prompt**. New `analyzeImageStyleOpenAI` and `describeImageContentPromptOpenAI` mirror the Gemini surface (`services/openaiService.ts`, `components/ControlPanel.tsx`).
- **Gemini Flash analyzers now retry across the model fallback list.** `analyzeImageForOption`, `describeImagePrompt`, and `describeImageContentPrompt` retry through `gemini-flash-latest → gemini-2.5-flash → gemini-2.0-flash` (matching `analyzeImageForCorrectionPrompt`) so spurious enablement errors on a single model id don't fail the whole call (`services/geminiService.ts`).
- **Consistent Gemini analysis BYOK resolution.** New `getGeminiApiKeyForAnalysis(user)` helper centralizes the Flash-key lookup (shared `apiKeys.gemini` → `gemini-svg`-only setups → legacy `geminiApiKey`, with BOM/whitespace normalization) so the prompt-drop flow and `processOptionFile` resolve the same key the toolbar uses (`services/correctionAnalysisRouter.ts`, `components/ControlPanel.tsx`).
- **Quieter VPN/proxy upload errors.** `uploadGenerationImage` detects network-block failures (`storage/retry-limit-exceeded`, `ERR_NAME_NOT_RESOLVED`, `Failed to fetch`, etc.) and emits a clearly labeled `[Storage unreachable]` warning with a hint about VPN and a pointer to `CLAUDE.md`, instead of a misleading red `console.error`. The IndexedDB cache contract (seed before upload) is unchanged, so images keep displaying via the existing `onError` recovery in `RecentGenerations.tsx` and `ImageDisplay.tsx` (`services/imageService.ts`).

### Removed

- **"Reset defaults" toolbar button.** The eraser/rotate icon next to the model selector and its associated `onResetToDefaults` prop are gone — settings still reset via the Settings page (`components/ControlPanel.tsx`, `App.tsx`).
- **Header "Styles" / "Colors" navigation links.** The compact catalog shortcuts in the page header were duplicating affordances that already live inside the control panel and modals; `Palette` / `PenTool` icon imports cleaned up alongside (`App.tsx`).

## [0.14.0] - 2026-05-08

### Added

- **Cmd+K / Ctrl+K generation search.** Command palette modal to find recent tiles by prompt substring, with thumbnail preview, arrow-key navigation, Enter to open, and Escape to close; wired from the header search control (`components/SearchModal.tsx`, `App.tsx`).
- **Claude Code `launch.json`** for starting the Vite dev server from the editor (`.claude/launch.json`).
- **`CLAUDE.md`** contributor notes for the VPN / Firebase Storage image flow and the IndexedDB cache invariant (seed before upload in `serializeGenerationForRemote`).

### Changed

- **`.gitignore`** ignores `.claude/worktrees/` so local Claude Code worktree state is not committed.

## [0.13.2] - 2026-05-08

### Fixed

- **IndexedDB cache ordering when Firebase Storage fails.** `serializeGenerationForRemote` now calls `cacheImageFromBase64` **before** `uploadGenerationImage`. If the upload throws (for example when `firebasestorage.googleapis.com` is blocked on VPN), the image is still written to the local blob cache so thumbnails and the main viewer can recover on the next load (`services/historyService.ts`).

## [0.13.1] - 2026-05-06

### Fixed

- **Gemini image generation and `API_KEY_INVALID`.** User preferences now **trim API keys on save**, normalize resolved keys (trim + strip BOM), **hydrate** Firestore data by dropping empty `apiKeys` entries and **merging legacy `geminiApiKey`** into the shared `gemini` slot when that slot is missing. **Settings** merges **`apiKeys` first**, then fills the Gemini field from legacy only when the stored slot is empty, so an empty `gemini` entry no longer hides a valid legacy key in the UI (`services/authService.ts`, `components/SettingsPage.tsx`).
- **Nano Banana Pro key fallback.** When **Nano Banana Pro** is selected but only a **Nano Banana 2** per-model override exists under Advanced overrides, image generation uses that key—the same Google account/project as other Gemini image models (`services/correctionAnalysisRouter.ts`).
- **Clearer generation errors.** `generateGraphic` shows a short, actionable message when Google rejects the API key instead of surfacing a large JSON error blob (`services/geminiService.ts`).

## [0.13.0] - 2026-05-06

### Added

- **Auxiliary BYOK routing for Run analysis and Expand prompt.** New `resolveAuxiliaryByokProvider` and `getApiKeyForModelFromUser` (`services/correctionAnalysisRouter.ts`) pick **OpenAI** vs **Gemini** the same way: prefer the toolbar’s provider when that key exists, otherwise fall back to whichever key is configured. Toolbar **Expand prompt** (`components/ControlPanel.tsx`) and refine-bar **Expand prompt** (`App.tsx`) both use this routing.
- **OpenAI paths for analysis and expansion.** **Run analysis** can use **`gpt-4o-mini`** Chat Completions with vision + JSON (`analyzeImageForCorrectionPromptOpenAI` in `services/openaiService.ts`). **Expand prompt** uses **`gpt-4o-mini`** text chat (`expandPromptOpenAI`). Shared instruction text lives in `services/correctionAnalysisShared.ts` (`buildCorrectionAuditUserPrompt`, `buildExpandPromptInstructions`).
- **Full-screen refine prompt modal** with backdrop click and **Escape** to close, optional hint for keyboard submit; **Run analysis** auto-opens the modal when a correction plan is ready; **Open full editor** link plus compact inline strip (`components/ImageDisplay.tsx`).

### Changed

- **Gemini Run analysis** reuses shared audit prompts and tries Flash fallbacks (`gemini-flash-latest` → `gemini-2.5-flash` → `gemini-2.0-flash`) when Google returns misleading enablement errors (`services/geminiService.ts`).
- **Refine bar** inline prompt field restored to a **short single-row** height; long prompts are read/edited in the modal.

### Fixed

- **Run analysis / Expand prompt** no longer fail for **GPT Image** users who only configured an **OpenAI** key (previously calls always went through Gemini-only key slots).
- **API keys** trimmed consistently when resolved from preferences (avoids stray whitespace breaking Gemini calls).
- **Per-model Gemini overrides** vs shared `gemini` slot: auxiliary flows align with the active model’s resolved key where applicable.

## [0.12.0] - 2026-05-06

### Added

- **Overwrite saved toolbar presets from the live toolbar.** Bookmark presets can be updated in place with a full-width **Overwrite with current toolbar** action (loading/success feedback). The affordance appears only when the current toolbar differs from that preset’s snapshot; legacy presets without an explicit OpenAI quality value normalize to **auto** so comparisons stay accurate (`components/ControlPanel.tsx`, `App.tsx`, `services/presetService.ts`).

### Changed

- **Gemini text/analysis uses `gemini-flash-latest`.** Brand analysis, correction analysis, prompt expansion, and image-description calls now use Google’s rolling Flash alias instead of a pinned model id, avoiding spurious `400 / API_KEY_INVALID` responses when a project enables Flash under a different version id (`services/geminiService.ts`, `README.md`, `agents.md`).

### Fixed

- **Personal Settings defaults no longer overwritten by everyday toolbar use.** Firestore `preferences.settings` default fields (graphic type, visual style, color palette, **aspect ratio**) are seeded only once when unset; subsequent toolbar changes no longer sync back into those saved defaults. Fixes the case where choosing Square on the toolbar for a one-off generation replaced a saved Widescreen default (`App.tsx`).
- **Marks rail on single-version generations.** The left thumbnail rail (including **Add a new Mark**) renders whenever a generation has at least one version so fresh results stay iterable without hunting for the refine bar; layout uses a consistent max width with or without multiple marks (`components/ImageDisplay.tsx`).
- **Compare discoverability.** The shift-click compare hint flashes only when the tile has more than one mark; the rail’s Compare control stays gated on multiple marks (`components/ImageDisplay.tsx`).

## [0.11.0] - 2026-05-04
### Added
- **Focus mode for the main preview.** When a generation is loaded into the main viewer, the entire toolbar options row (Type / Style / Colors / Size / Model) **and** the prompt input collapse together so the image gets the full vertical real estate. A new `Minimize2` / `Maximize2` button in the page header pins the choice manually, the toolbar auto-collapses on every scroll-down past a tiny 16px threshold (and only restores when the user comes back to the top), and selecting a new generation tile auto-collapses the toolbar by id so even an image that fits inside the viewport without scrolling triggers the focus mode. Auto-collapse is suppressed while any `<input>` / `<textarea>` / `contenteditable` element is focused so the toolbar can't yank itself away mid-keystroke. Persistent `<button>` for the toggle in the header is hidden in admin / settings / catalog modes where the toolbar isn't mounted (`App.tsx`, `components/ControlPanel.tsx`).
- **Mark dropdown moved inside the large image preview.** The version selector now lives as a small in-image chip (`Layers` icon + Roman numeral + `ChevronDown`) at `top-4 left-4`, hidden by default and revealed on hover/focus over the preview area. Hovering the chip exposes a rich popover with current/total count, the full label, the refinement prompt (when present), and a "Click to switch versions" hint. The dropdown menu itself was tightened: removed the redundant "Original" / "Refinement" type label, replaced with a small amber dot next to refinement entries, restored the full "Mark I" wording, and pulled the delete affordance closer to the label so spacing reads as one row instead of three columns (`components/ImageDisplay.tsx`).
- **All preview chrome auto-hides until you hover the image.** Action buttons (compare / refine / download / info), the version chip, the carousel arrows, the position counter, and the compare overlay now use `opacity-0` at rest and `group-hover:opacity-100` / `group-focus-within:opacity-100` against the preview row, on every screen size. Rolling onto the image surfaces all chrome at once; rolling off lets the image speak for itself. The thumbnail rail now also docks to invisible (still occupying its 124px slot in layout so the image doesn't reflow) and reveals on the same hover; in compare-pick / comparing mode the rail stays at full opacity so the user can drive the two-mark flow without babysitting the image (`components/ImageDisplay.tsx`).
- **One-click "Add a new Mark" on the rail.** The `+` slot at the bottom of the thumbnail rail now re-runs the last prompt through the refinement pipeline instead of opening the prompt editor — `Shift-click` keeps the editor for users who want to tweak. The button glyph swaps to a spinning `RefreshCw` while a refinement is in flight, and the tooltip / `aria-label` reflect the new behavior. The prompt source falls back through `version.refinementPrompt` → `generation.config.prompt` (`components/ImageDisplay.tsx`).
- **Compare section docks.** The "pick two marks" picker banner and the "Comparing Mark I vs Mark II" header are now rendered as a single absolutely-positioned overlay inside the image card and follow the same hover-reveal rule as the rest of the chrome. Labels were shortened to just `Mark I vs Mark II` so they don't crowd the image; the full `<model> · Mark I` text remains available via the `title` tooltip. While the comparison slider is being dragged the overlay (and every other piece of chrome — rail, version chip, action buttons, carousel arrows, position counter) hides via a `data-dragging` attribute on the row and `group-data-[dragging=true]:!opacity-0` rules, so the user has a clean two-image surface while scrubbing the divider, then everything fades back in on `pointerup` (`components/ImageDisplay.tsx`, `components/JuxtaposeSlider.tsx`).
- **Rich tooltips on the carousel arrows.** Hovering either ←/→ generation-step arrow now exposes a side-anchored popover that explains the keyboard shortcuts: `←` / `→` cycle generations, `↑` / `↓` cycle Marks within the current generation (only shown when more than one Mark exists). Helps surface the keyboard navigation without an onboarding tour (`components/ImageDisplay.tsx`).
- **Folder picker consolidated into a single dropdown.** Replaced the chip-strip + per-folder kebab UI in `RecentGenerations` with a compact dropdown trigger that combines the current folder's name and item count. The menu lists every folder with inline pin/rename/delete affordances and a `+ New folder` action at the bottom. Last-viewed folder persists to `localStorage` under `recentGenerations.viewFolderId`, so the gallery returns to where the user left off instead of always defaulting to Inbox. The redundant "(N items in folder)" header subtitle is gone now that the dropdown trigger surfaces the same information (`components/RecentGenerations.tsx`).
- **`triggerLabelClassName` on `RichSelect`.** Lets callers responsively hide the trigger label so the trigger collapses to icon + chevron at narrow widths while still showing text once there's room (`components/RichSelect.tsx`).
- **`triggerTooltip` on `DownloadMenu`.** Optional styled tooltip pill (matches the rest of the app's `bg-black/90` style) shown below the trigger on hover/focus; suppresses the native browser `title` so the two don't double up (`components/DownloadMenu.tsx`).

### Changed
- **`X-Small` → `Tiny` in the gallery size selector.** The compact `RichSelect` trigger is `w-28 xl:w-32`, which the hyphenated `X-Small` couldn't fit without wrapping to two lines at narrow widths. The menu item still carries the longer "X-Small — most thumbnails per row" description so meaning stays obvious (`components/RecentGenerations.tsx`).
- **Left carousel arrow repositioned past the rail's footprint.** The `←` arrow used to sit at `left-3` of the image card but now would render behind the absolutely-positioned 124px-wide rail in compare-pick / comparing mode. It now anchors at `left-[136px]` (124px rail + 12px gap) so it stays reachable in every mode (`components/ImageDisplay.tsx`).
- **Toolbar / prompt collapse animation.** `ControlPanel` now wraps the options row and the prompt input in independent `max-h-0 opacity-0 overflow-hidden` containers driven by the new `isOptionsCollapsed` prop, with a small negative-margin trick so the row above doesn't leave a gap when collapsed. The outer sticky bar's vertical padding goes from `p-4` to `px-4 py-0` while collapsed so the bar shrinks to a sliver. Any open dropdowns auto-close when the toolbar collapses to avoid orphaned popovers (`components/ControlPanel.tsx`).
- **Preferences sync now writes the full `preferences` map.** `authService.updateUserPreferences` fully replaces the `preferences` document in Firestore. The previous code passed a hand-picked subset (`geminiApiKey`, `apiKeys`, `selectedModel`, `systemPrompt`, `settings`) on every render-driven sync, which silently clobbered `presets`, `folders`, `activeFolderId`, and any other field that wasn't in the subset — so a saved preset or a freshly-created folder would vanish on the next page load. We now pass the entire `user.preferences` object through and rely on `sanitizePreferences` (already in the service) to strip non-serializable bits before write (`App.tsx`).

### Fixed
- **Hover preview popup no longer gets cropped behind the page header.** The rail's hover preview was `position: absolute` at `z-30` inside the rail wrapper; the page header sits at `z-50`, so whenever the rail's parent row landed near the top of the viewport the image portion of the popup was painted over by the header. Switched the popup to `position: fixed` at `z-[60]` and rewrote its anchor logic to compute viewport coordinates from the hovered thumbnail's `getBoundingClientRect`, then clamp `top` to `[8px, window.innerHeight − previewHeight − 8px]` so the entire card always stays on-screen no matter where the rail sits in the page or how big the preview is. Replaced the `popoverTop` (number) state with `popoverPos: { top, left }` (`components/ImageDisplay.tsx`).

## [0.10.0] - 2026-05-04
### Added
- **Active Generations panel docks to a pill.** The floating top-right monitor that surfaces every running batch now has a Minimize button in its header that collapses it to a small badge showing a spinner plus an aggregate "X running · Y queued" label. Clicking the badge re-expands the full panel. Every new Generate click auto-expands the panel again so progress is visible by default for the run the user just kicked off; they can dock it again whenever it's covering the main preview. Aggregate in-flight / queued counts are derived across all `activeGenerationJobs` so the badge stays accurate even when multiple batches are running simultaneously (`App.tsx`).
- **Queued count visible inside each batch row.** The runner's `BatchProgress` only emits the in-flight set, so a 3-image batch with `DEFAULT_BATCH_CONCURRENCY = 2` looked like only 2 generations were happening — the third was invisible until a worker freed up. Each batch row in the panel now derives `queued = total - completed - failed - inFlight` and renders a small italic "N queued" line below the in-flight prompts (and the panel header surfaces the aggregate "X running · Y queued" label) so users can see the full pipeline at a glance (`App.tsx`).
- **"Generating…" placeholder on the main viewer.** `ImageDisplay`'s empty state now branches on `isRefining`: while a fresh batch is starting and no first result has come back yet, the viewer renders a centered spinner card with "Generating…" / "Your first result will land here as soon as the model responds." copy. The original "Ready to Create" placeholder is unchanged for true first-run users (`components/ImageDisplay.tsx`).

### Changed
- **Main preview clears the moment a new generation starts.** `handleGenerate` now calls `setCurrentGeneration(null)` and resets the docked panel state at the very top of the function, so the previous result vanishes the instant the user clicks Generate instead of lingering on screen for several seconds while the first API call resolves. The render guard for `<ImageDisplay>` was widened to `currentGeneration || hasRunningGenerationJobs || history.length === 0` so the viewer stays mounted across the gap and the new "Generating…" placeholder takes over without unmounting and reflowing the gallery (`App.tsx`).

### Fixed
- **Auth modal no longer sits behind the Quick Start setup modal.** The "Quick Start" panel that appears for users with no account / no API key is rendered at `z-[140]`, while `AuthModal` is at `z-[100]`. Clicking Log In or Create Free Account from the setup modal — or from the header buttons while the setup modal was visible — left the setup panel floating on top of the auth form and made it look like the login screen wasn't reachable. `openAuthModal` now flips `setIsSetupModalOpen(false)` whenever it opens the auth modal, and the header's inline `setAuthModalMode` / `setIsAuthModalOpen` calls were rerouted through `openAuthModal` so the same dismissal happens from every entry point (`App.tsx`).

## [0.9.0] - 2026-05-04
### Added
- **Admins load their full unbounded generation history.** Pre-0.9.0 the gallery was capped at the most-recent 20 tiles for everyone, even admin accounts (which already kept *all* their docs in Firestore via the 0.8.0 unbounded-write change). `historyService.getFromRemote` now branches on `isAdmin`: admins page through Firestore in 200-doc batches with `orderBy('createdAt', 'desc') + startAfter(lastDoc)` until the collection is exhausted, and `historyService.getHistory` skips the `Math.max(REMOTE_LIMIT, LOCAL_LIMIT)` slice so the merged list isn't truncated. The per-user `brandoit_remote_history_cache_v1` localStorage mirror grows with the admin (capped at `ADMIN_REMOTE_CACHE_LIMIT = 2000`) and `historyService.updateRemote` / `deleteFromRemote` now resolve the target Firestore doc by `where('id', '==', genId)` first — both edits and deletes work correctly even when an admin has hundreds of older docs that fall outside the recent-scan window. `App.tsx` threads `user.isAdmin === true` into `deleteFromRemote` (`services/historyService.ts`, `App.tsx`).
- **Gallery pagination for large folders.** When a folder grows past 50 tiles, `RecentGenerations` now renders a pagination bar above the grid with prev/next buttons, an "Items X–Y of N" indicator in the gallery header, and a `RichSelect` page-size dropdown (25 / 50 / 100 / 200) that persists to `localStorage` under `recentGenerations.galleryPageSize`. The bar stays hidden for folders ≤ 50 tiles so the toolbar isn't cluttered for small folders. Folder counts on the tab strip, "Select all", and "Download all" still operate on the **full** folder rather than the visible page so bulk actions never silently drop tiles. Page resets to 1 when the user switches folders or changes page size (`components/RecentGenerations.tsx`).
- **`↑` / `↓` keyboard shortcuts cycle Marks on the current tile.** Same window-level focus guards as the existing `←` / `→` carousel: `↓` advances `currentVersionIndex` by one and wraps last → first, `↑` goes the other direction. Disabled while comparing or in compare-pick mode, and ignored while the user is typing in an input/textarea/contenteditable so navigation never fires mid-prompt (`components/ImageDisplay.tsx`).
- **Carousel arrows snap to the latest Mark.** `goNewer` / `goOlder` (the prev/next generation arrows on the main viewer + the `←` / `→` keyboard shortcuts) now override `currentVersionIndex` to `versions.length - 1` before calling `onNavigateToGeneration`. Browsing through history with the arrows now lands on each generation's most-recent refinement instead of whatever index was last persisted on the doc (often Mark I), which is far more useful when scrubbing a chain. Clicking a tile in the gallery still respects the stored index so deep-links and in-progress refinements aren't reset (`components/ImageDisplay.tsx`).

## [0.8.1] - 2026-05-02
### Fixed
- **Folder count badge sits true-center inside its pill.** The `(N)` badge next to each folder chip in `RecentGenerations` was rendering with `text-[10px]` inside an `h-5` (20px) circle using the default `leading-normal` (~1.5), which produced a 15px line box that flex-centered the line — but not the actual glyph — leaving multi-digit counts like `20` reading as slightly low. Added `leading-none` so the line box equals the font size and `tabular-nums` so digits stay even-width as the count grows or shrinks (`components/RecentGenerations.tsx`).

## [0.8.0] - 2026-05-02
### Added
- **Folders for the Recent Generations gallery.** Tiles can now be grouped into named folders. The gallery shows a folder tab strip above the grid (each chip displays a count and is filterable), every user gets an auto-seeded `Inbox` (renameable, undeletable), and a "New folder" chip on the strip starts an inline creation flow. Each folder chip exposes a pin toggle that controls which folder is the **sticky default** for new generations — with no pin, new tiles fall back to Inbox. The strip's kebab menu offers Rename and Delete (Inbox hides Delete); deleting a folder sweeps every tile inside it into Inbox before removing the folder so nothing is ever stranded. The selection-mode toolbar gets a "Move to folder" picker for bulk reassignment. Folders persist on the user document under `preferences.folders` / `preferences.activeFolderId` for signed-in users and in `localStorage` for guests, so the gallery looks the same before and after sign-in. Every `Generation` carries a `folderId`; legacy items without one are normalized into Inbox at read time. New `services/folderService.ts`, `Folder` interface, and `INBOX_FOLDER_ID` constant in `types.ts`. `historyService.moveGenerationsToFolder` is the durable bulk-write path used by both selection-mode moves and folder deletion (`App.tsx`, `components/RecentGenerations.tsx`, `services/folderService.ts`, `services/historyService.ts`, `services/authService.ts`, `types.ts`).
- **Toolbar presets.** Save the current toolbar configuration — graphic type, visual style, color scheme, aspect ratio, SVG mode, model, OpenAI image quality — as a named preset and recall it from the new `Bookmark` dropdown in `ControlPanel`. Save uses an inline "name your preset" field rather than a modal, with a duplicate-name guard and a default suggested name (`Preset N+1`) so the common case is zero-friction. Applying a preset uses **partial-snapshot semantics**: only the fields the preset actually carries are overridden, so users can save narrow snapshots (e.g. "just my favorite style + palette pair") that compose with the rest of the toolbar. Aspect ratios are coerced through `getSafeAspectRatioForModel` when a preset switches models, so an Instagram-square preset never strands a Gemini-only model on an unsupported ratio. Presets persist on the user document under `preferences.presets`. Guests don't see the save affordance (presets are signed-in-only); the dropdown still lists existing presets so a one-time guest can apply something the user saved earlier. New `services/presetService.ts` and `ToolbarPreset` interface in `types.ts` (`App.tsx`, `components/ControlPanel.tsx`, `services/presetService.ts`, `services/authService.ts`, `types.ts`).
- **Per-user stats drill-down.** New `statsService.getUserStats(uid)` builds a focused single-user snapshot (profile card, total tiles / images / refinements, daily timeline for the last 30 days, top buckets by model / graphic type / visual style / aspect ratio) by scanning only that user's `users/{uid}/history` subcollection — cheap regardless of project size, gated behind the same admin-only Firestore rule as the dashboard. The `StatsPage` adds a `FocusedUserView` that mirrors the global dashboard's layout, plus a back arrow to return to the all-users view. Avatars use the existing `CachedImage` component so profile photos survive VPN blocks (`components/StatsPage.tsx`, `services/statsService.ts`).
- **Multi-line prompt input that grows on focus.** The prompt field is now a `<textarea>` with `min-h-[48px] focus:h-32 resize-y`, so longer prompts no longer scroll horizontally inside a single-row input. `Enter` still submits; `Shift+Enter` inserts a newline. The keyboard shortcuts that ignore inputs/textareas/contenteditables already cover this so navigation arrows still won't fire mid-typing (`components/ControlPanel.tsx`).

### Changed
- **Admins keep an unbounded history.** `historyService.saveToRemote`, `historyService.updateRemote`, `historyService.mergeLocalToRemote`, and `historyService.updateGeneration` now thread an `isAdmin` flag through to the eviction sweep. Admin accounts skip the `REMOTE_LIMIT` cull entirely and use a wider `REMOTE_SCAN_LIMIT` (≥500) when looking up existing tiles, so legacy / audit assets are never evicted just because an admin blew past the regular cap. Regular accounts continue to enforce the existing limit unchanged. `App.tsx` passes `user.isAdmin === true` everywhere it triggers a remote write (`services/historyService.ts`, `App.tsx`).

### Fixed
- **Toolbar no longer wraps to a second row at desktop widths.** The new Presets dropdown nudged the toolbar past its desktop-width budget, leaving the Reset / Upload actions stranded on a second row at `lg`+ (and visually disconnecting them from the model row). The toolbar container is now `flex flex-wrap lg:flex-nowrap … w-full lg:min-w-0`, and `DropdownButton` is `shrink-0 lg:shrink lg:min-w-0`. At desktop widths the toolbar forces a single row and dropdown labels truncate gracefully when space is tight; below `lg` we keep `flex-wrap` so the strip wraps to multiple rows instead of producing a horizontal scrollbar that would clip dropdown menus (`components/ControlPanel.tsx`).
- **Admin row-actions kebab no longer disappears under the next row's sticky column.** The right-most actions column on the admin user table uses a `sticky right-0` background so the kebab stays visible while the table scrolls horizontally, but the kebab popover painted *under* the next row's sticky background because the cell had no z-context. The cell now lifts to `z-30` while its menu is open so dropdown items remain readable across rows (`components/AdminPage.tsx`).
- **"Build Brand Analysis" no longer fails behind a VPN.** Post-0.6.0 the saved version usually has `imageData=''` because raster bytes live in Firebase Storage. When the network can't reach `firebasestorage.googleapis.com` (VPN, captive portal, transient DNS), the analysis service's plain `fetch(imageUrl)` threw "Failed to fetch" and the action looked broken. `App.handleBrandAnalysis` now consults the IndexedDB image cache (populated at upload time) as a fallback before sending the image to the analyzer; the original network fetch remains as a last resort (`App.tsx`).
- **Generation thumbnails survive VPN / proxy blocks.** When `firebasestorage.googleapis.com` is blocked but Firestore docs come through, generation tiles and the main viewer used to fall back to a broken-image icon because `imageData` was stripped at upload time. New IndexedDB image cache (`services/imageCache.ts`) records every uploaded blob keyed on `${generationId}|${versionId}`, evicts entries when generations are deleted or aged out of remote history, and a background backfill walks recent history (with concurrency control) to seed the cache after the user has at least one healthy session. `RecentGenerations` and `ImageDisplay` now consult the cache from their `onError` handlers and present a `blob:` URL instead of failing. `URL.revokeObjectURL` is wired to component cleanup so the cache doesn't leak object URLs (`services/imageCache.ts`, `services/historyService.ts`, `services/imageService.ts`, `components/ImageDisplay.tsx`, `components/RecentGenerations.tsx`).
- **Profile photos survive VPN / proxy blocks.** Same root cause as thumbnails: when `firebasestorage.googleapis.com` is blocked the user's saved avatar fell back to a broken-image icon. Profile photos now live in the IndexedDB image cache under a reserved `__profile__|userId` namespace (the prune step skips reserved keys so history-driven eviction never touches profile photos). New reusable `<CachedImage>` component is the drop-in replacement for `<img>` and is now used by the header avatar, settings preview, and the admin / stats top-users tables. `imageService.uploadProfileImage` seeds the cache from the upload buffer immediately so there's no redundant network fetch after a fresh upload (`services/imageCache.ts`, `services/imageService.ts`, `components/CachedImage.tsx`, `App.tsx`, `components/SettingsPage.tsx`, `components/StatsPage.tsx`).

## [0.7.3] - 2026-04-28
### Fixed
- **Empty model responses no longer get persisted as blank versions.** When a model API returned a 200 with no usable bytes (`base64Data` missing/short, or SVG with no `svgCode`), the previous code happily passed it through `createVersionFromImage`, producing a "Mark X" tile that rendered as a solid-black thumbnail in the Compare rail and version dropdown. `runOne` in the batch loop now validates the result and throws a descriptive error if the payload isn't usable, which routes the slot through the existing `state.failed` counter instead of writing a phantom version (`App.tsx`).

### Changed
- **Any version can be deleted, not just refinements.** `handleDeleteRefinementVersion` previously hard-rejected any non-`'refinement'` version with `Only refinement versions can be deleted.`, and the version-dropdown trash button was gated behind `v.type === 'refinement'`. That left no way to remove blank/failed `type: 'generation'` versions produced by Compare runs and N-variations runs (Mark I + Mark II in a 3-up batch), so users were stuck with empty Compare-rail tiles. The type guard is removed from the App-level handler, and the dropdown now renders a delete button for every version. The "you can't delete the last version" guard remains, surfaced as a disabled button with an explanatory tooltip rather than a thrown error (`App.tsx`, `components/ImageDisplay.tsx`).

### Added
- **Hover-to-delete on Compare rail thumbnails.** Each rail thumbnail now has a small red `×` badge in its top-right corner that appears on hover (or while a delete is in flight), wired to the same `handleDeleteRefinementClick` handler as the version dropdown. Hidden when the generation has only one version, and while in compare-pick / comparing mode so it can't fight with the pick-two flow. The thumb itself is still a `<button role="option">`; the delete button is a sibling under a wrapping `<div className="relative group/railThumb">` so we don't violate the no-button-in-button rule (`components/ImageDisplay.tsx`).
- **"Version deleted" toast wording.** The post-delete notice now says "Version deleted" / "Failed to delete version" instead of "Refinement deleted" / "Failed to delete refinement", since the same path now applies to non-refinements (`components/ImageDisplay.tsx`).

## [0.7.2] - 2026-04-28
### Fixed
- **Recent-generations tile delete actually removes the tile.** For signed-in users `historyService.deleteFromRemote` was deleting the Firestore doc and its Storage objects, but the per-user `brandoit_remote_history_cache_v1:{uid}` localStorage mirror still contained the deleted item. The next `historyService.getHistory` call merged remote + this cache + local-pending + the merge backup, so the deleted generation was resurrected on every refresh and immediately re-written into the cache. `deleteFromRemote` now scrubs the deleted id from the per-user remote cache, the local-pending list, and the merge backup in a `finally` block, so a successful Firestore delete no longer comes back as a zombie tile (`services/historyService.ts`).
- **Tile-trash now always shows a confirmation modal.** `requestDeleteHistory` previously consulted `user.preferences.settings.confirmDeleteHistory` and bypassed the modal when the user had checked "Don't ask me again" once before. Combined with the resurrection bug above, that produced the experience of "I clicked the trash, no modal opened, a toast said it was removed, and the tile is still there." `requestDeleteHistory` now unconditionally opens the confirm modal for gallery tiles (the main-image trash button still respects `confirmDeleteCurrent`, which is a different setting). The modal also no longer shows the misleading "Don't ask me again" checkbox for the history-tile case since that path is now always confirmed (`App.tsx`).
- **No more lying "Generation removed" toast.** The trash button on each `RecentGenerations` tile was firing `showToast('Generation removed')` synchronously inside the `onClick` handler, before the confirmation modal had even opened — so cancelling the modal (or a silent delete failure) still produced a success toast. The synchronous toast is removed; success feedback is now the tile actually disappearing from the gallery (`components/RecentGenerations.tsx`).

## [0.7.1] - 2026-04-28
### Removed
- **"Mark" version badge on Recent Generations tiles.** The orange `Mark I/II/III` pill that overlaid the top-left corner of every multi-version thumbnail in the gallery has been removed; the gallery now reads as a clean image grid. The version label is still surfaced on the main viewer (top-center version dropdown, version menu rows, thumbnail-rail hover preview, and Info overlay) so refinement context is preserved where it matters. The Compare badge stacking logic was simplified accordingly — it now anchors at `top-2` instead of conditionally moving to `top-8` when the Mark pill was present (`components/RecentGenerations.tsx`).

## [0.7.0] - 2026-04-27
### Added
- **Carousel navigation on the main viewer.** `ImageDisplay` now exposes prev/next arrow buttons that step the main image through the recent-generations history one tile at a time. Arrows are positioned at the left and right edges of the image card (desktop) and rendered as an inline row with a `currentIdx / total` counter on mobile. The same navigation is bound to global ←/→ keyboard shortcuts that respect inputs/textareas/contenteditables and the prompt-editor modal so they don't fire mid-typing. The arrow buttons are disabled at the ends of the history list and hidden whenever the comparison slider is on screen so they can't fight with its own controls (`components/ImageDisplay.tsx`, `App.tsx`).
- **Recent-generations gallery jumps to the top on empty viewer.** When the user has prior history but nothing is loaded into the main viewer, `App.tsx` now suppresses the "Ready to Create" placeholder so `RecentGenerations` lands at the top of the page on load. True first-run users (no current generation _and_ no history) still see the original empty-state hint (`App.tsx`).
- **Show/Hide details toggle for the gallery.** New eye-icon toggle in the `RecentGenerations` toolbar collapses the per-tile prompt + tag-chip panel beneath each thumbnail. Default is **off** so the gallery reads as a clean image grid. Choice persists to `localStorage` under `recentGenerations.showDetails` (`components/RecentGenerations.tsx`).
- **Thumbnail size selector for the gallery.** New `RichSelect` dropdown in the `RecentGenerations` toolbar lets users pick `X-Small` / `Small` / `Medium` / `Large` density. Each maps to a different responsive `grid-cols-*` configuration (3→10 cols at X-Small, 2→5 at Large). Defaults to `Small` so the grid is tighter out of the box, and the choice persists to `localStorage` under `recentGenerations.thumbnailSize` (`components/RecentGenerations.tsx`).
- **`triggerLabelClassName` prop on `DownloadMenu`.** Lets callers responsively hide the trigger label `<span>` (e.g. `hidden xl:inline`) without losing the accessible name, which keeps reading via `triggerTitle`/`aria-label` (`components/DownloadMenu.tsx`).

### Changed
- **Tile action buttons hide until hover on hover-capable devices.** The per-tile toolbar (Download / Copy image / Copy URL / Copy prompt / Delete) on `RecentGenerations` thumbnails now uses `[@media(hover:hover)]:opacity-0 ... :group-hover:opacity-100` instead of the old `lg:` breakpoint carve-out. Hover-capable devices at any width get a clean image grid that reveals controls on hover/focus-within; touch-only devices keep the toolbar always visible since they have no hover state. Buttons remain in the DOM (opacity-only) so keyboard tab-focus and screen readers still see them (`components/RecentGenerations.tsx`).
- **Recent-generations toolbar collapses to icons instead of wrapping.** The gallery toolbar (Size / Show details / Download all / Select for export) was wrapping onto a second row at narrow desktop widths because `flex-wrap` let the buttons drop down. The container is now `flex-nowrap`, all buttons get `shrink-0`, and the text labels on the three action buttons hide below `xl` (1280px) via `hidden xl:inline`, leaving the icons + accessible names. The size dropdown keeps its selected value visible at all widths so users can still see which density is active (`components/RecentGenerations.tsx`).

## [0.6.0] - 2026-04-27
### Added
- **Concurrent background generations.** Each Generate click now mints its own `ActiveGenerationJob` with an `id`, dedicated `AbortController`, snapshotted run context (user, prompt, system prompt, OpenAI quality), and per-model progress, all tracked in a single `activeGenerationJobs` array. The toolbar is no longer blocked while a run is in flight, multiple runs can coexist, and each is independently stoppable and dismissable (`App.tsx`).
- **Floating "Active Generations" monitor.** New top-right card surfaces every running, completed, failed, or stopped job with: per-job spinner / status dot, `done/total` counter, in-flight count, prompt, color-coded progress bar (teal running, red failed, slate stopped), elapsed time, throughput-based ETA (falls back to per-model concurrency estimates when nothing has completed yet), up to three currently-running `{model, prompt}` rows, per-model chips for compare runs, a "View latest result" arrow that jumps to whichever image just landed, and a per-job Stop button. Settled jobs auto-dismiss after 9s on success / 14s on failure but can be cleared manually with the X (`App.tsx`).
- **Setup-aware Generate button.** `ControlPanel` accepts `setupRequired`, `setupActionLabel`, `setupActionDescription`, and `onSetupAction` props. When the user has no account or no API key, the Send icon swaps to a `KeyRound` / `UserPlus` glyph and clicking it opens the right setup modal instead of trying to generate (`components/ControlPanel.tsx`).
- **Storage-backed generation history.** Raster image bytes now upload to Firebase Storage at `users/{uid}/history/{generationId}/{versionId}.{ext}` via the new `uploadGenerationImage` / `deleteGenerationImages` helpers (`services/imageService.ts`). Firestore documents keep only metadata plus a `imageStoragePath` and download URL — generated tiles no longer threaten the 1 MiB Firestore document limit, and removing a generation tile cleans up its Storage folder (`services/historyService.ts`, `types.ts`).
- **`imageStoragePath` on `GenerationVersion`.** New optional field so versions can round-trip their Storage object location for cleanup. Old documents without it continue to work via fallback to `imageUrl` / `imageData` (`types.ts`, `services/historyService.ts`).

### Changed
- **Prompt input row redesigned as compact icon actions.** The previous `sm:flex-row` row with an in-input "Prompt" label and pill-shaped buttons becomes a single 12×12 row of icon buttons (Qty / Expand / Generate) using the `Send` glyph; the variations input is the icon button itself, with a chevron exposing the 1–5 quick-pick. Container uses `w-full max-w-5xl mx-auto` so the row stays centered with the toolbar above at every breakpoint (`components/ControlPanel.tsx`).
- **Tile-overlay buttons are touch-friendly and stay visible on small screens.** Hover-to-reveal action clusters in `ImageDisplay` and `RecentGenerations` now wrap with `flex-wrap`, clamp width via `max-w-[calc(100%-Xrem)]`, drop to `h-8 w-8` / `p-2.5` below `lg`, and use `opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100` so they're always reachable on mobile while preserving the desktop hover-fade (`components/ImageDisplay.tsx`, `components/RecentGenerations.tsx`).
- **`isGenerating` is now derived from `activeGenerationJobs`** (`hasRunningGenerationJobs`) rather than a separate boolean, removing several stale-state slots from the previous batch implementation (`batchProgress`, `batchModelProgress`, `activeBatchModelIds`, `batchVisualBars`, `batchStartedAt`, `isBatchStopping`, `batchAbortRef`, `batchModelJobsRef`, `batchVisualBarTimersRef`).
- **History serialization is async** so it can upload images before writing the Firestore doc (`historyService.saveToRemote`, `historyService.updateGeneration`). Remote payloads now exclude raw base64 entirely; reads continue to merge local cache + remote URL transparently.

### Fixed
- **Prompt row left-aligned at 768–1535px viewports.** The new compact prompt row was wrapped in a `mx-auto` container with `width: calc(100vw - 2rem)` and the input had `max-w-[30rem] xl:max-w-[44rem]` caps, which combined with fixed-size `shrink-0` action buttons left a gap on the right and made the row visually fall off-center from the toolbar above. Restored a `w-full max-w-5xl mx-auto` shell and removed the input max-width caps so `flex-1` properly fills the centered row (`components/ControlPanel.tsx`).
- **Stale generations no longer leak fetches or timers on unmount.** The cleanup effect now aborts every in-flight `AbortController` and clears every dismiss timer registered in `generationJobAbortControllersRef` / `generationJobDismissTimersRef`.

## [0.5.1] - 2026-04-22
### Changed
- **Toolbar redesigned as a tiered responsive menu bar.** Replaced the previous bordered-button toolbar (`components/ControlPanel.tsx`) with a ghost menu-style row that adapts across three breakpoints:
  - `< lg` (1024px): icon-only, 44×44 tap targets, label surfaced via tooltip.
  - `lg+`: icon + truncated label (≤100px, label still truncates cleanly).
  - `xl+` (1280px): icon + stacked SUBLABEL/label + chevron.
  - `2xl+` (1536px): adds the color-palette preview strip under Colors.
  Reset and Upload actions adopted the same ghost treatment with a vertical separator between the config and action groups so the grouping is obvious without borders.
- `Download all` inside a generation-tile viewer is now scoped to **that tile only** (all marks/versions in the current `Generation`) instead of the full history gallery (`components/ImageDisplay.tsx`). The label now reads "Download all in this tile" to match the scope.

### Fixed
- **Toolbar dropdowns no longer get clipped.** The toolbar container had `overflow-x-auto`, which per CSS spec implicitly sets `overflow-y: auto` as well — silently chopping off every absolute-positioned dropdown panel as soon as it rendered. Removed the overflow wrapper, pushed the text tier from `md` to `lg` so 768–1023px stays icon-only (no overflow possible), and kept `flex-wrap` as a final safety net.
- Resolved several regressions introduced while iterating on the toolbar: uneven vertical padding, tiny mobile icons, single-row scroll clipping, and dropdown panels that visually appeared then vanished on click.

## [0.5.0] - 2026-04-21
### Added
- **Cross-model comparison workflow with an inline swipe slider.** Users can now select multiple models for one generation run and compare results directly in the main preview surface (no cramped modal), with an A/B slider (`components/JuxtaposeSlider.tsx`) and side-by-side export options.
- **Grouped model selector UX for Gemini and OpenAI families.** The model menu now organizes options by provider, supports shift-click compare-entry behavior, and surfaces clearer selected-state feedback for compare picks.
- **Per-mark model identity across shared generation tiles.** Each generated version now carries its originating `modelId`, allowing mixed-model runs to remain grouped in one tile while keeping accurate model tags in previews/history and comparison picks.
- **Per-job batch progress lanes.** Multi-generation runs now render one progress row per active generation job (with prompt + model context), instead of a single aggregate bar, and fade rows out as jobs finish.
- **Toolbar preference durability upgrades.** Local toolbar cache now includes OpenAI image quality and improved fallback hydration for signed-out and returning sessions, so defaults persist more reliably between reloads.

### Changed
- Comparison mode now uses the existing viewport and thumbnail rail flow instead of a separate modal, with controls overlaid on the slider surface to preserve image real estate.
- Shift-click compare behavior now treats the currently selected mark as A and the shift-clicked mark as B when entering compare, matching expected "compare this against current" intent.
- Starting a new generation now exits compare mode immediately so the workspace returns to normal generation context.
- Control bar spacing and sizing were rebalanced for larger screens (`components/ControlPanel.tsx`), improving legibility and reducing cramped dropdown/button layouts.
- Multi-model batch ETA now reflects parallel wall-clock behavior using observed throughput and per-model concurrency assumptions.
- OpenAI integration path expanded: model labels, quality routing, and aspect-ratio handling were aligned across controls, generation services, history, and settings views.

### Fixed
- Resolved repeated compare-layout regressions where the preview area could collapse or left-align when entering comparison mode.
- Prevented top-right action buttons from covering compare controls while the slider is active.
- Corrected compare-entry seeding so users no longer need to reselect the first mark after entering picker mode.
- Improved per-job progress readability: larger metadata text and active bars no longer appear fully complete while generations are still in flight.
- Improved persistence defaults for first-load preferences (model/type/style/colors/size/quality) so user-selected settings survive reloads and sync more consistently.

## [0.4.0] - 2026-04-21
### Added
- **GPT Image 2 and GPT Image Mini** are now available as first-class models. The previous single "GPT Image" entry is split into three tiers in `SUPPORTED_MODELS`:
  - `openai-2` → **GPT Image 2** (`gpt-image-2`) — OpenAI's flagship image model with 2K/4K resolutions and aspect ratios from 3:1 to 1:3.
  - `openai-mini` → **GPT Image Mini** (`gpt-image-1-mini`) — budget tier.
  - `openai` → **GPT Image 1.5** (`gpt-image-1.5`) — retained for backwards compatibility with existing user preferences.
  All three share a single `apiKeys.openai` slot, so existing keys keep working without re-entry.
- **Quality control for OpenAI models.** New toolbar dropdown (visible only when `openai-2` or `openai-mini` is selected) with `Auto` / `Low` / `Medium` / `High`. Persisted per-user as `settings.openaiImageQuality` via `UserSettings`, and passed through to both generation and refinement calls. `gpt-image-1.5` ignores this parameter (it doesn't support quality).
- **Expanded aspect ratios for GPT Image 2.** New `OPENAI_2_ALLOWED_ASPECT_RATIOS` adds `16:9`, `9:16`, `3:1` (banner), and `1:3` (skyscraper) on top of the legacy three. Concrete pixel sizes (e.g. `2048x2048` for 2K square, `2304x768` for 3:1) are picked to satisfy OpenAI's constraints (edges multiples of 16, long:short ≤ 3:1).
- **Admin users table redesign.** The 11-column table is collapsed to a scannable 4-column layout:
  - **User** — display name with a rotating chevron that expands an inline details panel showing username, email, and created date (with hover-for-full-timestamp on the shortened date).
  - **Last seen** — relative time (`2 days ago`, `3 months ago`, `Never`) with a hover popover showing the exact timestamp.
  - **Status** — row of five 40×40 circular icon pills with hover tooltips for model, Gemini key, OpenAI key, admin role, and suspension state. Active pills are tinted (teal / amber / red); inactive are ghost-dim.
  - **Actions** — sticky to the right edge with a visible bordered `⋯` button so it's always in view regardless of horizontal scroll.

### Changed
- `services/openaiService.ts` signature is now `generateOpenAIImage(prompt, config, apiKey, { modelId, quality, systemPrompt })`. `modelId` maps UI ids (`openai-2` / `openai-mini` / `openai`) to OpenAI API model names, and `quality` is only sent to models that actually accept it.
- `getApiKeyForModel` in `App.tsx` now routes all three OpenAI ids to `apiKeys.openai` — no schema change, no re-entry required.
- Settings page description for the OpenAI API key now reads "Used by GPT Image 2, GPT Image Mini, and GPT Image 1.5" so the shared-key behaviour is obvious.
- `services/aspectRatioService.ts` splits the OpenAI allowed-ratio logic by model id so `openai-2` gets the expanded set while `openai` and `openai-mini` stay pinned to the legacy three.
- Model labels updated across `ControlPanel`, `ImageDisplay`, `RecentGenerations`, and the admin stats service: `openai-2` → "GPT Image 2", `openai-mini` → "GPT Image Mini", `openai` → "GPT Image 1.5".
- Admin action button is now a bordered pill (`w-11 h-11`), meeting the 44×44 touch-target rule and making the previously-ghosted `⋯` actually discoverable.

## [0.3.0] - 2026-04-21
### Added
- **Admin usage-stats dashboard.** New `Stats` tab on the Admin page with live metrics aggregated directly from Firestore:
  - Top-line tiles: total images generated (generation-type marks), total refinements, total users, active-last-7d, active-last-30d, admin signals, suspended users, users with an API key, and average images per user.
  - Time-series charts for "images generated per day" (stacked images + refinements with peak-day callout) and "new signups per day" over the last 30 days.
  - Breakdown bar charts by **model**, **graphic type**, **visual style (top 10)**, and **aspect ratio**, with per-row count and percent-of-total.
  - Top 10 users leaderboard by images generated (with refinement and tile counts).
  - One-click refresh with "computed Xs ago" relative-time labels.
- **`services/statsService.ts`**: does a single `collectionGroup('history')` scan + one `users/` read + one catalog read, then aggregates in memory. Correctly handles every timestamp shape the codebase has ever used (Firestore `Timestamp`, `serverTimestamp()`, ms epoch, ISO string) and counts batch marks correctly (a tile with 3 variations = 3 images).
- **Admin page now has a `Users | Stats` tab switcher**; the existing Users panel and all row actions are unchanged.
- **Hand-rolled SVG/CSS chart primitives** (`StatTile`, `HorizontalBarList`, `DailyBarChart`) — no chart library dependency, keeps the bundle small (+5 KB gzipped).
- **Firebase Analytics (GA4)** now actually loads in production. The `measurementId` (`G-FH2TCLP7BP`) has been in the Firebase config since initial setup, but `getAnalytics(app)` was never called — so `gtag.js` never loaded and no hits ever reached GA4. The `services/firebase.ts` module now calls `getAnalytics(app)` behind `isSupported()`, skips emulator dev sessions, and no-ops when `measurementId` is absent.

### Changed
- `firestore.rules`: added a collection-group admin-read rule (`match /{path=**}/history/{docId} { allow read: if isAdmin(); }`) so the Stats dashboard can run `collectionGroup('history')` queries. The nested per-user history rule is unchanged; this new block is the one that applies to group queries.
- `setAdminRole` Cloud Function now surfaces the underlying Firebase Admin SDK error code and message instead of a bare `"internal"` error, so failures are actually actionable.

### Fixed
- Google Analytics (`G-FH2TCLP7BP`) was showing "Data collection isn't active" because the GA4 SDK was never initialized — see "Changed" above. Page-view and default events now flow to GA4 on every production page load (ad-blocker behaviour notwithstanding).

## [0.2.0] - 2026-04-21
### Added
- **Admin panel** (`components/AdminPage.tsx`): paginated user table with client-side search, row-level action menu (clear API keys, wipe system prompt, suspend/unsuspend, promote/demote admin, delete account), inline destructive-action confirmations, and status/error banners matching the existing Settings page styling.
- **Claims-based admin identity.** Admin privileges are now a Firebase Auth custom claim (`admin: true`) surfaced on `User.isAdmin`, read on every sign-in. The legacy `planetoftheweb` username is kept as a bootstrap fallback so the first admin can self-promote without a lockout; after that, admin is a real claim.
- **Cloud Functions** (`functions/src/admin.ts`): `setAdminRole` and `deleteUserAccount` callables. `setAdminRole` is admin-gated with a one-time bootstrap path for `planetoftheweb`. `deleteUserAccount` performs conservative removal — Firestore `users/{uid}` + `history` subcollection, Storage `users/{uid}/*`, and the Auth record — and leaves team/catalog documents owned by that user intact.
- **User suspension.** New `isDisabled` flag on user documents. Suspended users are hard-blocked at app start with a clear notice and a sign-out button; rules forbid them from doing anything until an admin re-enables the account.
- **Sign-in auditing.** `authService` writes `lastSignInAt: serverTimestamp()` on every successful sign-in for admin-side visibility.
- **Firebase project scaffolding.** `firebase.json`, `.firebaserc`, `firestore.indexes.json`, and a TypeScript `functions/` project (Node 20) so rules and functions can be versioned and deployed from the repo.
- **Codified security rules.** `firestore.rules` and `storage.rules` now live in the repo with `isSignedIn()`, `isOwner(uid)`, `isAdmin()` helpers, per-collection scoping, and a default-deny tail.
- **Local emulator wiring.** `services/firebase.ts` connects to the Firebase Emulator Suite (Auth 9099, Firestore 8080, Storage 9199, Functions 5001) when `VITE_USE_FIREBASE_EMULATORS=true`, so Cloud Functions can be exercised end-to-end without touching production.
- Avatar menu gains an **Admin** entry (gated on `user.isAdmin` or the bootstrap username).

### Changed
- `services/structureSeeder.ts`, `services/batchGenerationService.ts`, `components/ControlPanel.tsx`, and `App.tsx` now check `user.isAdmin` first and fall back to the `planetoftheweb` username only as a legacy bridge.
- `services/authService.ts` reads the admin claim from the ID token result on every auth state change and strips any `isAdmin` fields out of preferences before writing to Firestore, so claim state can never be spoofed from the client.
- **Settings page** redesigned for clarity (`components/SettingsPage.tsx`): tidier sectioning, reliable per-provider API key persistence, and removal of the old custom toolbar label controls.
- `setAdminRole` now surfaces the underlying Firebase Admin SDK error code and message in its `HttpsError`, so callers see actionable failures instead of a bare `internal`.
- User system prompt is now passed through the Gemini SDK's native `systemInstruction` channel and also applied during prompt expansion, so one saved system prompt genuinely steers both generation and expansion.

### Fixed
- Firestore user-profile writes could fail when optional preference fields were `undefined`. All `undefined` values are now stripped before the write.
- API keys could drop out of Settings state after a round-trip save; persistence is now provider-scoped and reliable across reloads.
- Removed an unused custom toolbar labels pathway that was fighting the model-label UI and could leave stale labels in the toolbar.

## [0.1.3] - 2026-04-17
### Added
- Batch generation: a single Generate click can now produce multiple variations in one go. Combine a numeric `QTY` (1–5 for regular users, unlimited for admins) with Midjourney-style brace expansion in the prompt, e.g. `A { red, blue } logo on { white, black }` — totals multiply across all brace groups.
- Pre-send estimate of batch size and expected duration, plus a live batch progress banner with elapsed time, estimated time remaining, and the number of jobs currently running in parallel.
- Stop button on the batch progress banner. Cancels pending jobs via `AbortController` while letting in-flight generations finish and save, so partial batches aren't lost.
- Unified `DownloadMenu` on the main preview and in Recent Generations. Replaces the old scattered SVG / HTML / PNG / WebP action buttons with a single Download control that offers "Download this" (current mark) and "Download all" (every visible or selected tile) in PNG, WebP, SVG, or HTML formats.
- Export selected generations from Recent Generations as a single ZIP (batch download of chosen tiles).
- Left-side thumbnail rail on the main viewport whenever a tile has multiple versions. Hover a thumbnail to preview that mark in the large viewport without committing; click to commit. The rail scrolls when a batch outgrows the viewport height.
- Footer with copyright and links to the changelog and GitHub releases.
- New shared services: `promptExpansionService` (brace Cartesian expansion with `\{`/`\}` escapes), `batchGenerationService` (concurrency-limited batch runner), `timeEstimationService` (rolling per-model duration averages in `localStorage`), and `imageFormatService` (shared raster/SVG export helpers).

### Changed
- Every job submitted from a single Generate click — whether from numeric `QTY`, brace expansion, or both multiplied together — is now consolidated onto one history tile as Mark I, Mark II, Mark III, … mirroring how manual refinements are grouped. No more sprawling across N tiles per batch.
- Each batch mark now stores its own expanded prompt (in `refinementPrompt`) so brace variations remain attributable per-mark in the info overlay and download filenames.
- Variations count control redesigned as a compact `QTY` button in the toolbar: typable numeric input with a small chevron dropdown for 1–5 presets, centered number, tight spacing, consistent with other toolbar controls.
- Batch progress banner moved down (`top-24`) so it no longer covers toolbar buttons.
- "Download all" zips now fan out over every `type: 'generation'` version per tile instead of only the latest, so batched tiles export every mark. Filenames use each mark's own expanded prompt when available.

### Fixed
- Race condition when multiple concurrent batch jobs tried to persist into the same Generation: persistence is now serialized through a single promise queue, so create-vs-update and mark-number collisions can't happen even with parallel API calls.
- Batch history UI now replaces the existing tile by ID on every progress update (rather than appending duplicates), so the mark count and thumbnail stay current during a running batch.

## [0.1.2]
### Added
- Nano Banana 2 (`gemini-3.1-flash-image-preview`) as a first-class model option alongside Nano Banana Pro and GPT Image.
- Correction-analysis workflow in refine: the wand action now generates a structured, readable correction plan prompt (summary / issues / fixes).
- Top version dropdown refinement deletion (remove specific refinement marks, renumber marks, persist history updates).
- Per-version `aspectRatio` tracking so follow-up edits keep the correct size.

### Changed
- Reworked the refine panel with rich dropdowns, per-image model and size controls, square action buttons, and prompt editor improvements (expandable modal + `Cmd/Ctrl + Enter` submit).
- Improved resize/recompose pipeline with stricter preservation prompts, an automatic anti-padding second pass, and a style-reference-only fallback when recomposes stay boxed.
- Improved dropdown usability in constrained layouts (auto open upward when needed, adaptive menu height, higher overlay layering).
- Cloud history persistence now auto-trims older versions when approaching Firestore document size limits while preserving the full local chain.

### Fixed
- Aspect-ratio regression where refinements could revert to the toolbar/default size (now uses the active-version ratio for subsequent edits).

## [0.1.1]
### Added
- OpenAI GPT-Image 1.5 generation with supported size mapping and structured prompts that include type, style, colors, and aspect ratio.
- Customizable per-model labels (e.g. "GPT Image", "Nano Banana") applied across toolbar, previews, and history tags.
- Overlays and tags now show model, type, style, size, prompt, colors, and timestamps (MM-DD HH:MM AM/PM) with unified outlined styling.
- History items store `modelId`, `timestamp`, and config so tags render correctly after restore/generate/refine.

### Changed
- Model selector refreshed with fancy dropdown styling; restore now re-applies the model to the toolbar.
- Clipboard UX hardened: copy image bitmap / URL / prompt with centered toasts; option analysis accepts system prompt.
- Settings: per-model labels, model/key saving keeps confirmation settings in sync, clearer model sections with dividers.

## [0.1.0]
### Added
- Initial release with Gemini-based image generation, prompt expansion, brand guideline analysis, and Firestore-backed history.
- Core UI: ControlPanel for type/style/colors/aspect, recent generations gallery, large image preview, auth, and settings.
- BYOK for Gemini, teams/catalog/resource management, and normalized Firestore structure.

## [0.0.1]
### Added
- First public version of BranDoIt.
- Basic Gemini image generation, prompt entry, and initial project scaffold.
