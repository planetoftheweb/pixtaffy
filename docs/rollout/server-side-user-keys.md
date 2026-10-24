# Draft PR #29: staged server-side user keys

Server-side storage is OFF by default. The server-only Firestore flag is at
`config/featureFlags`, field `serverSideUserKeys`:

```json
{ "stage": 0, "allowAdmins": false, "allowlistUids": [], "forceLegacy": false }
```

A missing document, missing field, or invalid flag disables new enrollment.
Functions cache the flag for 30 seconds. Clients request their mode once per
sign-in and fall back to legacy mode if the callable is unavailable. Sign out and
back in after changing stages. Clients cannot read or write the flag document.

1. Stage 1: owner only (Ray, explicit uid allowlist). Admins are excluded by default.
2. Stage 2: everyone.

Ray flips the flag in Firebase Console > Firestore > config > featureFlags >
serverSideUserKeys, or runs the ADC script below locally. Never run it in CI.

```
node scripts/set-feature-flag.mjs --project brandoit --flag serverSideUserKeys --stage 1 --allow-email planetoftheweb@gmail.com
```

`--allow-email EMAIL` is repeatable and resolves each account with Firebase Auth
`getUserByEmail`, adding its uid to `allowlistUids`. The script prints uids, never
emails or tokens. `--allow-uid UID` is also repeatable; repeat all intended accounts
when updating the flag. `--dry-run` resolves accounts and previews without writing.
`allowAdmins` defaults to false; `--allow-admins` explicitly opts in all admins.
`--no-admins` remains a harmless no-op compatibility alias. `forceLegacy` defaults
to false; `--force-legacy` sets it to true.

Off switch: without a deploy, set stage 0 in the Firestore document at runtime or run:

```
node scripts/set-feature-flag.mjs --project brandoit --flag serverSideUserKeys --stage 0
```

Stage 0 is the default, off state. The change is effective within 30 seconds on
the server and on next sign-in for clients. No new users move to server storage.
Users whose `userApiKeys/{uid}` document has at least one encrypted key remain on
the server path, including status, key management and BYOK generation. These
sticky-only users never trigger lazy migration. Empty stores do not confer access.
Firestore profile rules remain based on stage and allowlist, independent of sticky mode.

Rollback without data loss: set stage 0 with `forceLegacy: false`, keep the
encrypted store and server Functions available, wait 30 seconds and sign in again.
Migrated users continue using encrypted keys; no plaintext restore is needed.

Hard off: set stage 0 plus `forceLegacy: true`, or run:

```
node scripts/set-feature-flag.mjs --project brandoit --flag serverSideUserKeys --stage 0 --force-legacy
```

This sends everyone to the legacy client path after the same cache/sign-in delay.
Migrated users must re-enter keys. Encrypted records are retained, but unavailable
to BYOK callables until access is restored. `forceLegacy` suppresses sticky access;
it does not override a stage/allowlist grant, so hard off requires stage 0 too.
The agentGenerateImage resolver still reads encrypted keys first, then legacy
fields. This change never writes decrypted keys back to profiles.

Deploy Functions, rules and client with the flag off, then test stage 1 before
broadening to stage 2. Ray must provision USER_API_KEYS_ENCRYPTION_KEY before
deployment. Only flag-enabled users lazily migrate on a key callable. Admin
profile listing reads masked statuses without migrating users. Admin clearing
another user's keys works independently of the stage.

Bulk migration is required as the LAST cleanup step, only after stage 2, the
final stage, is stable. Lazy migration covers active users; bulk migration removes
plaintext for inactive users too. Supply the same encryption secret to the process
without logging it. Build Functions first, then preview and apply:

```
node scripts/migrate-user-api-keys.mjs --project PROJECT_ID --dry-run
node scripts/migrate-user-api-keys.mjs --project PROJECT_ID
```

The migration refuses stages below 2. `--force-before-stage-2` overrides this
check but is not recommended. Sticky access preserves migrated users on rollback.

Monitor Functions error rate for generateWithUserKey, failed-precondition counts,
Firestore rules denials, support reports, and own-key generation success rate.
Compare stage 1 results before enabling stage 2.

Reusable checks live in `e2e/README.md`. `.harness-runs` is NOT a place for this
rollout plan. The machine-readable copy is `server-side-user-keys.json`.
