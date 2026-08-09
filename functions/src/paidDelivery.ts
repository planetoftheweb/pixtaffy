import { createHash } from "node:crypto";
import * as admin from "firebase-admin";

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
  const file = admin.storage().bucket().file(deliveryPath(uid, idempotencyKey));
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
  const file = admin.storage().bucket().file(deliveryPath(delivery.uid, delivery.idempotencyKey));
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
  const file = admin.storage().bucket().file(assistDeliveryPath(uid, idempotencyKey));
  const [exists] = await file.exists();
  if (!exists) return null;
  const [contents] = await file.download();
  const parsed = JSON.parse(contents.toString("utf8")) as CachedPaidAssistDelivery;
  if (parsed.version !== 1 || parsed.uid !== uid || parsed.idempotencyKey !== idempotencyKey) {
    throw new Error("Cached paid assist delivery failed validation.");
  }
  return parsed;
}

export async function writePaidAssistDeliveryWithRetry(delivery: CachedPaidAssistDelivery): Promise<void> {
  const file = admin.storage().bucket().file(assistDeliveryPath(delivery.uid, delivery.idempotencyKey));
  let lastError: unknown;
  for (const delay of [0, 250, 750]) {
    if (delay > 0) await wait(delay);
    try {
      await file.save(JSON.stringify(delivery), {
        resumable: false,
        contentType: "application/json",
        metadata: {
          cacheControl: "private,no-store,max-age=0",
          metadata: { pixtaffyAssistDelivery: "true", createdAt: String(delivery.createdAt) },
        },
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to store the AI result for delivery.");
}

export async function deleteExpiredPaidDeliveries(now = Date.now()): Promise<number> {
  const [imageFiles, assistFiles] = await Promise.all([
    admin.storage().bucket().getFiles({ prefix: "billing-deliveries/" }),
    admin.storage().bucket().getFiles({ prefix: "billing-assist-deliveries/" }),
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
