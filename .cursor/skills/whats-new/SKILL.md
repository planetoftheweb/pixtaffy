---
name: whats-new
description: Author and maintain PixTaffy's curated public product-news surface. Use only for substantial public launches that introduce a meaningful user capability or a major product change. Routine releases, patches, bug fixes, polish, admin work, and infrastructure stay in CHANGELOG.md without a What's New card.
---

# Skill: Curate What's New

What's New is the public story of PixTaffy's biggest launches. It is not a
second changelog and it is not tied one-to-one to package versions.

## Publication standard

Add a card only when all of these are true:

- The change is available to ordinary PixTaffy users, not only administrators or maintainers.
- It introduces a substantial new capability, workflow, commercial model, or product identity.
- A returning user would benefit from discovering it without reading release notes.
- The feature is large enough to support a clear standalone headline and visual story.
- The copy describes behavior that is still accurate in the current product.

Keep the change in `CHANGELOG.md` only when it is primarily:

- a bug fix, hotfix, reliability improvement, or performance change;
- interface polish, copy editing, accessibility cleanup, or visual refinement;
- an admin-only, security-only, support, dependency, protocol, or infrastructure change;
- a small shortcut, menu behavior change, provider update, or extension of an existing feature;
- implementation work that users do not need to understand.

Version numbers do not decide publication. A patch can contain a major public
launch, and a minor version can remain changelog-only. When uncertain, leave it
out. A short, useful launch history is better than a complete feed nobody reads.

## Surfaces

| Surface | File | Behavior |
|---|---|---|
| Header bell | `components/WhatsNewBell.tsx` | Shows the curated launch list |
| Spotlight | `components/WhatsNewSpotlight.tsx` | Opens once for the newest eligible featured launch |
| Discovery and detail | `components/WhatsNewPage.tsx` | Shows launch cards and optional guides |
| Source of truth | `data/whatsNew.ts` | Curated entries, newest first |
| State | `hooks/useWhatsNew.ts` | Stores last-seen and dismissed launch IDs |

## Authoring workflow

1. Confirm the release passes the publication standard above.
2. Run `npm run whats-new` or add the entry to the top of `data/whatsNew.ts`.
3. Write a user-facing headline, summary, and blurb around the new capability.
4. Add instructional sections only when they help someone use the launch.
5. Generate a unique PixTaffy launch image and save it under `public/whats-new/`.
6. Add engineering details to `CHANGELOG.md` separately.
7. Run `node scripts/whats-new.mjs check` and `npm run build`.

If the release does not pass the publication standard, skip steps 2 through 5.
Update `CHANGELOG.md`, bump the package version, and build normally. The catalog
validator will report that the version stays changelog-only.

## Entry shape

```ts
{
  id: 'v0.30.0-new-public-workflow',
  title: 'A concise sentence-case launch headline',
  summary: 'One short sentence for the bell.',
  blurb:
    'One paragraph that explains what the new capability lets a user do and why it matters.',
  publishedAt: Date.parse('2026-08-10T16:00:00Z'),
  version: '0.30.0',
  image: '/whats-new/whatsnew-v0.30.0.webp',
  featured: true,
  sections: [
    {
      heading: 'Use the new workflow',
      body: 'Short context that helps the user succeed.',
      steps: [
        { text: 'Start with a concrete action.', icon: 'Sparkles' },
        { text: 'Finish with the result the user receives.', icon: 'Check' },
      ],
    },
  ],
},
```

### Field rules

- `id`: unique, kebab-case, and version-prefixed.
- `title`: one clear launch headline, no trailing period.
- `summary`: one short sentence for the bell.
- `blurb`: one paragraph that stands on its own in cards and spotlight views.
- `publishedAt`: a valid ISO timestamp. Keep entries newest first.
- `version`: the release that introduced the launch. It does not need to match the current package version later.
- `image`: a unique workspace asset under `/whats-new/`.
- `featured`: use only for a launch worth interrupting the home screen once. Most cards should omit it.
- `sections`: optional. Prefer fewer useful sections over exhaustive release notes.
- `icon`: use names supported by `WhatsNewPage.tsx` and extend its icon map only when the launch truly needs another icon.

## Image direction

Every published launch gets one distinct 16:9 visual. Changelog-only releases get
no image.

- Format: WebP.
- Canvas: 1200 x 675 or 1280 x 720.
- Style: premium glossy 3D animated-film still in the current PixTaffy candy world.
- Characters: expressive wrapped-taffy mascots in cyan, pink, purple, orange, and coral.
- Environment: deep navy creative studio, subtle grid, candy-color practical lights.
- Story: show the launch capability as one clear visual action.
- Composition: keep the subject readable at a small card size and inside a safe center crop.
- Avoid: embedded text, letters, numbers, logos, watermarks, fake UI copy, extra limbs, and reused scenes.

Use the built-in image-generation workflow. Generate the asset, inspect it, crop it
to 16:9, convert it to WebP, save it in the workspace, and verify that the card
renders the image rather than the fallback icon.

## Catalog validation

`node scripts/whats-new.mjs check` validates the curated catalog, not release
coverage. It checks that:

1. each published version appears once;
2. every card has an image that exists;
3. image paths and exact image bytes are unique across cards;
4. the current package version may be either a public launch or changelog-only.

`npm run build` runs this validator in `prebuild`. Do not bypass it to ship a
broken card. A current package version without a card is a normal, valid result.

## Verify checklist

- [ ] The release passes the publication standard.
- [ ] The entry describes a substantial public capability, not fixes or polish.
- [ ] The copy is accurate in the current product.
- [ ] The image uses the current PixTaffy 3D candy style and is a unique 16:9 WebP.
- [ ] The bell, discovery card, and detail page render without fallback art.
- [ ] Featured launches open once and stay dismissed after dismissal.
- [ ] `CHANGELOG.md` contains the engineering release notes.
- [ ] `node scripts/whats-new.mjs check` and `npm run build` pass.
