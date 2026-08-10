# Spec: What's New Authoring Tooling

## 1. Curated Product-News Policy

- 1.1 `.cursor/skills/whats-new/SKILL.md` MUST define What's New as a curated public product-news surface, not a mirror of every package release.
- 1.2 A card MUST be reserved for a substantial public launch that introduces a meaningful repeatable user capability, commercial model, or major product identity change.
- 1.3 Bug fixes, patches, interface polish, admin-only work, support plumbing, dependencies, protocols, and infrastructure MUST remain changelog-only.
- 1.4 The policy MUST be independent of semver level. A package version MAY ship without a card.
- 1.5 The skill MUST document the bell, spotlight, discovery, and detail surfaces backed by `data/whatsNew.ts`.

## 2. Scaffolder Script

- 2.1 `node scripts/whats-new.mjs add` MUST run as ESM with only `node:` dependencies.
- 2.2 The scaffolder MUST prompt for version, title, summary, blurb, slug, a default WebP image path, featured state, and optional instructional sections.
- 2.3 The scaffolder MUST refuse duplicate versions and MUST insert a new entry at the start of the `WHATS_NEW` array.
- 2.4 User input MUST be escaped safely for TypeScript string literals.
- 2.5 The success message MUST name the 16:9 WebP destination and require catalog validation plus a changelog update.

## 3. Catalog Validator

- 3.1 `node scripts/whats-new.mjs check` MUST validate every curated entry, regardless of the current package version.
- 3.2 The validator MUST reject duplicate launch versions.
- 3.3 The validator MUST reject cards without an image field or with a missing image file.
- 3.4 The validator MUST reject reused image paths and identical image bytes across launch cards.
- 3.5 The validator MUST exit successfully when the current package version has no card and MUST describe that version as changelog-only.
- 3.6 The validator MUST honor `SKIP_WHATS_NEW_CHECK` as an explicit emergency bypass.

## 4. Artwork and Build Wiring

- 4.1 Every published launch MUST use a distinct 16:9 WebP in the current glossy 3D PixTaffy candy-character style.
- 4.2 Artwork SHOULD be 1200 x 675 or 1280 x 720 and MUST avoid embedded text, logos, watermarks, and fake interface copy.
- 4.3 Changelog-only releases MUST NOT require or generate release artwork.
- 4.4 `npm run build` MUST run the catalog validator before Vite bundles the application.
- 4.5 The verify checklist MUST cover the bell, image preview, detail page, optional spotlight dismissal, changelog entry, validator, and production build.
