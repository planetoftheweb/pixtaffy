# /deploy: Ship a new release of PixTaffy

Running this command is **explicit authorization** to commit, push, tag, draft a
GitHub release, deploy Firebase rules if they changed, and monitor the Render
auto-deploy. It overrides the workspace's "don't push / don't deploy unless
asked" rule (`Development Workflow` user-rule) for this single invocation.

The whole flow is sequential — if any step fails, **stop and report**, do not
paper over it. Most failures here are signal (a missing What's New entry, a
type error, a security-rules diff that wasn't reviewed), not noise.

---

## 1. Decide the semver bump first

Look at `git log` since the last release tag (`git describe --tags --abbrev=0`)
and pick one based on what's actually in the diff:

- **patch** (`X.Y.Z+1`) — bug fixes only, internal refactors, doc edits, dep
  bumps that don't change behavior.
- **minor** (`X.Y+1.0`) — new user-visible features, UX changes, new
  components, new toolbar options, new keyboard shortcuts, new admin surfaces.
- **major** (`X+1.0.0`) — breaking changes to data shapes, the BYOK contract,
  Firestore collection layout, or anything that requires user action to keep
  working.

Patch ≈ "I'd write 'fix:' commits about this." Minor/major ≈ "I'd want a
returning user to know about this on next load."

Semver and What's New are separate decisions. A minor bump can remain
changelog-only, while an unusually large public launch in a patch can still
deserve a card.

## 2. Decide whether this is public product news

Read `.cursor/skills/whats-new/SKILL.md` and apply its publication standard.
Create a card only for a substantial public launch that introduces a meaningful
new user capability, workflow, commercial model, or product identity.

Bug fixes, reliability work, interface polish, admin features, support plumbing,
provider updates, dependency changes, and infrastructure stay in `CHANGELOG.md`
without a What's New entry or image. This is the normal path for most releases.

If the release qualifies:

1. Run `npm run whats-new` or add the entry to the top of `data/whatsNew.ts`.
2. Mark `featured: true` only when the launch is worth opening a one-time spotlight.
3. Use only icons supported by `WhatsNewPage.tsx`.
4. Generate one unique 16:9 WebP in the current glossy 3D PixTaffy candy-character style.
5. Save it under `public/whats-new/` and verify the bell and detail page render it.

If the release does not qualify, skip the card and image. The prebuild validator
will validate the existing curated catalog and report that this version stays
changelog-only.

## 3. Update version metadata

- Bump `version` in `package.json` to the value chosen in step 1.
- If `README.md` carries any version badge, version pill, or "current
  version" line, update it too. (Today the README links to the changelog
  rather than embedding a version, so this is usually a no-op — verify
  before deciding.)

## 4. Run the local quality gates

```bash
npm run check:no-native-selects
npm run build
```

`npm run build` runs `prebuild` first, which is `node scripts/whats-new.mjs
check`. That gate validates every published launch card and its unique artwork,
without requiring a card for the current version. The build itself is the production bundle Render will also
produce, so a clean local build is your strongest "this will succeed in CI"
signal.

If either fails, **stop and report the failure verbatim**. Do not "fix
forward" by silencing the gate, deleting the failing test, or adding an
`SKIP_WHATS_NEW_CHECK=1` escape unless the user explicitly approves it.

## 5. Update CHANGELOG.md

Add a new section for the release at the top of the version list (above the
existing newest entry), keeping the file's `## [Unreleased]` placeholder in
place. Use the existing groupings — `Added`, `Changed`, `Fixed`, `Removed`,
optional `Internal` — and match the engineering voice already in the file
(specific, root-cause-aware, file-path callouts).

CHANGELOG is the engineering changelog. The What's New entry from step 2 is
the user voice. Keep them in sync but written for different audiences.

## 6. Update README.md if needed

The README has a `## Features` bullet list (no Recent Changes table). If this
release adds a notable user-facing feature, append or rephrase the matching
bullet so first-time visitors see it. Do not just replicate the CHANGELOG
here — the Features list is a stable product overview, not a per-release
log. Skip this step entirely on patch releases.

## 7. Commit everything

Single commit covering the version bump + CHANGELOG + What's New (if
authored) + README (if updated) + any code changes that are part of the
release. Use a conventional commit message that matches the recent style in
this repo (`git log --oneline -15`):

- Releases that are mostly a feature batch: `feat(<scope>): one-line headline`
- Releases that are mostly bug fixes: `fix(<scope>): one-line headline`
- Pure release plumbing on top of already-merged work:
  `chore(release): X.Y.Z — short summary of the headline change`

Pass the message via a HEREDOC so multi-line descriptions render correctly.

## 8. Push to the remote

```bash
git push
```

This is the actual deploy trigger for the static site — Render watches the
configured branch and starts a new build automatically once the push lands.
The MCP step in step 11 is for **monitoring** that build, not initiating it.

## 9. Create the GitHub release

Use `gh` to draft a release whose tag is `v<version>` and whose body is the
new section you wrote in CHANGELOG.md (you can use the `## [<version>]`
section as-is). Pass the body via HEREDOC so Markdown renders cleanly:

```bash
gh release create "v<version>" \
  --title "v<version>" \
  --notes "$(cat <<'EOF'
<paste the CHANGELOG section body, no leading "## [<version>]" header>
EOF
)"
```

Do **not** use `--latest` if you're shipping a hotfix on top of an older
minor — let `gh` infer it.

## 10. Deploy Firebase rules if they changed

Compare the working tree against the last release tag for the three
rules-shaped files:

```bash
git diff "$(git describe --tags --abbrev=0)" -- firestore.rules firestore.indexes.json storage.rules
```

For each file that actually changed, run **only** the matching deploy:

- `firestore.rules` changed → `firebase deploy --only firestore:rules`
- `firestore.indexes.json` changed → `firebase deploy --only firestore:indexes`
- `storage.rules` changed → `firebase deploy --only storage:rules`

Do not run `firebase deploy` without `--only` — that risks redeploying
Cloud Functions or other resources that aren't part of this release. If
none of the three files changed, skip this step entirely.

## 11. Monitor the Render auto-deploy

Render's static-site service auto-deploys from the pushed branch — there's
no separate "trigger deploy" command needed. Use the `user-render` MCP to
find and watch the freshly-triggered deploy:

1. Confirm the MCP server is healthy. If `list_workspaces` or
   `list_services` errors, surface the error and stop — do not fall back to
   FTP. (FTP is the separate `deploy-ftp-git` flow for other projects, not
   this one.)
2. Find the PixTaffy static-site service via `list_services`.
3. Call `list_deploys` for that service and grab the newest entry — its
   commit SHA should match the push from step 8 within ~30 seconds.
4. Poll `get_deploy` until `status` is `live` (success), `build_failed`,
   `update_failed`, or `canceled`. Surface the final status.

If the deploy fails, surface the build log link (`get_deploy` returns one)
and stop. Do not retry or roll forward — the user needs to see the error
first.

## 12. Report back

Reply to the user with:

- The new version number and bump type (patch / minor / major).
- The GitHub release URL.
- The Render deploy status + URL.
- Any Firebase rules that were deployed (or "no rules changes this release").
- A one-line recap of what shipped, taken from the What's New entry's
  `summary` field if there is one, or the CHANGELOG headline otherwise.

That's the verification handle the user will use to spot-check the live
site.
