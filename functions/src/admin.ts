import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

/**
 * Bootstrap safety valve: the single legacy username that is allowed to
 * promote themselves (or anyone else) to admin even when their token does not
 * yet carry the `admin` custom claim. Kept narrow on purpose so it cannot
 * silently widen over time.
 */
const BOOTSTRAP_USERNAME = "planetoftheweb";

async function callerIsBootstrap(callerUid: string): Promise<boolean> {
  try {
    const snap = await getFirestore().doc(`users/${callerUid}`).get();
    if (!snap.exists) return false;
    const username = (snap.data()?.username as string | undefined)?.trim();
    return username === BOOTSTRAP_USERNAME;
  } catch (err) {
    logger.warn("callerIsBootstrap lookup failed", err);
    return false;
  }
}

/**
 * Set (or clear) the `admin` custom claim on a user.
 * Authorization:
 *   - caller's token already has `admin === true`, OR
 *   - caller's Firestore users/{callerUid}.username === 'planetoftheweb'
 *     (one-time bootstrap; retained as a break-glass fallback).
 */
export const setAdminRole = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const callerUid = request.auth.uid;
  const callerIsAdmin = request.auth.token?.admin === true;

  const targetUid = String(request.data?.uid ?? "").trim();
  const admin_ = Boolean(request.data?.admin);

  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Missing target `uid`.");
  }

  if (!callerIsAdmin) {
    const bootstrap = await callerIsBootstrap(callerUid);
    if (!bootstrap) {
      throw new HttpsError(
        "permission-denied",
        "Only admins (or the bootstrap user) can change admin roles."
      );
    }
  }

  try {
    await getAuth().setCustomUserClaims(targetUid, { admin: admin_ });
    logger.info(`setAdminRole: caller=${callerUid} target=${targetUid} admin=${admin_}`);
    return { ok: true, uid: targetUid, admin: admin_ };
  } catch (err: any) {
    // Surface the Firebase error code to the client so "internal" errors are
    // actually actionable. Safe to expose: this code path is admin-gated.
    const code = err?.code || err?.errorInfo?.code || 'unknown';
    const message = err?.message || 'Failed to update admin claim.';
    logger.error('setAdminRole failed', { code, message, err });
    throw new HttpsError('internal', `Failed to update admin claim (${code}): ${message}`);
  }
});

/**
 * Conservative full deletion of a user.
 * Removes:
 *   - Firestore: `users/{uid}` and the `users/{uid}/history` subcollection
 *   - Storage:   all objects under `users/{uid}/`
 *   - Auth:      the Firebase Auth user record
 * Intentionally leaves teams and shared catalog items (`graphic_types`,
 * `visual_styles`, `brand_colors`, `aspect_ratios`) untouched.
 */
export const deleteUserAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  if (request.auth.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin claim required.");
  }

  const targetUid = String(request.data?.uid ?? "").trim();
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Missing target `uid`.");
  }

  const firestore = getFirestore();
  const userDocRef = firestore.doc(`users/${targetUid}`);

  // 1. Firestore: recursiveDelete handles the subcollections too.
  try {
    await firestore.recursiveDelete(userDocRef);
  } catch (err) {
    logger.error(`recursiveDelete failed for users/${targetUid}`, err);
    throw new HttpsError("internal", "Failed to delete Firestore data.");
  }

  // 2. Storage: delete everything under users/{uid}/.
  try {
    const bucket = getStorage().bucket();
    await bucket.deleteFiles({ prefix: `users/${targetUid}/` });
  } catch (err) {
    // Storage failures should not block Auth removal, but we log loudly.
    logger.warn(`Storage cleanup failed for users/${targetUid}/`, err);
  }

  // 3. Auth: remove the user record.
  try {
    await getAuth().deleteUser(targetUid);
  } catch (err: any) {
    // Swallow "user-not-found" — Firestore/Storage cleanup already ran.
    if (err?.code !== "auth/user-not-found") {
      logger.error(`deleteUser failed for ${targetUid}`, err);
      throw new HttpsError("internal", "Failed to delete Auth record.");
    }
  }

  logger.info(`deleteUserAccount: caller=${request.auth.uid} target=${targetUid}`);
  return { ok: true, uid: targetUid };
});
