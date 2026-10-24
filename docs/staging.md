# Staging

`pixtaffy-staging` is the separate Firebase project for preview testing.
Production remains `brandoit`. Build its frontend with
`vite build --mode pixtaffy-staging`.

Keep staging configuration in the gitignored `.env.pixtaffy-staging`.
Set all required Firebase fields there so Vite does not inherit production
configuration from `.env`. Variable names only:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
VITE_USE_FIREBASE_EMULATORS
```

Measurement ID is optional. Enable the emulator flag only for local emulator
testing, not hosted previews. HTTP function URLs use the configured project and
SDK region, with the local Functions emulator used when the flag is enabled.

The harness deploys hosting and backend previews to staging with:

```sh
node ~/coding/multi-agent-harness/harness.mjs --preview-only --repo ~/coding/PixTaffy --prod-project brandoit --preview-project pixtaffy-staging --allow-backend-preview --hosting-target pixtaffy --walkthroughs key-flow
```

To seed the server-side user keys flag, run locally with ADC credentials that
can write staging Firestore. Never run this seed in CI. Replace the placeholder
with the test user's staging Auth UID; repeat `--allow-uid` for every intended user:

```sh
node scripts/set-feature-flag.mjs --project pixtaffy-staging --flag serverSideUserKeys --stage 1 --allow-uid STAGING_TEST_USER_UID --dry-run
node scripts/set-feature-flag.mjs --project pixtaffy-staging --flag serverSideUserKeys --stage 1 --allow-uid STAGING_TEST_USER_UID
```

This writes `config/featureFlags.serverSideUserKeys` with stage 1, the explicit
allowlist, `allowAdmins: false`, and `forceLegacy: false`. A missing flag disables
enrollment. Wait up to 30 seconds for the server cache, then sign out and back in.

App Check is not configured on staging. App Check enforced callables, including
billing balance, paid AI, and feedback, fail there by design. Staging CORS allows
its hosting sites and preview channels only in the staging runtime project;
production CORS and App Check enforcement remain unchanged.

## Current staging state

- Project: `pixtaffy-staging` (Blaze, Firestore nam5, Email/Password auth on).
  Firebase Storage is not set up yet, so storage rules are not deployed there.
- Staging secrets: a staging-only `USER_API_KEYS_ENCRYPTION_KEY` and placeholder
  values for the Gemini, OpenRouter, GitHub and Stripe secrets. No production
  secret is copied to staging.
- Test owner account: `staging-owner@pixtaffy-staging.test`. Its password and UID
  live only on Otis in `~/.config/pixtaffy-staging/test-owner.env` (chmod 600).
  The flag is at stage 1 with only this UID allowlisted.
- Walk-through against a preview as the test owner:

```sh
(set -a; source ~/.config/pixtaffy-staging/test-owner.env; set +a; WALKTHROUGH_EXPECT_MODE=server node e2e/run-walkthrough.mjs key-flow --base-url PREVIEW_URL --out /tmp/kf)
```
