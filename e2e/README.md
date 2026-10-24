# Reusable browser walkthroughs

Run `npm run walkthrough:local`. This builds Functions and runs Firebase emulators
with project `demo-pixtaffy` only, then starts Vite on a free port. The launcher
creates `functions/.secret.local` with a clearly fake encryption secret only when
absent and ignored by Git, and removes only its own file on exit. It wraps:

```
npm --prefix functions run build
firebase emulators:exec --project demo-pixtaffy --only auth,firestore,functions,storage "node e2e/run-local.mjs key-flow"
```

Chrome must be installed. `playwright-core` does not download browsers during
npm install. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a specific executable;
otherwise the runner uses `channel: 'chrome'`.

For a preview deployment:

```
node e2e/run-walkthrough.mjs key-flow --base-url https://YOUR-PREVIEW --out e2e-results/preview --headed
```

Environment variables:

- `WALKTHROUGH_EMAIL` and `WALKTHROUGH_PASSWORD`: existing test account, otherwise
  the UI creates a throwaway owner. Use a dedicated account: the flow replaces
  and deletes its Gemini key.
- `WALKTHROUGH_GEMINI_KEY`: optional real key. Without it the flow generates a fake
  key and expects a sanitized provider failure. Never put credentials in CLI args.
- `WALKTHROUGH_EXPECT_MODE=server|legacy|any`: expected preview mode.
- `WALKTHROUGH_STAGE=0|1|2`: local flag, default 2. Stage 1 allowlists the owner
  after signup with `allowAdmins: false` (the default, admins require explicit opt-in), waits for cache expiry, and reloads.
- `WALKTHROUGH_ALSO_LEGACY=0`: disable the default second local run at stage 0.

Each step writes a masked screenshot and pass/fail entry in `result.json`. Request
URLs and response bodies are available in memory to assertions, never saved to
results. All input fields are masked on screenshots, including failed steps.
The runner exits nonzero for failures, including browser startup failures.

Walkthrough modules export `async function ({ page, context, browser, baseUrl,
outDir, env, step, requests, responses })`. The multi-agent harness reuses these
via `--walkthroughs key-flow`. Rollout documentation belongs in `docs/rollout`,
not `.harness-runs`.

Local runs verify the owner email using the Auth emulator Admin SDK after UI
signup completes. Both Auth and Firestore hosts must be loopback addresses.
The launcher isolates Firebase CLI configuration in a temporary directory and
sets `FEATURE_FLAG_CACHE_MS=100`. This override is honored only when
`FUNCTIONS_EMULATOR=true`; production retains its 30-second cache.

Settings is selected by its `menuitem` role. The server walkthrough checks
stranger isolation while the owner key still exists, including an attempted
callable request with the owner's UID, then deletes the owner key. Step and
launch failures retain sanitized error messages in `result.json`; protected
keys, passwords, and tokens are redacted. Screenshots mask inputs and protected
values. Browser launch failures are failures, never skipped passes.
