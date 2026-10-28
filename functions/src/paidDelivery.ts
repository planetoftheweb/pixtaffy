import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";

export interface CachedPaidDelivery {
  version: 1;
  uid: string;
  idempotencyKey: string;
  modelId: string;
  createdAt: number;
  reservation: {
    kind: "single" | "batch" | "admin";
    reservationId: string | null;
    itemReservationId: string | null;
  };
  payload: {
    imageUrl: string;
    base64Data: string;
    mimeType: string;
    modelId: string;
    milliCreditsCharged: number;
    balanceMilliCredits: number;
  };
  providerRequestId: string | null;
  actualCostUsd: number;
  usage: Record<string, unknown> | null;
}

export interface CachedPaidAssistDelivery {
  version: 1;
  uid: string;
  idempotencyKey: string;
  action: string;
  createdAt: number;
  reservationId: string | null;
  result: unknown;
  milliCreditsCharged: number;
  balanceMilliCredits: number;
  actualCostUsd: number;
  usage: Record<string, unknown> | null;
}

const deliveryPath = (uid: string, idempotencyKey: string): string => {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return `billing-deliveries/${uid}/${digest}.json`;
};

const assistDeliveryPath = (uid: string, idempotencyKey: string): string => {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return `billing-assist-deliveries/${uid}/${digest}.json`;
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function readPaidDelivery(
  uid: string,
  idempotencyKey: string,
): Promise<CachedPaidDelivery | null> {
  const file = getStorage().bucket().file(deliveryPath(uid, idempotencyKey));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [contents] = await file.download();
  const parsed = JSON.parse(contents.toString("utf8")) as CachedPaidDelivery;
  if (parsed.version !== 1 || parsed.uid !== uid || parsed.idempotencyKey !== idempotencyKey) {
    throw new Error("Cached paid delivery failed validation.");
  }
  return parsed;
}

export async function writePaidDeliveryWithRetry(delivery: CachedPaidDelivery): Promise<void> {
  const file = getStorage().bucket().file(deliveryPath(delivery.uid, delivery.idempotencyKey));
  let lastError: unknown;
  for (const delay of [0, 250, 750]) {
    if (delay > 0) await wait(delay);
    try {
      await file.save(JSON.stringify(delivery), {
        resumable: false,
        contentType: "application/json",
        metadata: {
          cacheControl: "private,no-store,max-age=0",
          metadata: {
            pixtaffyDelivery: "true",
            createdAt: String(delivery.createdAt),
          },
        },
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to store the generated image for delivery.");
}

export async function readPaidAssistDelivery(
  uid: string,
  idempotencyKey: string,
): Promise<CachedPaidAssistDelivery | null> {
  const file = getStorage().bucket().file(assistDeliveryPath(uid, idempotencyKey));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [contents] = await file.download();
  const parsed = JSON.parse(contents.toString("utf8")) as CachedPaidAssistDelivery;
  if (parsed.version !== 1 || parsed.uid !== uid || parsed.idempotencyKey !== idempotencyKey) {
    throw new Error("Cached paid assist delivery failed validation.");
  }
  return parsed;
}

type AssistFile = Pick<ReturnType<ReturnType<ReturnType<typeof getStorage>["bucket"]>["file"]>, "save" | "download">;

export async function writePaidAssistDeliveryWithRetry(
  delivery: CachedPaidAssistDelivery,
  file: AssistFile = getStorage().bucket().file(assistDeliveryPath(delivery.uid, delivery.idempotencyKey)),
  sleep: (milliseconds: number) => Promise<void> = wait,
): Promise<CachedPaidAssistDelivery> {
  let lastError: unknown;
  for (const delay of [0, 250, 750]) {
    if (delay > 0) await sleep(delay);
    try {
      await file.save(JSON.stringify(delivery), {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        contentType: "application/json",
        metadata: {
          cacheControl: "private,no-store,max-age=0",
          metadata: { pixtaffyAssistDelivery: "true", createdAt: String(delivery.createdAt) },
        },
      });
      return delivery;
    } catch (error) {
      const conflict = error as { code?: unknown; status?: unknown; message?: string };
      if ([409, 412, "409", "412", "ALREADY_EXISTS"].includes(conflict?.code as string | number)
        || [409, 412].includes(Number(conflict?.status))
        || /already[ _-]?exists|conditionNotMet/i.test(conflict?.message ?? "")) {
        let stored: CachedPaidAssistDelivery;
        try {
          const [contents] = await file.download();
          stored = JSON.parse(contents.toString("utf8"));
          if (!stored || stored.version !== 1 || stored.uid !== delivery.uid
            || stored.idempotencyKey !== delivery.idempotencyKey || stored.action !== delivery.action
            || !(stored.reservationId === null || typeof stored.reservationId === "string")) {
            throw new Error("Invalid delivery identity");
          }
        } catch {
          throw new HttpsError("failed-precondition", "The stored AI delivery could not be validated. Contact support.");
        }
        // The first durable delivery wins, including its reservation. If the reservation
        // differs, the caller settles that stored reservation and releases only its own
        // unused reservation. Never return the losing provider result or overwrite storage.
        return stored;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to store the AI result for delivery.");
}

export async function deleteExpiredPaidDeliveries(now = Date.now()): Promise<number> {
  const [imageFiles, assistFiles] = await Promise.all([
    getStorage().bucket().getFiles({ prefix: "billing-deliveries/" }),
    getStorage().bucket().getFiles({ prefix: "billing-assist-deliveries/" }),
  ]);
  const files = [...imageFiles[0], ...assistFiles[0]];
  const cutoff = now - 24 * 60 * 60 * 1_000;
  let deleted = 0;
  await Promise.all(files.map(async (file) => {
    const [metadata] = await file.getMetadata();
    const createdAt = Number(metadata.metadata?.createdAt ?? Date.parse(String(metadata.timeCreated ?? "")));
    if (!Number.isFinite(createdAt) || createdAt > cutoff) return;
    await file.delete({ ignoreNotFound: true });
    deleted += 1;
  }));
  return deleted;
}
