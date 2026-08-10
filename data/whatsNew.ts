import type { WhatsNewEntry } from '../types';

/**
 * Curated What's New entries, the single source of truth for the bell
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
 *   - This is a product-news surface, not a copy of CHANGELOG.md. Add an
 *     entry only for a substantial public launch that introduces a meaningful,
 *     repeatable user capability or a major product change.
 *   - Bug fixes, patches, polish, admin tools, support plumbing, dependency
 *     work, and infrastructure changes stay in CHANGELOG.md without a card.
 *   - Entries stay sorted descending by `publishedAt`; the first is the
 *     "hero" on the discovery page.
 *   - Every release gets its own artwork and image path. Never reuse a
 *     thumbnail from another entry; the prebuild check enforces this for
 *     the current release.
 *   - One entry per release; mark the headline release with
 *     `featured: true` to trigger the one-time spotlight modal.
 *
 * Icons in steps reference Lucide-react icon names that the detail view
 * resolves via its `ICON_MAP` allowlist; unknown names fall back to a
 * neutral help glyph so a typo never crashes the page.
 */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: 'v0.30.0-guest-credits',
    title: 'Try GPT Image 2 before you sign up',
    summary:
      'Every new visitor now starts with three guest credits and GPT Image 2 ready to create their first image.',
    blurb:
      'You can now make a meaningful first image before creating an account. PixTaffy starts new visitors with three guest credits and selects GPT Image 2, which uses two credits. Use the remaining credit on a Standard model, then create an account and verify your email whenever you want ten starter credits and cloud-saved work.',
    publishedAt: Date.parse('2026-08-10T23:13:00Z'),
    version: '0.30.0',
    image: '/whats-new/whatsnew-v0.30.0.webp',
    featured: true,
    sections: [
      {
        heading: 'Start with a stronger first image',
        body: 'GPT Image 2 is selected when a new visitor opens the studio. The toolbar shows both the two-credit generation cost and the three-credit guest balance before anything runs.',
        steps: [
          { text: 'Click Create your first image from the welcome page.', icon: 'Sparkles' },
          { text: 'Write a prompt and create it with GPT Image 2.', icon: 'Image' },
          { text: 'Switch to a one-credit Standard model when you want to use the remaining guest credit.', icon: 'ArrowRight' },
        ],
      },
      {
        heading: 'Keep going when you are ready',
        body: 'Guest images stay in the current browser. Creating an account moves the work into cloud history, and email verification adds ten starter credits that last for 30 days.',
        steps: [
          { text: 'Download guest work immediately or create an account to sync it.', icon: 'Check' },
          { text: 'Verify your email to receive ten starter credits.', icon: 'Sparkles' },
          { text: 'Bring your own provider key whenever you want image generation without PixTaffy credits.', icon: 'KeyRound' },
        ],
      },
    ],
  },
  {
    id: 'v0.29.0-welcome-to-pixtaffy',
    title: 'Take the new PixTaffy studio tour',
    summary:
      'First-time visitors get a proper welcome page, a clear feature tour, and a direct path to creating with guest credits.',
    blurb:
      'The candy crew finally has a front door. New visitors can see how brand settings, image models, AI helpers, saved versions, and Build Studio fit together before they make anything. One button takes them straight into the studio with three guest credits, no signup form, and no second popup in the way. Members can reopen the tour from the account menu whenever they want.',
    publishedAt: Date.parse('2026-08-10T02:00:00Z'),
    version: '0.29.0',
    image: '/whats-new/whatsnew-v0.29.0.webp',
    featured: true,
    sections: [
      {
        heading: 'See the whole studio before signing up',
        body: 'The welcome page walks through brand-aware generation, model comparisons, AI workflow helpers, Build Studio, saved versions, and the choice between free BYOK and PixTaffy credits.',
        steps: [
          { text: 'Tour the feature set without creating an account.', icon: 'Eye' },
          { text: 'Create with three guest credits, then download the result immediately.', icon: 'Sparkles' },
          { text: 'Create an account when you want to save work and claim ten starter credits.', icon: 'ArrowRight' },
        ],
      },
      {
        heading: 'A smoother studio once you arrive',
        body: 'The toolbar notice now appears every time the toolbar scrolls away, and frame-name editing in Build Studio no longer moves the target between the two clicks.',
        steps: [
          { text: 'Scroll the toolbar away and the restore hint appears every time.', icon: 'Eye' },
          { text: 'Double-click a frame name without chasing a moving label.', icon: 'Edit' },
          { text: 'Press Enter to keep the name or Escape to cancel.', icon: 'Check' },
        ],
      },
    ],
  },
  {
    id: 'v0.26.1-first-image-free',
    title: 'Make your first image before signing up',
    summary:
      'New visitors can create and download images with guest credits before PixTaffy asks for an account.',
    blurb:
      'Sometimes you just want to see the thing work. Type a prompt and use three guest credits with no registration form in the way. GPT Image 2 starts selected and uses two credits, leaving one for a Standard model. Download the result immediately, then create an account to save it to your cloud history and verify your email for ten starter credits.',
    publishedAt: Date.parse('2026-08-09T21:00:00Z'),
    version: '0.26.1',
    image: '/whats-new/whatsnew-v0.26.1.webp',
    featured: true,
    sections: [
      {
        heading: 'Prompt first, account second',
        body: 'Guest images use the same protected server pipeline as paid generations. The toolbar shows the selected model cost and remaining guest balance, and every result is yours to download right away.',
        steps: [
          { text: 'Write a prompt and click Create your first image.', icon: 'Sparkles' },
          { text: 'Preview or download the finished image without registering.', icon: 'Download' },
          { text: 'Create an account to save it and verify your email for ten starter credits.', icon: 'ArrowRight' },
        ],
      },
    ],
  },
  {
    id: 'v0.26.0-sustainable-ai-credits',
    title: 'Starter credits, then pay as you go',
    summary:
      'PixTaffy includes ten starter credits, permanent credit packs, and a monthly Taffy Studio membership for site-funded AI.',
    blurb:
      'You can still bring your own image-generation key and use PixTaffy for free. When you want PixTaffy to handle the provider bill, verified accounts get ten starter credits, credit packs never expire, and Taffy Studio adds 100 credits every month with two-month rollover. Every paid model and AI helper shows its credit cost before it runs.',
    publishedAt: Date.parse('2026-08-09T20:30:00Z'),
    version: '0.26.0',
    image: '/whats-new/whatsnew-v0.26.0.webp',
    featured: true,
    sections: [
      {
        heading: 'Try site-funded AI with ten starter credits',
        body: 'Verify your email and PixTaffy adds ten credits that are good for 30 days. They work in the web studio for paid image models and AI workflow tools, so you can try the whole experience before buying anything.',
        steps: [
          { text: 'Create an account or sign in, then verify your email.', icon: 'Check' },
          { text: 'Open Pricing to see your balance and credit activity.', icon: 'Eye' },
          { text: 'Pick a paid model and review its exact credit cost before generating.', icon: 'Sparkles' },
        ],
      },
      {
        heading: 'Buy permanent credits or subscribe to Pro',
        body: 'Credit packs cost $6 for 25, $18 for 100, or $45 for 300, and purchased credits never expire. Taffy Studio costs $15 a month, adds 100 credits each billing period, and lets unused subscription credits roll over for up to two months.',
        steps: [
          { text: 'Choose a pack when you want credits without a subscription.', icon: 'CreditCard' },
          { text: 'Choose Taffy Studio for a fresh monthly balance and 2,000 saved generations.', icon: 'Layers' },
          { text: 'Use the billing portal anytime to update payment details or cancel.', icon: 'Settings' },
        ],
      },
      {
        heading: 'BYOK stays free',
        body: 'Your own image-generation keys still work without PixTaffy credits. Paid Gemini helpers use the PixTaffy balance so the cost is predictable and the provider keys stay safely on the server.',
        steps: [
          { text: 'Add your image provider key in Settings to keep generating free.', icon: 'KeyRound' },
          { text: 'Switch to a PixTaffy-funded model whenever you want one-click billing.', icon: 'ArrowRight' },
        ],
      },
    ],
  },
  {
    id: 'v0.25.0-pixtaffy',
    title: 'Say hello to PixTaffy',
    summary:
      'A new name, a new candy-bright brandmark, and a new home at pixtaffy.com.',
    blurb:
      'BranDoIt is now PixTaffy. Your account, gallery, presets, API tokens, and saved settings are still right where you left them. The app has a new transparent brandmark and a new home at pixtaffy.com, while the tools and workflows you already know keep working.',
    publishedAt: Date.parse('2026-08-09T16:00:00Z'),
    version: '0.25.0',
    image: '/whats-new/whatsnew-v0.25.0.webp',
    featured: true,
    sections: [
      {
        heading: 'Same studio, brighter sign out front',
        body: 'The new PixTaffy identity now appears throughout the app, exported files, API labels, and developer tools. Nothing in your workspace was reset or moved.',
        steps: [
          { text: 'Visit pixtaffy.com for the new permanent home.', icon: 'ExternalLink' },
          { text: 'Sign in with the same account and keep creating.', icon: 'Check' },
          { text: 'Existing API tokens and integrations continue to work.', icon: 'KeyRound' },
        ],
      },
    ],
  },
  {
    id: 'v0.24.0-api-and-mcp',
    title: 'Generate from anywhere, personal API tokens & an MCP server',
    summary:
      'Create a token in Settings and generate from Claude, Codex, or your own apps, your presets, your keys, safely rate-limited.',
    blurb:
      'PixTaffy now works wherever you do. Create a personal API token in Settings → API access and any external tool can generate as your account: the bundled MCP server plugs PixTaffy into Claude Code, Claude Desktop, or Codex, and the plain HTTPS API lets your own apps generate with one POST. Calls use your saved presets (including art direction), your default styles, and your own model keys, Gemini, OpenAI, and OpenRouter models all supported. Built safely: tokens are shown once and stored only as hashes, they are generate-only and can never read or change your settings or keys, every call is rate-limited per account, and one click revokes a token forever.',
    publishedAt: Date.parse('2026-07-05T14:00:00Z'),
    version: '0.24.0',
    image: '/whats-new/whatsnew-v0.24.0.webp',
    featured: true,
    sections: [
      {
        heading: 'Create a personal API token',
        body: 'Tokens live in Settings → API access. Each token is shown exactly once at creation, copy it then, and appears afterwards only as a name, a prefix, and its last-used date. You can hold up to five active tokens and revoke any of them instantly.',
        steps: [
          { text: 'Settings → API access → name the token for where it will live (e.g. "Claude MCP").', icon: 'KeyRound' },
          { text: 'Click Create token and copy the bdi_… value immediately.', icon: 'Clipboard' },
          { text: 'Revoke from the same list whenever a token is retired or exposed.', icon: 'Check' },
        ],
      },
      {
        heading: 'Plug PixTaffy into Claude or Codex',
        body: 'The repo ships an MCP server (mcp/) that exposes a generate_infographic tool. Point Claude Code, Claude Desktop, or Codex at it with your token in the environment, then just ask for graphics, by preset name, model, aspect ratio, and target folder.',
        steps: [
          { text: 'Add the server to your client config with PIXTAFFY_API_TOKEN set.', icon: 'Settings' },
          { text: 'Ask: "Generate an infographic about tides with my What\'s New Hero preset, 16:9."', icon: 'Sparkles' },
          { text: 'Results land in your PixTaffy gallery with hosted URLs returned to the chat.', icon: 'Image' },
        ],
      },
      {
        heading: 'Or call the HTTPS API from your own app',
        body: 'One POST with your token generates up to 15 images per request, resolves presets by name, saves to a gallery folder of your choice (or returns bytes inline), and reports the true model and aspect ratio for each result.',
        steps: [
          { text: 'POST to the agentGenerateImage endpoint with Authorization: Bearer bdi_….', icon: 'ExternalLink' },
          { text: 'Pass prompt (or prompts[]), optional presetName, and settings overrides.', icon: 'Edit' },
          { text: 'Read results[].imageUrl, images are hosted and saved to your account.', icon: 'Check' },
        ],
      },
    ],
  },
  {
    id: 'v0.22.0-present-anywhere',
    title: 'Take Build Studio animations into your slide deck',
    summary:
      'Export a real PowerPoint with click-to-reveal builds, or download one PNG still for every animation step.',
    blurb:
      'Build Studio animations now travel with you. Export an editable PowerPoint where each frame arrives on click, open it in PowerPoint or Keynote, or import it into Google Slides. When a deck needs simple stills instead, export the complete reveal sequence as numbered PNG files.',
    publishedAt: Date.parse('2026-07-04T08:00:00Z'),
    version: '0.22.0',
    image: '/whats-new/whatsnew-v0.22.0.webp',
    featured: true,
    sections: [
      {
        heading: 'Export an animated PowerPoint',
        body: 'Build Studio writes one editable slide with your image background and every frame stacked in order with a native fade-in-on-click entrance.',
        steps: [
          { text: 'Open Build Studio and arrange the frames in reveal order.', icon: 'Film' },
          { text: 'Choose Export PowerPoint to download the animated .pptx file.', icon: 'Save' },
          { text: 'Open it in PowerPoint or Keynote, or import it into Google Slides.', icon: 'ExternalLink' },
        ],
      },
      {
        heading: 'Export one still for every step',
        body: 'The PNG export creates the empty start, every reveal stop, and the completed image so a standard slide deck can reproduce the sequence without video.',
        steps: [
          { text: 'Choose Export Images in Build Studio.', icon: 'Image' },
          { text: 'Add the numbered PNG files to your deck in order.', icon: 'Layers' },
          { text: 'Advance one slide at a time to present the build.', icon: 'ArrowRight' },
        ],
      },
    ],
  },
  {
    id: 'v0.21.0-build-studio',
    title: 'Build Studio, animate your infographics and export MP4',
    summary:
      'Turn any image into a step-by-step reveal animation. AI proposes the items in reading order, or draw them yourself, then export H.264.',
    blurb:
      'Build Studio turns a generated infographic into a presentation-ready reveal animation. Open it from the Animate button on any preview, then let the AI wand propose every block in reading order, title first, content in the middle, conclusion last, or trace them yourself with freeform, rectangle, and brush tools. Each item gets its own reveal moment with camera zoom, fade/wipe/spotlight styles, and tunable timing. When you are happy, export a one-click H.264 MP4 right in the browser, or fullscreen the player and screen-record. Signed-in users get cloud-backed builds that survive a cleared browser; everyone gets ⌘Z undo on every edit.',
    publishedAt: Date.parse('2026-07-04T03:00:00Z'),
    version: '0.21.0',
    image: '/whats-new/whatsnew-v0.21.0.webp',
    featured: true,
    sections: [
      {
        heading: 'Open Build Studio from any preview',
        body: 'The Animate button on the preview toolbar opens Build Studio for the image you are looking at. Your selections, item order, timing, and playback settings persist per image, locally for guests, and in Firestore for signed-in users so a build survives a new browser or cleared storage.',
        steps: [
          { text: 'Open any generation from your gallery so its preview is showing.', icon: 'Layers' },
          { text: 'Click Animate on the preview toolbar, Build Studio opens over the image.', icon: 'Film' },
          { text: 'Close with Esc (peels back one layer at a time) or the × button.', kbd: 'Esc' },
        ],
      },
      {
        heading: 'AI auto-select proposes items in reveal order',
        body: 'The wand runs one Gemini vision call on your key and returns an ordered list of regions, hook first, body blocks in reading order, conclusion last. It replaces the current items in one shot; ⌘Z brings your manual work back. For busy art, run Clean up first so each block sits on a solid background.',
        steps: [
          { text: 'Click the wand in the floating toolbar above the canvas.', icon: 'Wand2' },
          { text: 'Wait for the pass to finish, items appear in the sidebar with AI-proposed names you can double-click to rename.', icon: 'Sparkles' },
          { text: 'Fine-tune any region with the selection tools, or undo the whole pass.', kbd: 'Cmd+Z' },
        ],
      },
      {
        heading: 'Clean up for animation before selecting',
        body: 'Dense infographics can be hard to auto-select. Clean up sends a refine instruction that redraws the same content with each section isolated on a solid background, easier for both the wand and manual tracing. It creates a new Mark; your original stays untouched.',
        steps: [
          { text: 'Click the sparkles button next to the wand in the toolbar.', icon: 'Sparkles' },
          { text: 'A new Mark appears with cleaner, separated blocks, switch to it in the version rail if needed.', icon: 'Layers' },
          { text: 'Re-open Build Studio on the cleaned Mark and run AI auto-select or trace items yourself.', icon: 'Wand2' },
        ],
      },
      {
        heading: 'Draw, reorder, and focus individual items',
        body: 'Freeform lasso (straight lines by default, hold Alt for a single drag), rectangle, and brush tools live in a Photoshop-style floating toolbar. Drag item badges to reorder. Double-tap ⌥ or press ⌥1-9 to focus-isolate one item for fine eraser work. Drag the duration readout to scrub per-item timing.',
        steps: [
          { text: 'Pick a selection tool from the floating toolbar and trace around a block, it becomes an item in the sidebar.', icon: 'Pencil' },
          { text: 'Drag the numbered badge on the canvas to reorder; double-click a name to rename in place.', icon: 'ArrowRight' },
          { text: 'Double-tap ⌥ to zoom into the selected item; Esc steps back out one layer at a time.', kbd: 'Esc' },
        ],
      },
      {
        heading: 'Play the reveal and export MP4',
        body: 'The player walks through items one at a time with camera zoom and your chosen transition style. Arrow keys advance manually; toggle auto-play, loop, and speed. Export renders H.264 locally via WebCodecs, no upload, so the file plays in QuickTime, PowerPoint, and social feeds.',
        steps: [
          { text: 'Switch to the Play tab at the bottom of the sidebar and press Play.', icon: 'Film' },
          { text: 'Use ← / → to step through items, or enable auto-play and loop.', icon: 'ArrowRight' },
          { text: 'Click Export MP4 in the header, the file downloads when rendering finishes.', icon: 'Film' },
        ],
      },
    ],
  },
  {
    id: 'v0.15.0-prompt-image-drop',
    title: 'Drop an image into the prompt box',
    summary: 'Drag a reference image onto the prompt to expand it or use it as style.',
    blurb:
      'Drag any reference image onto the prompt and pick a path: generate a content prompt that respects your toolbar menus, or use the image as a style reference for the next run. Multi-prompt JSON arrays now work too, paste an array of strings to fan out a batch.',
    publishedAt: Date.parse('2026-05-12T00:00:00Z'),
    version: '0.15.0',
    image: '/whats-new/whatsnew-v0.15.0.webp',
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
    id: 'v0.8.0-folders-toolbar-presets-and',
    title: "Organize work with folders and reusable presets",
    summary: "Group generations into folders and recall favorite toolbar setups in one click.",
    blurb: "Your gallery grows up: group creations into named folders, pin a default for new work, and move tiles in bulk \u2014 everything lands in Inbox by default so nothing gets lost. Save your favorite toolbar setup (style, colors, size, model) as a named preset and recall it in one click. And if you work behind a VPN or corporate proxy, thumbnails and profile photos now keep displaying instead of breaking.",
    publishedAt: Date.parse('2026-05-02T12:00:00Z'),
    version: '0.8.0',
    image: '/whats-new/whatsnew-v0.8.0.webp',
  },
  {
    id: 'v0.6.0-keep-creating-while-generations',
    title: "Keep creating while generations run in the background",
    summary: "Fire off multiple runs at once and track them in a floating monitor",
    blurb: "Generate doesn't lock you out anymore \u2014 kick off a run, tweak your prompt, and kick off another while the first is still cooking. A floating Active Generations monitor tracks every job with progress bars, time estimates, a jump-to-result shortcut, and per-job stop buttons. Your image history also moved to sturdier cloud storage, so big galleries stay fast and reliable.",
    publishedAt: Date.parse('2026-04-27T12:00:00Z'),
    version: '0.6.0',
    image: '/whats-new/whatsnew-v0.6.0.webp',
  },
  {
    id: 'v0.5.0-compare-models-side-by',
    title: "Compare models side by side with a swipe slider",
    summary: "Run one prompt through multiple models and swipe between results",
    blurb: "Curious which model draws it best? Select several models for a single run and compare the results right in the main preview with a smooth A/B swipe slider \u2014 no cramped popup. Each result remembers which model made it, batches show a progress lane per job, and the toolbar itself got a sleeker, more responsive redesign.",
    publishedAt: Date.parse('2026-04-21T12:00:00Z'),
    version: '0.5.0',
    image: '/whats-new/whatsnew-v0.5.0.webp',
  },
  {
    id: 'v0.1.0-batch-generation-smarter-downloads',
    title: "Batch generation, smarter downloads, and version rails",
    summary: "Generate up to 5 variations at once and download everything in one click",
    blurb: "One click can now produce a whole batch of variations \u2014 set a quantity or write prompts with {red, blue}-style options and watch them multiply, complete with a live progress banner and a stop button. All the marks from a batch land on a single tile, and a new thumbnail rail lets you hover to preview each one. A unified Download menu replaces the scattered export buttons, and you can zip up selected generations in one go.",
    publishedAt: Date.parse('2026-04-17T12:00:00Z'),
    version: '0.1.0',
    image: '/whats-new/whatsnew-v0.1.0.webp',
  },
];
