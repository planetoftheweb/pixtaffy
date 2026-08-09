# Project Agents & Architecture

## Core Philosophy
PixTaffy is an AI-powered design studio helper that streamlines brand asset creation.
We prioritize:
- **Clean, Maintainable Code:** Modular services and components.
- **Modern React Patterns:** Hooks, Functional Components, Composition.
- **Type Safety:** Strict TypeScript interfaces for all data structures.
- **Efficient Styling:** Tailwind CSS v4 with CSS-first configuration.
- **Robust Data Management:** Normalized Firestore database and Firebase services.

## Agents & Roles
This project is designed to be worked on by specialized AI agents.

### 1. Frontend Agent
**Focus:** UI/UX, React Components, Styling.
- Manages `App.tsx` layout and routing.
- Maintains UI components in `/components` (`ControlPanel`, `ImageDisplay`, `CatalogPage`, `SettingsModal`, `BrandAnalysisModal`).
- Ensures responsive design and dark mode compatibility via Tailwind CSS.
- Handles user interactions and visual feedback (loading states, toasts, modals).
- **Configuration Safety:** Implements a "Configuration Error" screen in `App.tsx` to block app usage if critical `.env` variables are missing.
- **Toolbar Consistency:** Model selector and toolbar dropdowns use the same fancy button/dropdown styling (teal labels, hover overlays, responsive text hiding) for a consistent UX.
- **Model Labels & Overlays:** Support customizable per-model labels (e.g., GPT Image, Nano Banana) applied across toolbar, previews, and history tags, with full prompt/model/timestamp overlays on large previews.

### 2. Service Agent
**Focus:** Business Logic, API Integrations, Data Management.
- **Authentication:** `authService.ts` (Firebase Auth & User Profile management).
- **AI Integration:** `geminiService.ts`.
    - **Image Generation:** MUST use `gemini-3-pro-image-preview` for Gemini and `gpt-5` for OpenAI.
    - **Text/Analysis:** Use `gemini-flash-latest` (Google's always-current Flash alias) for brand analysis, correction analysis, prompt expansion, and image-description calls. Pinning to a specific version like `gemini-2.5-flash` caused `400 / API_KEY_INVALID` rejections for users whose key/project didn't have that exact version enabled, even when image-gen against the same key worked fine.
    - **Multi-Model Support:** Architecture supports different API keys for different models via User Preferences.
- **Data Persistence:** 
    - `resourceService.ts` (Fetches unified System + Custom resources with scoping).
    - `historyService.ts` (Manages Generation History with Local/Remote sync).
    - `teamService.ts` (Manages Team creation and membership).
    - `catalogService.ts` (Reads public resources for the community view).
- **File Management:** `imageService.ts` (Firebase Storage uploads).
- **Database Structure:** `structureSeeder.ts` (Admin-only seeding of default assets).
- **Security Check:** Always verify Firestore Security Rules when modifying collection access patterns. Ensure `users/{userId}` allows read/write for the authenticated owner.

### 3. DevOps Agent
**Focus:** Build, Deployment, Configuration.
- Manages `vite.config.ts` and `package.json`.
- Handles Environment Variables configuration (`.env`).
- Configures Firebase Security Rules (Firestore & Storage).
- Manages deployment pipelines (Render Static Sites).

## Context & Tech Stack
- **Framework:** React 19 + Vite
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 + PostCSS
- **Backend / BaaS:** Firebase (Auth, Firestore, Storage)
- **AI Model:** Google Gemini 3 Pro Image Preview - STRICTLY ENFORCED
- **Billing:** BYOK (Bring Your Own Key) only. System keys are disabled to prevent cost overruns.
- **Icons:** Lucide React
- **Fonts:** Mona Sans & Inter (Locally hosted)

## Data Architecture
The project uses a **Normalized Database Structure** in Firestore to allow efficient sharing and scalability.

### Collections
1.  **`users`**: User profiles, preferences, and private generation history.
2.  **`teams`**: Team definitions and member lists.
3.  **Resource Collections** (The "Spreadsheet" Tables):
    *   `graphic_types`
    *   `visual_styles`
    *   `brand_colors`
    *   `aspect_ratios`
    *   *Note:* These collections store ALL items. Visibility is controlled by the `scope` field (`system`, `private`, `public`, `team`) and `ownerId` / `teamId`.

## Development Guidelines
1.  **Service-Oriented:** Keep business logic out of UI components. Use services.
2.  **Sanitization:** Always sanitize data before sending to Firestore (remove symbols/functions).
3.  **Security:** Respect Firestore Security Rules. User operations must be scoped to their `auth.uid`.
4.  **Types:** Update `types.ts` immediately when data structures change.
5.  **Rules Sharing:** When providing Firestore/Storage security rules, do **not** create files—respond with copyable code blocks only.
6.  **Testing Permissions:** When changing data fetch logic, verify corresponding Firestore Rules. Use the "Configuration Error" or console logs to identify `Missing Permissions` errors early.
