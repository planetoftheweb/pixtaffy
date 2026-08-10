# PixTaffy

![PixTaffy](./screenshot.png)

An AI-powered brand design studio that helps you generate cohesive visual assets using Google Gemini, OpenAI, and OpenRouter models.

**Website:** [pixtaffy.com](https://pixtaffy.com)

## Features

*   **🎨 AI Graphic Generation:** Create logos, icons, social media posts, and banners.
*   **🧩 Brand Consistency:** Enforce color palettes and visual styles across all generated assets.
*   **👥 Teams & Collaboration:** Create teams and share styles/colors with your teammates.
*   **🛠️ Smart Resource Management:** 
    *   Organized dropdowns (Defaults, Private, Team, Public).
    *   Search and filter capabilities.
    *   Admin controls for System Defaults.
*   **🔎 Quick search:** **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux) opens a search palette over your generation history—filter by prompt text, arrow through results, Enter to jump to a tile.
*   **🖱️ Drop an image into the prompt box:** Drag an image onto the prompt textarea to (a) **generate a content prompt** that respects your toolbar menus (no layout/style/palette/aspect-ratio noise) or (b) **use the image as a style reference** with two influence modes — _image overrides menu style_ or _menus override image style_. Falls back to OpenAI `gpt-4o-mini` vision when Google rejects the Gemini key for Flash text/vision.
*   **📦 Multi-prompt batches:** Enter a JSON array like `["headline tile", "icon {a,b}", "footer"]` in the prompt box and each top-level entry generates as its own tile (brace expansion still applies inside each entry).
*   **📂 Normalized Database:** Uses a smart "spreadsheet-like" structure to manage resources with flexible scoping (`private`, `public`, `team`, `system`).
*   **🌍 Community Catalog:** Browse public items shared by other users.
*   **💾 Cloud History:** Automatically saves your generation history with metadata in Firestore and raster image bytes in Firebase Storage (`users/{uid}/history/{generationId}/{versionId}.{ext}`), so tiles never bump into the 1 MiB Firestore document limit and deletes clean up Storage automatically.
*   **🖼️ Smart Analysis:** Upload brand guidelines (PDF/Image) to extract colors and styles with an interactive review modal.
*   **✨ PixTaffy AI tools:** Prompt expansion, naming, image analysis, correction analysis, style extraction, region detection, and brand-guideline analysis run through a server-side Gemini key and consume 0.1 to 0.5 PixTaffy credit. BYOK remains free for image generation only.
*   **🍬 Guest credits:** New visitors receive 3 credits before registering. GPT Image 2 is selected by default, leaving one credit for a second Standard image. Firebase Anonymous Auth, App Check, idempotency, browser and network limits, and the daily provider circuit breaker protect the guest path.
*   **👤 User Profiles:** Sign up with Email or Username. Sync preferences across devices.
*   **⚙️ Full Settings Management:** dedicated page for managing API keys, profile settings, and application preferences.
*   **🔑 BYOK (Bring Your Own Key):** Multi-model keys for Google Gemini and OpenAI. A single OpenAI key drives three tiers — **GPT Image 2** (flagship, 2K/4K, 3:1 & 1:3 ratios), **GPT Image Mini** (budget), and **GPT Image 1.5** (legacy) — with a per-model **Quality** control (Auto / Low / Medium / High).
*   **💳 Optional PixTaffy credits:** Verified accounts receive 10 starter credits for 30 days. Credit packs and Taffy Studio fund curated OpenRouter image models without exposing shared provider keys to the browser.
*   **💬 Feedback to GitHub:** Bugs, ideas, questions, and screenshots can be sent from the footer or account menu. A protected Cloud Function saves the private contact record and opens a labeled issue in `planetoftheweb/pixtaffy`.
*   **🧠 Refinement Workspace:** Per-image refine model + target size controls, built-in **Run analysis** correction-plan generator (Gemini Flash vision or OpenAI `gpt-4o-mini` vision + JSON, matching your configured keys), and style-reference fallback for difficult recompositions.
*   **🧬 Versioned Iteration:** Mark-based generation/refinement history with restore, per-refinement deletion, and per-version aspect-ratio tracking so follow-up edits keep the correct size.
*   **📝 Better Prompt Editing:** Compact refine textbox with optional **full-screen prompt editor** (opens after Run analysis or via **Open full editor**), **Escape** to close, and keyboard submit shortcut (`Cmd/Ctrl + Enter`).
*   **📋 Clipboard-friendly UX:** Copy prompts, image URLs, or the actual images with centered toast feedback for every action (generate, download, delete, restore). Overlays show model, prompt, tags, and timestamps.
*   **⚡ Batch generation:** Numeric `QTY` plus brace expansion in prompts, pre-send size and duration estimates, and one history tile with Mark I / II / III grouping (with per-mark expanded prompts and thumbnails).
*   **🪟 Concurrent background runs:** Each Generate click runs as its own backgrounded job — the toolbar stays unblocked so you can keep typing or fire off another run, and a floating "Active Generations" monitor surfaces every job with elapsed/ETA, throughput-aware estimates, per-model progress chips, a "View latest result" jump, and per-job stop / dismiss controls. The monitor docks to a small "X running · Y queued" pill when it's in the way so it doesn't cover the main preview, and the canvas clears to a "Generating…" state the instant a new run starts so you always know your click registered. Each batch row also surfaces queued items (not just in-flight ones), so a 3-image batch never looks like only 2 generations are happening.
*   **🆚 Comparison mode:** Generate across multiple models, then compare marks inline in the main viewport with a swipe slider (plus side-by-side export) and shift-click quick-pick from thumbnails/history.
*   **⬇️ Unified downloads:** Single download menu on the main preview and in history for PNG, WebP, SVG, or HTML; download-all zips every generation mark; export selected tiles as a ZIP from Recent Generations.
*   **🖼️ Thumbnail rail:** When a tile has multiple marks, browse and preview versions from a left rail. The rail itself docks until you hover the preview area so the image fills the viewport at rest, but stays visible while you're picking two marks to compare. Hover-preview popovers anchor to the hovered thumb's viewport position so they always stay fully on-screen, even at the top of the page.
*   **🎯 Focus mode:** The whole toolbar options row + prompt input collapses together so the main preview gets the full vertical real estate. A header `Minimize` / `Maximize` button pins the choice manually, the toolbar auto-collapses on the slightest scroll-down (and only restores when you come back to the top), and selecting any new tile auto-collapses by default. Auto-collapse pauses while you're typing so it never yanks itself away mid-keystroke. Inside the preview, the version chip, action buttons, carousel arrows, position counter, and compare overlay all hide until you hover the image — and disappear entirely while you drag the comparison slider divider so nothing competes with the image. The canvas chrome _and_ the cursor itself fade after ~4 seconds of no input on the preview, so quietly studying an image leaves zero UI noise on top of it.
*   **▶️ Fullscreen slideshow:** The preview toolbar's **Play** button opens a fullscreen viewer that walks every Mark of the active tile with `←` / `→` keys, an on-screen progress dot row, and visible-but-fading prev/next chevrons. Same idle-hide treatment as the regular preview — chevrons, dot row, exit affordance, and the cursor all fade after ~4 seconds, so the image fills the screen without competition; the next mouse move or key press brings everything back. `Esc` exits.
*   **⬅️➡️ Carousel viewer:** Step the main viewer through your recent-generations history one tile at a time with prev/next arrow buttons or ←/→ keyboard shortcuts — and ↑/↓ cycles the Marks (Mark I, II, …) on the current tile with wrap. Hovering either arrow surfaces a rich popover that names the shortcuts so they stay discoverable without an onboarding tour. Arrows stay clear of the comparison slider when it's open. Stepping to a neighboring generation always snaps to its most-recent Mark so chains read top-to-bottom without the viewer reverting to Mark I.
*   **🗂️ Customizable gallery:** Recent Generations supports a thumbnail size dropdown (Tiny / Small / Medium / Large), an optional details panel under each tile (prompt + tag chips), and pagination for folders over 50 tiles (configurable 25 / 50 / 100 / 200 items per page). All three preferences persist to localStorage. Per-tile action buttons stay out of the way until you hover.
*   **📁 Folders:** Group generation tiles into named folders with an always-present `Inbox`, a sticky pin that controls which folder new tiles land in, a single dropdown picker that shows the active folder's name + count and lists every folder with inline pin/rename/delete plus `+ New folder` actions, bulk **Move to folder** _and_ bulk **Delete** from selection mode (double-tap to confirm), and rename / delete (deleting a folder sweeps its tiles into Inbox). The last-viewed folder persists to `localStorage` so the gallery returns to where you left off. Folders themselves persist on the user document for signed-in users and in `localStorage` for guests, so the gallery looks the same before and after sign-in.
*   **🔖 Toolbar presets:** Save the current toolbar configuration (graphic type, visual style, color scheme, aspect ratio, SVG mode, model, OpenAI quality) as a named preset and recall it from the Bookmark dropdown with one click. Partial-snapshot semantics let you save narrow presets (e.g. just a style + palette) that compose with the rest of the toolbar. When a preset differs from the live toolbar, **Overwrite with current toolbar** updates it in place without creating a duplicate name.
*   **🖼️ Offline-resilient images:** Generation thumbnails and profile photos are mirrored into an IndexedDB blob cache so they keep loading even when Firebase Storage is blocked by a VPN, captive portal, or transient DNS hiccup. A background backfill seeds the cache after the first healthy session; reserved cache namespaces keep history-driven eviction from touching profile photos.
*   **📄 Site footer:** Copyright plus quick links to the changelog and GitHub releases.
*   **🛡️ Admin panel:** Claims-based admin role (Firebase Auth custom claims, not a hardcoded username) with a compact, information-dense user table — expandable rows for full profile details, icon-based status pills (model, keys, admin, suspension) with hover tooltips, relative "last seen" times, and a sticky action column for clear API keys, wipe system prompts, suspend / unsuspend accounts, promote or demote admins, and conservatively delete user data (Firestore + Storage + Auth). Suspended users are hard-blocked with a clear notice. Admin accounts also keep an unbounded generation history (no `REMOTE_LIMIT` eviction) and the gallery loads the full set client-side via paginated Firestore reads, so legacy / audit assets are always reachable.
*   **📊 Admin usage stats:** Live dashboard with total images generated, refinements, active users, signups/day and images/day for the last 30 days, breakdowns by model / graphic type / visual style / aspect ratio, and a top-users leaderboard — aggregated directly from Firestore with one `collectionGroup('history')` query. Drill into any user from the leaderboard for a focused single-user snapshot (timeline, totals, top buckets) that scans only that user's history subcollection.

## Tech Stack

*   **Frontend:** React 19, TypeScript, Vite
*   **Styling:** Tailwind CSS v4 (CSS-first configuration)
*   **Backend / BaaS:** Firebase
    *   **Authentication:** Email/Password & Profile Management
    *   **Firestore:** Real-time NoSQL Database (Normalized Structure)
    *   **Storage:** Profile photos & Asset storage
*   **AI:** Google Gemini (`gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`, `gemini-flash-latest`) and OpenAI (`gpt-image-2`, `gpt-image-1-mini`, `gpt-image-1.5`)
*   **Icons:** Lucide React
*   **Font:** Mona Sans & Inter

## Getting Started

### Prerequisites

*   Node.js (v18 or higher)
*   A Google Gemini API Key
*   A Firebase Project (Auth, Firestore, and Storage enabled)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/planetoftheweb/pixtaffy.git
    cd pixtaffy
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up Environment Variables:**
    Create a `.env` (or `.env.local`) file in the root directory. **Keys must start with `VITE_`**.

    ```env
    # Firebase Configuration
    VITE_FIREBASE_API_KEY=your_firebase_api_key
    VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_bucket.appspot.com
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_id
    VITE_FIREBASE_APP_ID=your_app_id
    VITE_FIREBASE_APPCHECK_SITE_KEY=your_recaptcha_enterprise_site_key
    ```
    *Note: The app includes a built-in "Configuration Error" screen that will alert you if any of these keys are missing.*

    When a local preview calls App Check protected production Functions, add a registered Firebase App Check debug token as `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN`. Keep that token in the ignored `.env` or `.env.local` file. Never commit it or include it in a production build.

    PixTaffy's shared OpenRouter, Gemini, and GitHub credentials must not use `VITE_` variables. Store them as Firebase Function secrets named `OPENROUTER_API_KEY`, `PIXTAFFY_GEMINI_API_KEY`, and `GITHUB_TOKEN`. The GitHub token needs Issues read/write access to `planetoftheweb/pixtaffy`.

4.  **Configure Firebase Storage CORS:**
    To allow image uploads from localhost and your production domain, you must apply CORS rules to your Storage bucket.
    
    *   Ensure `cors.json` exists in your project root.
    *   Run this command (requires `gsutil` or Google Cloud CLI):
        ```bash
        gsutil cors set cors.json gs://<your-bucket-name>
        ```

5.  **Start the development server:**
    ```bash
    npm run dev
    ```

## Database Structure

The application uses a normalized Firestore structure with **Row-Level Security** based on scopes:

*   `/users/{userId}`: User profiles and private settings.
*   `/teams/{teamId}`: Team metadata and member lists.
*   `/visual_styles`, `/brand_colors`, `/graphic_types`, `/aspect_ratios`: 
    *   Unified collections storing **all** items.
    *   `scope`: Determines visibility (`system`, `private`, `public`, `team`).
    *   `ownerId`: The user who created the item.
    *   `teamId`: Required if scope is `team`.

## Building for Production

To create a production build:

```bash
npm run build
```

The output will be in the `dist` directory.

## API & MCP access

Signed-in users can generate through the HTTPS API or the bundled MCP server
(Claude Code / Claude Desktop / Codex) using personal `bdi_…` tokens created
in **Settings → API access**. Tokens are hashed at rest, generate-only, and
rate-limited per account; generation always uses the account's own BYOK model
keys. The bundled server supports MCP 2026-07-28 and legacy clients, and
requires Node.js 20 or newer. See [`mcp/README.md`](./mcp/README.md) for setup
and the raw HTTP contract.

## Deployment

PixTaffy is hosted on Firebase Hosting, with Firebase Functions, Firestore, and Storage in the `brandoit` project. Deploy the frontend and protected backend with the Firebase CLI after the production build and test gates pass.

## License

MIT

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for a full, versioned history of changes.
