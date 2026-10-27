# User-key callable security rollout

Both flags default off when missing or invalid. No deploy, migration, client rebuild, or key rewrite is needed to flip them. Operators must not enable either flag until Ray approves shipping.

## Server flags

Firestore document: `config/featureFlags`. Independent fields:

- `enforceAppCheckUserKeys`
- `rateLimitUserKeys`

Each uses `{ stage: 0 | 1 | 2, allowlistUids?: string[], allowAdmins?: boolean }`. Stage 0 is off for everyone. Stage 1 includes only explicitly allowlisted UIDs unless `allowAdmins: true` is deliberately supplied. Stage 2 includes everyone authenticated. Missing and malformed fields are off. Keep `allowAdmins: false` throughout the owner-only rollout.

The server caches each field for 30 seconds. `resetFeatureFlagCache()` clears all fields. The emulator can lower the TTL using `FEATURE_FLAG_CACHE_MS`, capped at 30,000 ms. Unauthenticated callers remain rejected independently.

App Check is evaluated at request time on all six user-key callables. Enabled callers without `request.app` receive `failed-precondition` with `App Check required.`. Static options, region, and CORS stay unchanged. The App Check gate precedes key access and provider calls. Existing authentication, admin authorization and input validation still apply.

Rate limits use caller UID, including when an admin clears another user's keys:

| Callables | Bucket | Limits |
| --- | --- | --- |
| getUserApiKeyStatus, setUserApiKey, deleteUserApiKey, clearUserApiKeys | userkey-manage | 30/minute, 300/day |
| generateWithUserKey | userkey-generate | 20/hour, 100/day |
| listUserKeyProfiles | none | App Check only |

Transactions write `users/{uid}/private/rate-{bucket}`. Window fields are `minuteStart`, `minuteCount`, `hourStart`, `hourCount`, `dayStart`, `dayCount`, and `updatedAt`, with only configured windows written. Windows start with the first request and expire at 60,000 / 3,600,000 / 86,400,000 milliseconds. A request at the limit throws `resource-exhausted` without incrementing any window.

Paid AI still uses `users/{uid}/private/rate-images` at 20/hour, 100/day and `rate-helpers` at 60/hour, 300/day. Existing counter field names and paths are preserved.

## Client and access review

`services/firebase.ts:137-140` initializes App Check using `ReCaptchaEnterpriseProvider` and automatic token refresh on the same app passed to `getFunctions(app)` at line 164. Firebase callable clients therefore already attach App Check tokens when configured in a non-emulator browser. `services/userApiKeyService.ts:16-17` uses those default-region functions, so us-central1 compatibility is preserved. Neither client file changed.

Existing Firestore rules deny client access to `config/{doc}` and `userApiKeys/{uid}`; private counters are admin-only for client reads and writes. Server transactions use Admin SDK. No rules changes are needed.

## Staged enablement

Execute operator commands only after approval, using ADC. Resolve Ray's existing account, never create an account on a real project. Repeat each command for the other flag independently.

1. Staging stage 1, Ray's UID only:
   `node scripts/set-feature-flag.mjs --project pixtaffy-staging --flag enforceAppCheckUserKeys --stage 1 --allow-email planetoftheweb@gmail.com`
   and
   `node scripts/set-feature-flag.mjs --project pixtaffy-staging --flag rateLimitUserKeys --stage 1 --allow-email planetoftheweb@gmail.com`.
   The script resolves the existing email to UID and defaults allowAdmins to false. Verify the resulting UID allowlist contains only Ray.
2. Staging stage 2, everyone: repeat with `--stage 2` and no allow-email.
3. Production stage 1, Ray only: repeat the stage 1 commands with `--project brandoit`.
4. Production stage 2, everyone: repeat with `--project brandoit --stage 2` only after staging and owner verification are stable.

Monitor App Check failures, resource-exhausted responses, successful key save/status/delete and generation, provider request volume, and existing paid-AI counters after each stage. Confirm an unlisted account retains legacy behavior during stage 1.

## Instant off-switch and rollback

Set either field to `{ stage: 0 }` in Firebase Console at `config/featureFlags`, or run:

```sh
node scripts/set-feature-flag.mjs --project <project> --flag enforceAppCheckUserKeys --stage 0
node scripts/set-feature-flag.mjs --project <project> --flag rateLimitUserKeys --stage 0
```

This is the runtime off-switch without deployment or rebuild, effective within the 30-second cache TTL. Flip both fields for full rollback. Existing keys in `userApiKeys/{uid}`, legacy data, serverSideUserKeys behavior and counters remain intact. No migration or deletion is required. Confirm previously blocked calls return to legacy behavior after cache expiry.

## Verification

Run functions lint/tests, root tests/typecheck/build and `npm run check:no-native-selects`. Root build and typecheck have known baseline failures that are outside this task.

`npm run test:emulator` exercises real emulator rate transactions alongside callable-stage tests. `npm run walkthrough:local` uses demo-pixtaffy only, signs in through the UI, exercises key management and generation, checks browser callable rejection across App Check stages and stranger isolation, then resets security flags. The local browser has no real attestation: negative App Check stages are exercised first, then App Check is disabled for the rate-limited UI flow. No real project accounts are created. The runner writes result.json only with pass true on success; its standard artifacts include screenshots.

The local launcher supplies a throwaway encryption value through the child environment and creates no secret files. Java is required for emulator execution and is unavailable on the Builder host. Emulator and browser execution must be completed by the orchestrator on the Mac Studio. A fake key verifies provider routing and safe failure; successful real-provider image output requires an operator-supplied key and is not claimed by fake-key execution.
