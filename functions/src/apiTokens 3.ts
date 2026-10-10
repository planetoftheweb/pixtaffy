/**
 * Personal API tokens for external access (MCP servers, scripts, other apps).
 *
 * Security model:
 *  - Tokens look like `bdi_<64 hex>`; the PLAINTEXT is shown exactly once at
 *    creation and never stored. Firestore keeps only the SHA-256 hash as the
 *    doc id in the top-level `apiTokens` collection, so a database read can
 *    never recover a usable token.
 *  - `apiTokens/**` is denied to all clients in firestore.rules; only these
 *    admin-SDK functions touch it.
 *  - Verification is an O(1) doc get by hash. Revocation is a tombstone
 *    (`revokedAt`), so a stolen-then-revoked token can be audited.
 *  - Every generation call is rate-limited per account (fixed hour/day
 *    windows in `users/{uid}/private/apiUsage`) regardless of which token
 *    was used. Limits can be raised per-account by an admin editing that doc.
 *  - Tokens only ever act as the account that created them, spending that
 *    account's own BYOK provider keys — there is nothing cross-account to
 *    escalate to.
 */
import { onRequest } from "firebase-functions/v2/https";
import type { Response } from "express";
import * as admin from "firebase-admin";
import { createHash, randomBytes } from "node:crypto";

const REGION = "us-central1";
const MAX_ACTIVE_TOKENS_PER_USER = 5;
const TOKEN_PREFIX = "bdi_";

// Default per-account API generation limits (images, fixed windows).
const DEFAULT_MAX_PER_HOUR = 60;
const DEFAULT_MAX_PER_DAY = 300;

export const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const tokenDisplayPrefix = (token: string): string =>
  `${token.slice(0, 8)}…${token.slice(-4)}`;

export interface VerifiedApiToken {
  uid: string;
  tokenHash: string;
  name: string;
}

/** Resolve a bearer `bdi_…` token to its account. Null = invalid/revoked. */
export async function verifyApiToken(
  db: admin.firestore.Firestore,
  token: string,
): Promise<VerifiedApiToken | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 40 || token.length > 128) {
    return null;
  }
  const tokenHash = hashToken(token);
  const snap = await db.collection("apiTokens").doc(tokenHash).get();
  const data = snap.data();
  if (!data || typeof data.uid !== "string" || data.revokedAt) return null;

  // Touch lastUsedAt at most once a minute — audit trail without write spam.
  const last = (data.lastUsedAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
  if (Date.now() - last > 60_000) {
    snap.ref
      .update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() })
      .catch(() => undefined);
  }
  return { uid: data.uid, tokenHash, name: typeof data.name === "string" ? data.name : "token" };
}

/**
 * Count `images` against the account's fixed hour/day windows. Throws with a
 * clean message when a limit would be exceeded (nothing is counted then).
 */
export async function enforceApiRateLimit(
  db: admin.firestore.Firestore,
  uid: string,
  images: number,
): Promise<void> {
  const ref = db.collection("users").doc(uid).collection("private").doc("apiUsage");
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13); // e.g. 2026-07-05T09
  const dayKey = now.toISOString().slice(0, 10);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() || {};
    const maxPerHour = typeof data.maxPerHour === "number" ? data.maxPerHour : DEFAULT_MAX_PER_HOUR;
    const maxPerDay = typeof data.maxPerDay === "number" ? data.maxPerDay : DEFAULT_MAX_PER_DAY;
    const hourCount = data.hourKey === hourKey ? (data.hourCount as number) || 0 : 0;
    const dayCount = data.dayKey === dayKey ? (data.dayCount as number) || 0 : 0;

    if (hourCount + images > maxPerHour) {
      throw new RateLimitError(
        `API rate limit: ${maxPerHour} images/hour (used ${hourCount}). Try later.`,
      );
    }
    if (dayCount + images > maxPerDay) {
      throw new RateLimitError(
        `API rate limit: ${maxPerDay} images/day (used ${dayCount}). Try tomorrow.`,
      );
    }

    tx.set(
      ref,
      {
        hourKey,
        hourCount: hourCount + images,
        dayKey,
        dayCount: dayCount + images,
        maxPerHour,
        maxPerDay,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export class RateLimitError extends Error {}

/** ---- Token management endpoint (Settings UI) --------------------------- */

interface ManageBody {
  action?: "create" | "list" | "revoke";
  name?: string;
  tokenHash?: string;
}

const sendJson = (res: Response, status: number, body: unknown): void => {
  res.status(status).set("Content-Type", "application/json").send(JSON.stringify(body));
};

const parseBearer = (header: string | undefined): string | null => {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
};

/**
 * Create / list / revoke the caller's API tokens. Auth: a Firebase ID token
 * from the signed-in app session (NOT an API token — a leaked API token must
 * not be able to mint more tokens or enumerate its siblings).
 */
export const manageApiTokens = onRequest(
  { cors: true, region: REGION, invoker: "public" },
  async (req, res) => {
    const out = res as Response;
    try {
      if (req.method === "OPTIONS") {
        out.status(204).send("");
        return;
      }
      if (req.method !== "POST") {
        sendJson(out, 405, { error: "Use POST." });
        return;
      }

      const idToken = parseBearer(req.headers.authorization);
      if (!idToken) {
        sendJson(out, 401, { error: "Missing Authorization bearer token." });
        return;
      }
      let decoded: admin.auth.DecodedIdToken;
      try {
        decoded = await admin.auth().verifyIdToken(idToken);
      } catch {
        sendJson(out, 401, { error: "Invalid or expired Firebase ID token." });
        return;
      }
      const uid = decoded.uid;

      const db = admin.firestore();
      const userSnap = await db.collection("users").doc(uid).get();
      if (userSnap.data()?.isDisabled === true) {
        sendJson(out, 403, { error: "Account suspended." });
        return;
      }

      const body: ManageBody =
        typeof req.body === "string" ? JSON.parse(req.body) : (req.body as ManageBody) || {};

      if (body.action === "create") {
        const name = (body.name || "").trim().slice(0, 60) || "API token";
        const active = await db
          .collection("apiTokens")
          .where("uid", "==", uid)
          .where("revokedAt", "==", null)
          .get();
        if (active.size >= MAX_ACTIVE_TOKENS_PER_USER) {
          sendJson(out, 400, {
            error: `Limit of ${MAX_ACTIVE_TOKENS_PER_USER} active tokens. Revoke one first.`,
          });
          return;
        }
        const token = TOKEN_PREFIX + randomBytes(32).toString("hex");
        const tokenHash = hashToken(token);
        await db.collection("apiTokens").doc(tokenHash).set({
          uid,
          name,
          prefix: tokenDisplayPrefix(token),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUsedAt: null,
          revokedAt: null,
        });
        // The one and only time the plaintext leaves the server.
        sendJson(out, 200, { token, tokenHash, name, prefix: tokenDisplayPrefix(token) });
        return;
      }

      if (body.action === "list") {
        const snap = await db.collection("apiTokens").where("uid", "==", uid).get();
        const tokens = snap.docs
          .map((d) => {
            const t = d.data();
            return {
              tokenHash: d.id,
              name: t.name || "API token",
              prefix: t.prefix || "bdi_…",
              createdAt: (t.createdAt as admin.firestore.Timestamp | null)?.toMillis?.() ?? null,
              lastUsedAt: (t.lastUsedAt as admin.firestore.Timestamp | null)?.toMillis?.() ?? null,
              revokedAt: (t.revokedAt as admin.firestore.Timestamp | null)?.toMillis?.() ?? null,
            };
          })
          .filter((t) => !t.revokedAt)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        sendJson(out, 200, { tokens });
        return;
      }

      if (body.action === "revoke") {
        const tokenHash = (body.tokenHash || "").trim();
        if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
          sendJson(out, 400, { error: "tokenHash required." });
          return;
        }
        const ref = db.collection("apiTokens").doc(tokenHash);
        const snap = await ref.get();
        if (!snap.exists || snap.data()?.uid !== uid) {
          sendJson(out, 404, { error: "Token not found." });
          return;
        }
        await ref.update({ revokedAt: admin.firestore.FieldValue.serverTimestamp() });
        sendJson(out, 200, { revoked: true });
        return;
      }

      sendJson(out, 400, { error: "action must be create | list | revoke." });
    } catch (err) {
      sendJson(out, 500, { error: err instanceof Error ? err.message : "Internal error." });
    }
  },
);
