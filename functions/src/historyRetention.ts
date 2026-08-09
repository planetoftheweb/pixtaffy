import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { FieldPath } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { historyLimitForBilling } from "./billingCore";

const REGION = "us-central1";
const DAY_MS = 24 * 60 * 60 * 1_000;
const RETENTION_CONFIG_PATH = "systemConfig/historyRetention";

const db = () => admin.firestore();

async function retentionStartsAt(): Promise<number> {
  const ref = db().doc(RETENTION_CONFIG_PATH);
  const snap = await ref.get();
  const configured = Number(snap.data()?.enforceAfter ?? 0);
  if (configured > 0) return configured;
  const enforceAfter = Date.now() + 30 * DAY_MS;
  await ref.set({ enforceAfter, createdAt: Date.now(), updatedAt: Date.now() }, { merge: true });
  logger.info("PixTaffy history retention grace period started", { enforceAfter });
  return enforceAfter;
}

async function deleteBuildsForGeneration(uid: string, generationId: string): Promise<void> {
  const prefix = `${generationId}|`;
  const snap = await db()
    .collection(`users/${uid}/builds`)
    .orderBy(FieldPath.documentId())
    .startAt(prefix)
    .endAt(`${prefix}\uf8ff`)
    .get();
  const batches: admin.firestore.WriteBatch[] = [];
  let batch = db().batch();
  let count = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    count += 1;
    if (count % 450 === 0) {
      batches.push(batch);
      batch = db().batch();
    }
  }
  if (count % 450 !== 0) batches.push(batch);
  await Promise.all(batches.map((item) => item.commit()));
}

async function deleteGeneration(uid: string, doc: admin.firestore.QueryDocumentSnapshot): Promise<void> {
  const generationId = String(doc.data().id || doc.id);
  await Promise.all([
    admin.storage().bucket().deleteFiles({ prefix: `users/${uid}/history/${generationId}/`, force: true }),
    deleteBuildsForGeneration(uid, generationId),
  ]);
  await doc.ref.delete();
}

async function reconcileStorage(uid: string, retainedIds: Set<string>): Promise<number> {
  const [files] = await admin.storage().bucket().getFiles({ prefix: `users/${uid}/history/` });
  const orphanFiles = files.filter((file) => {
    const relative = file.name.slice(`users/${uid}/history/`.length);
    const generationId = relative.split("/")[0];
    return Boolean(generationId) && !retainedIds.has(generationId);
  });
  await Promise.all(orphanFiles.map((file) => file.delete({ ignoreNotFound: true })));
  return orphanFiles.length;
}

async function enforceForUser(user: admin.auth.UserRecord): Promise<{ deleted: number; orphanFiles: number }> {
  if (user.customClaims?.admin === true) return { deleted: 0, orphanFiles: 0 };
  const billingSnap = await db().doc(`users/${user.uid}/private/billing`).get();
  const billing = billingSnap.data() ?? {};
  const limit = historyLimitForBilling({
    paidCustomer: billing.paidCustomer === true,
    plan: billing.plan,
    subscriptionStatus: billing.subscriptionStatus,
  });
  const historySnap = await db()
    .collection(`users/${user.uid}/history`)
    .orderBy("createdAt", "desc")
    .get();
  const keep = historySnap.docs.slice(0, limit);
  const excess = historySnap.docs.slice(limit);
  for (const doc of excess) await deleteGeneration(user.uid, doc);
  const retainedIds = new Set(keep.map((doc) => String(doc.data().id || doc.id)));
  const orphanFiles = await reconcileStorage(user.uid, retainedIds);
  return { deleted: excess.length, orphanFiles };
}

export const enforceHistoryRetention = onSchedule(
  { schedule: "every day 04:15", region: REGION, timeZone: "UTC", timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    const enforceAfter = await retentionStartsAt();
    if (Date.now() < enforceAfter) {
      logger.info("History retention is still in its export grace period", { enforceAfter });
      return;
    }
    let pageToken: string | undefined;
    let deleted = 0;
    let orphanFiles = 0;
    do {
      const page = await admin.auth().listUsers(250, pageToken);
      for (const user of page.users) {
        try {
          const result = await enforceForUser(user);
          deleted += result.deleted;
          orphanFiles += result.orphanFiles;
        } catch (error) {
          logger.error("History retention failed for user", { uid: user.uid, error });
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);
    logger.info("PixTaffy history retention completed", { deleted, orphanFiles });
  },
);
