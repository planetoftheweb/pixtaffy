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

**This decision drives the rest of the flow.** A minor or major bump means
authoring a What's New entry (step 2). A patch bump skips it.

## 2. (Minor / major bumps only) Author the What's New entry

The build is gated on this — `npm run prebuild` runs `scripts/whats-new.mjs
check` and refuses to build when the new `package.json` `major.minor` has no
matching entry in `data/whatsNew.ts`. Skipping this step now just means the
build in step 4 fails later.

Read the full skill at `.cursor/skills/whats-new/SKILL.md` and follow it
end-to-end. **Both substeps below are mandatory; the image substep is the
one most often skipped, so do not move past this section until both are
done.**

### 2a. Write the entry

Run `npm run whats-new` to scaffold interactively, OR append to the top of
`WHATS_NEW` in `data/whatsNew.ts` by hand using the shape documented in the
skill. Notes:

- Mark `featured: true` only for headline releases worth interrupting the
  home screen with a spotlight modal. Most entries should NOT be featured.
- The `version` field's `major.minor` MUST match the `package.json` bump
  you'll do in step 3.
- If a step's `icon` references a Lucide name not in `WhatsNewPage.tsx`'s
  `ICON_MAP` allowlist, either pick an allowlisted icon or extend
  `ICON_MAP` (and its imports). Unknown names fall back to `HelpCircle`,
  which looks broken — extending the map is the right move when the icon
  genuinely fits the release theme.

### 2b. Generate the hero image yourself — do not skip this

The deploy gate does NOT validate that the image exists. If you skip this,
the bell + spotlight + discovery card will all render a broken-image
placeholder in production. **The agent shipping the release is responsible
for the art**, every time:

1. Read an existing entry's image (e.g. `public/whats-new/whatsnew-panel.png`)
   to anchor the style — soft horizontal teal→orange gradient, flat vector,
   no text, sparkles + motion-line dashes scattered around the central
   subject.
2. Call `GenerateImage` with: 16:9 aspect ratio (~1024×576), brand palette
   only (teal `#00A9A5`, orange `#FF7F50`, red `#B93135` accent, dark navy),
   no embedded text or letters anywhere, soft drop shadows only, a central
   subject that reflects the release's headline noun (a slideshow frame, a
   key, a folder, etc.). Pass an existing `public/whats-new/*.png` as
   `reference_image_paths` so the model has a concrete style anchor.
3. `GenerateImage` writes to `~/.cursor/projects/.../assets/...` rather than
   the workspace, so `cp` the result to the canonical path:

   ```bash
   cp "<generated-path>" "public/whats-new/whatsnew-v<version>.png"
   ```

4. Verify by re-reading the public path — if `ls public/whats-new/` doesn't
   show a file matching the version, the entry's `image` field will 404 in
   prod.

Patch releases skip this entire section — the parent minor's entry already
covers `x.y.*`.

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
check` — that's the deploy gate that fails the build if step 2 was skipped on
a minor/major. The build itself is the production bundle Render will also
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
