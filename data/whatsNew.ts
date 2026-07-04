import type { WhatsNewEntry } from '../types';

/**
 * Curated What's New entries — the single source of truth for the bell
 * dropdown, the spotlight modal, the card grid on the discovery page, and
 * the per-release detail page.
 *
 * Authoring conventions:
 *   - `summary` is a single short sentence shown in the bell preview.
 *   - `blurb` is one paragraph shown on the spotlight modal and on the
 *     image-top grid cards. It should stand on its own without sections.
 *   - `sections` are optional rich, instructional content rendered on the
 *     detail page (`WhatsNewPage` selected-entry view). Each section has a
 *     heading + body + numbered steps with optional icon / kbd markers.
 *   - Entries stay sorted descending by `publishedAt`; the first is the
 *     "hero" on the discovery page.
 *   - One entry per release; mark the headline release with
 *     `featured: true` to trigger the one-time spotlight modal.
 *
 * Icons in steps reference Lucide-react icon names that the detail view
 * resolves via its `ICON_MAP` allowlist; unknown names fall back to a
 * neutral help glyph so a typo never crashes the page.
 */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: 'v0.21.0-build-studio',
    title: 'Build Studio — animate your infographics and export MP4',
    summary:
      'Turn any image into a step-by-step reveal animation. AI proposes the items in reading order, or draw them yourself — then export H.264.',
    blurb:
      'Build Studio turns a generated infographic into a presentation-ready reveal animation. Open it from the Animate button on any preview, then let the AI wand propose every block in reading order — title first, content in the middle, conclusion last — or trace them yourself with freeform, rectangle, and brush tools. Each item gets its own reveal moment with camera zoom, fade/wipe/spotlight styles, and tunable timing. When you are happy, export a one-click H.264 MP4 right in the browser, or fullscreen the player and screen-record. Signed-in users get cloud-backed builds that survive a cleared browser; everyone gets ⌘Z undo on every edit.',
    publishedAt: Date.parse('2026-07-04T03:00:00Z'),
    version: '0.21.0',
    image: '/whats-new/whatsnew-v0.21.0.png',
    featured: true,
    sections: [
      {
        heading: 'Open Build Studio from any preview',
        body: 'The Animate button on the preview toolbar opens Build Studio for the image you are looking at. Your selections, item order, timing, and playback settings persist per image — locally for guests, and in Firestore for signed-in users so a build survives a new browser or cleared storage.',
        steps: [
          { text: 'Open any generation from your gallery so its preview is showing.', icon: 'Layers' },
          { text: 'Click Animate on the preview toolbar — Build Studio opens over the image.', icon: 'Film' },
          { text: 'Close with Esc (peels back one layer at a time) or the × button.', kbd: 'Esc' },
        ],
      },
      {
        heading: 'AI auto-select proposes items in reveal order',
        body: 'The wand runs one Gemini vision call on your key and returns an ordered list of regions — hook first, body blocks in reading order, conclusion last. It replaces the current items in one shot; ⌘Z brings your manual work back. For busy art, run Clean up first so each block sits on a solid background.',
        steps: [
          { text: 'Click the wand in the floating toolbar above the canvas.', icon: 'Wand2' },
          { text: 'Wait for the pass to finish — items appear in the sidebar with AI-proposed names you can double-click to rename.', icon: 'Sparkles' },
          { text: 'Fine-tune any region with the selection tools, or undo the whole pass.', kbd: 'Cmd+Z' },
        ],
      },
      {
        heading: 'Clean up for animation before selecting',
        body: 'Dense infographics can be hard to auto-select. Clean up sends a refine instruction that redraws the same content with each section isolated on a solid background — easier for both the wand and manual tracing. It creates a new Mark; your original stays untouched.',
        steps: [
          { text: 'Click the sparkles button next to the wand in the toolbar.', icon: 'Sparkles' },
          { text: 'A new Mark appears with cleaner, separated blocks — switch to it in the version rail if needed.', icon: 'Layers' },
          { text: 'Re-open Build Studio on the cleaned Mark and run AI auto-select or trace items yourself.', icon: 'Wand2' },
        ],
      },
      {
        heading: 'Draw, reorder, and focus individual items',
        body: 'Freeform lasso (straight lines by default — hold Alt for a single drag), rectangle, and brush tools live in a Photoshop-style floating toolbar. Drag item badges to reorder. Double-tap ⌥ or press ⌥1-9 to focus-isolate one item for fine eraser work. Drag the duration readout to scrub per-item timing.',
        steps: [
          { text: 'Pick a selection tool from the floating toolbar and trace around a block — it becomes an item in the sidebar.', icon: 'Pencil' },
          { text: 'Drag the numbered badge on the canvas to reorder; double-click a name to rename in place.', icon: 'ArrowRight' },
          { text: 'Double-tap ⌥ to zoom into the selected item; Esc steps back out one layer at a time.', kbd: 'Esc' },
        ],
      },
      {
        heading: 'Play the reveal and export MP4',
        body: 'The player walks through items one at a time with camera zoom and your chosen transition style. Arrow keys advance manually; toggle auto-play, loop, and speed. Export renders H.264 locally via WebCodecs — no upload — so the file plays in QuickTime, PowerPoint, and social feeds.',
        steps: [
          { text: 'Switch to the Play tab at the bottom of the sidebar and press Play.', icon: 'Film' },
          { text: 'Use ← / → to step through items, or enable auto-play and loop.', icon: 'ArrowRight' },
          { text: 'Click Export MP4 in the header — the file downloads when rendering finishes.', icon: 'Film' },
        ],
      },
    ],
  },
  {
    id: 'v0.20.0-add-marks-rerolls',
    title: 'The + button now re-rolls the prompt — hold 1-9 to batch',
    summary:
      'Clicking + on the version rail now runs a fresh creative re-roll of the original prompt; hold a digit to batch, or Shift-click to edit prompt + count.',
    blurb:
      'The + button at the end of the version rail used to refine the previous image — same prompt, but the model was told to "preserve composition, framing, subjects, layout, lighting" so new Marks ended up nearly identical. Now it runs a fresh generation: no previous image input, no preservation directives, so the model rethinks layout, palette, and composition every time. Hold a number (1-9) while clicking to batch that many re-rolls in one click — a teal "×N" badge appears on the + so you can see what the next click will do, and N spinner placeholders show up immediately in the rail so the upcoming Marks are visible before they finish. Shift-click opens the new "Add Marks" editor where you can tweak the prompt and pick a count.',
    publishedAt: Date.parse('2026-05-21T20:00:00Z'),
    version: '0.20.0',
    image: '/whats-new/whatsnew-v0.20.0.png',
    sections: [
      {
        heading: 'Click + to re-roll the prompt',
        body: 'The + button at the bottom of the version rail no longer "refines" the previous image — it now runs a fresh generation against the tile\'s original prompt, with no previous-image input and no preservation directives. The model is free to rethink layout, palette application, and composition every time.',
        steps: [
          { text: 'Restore any generation from your gallery so its rail is showing.', icon: 'Layers' },
          { text: 'Click + at the end of the rail — a new Mark appears with a fresh creative take.', icon: 'Plus' },
          { text: 'The refine bar still works for incremental edits ("make the title bigger", "darken the background") — that path keeps using the previous image as input.', icon: 'Wand2' },
        ],
      },
      {
        heading: 'Hold 1-9 to batch multiple re-rolls',
        body: 'Press and hold any digit from 1 to 9 while clicking + and that many fresh Marks queue up at once. A teal "×N" badge floats on the + button so you know what the next click will do; the same number of spinner placeholders appear in the rail immediately so the incoming Marks are visible before they finish.',
        steps: [
          { text: 'Press and hold a number (1-9) anywhere on the page that isn\'t a text field.', icon: 'ArrowRight' },
          { text: 'Watch the + button — a small "×3" (or whatever digit you held) teal badge appears in its top-right corner.', icon: 'Check' },
          { text: 'Click + once; three spinner placeholders pop into the rail and the re-rolls run sequentially.', icon: 'Sparkles' },
        ],
      },
      {
        heading: 'Shift-click for the new Add Marks editor',
        body: 'Hold Shift while clicking + to open a dedicated editor instead of running immediately. Pre-filled with the tile\'s original prompt, fully editable, with a 1-9 count picker right there. Distinct from the refine editor — it submits to the re-roll pipeline, not the refinement one.',
        steps: [
          { text: 'Shift-click + on the version rail (or hold 1-9 + Shift-click to pre-fill the count).', icon: 'Pencil' },
          { text: 'Edit the prompt if you want a variant, then pick how many Marks to add from the 1-9 segmented picker.', icon: 'BookOpen' },
          { text: 'Cmd/Ctrl+Enter submits; the editor closes and N placeholders appear in the rail.', icon: 'Check' },
        ],
      },
      {
        heading: 'Hover the + for a keyboard cheat sheet',
        body: 'A rich hover tooltip on the + button lists all four interaction modes — Click, 1-9 + Click, Shift+Click, and 1-9 + Shift+Click — with the exact behavior each one triggers. Portaled out of the rail so it doesn\'t get clipped by the scroll container.',
        steps: [
          { text: 'Hover (or focus) the + button on any version rail.', icon: 'Eye' },
          { text: 'A panel appears beside it with the four modes and what each does.', icon: 'Info' },
        ],
      },
    ],
  },
  {
    id: 'v0.19.0-preset-actions-and-search',
    title: 'Preset hamburger menus, hover previews, and a bigger search',
    summary:
      'Each preset row gets a ⋯ menu for Rename / Overwrite / Delete, hovering shows its full parameter set, and search results open a much larger preview.',
    blurb:
      'Saved presets are now safer to scan and easier to manage. Each row has a single ⋯ button that opens a side popover with Rename, Overwrite with current toolbar, and Delete — so the destructive "overwrite" is no longer one accidental click away. Hovering any preset pops a panel beside it showing the full snapshot — type, style, colors, size, model, quality — so you can vet a preset before applying it. The same treatment lives in both the toolbar Presets dropdown and each folder\'s gallery preset menu. Search (⌘K) was redesigned too: the results column is narrower, the preview panel is much larger, and the active result shows its prompt, every parameter that produced it, and the full creation date.',
    publishedAt: Date.parse('2026-05-21T17:00:00Z'),
    version: '0.19.0',
    image: '/whats-new/whatsnew-v0.19.0.png',
    sections: [
      {
        heading: 'Per-row hamburger menu replaces the inline buttons',
        body: 'The old delete trash icon and the auto-appearing "Overwrite with current toolbar" row are gone. Each preset now has a single ⋯ button that opens a portaled side popover with three actions, so applying a preset is one safe click and destructive actions live behind a deliberate second click.',
        steps: [
          { text: 'Open the Presets dropdown — either the toolbar one or a folder\'s gallery preset menu.', icon: 'Bookmark' },
          { text: 'Click the ⋯ button on any preset row to open the side popover.', icon: 'Layers' },
          { text: 'Choose Rename, Overwrite with current toolbar, or Delete preset. Delete arms first; click again within ~3s to confirm.', icon: 'Pencil' },
        ],
      },
      {
        heading: 'Hover to preview a preset\'s parameters',
        body: 'Hovering a preset row pops a small panel beside it listing every saved parameter — type, style, colors, size, SVG mode, model, and quality. Lets you check exactly what a preset will apply before you click it.',
        steps: [
          { text: 'Open any presets menu.', icon: 'Bookmark' },
          { text: 'Move the pointer over a preset row — the preview opens to the side automatically.', icon: 'Eye' },
          { text: 'Click the row to apply, or click the ⋯ to manage it.', icon: 'Check' },
        ],
      },
      {
        heading: 'Bigger, more useful search modal',
        body: 'Press ⌘K (or ⌃K on Windows) to open search. The results list is now a narrow left rail, and the right panel shows a large preview of the active result with its full prompt, every parameter that produced it, and the creation date.',
        steps: [
          { text: 'Press ⌘K / ⌃K to open search.', icon: 'Sparkles' },
          { text: 'Type to filter, or use ↑ / ↓ to step through recent results.', icon: 'ArrowRight' },
          { text: 'The right panel updates as you move; ↵ opens the highlighted generation.', icon: 'Check' },
        ],
      },
      {
        heading: 'Per-folder gallery presets',
        body: 'A folder can now keep its own preset list separate from your global presets. Open the gallery preset menu and switch between Global and This folder — saving while in folder mode persists the preset to that folder only.',
        steps: [
          { text: 'Open the gallery Presets menu (the ⌘ chip next to a folder name).', icon: 'Folder' },
          { text: 'Toggle between Global and This folder at the top of the menu.', icon: 'Layers' },
          { text: 'Save the current toolbar — it goes to whichever source is active.', icon: 'BookOpen' },
        ],
      },
    ],
  },
  {
    id: 'v0.18.0-nested-folders',
    title: 'Nested folders, drag to reorder, and smarter menus',
    summary:
      'Organize generations in a collapsible folder tree — drag to reorder, drop in the middle to nest, and right-click for quick actions.',
    blurb:
      'The gallery now behaves like a real project library. Create nested folders with per-folder instructions that flow down to subfolders and new generations. Open the folder picker to browse a collapsible tree, drag folders to the top or bottom edge to reorder siblings, or drop on the middle of a row to move a folder inside another. Right-click any folder for instructions, rename, subfolder, or delete — and open the row menu without it getting clipped at the bottom of the screen. New images save to whichever folder you have open.',
    publishedAt: Date.parse('2026-05-20T18:00:00Z'),
    version: '0.18.0',
    image: '/whats-new/whatsnew-v0.18.0.png',
    featured: true,
    sections: [
      {
        heading: 'Browse and switch folders',
        body: 'The folder chip in the gallery header opens a full tree — expand branches with the chevron, see item counts per folder, and click a row to jump straight into that folder view.',
        steps: [
          { text: 'Click the folder name chip in the gallery header to open the picker.', icon: 'Folder' },
          { text: 'Use the chevron on a row to expand or collapse its subfolders.', icon: 'Layers' },
          { text: 'Click any folder row to switch the gallery to that folder.', icon: 'Check' },
        ],
      },
      {
        heading: 'Drag to reorder or nest',
        body: 'Folder rows are draggable. The drop zone tells you what will happen before you release — a thick teal line above or below means reorder among siblings; highlighting the whole row means move inside that folder.',
        steps: [
          { text: 'Drag a folder row by its name area (not Inbox).', icon: 'FolderInput' },
          { text: 'Hover the top quarter of another row to insert above it — watch for the top border line.', icon: 'ArrowRight' },
          { text: 'Hover the bottom quarter to insert below — watch for the bottom border line.', icon: 'ArrowRight' },
          { text: 'Drop on the middle of a row to nest the dragged folder inside it — the row highlights in teal.', icon: 'Folder' },
        ],
      },
      {
        heading: 'Right-click and row actions',
        body: 'Every folder supports a context menu from a right-click, and a compact ⋮ menu for the same actions. Menus render above the trigger when you are near the bottom of the screen so nothing gets cut off.',
        steps: [
          { text: 'Right-click a folder row for Open, Add subfolder, Instructions, Rename, or Delete.', icon: 'Pencil' },
          { text: 'Or click the ⋮ button on the row for the same actions in a dropdown.', icon: 'Layers' },
          { text: 'Right-click the Folders header label to create a new top-level folder.', icon: 'Folder' },
        ],
      },
      {
        heading: 'Instructions and where new work lands',
        body: 'Add custom instructions on any folder; subfolders inherit them unless they define their own. Generations you create while viewing a folder are saved into that folder automatically.',
        steps: [
          { text: 'Open a folder’s menu and choose Add instructions or Edit instructions.', icon: 'BookOpen' },
          { text: 'Generate or refine while that folder is selected — the tile stays in that folder.', icon: 'Sparkles' },
        ],
      },
    ],
  },
  {
    id: 'v0.17.0-slideshow-and-safer-deletes',
    title: 'Fullscreen slideshow, calmer canvas, safer deletes',
    summary:
      'Press F to enter a folder-scoped slideshow, double-tap any delete, and bulk-delete selected tiles.',
    blurb:
      "A handful of viewing and editing upgrades land together. Press F on any tile to open a fullscreen slideshow scoped to your active folder, with cursor and chrome that fade out after five seconds of stillness. Every destructive button across the app now uses double-tap-to-confirm — one click arms it, a second click within three seconds fires — and the selection-mode toolbar gains a bulk Delete next to Move-to-folder. Behind the scenes, Gemini image generation falls back to Nano Banana Pro when Nano Banana 2 is unavailable, and SVG generation gives you a real, actionable error instead of a generic 'API key not valid'.",
    publishedAt: Date.parse('2026-05-15T15:00:00Z'),
    version: '0.17.0',
    image: '/whats-new/whatsnew-v0.17.0.png',
    featured: true,
    sections: [
      {
        heading: 'Fullscreen slideshow mode',
        body: 'A new immersive viewer for any tile, scoped to the folder you are currently browsing. Chrome stays out of the way until you ask for it, the cursor fades after five seconds, and arrow keys walk the folder you actually have open instead of the entire global history.',
        steps: [
          { text: 'Open a tile in the main preview, then press F to enter slideshow.', kbd: 'F' },
          { text: 'Use the arrow keys to walk through your active folder.', icon: 'ArrowRight' },
          { text: 'Press H to toggle the chrome overlay back on if you want the controls.', kbd: 'H' },
          { text: 'Press Esc (or F again) to exit slideshow.', kbd: 'Esc' },
        ],
      },
      {
        heading: 'Calmer main canvas',
        body: 'The same idle-fade behavior now applies to the regular main preview. Five seconds of a stationary mouse hides the cursor and every hover-revealed control — history arrows, version dropdown, refinement rail, action buttons — so the image owns the viewport while you look at it. Move the mouse and everything reappears.',
        steps: [
          { text: 'Hover the preview area, then leave the mouse still for five seconds.' },
          { text: 'Watch the chrome and cursor fade out together.', icon: 'EyeOff' },
          { text: 'Move the mouse to bring everything back instantly.', icon: 'Eye' },
        ],
      },
      {
        heading: 'Double-tap to delete, anywhere',
        body: 'A new shared confirm pattern means every destructive button in the app now arms on first click and fires on second click within three seconds — no more accidental deletes from a stray tap, and no more modal dialog that some users had silenced via preferences. The arm window auto-resets so a forgotten arm never lingers.',
        steps: [
          { text: 'Click any delete button — trash icons on tiles, version-rail thumbnails, or the new bulk-delete in selection mode.', icon: 'Trash2' },
          { text: 'The button turns amber and pulses for a few seconds — that is the armed state.' },
          { text: 'Click again within three seconds to confirm; ignore it and the button quietly disarms.', icon: 'Check' },
        ],
      },
      {
        heading: 'Bulk-delete selected tiles',
        body: 'Selection mode used to only support move-to-folder and bulk-export. Now there is a Delete button next to those, using the same double-tap pattern — pick any number of tiles, click the trash, click it again to confirm.',
        steps: [
          { text: 'Click the Select-items button in the gallery toolbar to enter selection mode.', icon: 'CheckSquare' },
          { text: 'Click any tile to toggle its selection — the corner checkbox is the visible cue.' },
          { text: 'Click the red trash button in the selection toolbar to arm bulk-delete, then click it again to fire.', icon: 'Trash2' },
        ],
      },
      {
        heading: 'Quieter header, smarter fallbacks',
        body: 'The header now only carries Avatar, Focus, and Bell on the right side — GitHub moved into the user dropdown for signed-in users. Nano Banana Pro takes over automatically when Nano Banana 2 is unavailable, with the actual model that produced the image recorded on the version. And SVG generation surfaces a real diagnosis when Google rejects a key, naming every model that was tried and pointing at AI Studio for project-level enablement.',
        steps: [
          { text: 'Click your avatar in the header to find GitHub plus the dark-mode toggle in one place.' },
          { text: 'Drop a PDF onto the prompt textarea to use it as a style reference, same flow as image drops.' },
          { text: 'If a Gemini image fails on Nano Banana 2, the app retries on Nano Banana Pro automatically.', icon: 'Sparkles' },
        ],
      },
    ],
  },
  {
    id: 'v0.16.1-gallery-polish',
    title: 'Bulk move shows progress now',
    summary:
      'A spinner banner and dimmed tiles make it obvious when a folder move is still in flight.',
    blurb:
      "Moving fifty tiles to another folder used to look like the gallery had frozen for a few seconds — Firestore writes them one at a time, but nothing on screen said so. Now a sticky banner with a spinner tracks the operation and the affected tiles dim and pulse until every write lands. Plus a few smaller fixes: the What's New spotlight no longer flashes on reload, the info button on the main preview tucks itself away when the info card is open, and refinement-panel tooltips only appear on hover the way tooltips should.",
    publishedAt: Date.parse('2026-05-15T12:00:00Z'),
    version: '0.16.1',
    image: '/whats-new/whatsnew-v0.16.1.png',
    sections: [
      {
        heading: 'Watch the bulk move',
        body: 'When you pick a destination folder during selection mode, a banner appears at the bottom of the gallery the instant the move starts and stays until every tile has finished writing.',
        steps: [
          {
            text: 'Enter selection mode and check the tiles you want to relocate.',
            icon: 'Check',
          },
          {
            text: 'Open the "Move to folder" picker and pick a destination.',
            icon: 'Layers',
          },
          {
            text: 'Watch the banner — affected tiles dim and pulse until the move lands, then a confirmation toast wraps things up.',
            icon: 'Sparkles',
          },
        ],
      },
      {
        heading: 'Quieter loading and tooltips',
        body: "A handful of supporting fixes shipped alongside the progress banner — small things that returning users will feel even if they never read this page.",
        steps: [
          {
            text: "No more spotlight flash on reload for users who've already dismissed the latest announcement.",
          },
          {
            text: "The info card on the main preview tucks to the bottom-right, and the toggle button hides itself while the card is open.",
          },
          {
            text: "Refinement-panel tooltips only appear when you actually hover the button — they were leaking through a Tailwind class collision before.",
          },
        ],
      },
    ],
  },
  {
    id: 'v0.16.0-whats-new',
    title: "Meet the What's New panel",
    summary: 'Every release highlight now lives behind a bell in the header.',
    blurb:
      "A bell in the header collects every release highlight, with a red dot when something is new. Big releases also get a one-time spotlight modal that dismisses for good once you've seen it — so the same announcement never bugs you twice.",
    publishedAt: Date.parse('2026-05-12T22:00:00Z'),
    version: '0.16.0',
    image: '/whats-new/whatsnew-panel.png',
    featured: true,
    sections: [
      {
        heading: 'Read the bell',
        body: 'Every recent update lives behind the bell. A red badge appears whenever a new entry has shipped since you last opened it.',
        steps: [
          { text: 'Open the bell in the top-right of the header.', icon: 'Bell' },
          { text: 'Scroll the dropdown to skim every update in reverse chronological order.' },
          { text: 'Click any row to jump straight to that release\u2019s full guide.', icon: 'ArrowRight' },
        ],
      },
      {
        heading: 'Browse the discovery page',
        body: 'For a more visual experience, the full-page view gives each release a hero illustration and breathing room.',
        steps: [
          { text: 'Open the bell.', icon: 'Bell' },
          { text: 'Click \u201cView all updates\u201d at the very bottom of the dropdown.', icon: 'ArrowRight' },
          { text: 'Click the hero card or any card in the grid to read its guide.' },
        ],
      },
      {
        heading: 'Handle the spotlight modal',
        body: 'When we ship something big, a single one-time modal pops up on app load. Dismissing it remembers your preference per account so it never re-fires.',
        steps: [
          { text: 'Click \u201cRead the guide\u201d for a step-by-step walkthrough of the new feature.', icon: 'BookOpen' },
          { text: 'Or click \u201cGot it\u201d to dismiss and move on.', icon: 'Check' },
          { text: 'Press Esc or click the backdrop \u2014 same result, dismisses and remembers.', kbd: 'Esc' },
        ],
      },
    ],
  },
  {
    id: 'v0.15.0-prompt-image-drop',
    title: 'Drop an image into the prompt box',
    summary: 'Drag a reference image onto the prompt to expand it or use it as style.',
    blurb:
      'Drag any reference image onto the prompt and pick a path: generate a content prompt that respects your toolbar menus, or use the image as a style reference for the next run. Multi-prompt JSON arrays now work too — paste an array of strings to fan out a batch.',
    publishedAt: Date.parse('2026-05-12T00:00:00Z'),
    version: '0.15.0',
    image: '/whats-new/whatsnew-prompt-drop.png',
    sections: [
      {
        heading: 'Drop an image onto the prompt',
        body: 'Drag any image file from your desktop directly onto the prompt textarea. A picker will ask how you want to use it.',
        steps: [
          { text: 'Drag an image file from Finder, the desktop, or another browser tab.', icon: 'Upload' },
          { text: 'Drop it anywhere on the prompt input.', icon: 'Image' },
          { text: 'Choose \u201cUse as content prompt\u201d to expand a prompt from it, or \u201cUse as style reference\u201d to attach it to the next run.', icon: 'Wand2' },
        ],
      },
      {
        heading: 'Paste multi-prompt arrays',
        body: 'Run a batch of variations in one shot by pasting a JSON array of prompts. Each string becomes its own generation tile.',
        steps: [
          { text: 'Compose your prompts as a JSON array, e.g. ["tile one", "tile two", "tile three"].' },
          { text: 'Paste the array into the prompt input.', icon: 'Clipboard' },
          { text: 'Submit \u2014 each entry runs as a separate tile in the gallery.', icon: 'Sparkles' },
        ],
      },
    ],
  },
  {
    id: 'v0.14.0-cmdk-search',
    title: 'Cmd+K to find any past generation',
    summary: 'Press Cmd+K to instantly search recent generations by prompt text.',
    blurb:
      'Hit Cmd+K (or Ctrl+K) anywhere in the app to search recent tiles by prompt. Arrow keys move, Enter opens, Escape closes — your gallery is now one keystroke away.',
    publishedAt: Date.parse('2026-05-08T00:00:00Z'),
    version: '0.14.0',
    image: '/whats-new/whatsnew-search.png',
    sections: [
      {
        heading: 'Search from anywhere',
        body: 'No more scrolling the history rail to find that one tile from yesterday. Just type.',
        steps: [
          { text: 'Press the search shortcut anywhere in the app.', kbd: 'Cmd+K' },
          { text: 'Type any words from a past prompt.', icon: 'Search' },
          { text: 'Use the arrow keys to move between matches.' },
          { text: 'Press Enter to open the selected tile.', kbd: 'Enter' },
          { text: 'Press Escape to close without selecting.', kbd: 'Esc' },
        ],
      },
    ],
  },
  {
    id: 'v0.13.0-byok-analysis-paths',
    title: 'Run analysis and Expand prompt now work with OpenAI keys',
    summary: 'GPT Image users with only an OpenAI key can now run brand analysis and prompt expansion.',
    blurb:
      "If you're a GPT Image user with only an OpenAI key configured, Run analysis and Expand prompt route through gpt-4o-mini automatically. The refine-prompt editor also got a full-screen modal that auto-opens when an analysis plan is ready.",
    publishedAt: Date.parse('2026-05-06T00:00:00Z'),
    version: '0.13.0',
    image: '/whats-new/whatsnew-byok.png',
    sections: [
      {
        heading: 'Brand analysis with an OpenAI key',
        body: 'Brand analysis used to require a Gemini key. It now routes automatically through `gpt-4o-mini` whenever only an OpenAI key is configured.',
        steps: [
          { text: 'Open Settings from the user menu.', icon: 'Settings' },
          { text: 'Paste your OpenAI key under API Keys and save.', icon: 'KeyRound' },
          { text: 'Open the brand panel and click \u201cRun analysis\u201d \u2014 no extra config required.', icon: 'Wand2' },
        ],
      },
      {
        heading: 'Expand prompt routing',
        body: 'The same routing applies to the Expand prompt button next to the prompt input.',
        steps: [
          { text: 'Click \u201cExpand prompt\u201d beside the prompt box.', icon: 'Sparkles' },
          { text: 'The refine-prompt modal opens automatically once the plan is ready.' },
          { text: 'Accept, tweak, or discard the suggestion.', icon: 'Check' },
        ],
      },
    ],
  },
  {
    id: 'v0.12.0-overwrite-presets',
    title: 'Overwrite saved toolbar presets',
    summary: 'Update a saved preset in place when the toolbar changes.',
    blurb:
      'Found a better combination for a preset you already saved? An Overwrite button now appears whenever the live toolbar differs from a preset, so you can update it in place without deleting and re-creating it.',
    publishedAt: Date.parse('2026-05-06T00:00:00Z'),
    version: '0.12.0',
    image: '/whats-new/whatsnew-presets.png',
    sections: [
      {
        heading: 'Overwrite a preset in place',
        body: 'When the live toolbar configuration drifts from the loaded preset, an Overwrite button appears next to the preset name so you can save the new combination over the existing one.',
        steps: [
          { text: 'Load a preset from the preset dropdown.', icon: 'Layers' },
          { text: 'Tweak any toolbar option \u2014 colors, styles, aspect ratio, etc.', icon: 'Pencil' },
          { text: 'Spot the Overwrite button next to the preset name.', icon: 'Save' },
          { text: 'Click it to commit the new combination over the preset.', icon: 'Check' },
        ],
      },
    ],
  },
];
