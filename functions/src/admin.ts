import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

/**
 * Set (or clear) the `admin` custom claim on a user.
 * Authorization: the caller's token must already carry `admin === true`.
 * The old username-based bootstrap was removed because `username` lives on
 * the user's own profile doc, so anyone could set it and promote themselves.
 * To grant the first admin, set the claim with the Admin SDK from a trusted
 * machine instead.
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
    throw new HttpsError(
      "permission-denied",
      "Only admins can change admin roles."
    );
  }

  try {
    await admin.auth().setCustomUserClaims(targetUid, { admin: admin_ });
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

  const firestore = admin.firestore();
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
    const bucket = admin.storage().bucket();
    await bucket.deleteFiles({ prefix: `users/${targetUid}/` });
  } catch (err) {
    // Storage failures should not block Auth removal, but we log loudly.
    logger.warn(`Storage cleanup failed for users/${targetUid}/`, err);
  }

  // 3. Auth: remove the user record.
  try {
    await admin.auth().deleteUser(targetUid);
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
