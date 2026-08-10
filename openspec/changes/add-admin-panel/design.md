# Design: Admin Panel

## Context
BranDoIt's current "admin" surface is a literal string comparison against the username `planetoftheweb`, sprinkled across `services/structureSeeder.ts`, `services/batchGenerationService.ts`, `App.tsx`, and `components/ControlPanel.tsx`. There is no UI for viewing other users, no audit trail, and no enforcement path other than user-doc ownership rules in Firestore. Meanwhile the Firebase project itself has no checked-in rules, no Cloud Functions, and no CI coverage: rule changes happen in the Console and cannot be reviewed.

This change introduces a claims-based admin identity, two Cloud Functions, codified security rules, and a dedicated admin UI that matches the visual language of `components/SettingsPage.tsx`.

## Goals
- Replace the username-string gate with Firebase Auth custom claim `admin: true`.
- Make admin actions auditable by keeping everything inside the web app (no Console visits required for routine management).
- Codify existing Firestore + Storage rules so every future change is reviewable.
- Keep deletion conservative: scoped to user-owned data only; never cascade into shared catalog data or teams.
- Preserve the current bootstrap user (`planetoftheweb`) as a break-glass fallback that cannot accidentally lock itself out mid-deploy.

## Non-Goals
- Organization/team-level permissions. Admin is a single global role.
- Per-action granular permissions (e.g. "can clear keys but not delete"). All admin ops are allowed to any admin.
- Deleting teams or shared catalog items (`graphic_types`, `visual_styles`, `brand_colors`, `aspect_ratios`) as a side-effect of user deletion.
- Email notifications for admin actions (suspension, deletion). Out of scope.
- Pagination beyond "Load more". No server-side filtering or sorting on the admin table.

## Architecture

```mermaid
flowchart LR
    Admin["Admin user<br/>(claims.admin=true)"]
    App["Web app<br/>AdminPage.tsx"]
    FS["Firestore"]
    STO["Firebase Storage"]
    subgraph fn [Cloud Functions]
      SETC[setAdminRole]
      DELU[deleteUserAccount]
    end
    AUTH["Firebase Auth<br/>(claims + users)"]

    Admin -->|list, read, clear keys, disable| App
    App -->|"reads + writes via rules"| FS
    App -->|promote/demote| SETC
    App -->|delete account| DELU
    SETC -->|setCustomUserClaims| AUTH
    DELU -->|recursiveDelete users/{uid}| FS
    DELU -->|delete users/{uid}/*| STO
    DELU -->|deleteUser| AUTH
```

## Identity and Authorization

### Custom claim
The single source of truth for "is this caller an admin" is the Firebase ID token claim `admin === true`. The frontend reads it via `getIdTokenResult(true)` after every sign-in and attaches `isAdmin` to the in-memory `User` object. `isAdmin` is never persisted to Firestore and is stripped from every profile/preference write.

### Bootstrap fallback
The first admin is bootstrapped by the `planetoftheweb` username. `setAdminRole` accepts a call if either:
1. the caller's token already has `admin === true`, or
2. the caller's Firestore user doc (`users/{callerUid}`) has `username === 'planetoftheweb'`.

Once the claim is set, the username path is no longer exercised in practice, but it remains as a safety valve so a mid-deploy session (claim not yet minted) cannot lock itself out. Frontend gates (`user.isAdmin || username === 'planetoftheweb'`) follow the same pattern.

### Rules strategy
Firestore rules add an `isAdmin()` helper and apply it as an additional allow-clause on top of existing owner-only rules. Net effect: normal users keep exactly the access they have today; admins additionally get full read/write across `users`, `users/{uid}/history`, `teams`, and the catalog collections (`graphic_types`, `visual_styles`, `brand_colors`, `aspect_ratios`). Storage rules mirror the same pattern for `users/{uid}/*`.

## Data Model

### New fields on `users/{uid}`
- `isDisabled?: boolean` — when true, the app hard-blocks the account before any studio UI renders.
- `lastSignInAt?: Timestamp` — refreshed on every sign-in; drives the "last active" column.

### Non-persisted fields on in-memory User
- `isAdmin?: boolean` — derived from `getIdTokenResult().claims.admin`. Never written.

`services/authService.ts` is updated to:
1. Read claims during `onAuthStateChange` and attach `isAdmin`.
2. Write `lastSignInAt: serverTimestamp()` on every sign-in.
3. Extend `sanitizePreferences` / profile writes to strip `isAdmin`.

## Cloud Functions

### `setAdminRole({ uid, admin })`
Callable. Authorizes via the bootstrap rule above. Calls `admin.auth().setCustomUserClaims(uid, { admin })`. Returns `{ ok: true }`. Does not touch Firestore — the frontend calls `getIdTokenResult(true)` afterwards to refresh.

### `deleteUserAccount({ uid })`
Callable. Admin-only (via claim). Executes in order:
1. `admin.firestore().recursiveDelete(db.doc('users/' + uid))` — clears the user doc and the `history` subcollection.
2. List + delete objects under Storage path `users/{uid}/` — avatars, uploads, analysis artefacts.
3. `admin.auth().deleteUser(uid)` — removes the Auth record.

Conservative scope: teams, catalog items, and any shared content the user authored are intentionally left in place. The tasks list explicitly states that wider cleanup is out of scope for this change.

## Frontend

### `services/adminService.ts`
Thin wrapper over Firestore + Cloud Function calls:
- `isCurrentUserAdmin()` → returns claim.
- `listUsers(cursor?)` → `query(users, orderBy('createdAt', 'desc'), limit(25), startAfter?)`.
- `clearUserApiKeys(uid)`, `clearUserSystemPrompt(uid)`, `setUserDisabled(uid, disabled)` → `updateDoc`.
- `promoteToAdmin(uid)`, `demoteFromAdmin(uid)` → call `setAdminRole`.
- `deleteUserCompletely(uid)` → call `deleteUserAccount`.

### `components/AdminPage.tsx`
Styled to match `components/SettingsPage.tsx` (same section cards, same typography, same dark/light variants). Contents:
- Header with total user count and a search box (client-side filter over already-loaded pages).
- Bootstrap banner: visible only when `user.username === 'planetoftheweb' && !user.isAdmin`. Clicking "Claim admin role" calls `promoteToAdmin(self)` and refreshes the ID token.
- Table columns: email · name · username · createdAt · lastSignInAt · selected model · Gemini key (yes/no) · OpenAI key (yes/no) · admin · disabled · Actions.
- Row overflow menu: Clear keys · Wipe system prompt · Disable/Enable · Promote/Demote admin · Delete account. Destructive items route through an inline confirm.
- "Load more" pagination using the Firestore cursor.

### `App.tsx` wiring
- New `adminMode` boolean alongside `settingsMode`/`catalogMode`.
- Avatar dropdown shows "Admin" only when `user.isAdmin` (or bootstrap fallback).
- When `user.isDisabled`, short-circuit the app to a full-screen "Your account has been suspended" notice before any studio UI renders. Sign-out remains accessible.

## Suspended-User UX
Hard block. A signed-in suspended user sees a full-screen notice identifying their account and offering only a sign-out action. No history access, no catalog access, no settings access, no admin access even if claims still say otherwise.

## Deletion Scope (conservative)
- Removed: `users/{uid}` document, every doc under `users/{uid}/history`, every file under Storage `users/{uid}/`, and the Firebase Auth user record.
- Left alone: teams the user belonged to, catalog items they authored, any shared/community data. A future change can layer authorship transfer on top of this.

## Security Considerations
- `setAdminRole` is the only path that can mint the claim. The bootstrap OR-clause is deliberately narrow (single literal username, checked server-side against Firestore).
- `deleteUserAccount` does not accept a caller-supplied `callerUid`; authorization comes from `context.auth.token.admin`.
- Destructive frontend actions require an inline confirm even for admins.
- `isAdmin` is stripped from every write path so a malicious frontend cannot persist the field.
- Rules deny all writes to `users/{uid}.lastSignInAt` except server-trusted writes via the client SDK when the caller owns the doc (the value is `serverTimestamp()` so users cannot forge it).

## Risks / Trade-offs
- Keeping the `planetoftheweb` fallback indefinitely means anyone who registers that exact username becomes a bootstrap admin. Mitigation: a follow-up change can retire the fallback entirely once we're comfortable the claim is propagated everywhere.
- Conservative deletion leaves orphaned authorship references on catalog items. Acceptable for now; documented in this design.
- Claim propagation takes up to an hour by default; the frontend forces a token refresh after promote/demote to avoid this.
- No server-side pagination on the admin list means large user bases (1k+) will paginate slowly. Acceptable at current scale.

## Deployment Posture
Nothing in this change runs `firebase deploy`. Rules and functions are left ready to deploy; the last task explicitly stops short of deployment per the repo's workflow rule. The emulator suite is the only runtime target this change exercises.
