---
name: whats-new
description: Author and ship a What's New entry for PixTaffy, the user-facing release surface that drives the header bell dropdown, the spotlight modal, the discovery page, and per-release detail guides. Use when adding a user-visible feature, bumping any version, or when `npm run build` fails the `whats-new:check` prebuild gate. The companion script `scripts/whats-new.mjs` scaffolds the entry; this skill explains the conventions, fields, and verify checklist around it. The agent is responsible for generating the brand-matched 16:9 hero image via `GenerateImage` and saving it at `public/whats-new/whatsnew-v<version>.png`; do not punt this step to the user.
---

# Skill: Author a What's New entry

PixTaffy surfaces every user-facing release through a single curated content
file. There are four surfaces, but only one source of truth — get the entry
right and every surface updates correctly.

## When to use this skill

Open this skill when ANY of these is true:

- You're shipping a user-visible feature, behavior change, or UX polish that
  a returning user would want to know about.
- You're about to bump `package.json` to a new version, including a patch.
- `npm run build` failed with `[whats-new] No exact entry found for vX.Y.Z` — that's
  the deploy gate kicking in.
- Someone asked "how do I add a What's New entry" or "where does the bell
  content come from".

**Do not** use this skill for engineering-only changes (refactors, dependency
bumps, internal renames). Those belong in `CHANGELOG.md` only.

## How the surface works

| Surface | File | When it shows up |
|---|---|---|
| Header bell dropdown | `components/WhatsNewBell.tsx` | Always available; red badge when newer than last seen |
| Spotlight modal | `components/WhatsNewSpotlight.tsx` | Auto-opens once per user when the newest `featured: true` entry hasn't been dismissed |
| Discovery + detail page | `components/WhatsNewPage.tsx` | Opens when the user clicks any row, "View all updates," or visits `?whatsnew=<id>` |
| Source of truth | `data/whatsNew.ts` | One array, newest first; the file the script edits |

State persistence: `lastSeenWhatsNewId` and `dismissedSpotlightIds` live in
`UserPreferences` for signed-in users and `localStorage` for guests, wired
through `hooks/useWhatsNew.ts`.

## Authoring workflow (preferred path: the script)

From the repo root:

```bash
npm run whats-new
```

The interactive prompt asks for version, title, summary, blurb, image path,
featured flag, and (optionally) instructional sections with steps. It
appends a properly formatted entry to the top of `data/whatsNew.ts`. The
script aborts if an entry already exists for that version, so re-runs are
safe.

After running:

1. Drop the hero image at the path the script printed (default
   `public/whats-new/whatsnew-v<version>.png`).
2. `npm run build` to confirm the prebuild gate passes and the bundle is
   clean.
3. Update `CHANGELOG.md` with the same release — keep CHANGELOG as the
   engineering voice; `whatsNew.ts` is the user voice.

## Authoring workflow (fallback: by hand)

If the script isn't an option, append to the **top** of the `WHATS_NEW`
array in `data/whatsNew.ts` (entries are newest-first). Use this shape:

```ts
{
  id: 'v0.17.0-some-slug',                       // unique, kebab-case, version-prefixed
  title: 'Concise sentence-case headline',        // 1 line, no trailing period
  summary: 'One short sentence shown in the bell.', // ~70 chars; the bell line-clamps to 2 lines
  blurb:
    'One paragraph that stands on its own. Used in the spotlight modal and the discovery grid cards, so it should make sense without any of the sections below.',
  publishedAt: Date.parse('2026-05-15T22:00:00Z'),
  version: '0.17.0',                              // must match the package.json bump
  image: '/whats-new/whatsnew-v0.17.0.png',       // 16:9, see image rules below
  featured: true,                                 // omit unless this is a headline release
  sections: [
    {
      heading: 'Headline for this chunk of instructions',
      body: 'Context paragraph for the section. Keep it human.',
      steps: [
        { text: 'A concrete action with a verb.', icon: 'Bell' },
        { text: 'Step that mentions a keyboard shortcut.', kbd: 'Cmd+K' },
        { text: 'Step without any chrome.' },
      ],
    },
  ],
},
```

### Field rules

- **`id`** — `v<version>-<slug>`. The script enforces uniqueness; if you
  edit manually, search the file to confirm no collision.
- **`summary`** vs **`blurb`** — `summary` is one sentence (the bell line);
  `blurb` is one paragraph (the spotlight and discovery cards). Both
  required.
- **`publishedAt`** — the deep-link router and "last seen" comparison rely
  on this being a real `Date.parse(...)`-able ISO string. Use UTC.
- **`version`** — MUST exactly match `package.json` for the deploy gate to
  pass. Patch releases get their own entry and artwork too.
- **`featured`** — omit for default. Only set `true` when the change is
  worth interrupting the home screen with a spotlight modal. Most entries
  should NOT be featured.
- **`sections`** — optional. If present, the detail page renders them.
  Section bodies are paragraphs; steps are numbered. Icons in steps must
  be names allowlisted in `WhatsNewPage.tsx`'s `ICON_MAP` (a small set of
  Lucide icons); unknown names fall back to a neutral `HelpCircle` glyph,
  which looks broken next to the step. If a release theme genuinely needs
  an icon outside the current allowlist (e.g. `Trash2` for a release
  centered on safer deletes), **extend `ICON_MAP` and its imports** rather
  than substituting a less-fitting icon. Keep the allowlist narrow but not
  artificially constrained.
- **`kbd`** on a step renders as a styled keycap chip (e.g. `Cmd+K`,
  `Esc`). Use `+` separators, no spaces.

### Image rules

- Every release needs visibly different artwork and a unique image path.
  Never reuse an earlier thumbnail, even when two releases share a theme.
  The prebuild gate checks the current release against older image paths and
  exact file contents, so copying old art under a new filename also fails.
- Aspect ratio: 16:9 (the bell thumbnails, spotlight hero, and grid cards
  all assume this).
- Resolution: ~1024×576 is plenty; the bell thumbnail is rendered at
  144×80, the floating overlay at ~288×162. Going much above 1280px wide
  bloats first-paint without visible gain.
- Location: `public/whats-new/whatsnew-v<version>.png` (or `.jpg` /
  `.webp`). Path in the entry starts with `/whats-new/...` because Vite
  serves `public/` from the site root.
- Style: keep them on-brand (brand teal `#00A9A5`, orange `#FF7F50`,
  red `#B93135`, dark navy accent) and avoid embedded text that won't
  scale at thumbnail size.

### Generate the image yourself — don't punt to the user

**The agent producing the entry is also responsible for producing the
image.** Earlier sessions repeatedly skipped this step and asked the user
to "drop one in later," which left the bell rendering the Sparkles
fallback in production. That isn't acceptable — every other 0.x release
shipped with brand-matched art, and so should yours.

Workflow when authoring an entry:

1. **Read an existing image first** to anchor the style. The skill agent
   should call `Read` on `public/whats-new/whatsnew-panel.png` (or any
   other recent entry) so the next generation matches the established
   look — soft horizontal teal→orange-cream gradient, flat 2D vector
   illustration, slight drop shadow, scattered sparkle stars and motion
   lines, no text.
2. **Generate via `GenerateImage`** with these required prompt traits:
   - 16:9 aspect ratio, ~1024×576
   - Soft horizontal gradient: brand teal on the left, warm orange-cream
     on the right
   - Flat vector illustration with soft drop shadows
   - Brand palette only — teal `#00A9A5`, orange `#FF7F50`,
     red `#B93135`, dark navy for accents
   - Subject reflects the entry's headline noun (a folder for folder
     work, a magnifier for search, a key for BYOK, etc.)
   - Decorative sparkles, dots, and motion-line dashes scattered around
   - **No embedded text or words anywhere** — the thumbnail is rendered
     as small as 144×80 and any baked-in text becomes illegible noise
   - Pass the existing `whatsnew-panel.png` (or another existing entry)
     as a `reference_image_paths` so the model has a concrete style
     anchor.
3. **Save the file at the canonical path** so the entry's `image` field
   resolves on first load:
   ```bash
   cp "<generated-path>" "public/whats-new/whatsnew-v<version>.png"
   ```
   `GenerateImage` writes to a `~/.cursor` assets dir, not the workspace,
   so the copy is mandatory.
4. **Verify it loads** in `npm run dev` — the bell row should show your
   art, not the Sparkles fallback. If it shows Sparkles, the path in
   `data/whatsNew.ts` doesn't match the file on disk.

The deploy gate validates that the current entry exists, its image is present,
and its artwork is not reused from an older release. Generate the image as part
of authoring or the work isn't done.

## How the deploy gate works

`npm run build` runs `prebuild` first, which executes
`node scripts/whats-new.mjs check`. The check:

1. Reads `version` from `package.json`.
2. Reads the paired `version` and `image` fields from `data/whatsNew.ts`.
3. Fails with a non-zero exit if no entry exactly matches the current version.
4. Fails when the current release image is missing, reuses an older path, or
   contains the exact same artwork bytes as an older release image.

This runs both locally (catches you before push) and on Render (catches
you before deploy). If you genuinely need to bypass for a one-off (e.g.
hotfix on an old branch), set `SKIP_WHATS_NEW_CHECK=1` for that build.

## Verify checklist

Before considering the entry "done":

- [ ] `npm run build` passes (gate + bundle).
- [ ] **Unique hero image generated and saved** at
      `public/whats-new/whatsnew-v<version>.png` — see "Generate the
      image yourself" above. Do not reuse artwork from another entry.
- [ ] In `npm run dev`, the bell shows the new row at the top with the
      thumbnail rendered (not the Sparkles fallback).
- [ ] Hovering the new row floats the larger preview to the left of the
      dropdown, anchored vertically to the row.
- [ ] Clicking the row opens the detail view on `WhatsNewPage` with the
      sections rendered.
- [ ] If `featured: true`, the spotlight modal opens once on app load and
      the "Read the guide →" CTA opens the detail view.
- [ ] If `featured: true`, dismissing it (Esc, backdrop, or "Got it")
      doesn't re-fire on the next reload for the same user.
- [ ] `CHANGELOG.md` mentions the release in engineering voice.

## Files at a glance

| Purpose | Path |
|---|---|
| Content (single source of truth) | `data/whatsNew.ts` |
| Bell dropdown | `components/WhatsNewBell.tsx` |
| Spotlight modal | `components/WhatsNewSpotlight.tsx` |
| Discovery + detail page | `components/WhatsNewPage.tsx` |
| State + persistence | `hooks/useWhatsNew.ts` |
| Types | `types.ts` (`WhatsNewEntry`, `WhatsNewSection`, `WhatsNewStep`) |
| Scaffolder + deploy gate | `scripts/whats-new.mjs` |
| Engineering changelog | `CHANGELOG.md` |
