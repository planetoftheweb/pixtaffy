import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import {
  STARTER_GRANT_MILLICREDITS,
  computeBalanceMilliCredits,
  historyLimitForBilling,
  releaseToBuckets,
  reserveFromBuckets,
  subscriptionGrantAmount,
  type CreditAllocation,
  type CreditBucket,
  type CreditSource,
} from "./billingCore";
import { getPaidModelPrice } from "./pricing";
import { readPaidAssistDelivery, readPaidDelivery } from "./paidDelivery";

const REGION = "us-central1";
const ALLOWED_ORIGINS: Array<string | RegExp> = [
  "https://pixtaffy.com",
  "https://www.pixtaffy.com",
  "https://pixtaffy.web.app",
  "https://pixtaffy.firebaseapp.com",
  /^https:\/\/pixtaffy--[a-z0-9-]+\.web\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

const callableOptions = {
  region: REGION,
  cors: ALLOWED_ORIGINS,
  enforceAppCheck: true,
};

const stripeBillingEventsSecret = defineSecret("PIXTAFFY_STRIPE_EVENTS_WEBHOOK_SECRET");

const db = () => admin.firestore();
const billingRef = (uid: string) => db().doc(`users/${uid}/private/billing`);
const ledgerRef = (uid: string, id: string) => db().doc(`users/${uid}/billingLedger/${id}`);
const reservationRef = (id: string) => db().doc(`billingReservations/${id}`);

export interface BillingDocument {
  version: 1;
  buckets: CreditBucket[];
  balanceMilliCredits: number;
  debtMilliCredits: number;
  plan: "free" | "pro";
  subscriptionStatus: string | null;
  subscriptionRenewsAt: number | null;
  stripeCustomerId: string | null;
  paidCustomer: boolean;
  starterGrantedAt: number | null;
  updatedAt: number;
}

const emptyBilling = (now: number): BillingDocument => ({
  version: 1,
  buckets: [],
  balanceMilliCredits: 0,
  debtMilliCredits: 0,
  plan: "free",
  subscriptionStatus: null,
  subscriptionRenewsAt: null,
  stripeCustomerId: null,
  paidCustomer: false,
  starterGrantedAt: null,
  updatedAt: now,
});

const readBilling = (data: admin.firestore.DocumentData | undefined, now: number): BillingDocument => {
  const base = emptyBilling(now);
  if (!data) return base;
  return {
    ...base,
    ...data,
    version: 1,
    buckets: Array.isArray(data.buckets) ? (data.buckets as CreditBucket[]) : [],
    balanceMilliCredits: Number(data.balanceMilliCredits ?? 0),
    debtMilliCredits: Math.max(0, Number(data.debtMilliCredits ?? 0)),
    paidCustomer: data.paidCustomer === true,
    starterGrantedAt: typeof data.starterGrantedAt === "number" ? data.starterGrantedAt : null,
  };
};

const safeId = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const isVerified = (request: CallableRequest): boolean =>
  request.auth?.token?.email_verified === true;

const publicState = (billing: BillingDocument, isAdmin: boolean) => ({
  balanceMilliCredits: isAdmin ? Number.MAX_SAFE_INTEGER : computeBalanceMilliCredits(billing.buckets, Date.now()) - billing.debtMilliCredits,
  balanceCredits: isAdmin ? null : (computeBalanceMilliCredits(billing.buckets, Date.now()) - billing.debtMilliCredits) / 1_000,
  plan: billing.plan,
  subscriptionStatus: billing.subscriptionStatus,
  subscriptionRenewsAt: billing.subscriptionRenewsAt,
  stripeCustomerId: billing.stripeCustomerId,
  paidCustomer: billing.paidCustomer,
  starterGranted: billing.starterGrantedAt != null,
  historyLimit: historyLimitForBilling({
    isAdmin,
    paidCustomer: billing.paidCustomer,
    plan: billing.plan,
    subscriptionStatus: billing.subscriptionStatus,
  }),
  isAdmin,
});

export async function ensureStarterGrant(uid: string, verified: boolean): Promise<void> {
  if (!verified) return;
  const now = Date.now();
  const ref = billingRef(uid);
  const starterLedger = ledgerRef(uid, "starter-grant");
  await db().runTransaction(async (tx) => {
    const [billingSnap, ledgerSnap] = await Promise.all([tx.get(ref), tx.get(starterLedger)]);
    const billing = readBilling(billingSnap.data(), now);
    if (billing.starterGrantedAt != null || ledgerSnap.exists) return;
    const bucket: CreditBucket = {
      id: "starter-grant",
      source: "starter",
      grantedMilliCredits: STARTER_GRANT_MILLICREDITS,
      remainingMilliCredits: STARTER_GRANT_MILLICREDITS,
      createdAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1_000,
      externalId: null,
    };
    const buckets = [...billing.buckets, bucket];
    tx.set(ref, {
      ...billing,
      buckets,
      balanceMilliCredits: computeBalanceMilliCredits(buckets, now) - billing.debtMilliCredits,
      starterGrantedAt: now,
      updatedAt: now,
    });
    tx.set(starterLedger, {
      uid,
      deltaMilliCredits: STARTER_GRANT_MILLICREDITS,
      reason: "signup_grant",
      source: "starter",
      createdAt: now,
      expiresAt: bucket.expiresAt,
      metadata: {},
    });
  });
}

export async function grantCredits(input: {
  uid: string;
  source: CreditSource;
  milliCredits: number;
  idempotencyKey: string;
  expiresAt: number | null;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const now = Date.now();
  const ledgerId = `grant-${safeId(input.idempotencyKey)}`;
  const ref = billingRef(input.uid);
  const grantLedger = ledgerRef(input.uid, ledgerId);
  return db().runTransaction(async (tx) => {
    const [billingSnap, existingLedger] = await Promise.all([tx.get(ref), tx.get(grantLedger)]);
    const billing = readBilling(billingSnap.data(), now);
    if (existingLedger.exists) return billing.balanceMilliCredits;

    const requested = Math.max(0, Math.floor(input.milliCredits));
    const amount = input.source === "subscription"
      ? Math.min(requested, subscriptionGrantAmount(billing.buckets, now))
      : requested;
    if (amount <= 0) return billing.balanceMilliCredits;

    const debtPayment = Math.min(billing.debtMilliCredits, amount);
    const usableAmount = amount - debtPayment;
    const bucket: CreditBucket | null = usableAmount > 0 ? {
      id: ledgerId,
      source: input.source,
      grantedMilliCredits: usableAmount,
      remainingMilliCredits: usableAmount,
      createdAt: now,
      expiresAt: input.expiresAt,
      externalId: input.idempotencyKey,
    } : null;
    const buckets = bucket ? [...billing.buckets, bucket] : billing.buckets;
    const debtMilliCredits = billing.debtMilliCredits - debtPayment;
    const balanceMilliCredits = computeBalanceMilliCredits(buckets, now) - debtMilliCredits;
    tx.set(ref, {
      ...billing,
      buckets,
      balanceMilliCredits,
      debtMilliCredits,
      paidCustomer: billing.paidCustomer || input.source === "purchase" || input.source === "subscription",
      updatedAt: now,
    });
    tx.set(grantLedger, {
      uid: input.uid,
      deltaMilliCredits: amount,
      reason: input.source === "purchase" ? "credit_purchase" : "subscription_grant",
      source: input.source,
      createdAt: now,
      expiresAt: input.expiresAt,
      metadata: input.metadata ?? {},
    });
    return balanceMilliCredits;
  });
}

export interface ReservationResult {
  reservationId: string | null;
  balanceMilliCredits: number;
  adminBypass: boolean;
}

const takeAllocations = (
  allocations: CreditAllocation[],
  milliCredits: number,
): { taken: CreditAllocation[]; remaining: CreditAllocation[] } | null => {
  let needed = Math.floor(milliCredits);
  const taken: CreditAllocation[] = [];
  const remaining: CreditAllocation[] = [];
  for (const allocation of allocations) {
    if (needed <= 0) {
      remaining.push(allocation);
      continue;
    }
    const amount = Math.min(allocation.milliCredits, needed);
    taken.push({ ...allocation, milliCredits: amount });
    needed -= amount;
    if (allocation.milliCredits > amount) {
      remaining.push({ ...allocation, milliCredits: allocation.milliCredits - amount });
    }
  }
  return needed === 0 ? { taken, remaining } : null;
};

export async function reserveCredits(input: {
  uid: string;
  milliCredits: number;
  idempotencyKey: string;
  action: string;
  modelId?: string | null;
  isAdmin?: boolean;
}): Promise<ReservationResult> {
  if (input.isAdmin) {
    return { reservationId: null, balanceMilliCredits: Number.MAX_SAFE_INTEGER, adminBypass: true };
  }
  const now = Date.now();
  const reservationId = safeId(`${input.uid}:${input.idempotencyKey}`);
  const ref = billingRef(input.uid);
  const resRef = reservationRef(reservationId);
  return db().runTransaction(async (tx) => {
    const [billingSnap, existingReservation] = await Promise.all([tx.get(ref), tx.get(resRef)]);
    const billing = readBilling(billingSnap.data(), now);
    if (billing.debtMilliCredits > 0) {
      throw new HttpsError("failed-precondition", "Your PixTaffy balance is negative after a payment reversal. Resolve it before using site-funded AI.");
    }
    if (existingReservation.exists) {
      const existing = existingReservation.data()!;
      if (existing.uid !== input.uid || existing.milliCredits !== input.milliCredits) {
        throw new HttpsError("already-exists", "This request key was already used.");
      }
      // Never call a provider twice for the same client request. A duplicate
      // can otherwise create a second image while the existing debit remains
      // idempotent, effectively making the retry free.
      throw new HttpsError("already-exists", `This request is already ${existing.state ?? "in progress"}.`);
    }
    const reserved = reserveFromBuckets(billing.buckets, input.milliCredits, now);
    if (!reserved) {
      throw new HttpsError("resource-exhausted", "Not enough PixTaffy credits.");
    }
    tx.set(ref, {
      ...billing,
      buckets: reserved.buckets,
      balanceMilliCredits: reserved.balanceMilliCredits,
      updatedAt: now,
    });
    tx.set(resRef, {
      uid: input.uid,
      state: "reserved",
      milliCredits: Math.floor(input.milliCredits),
      allocations: reserved.allocations,
      action: input.action,
      modelId: input.modelId ?? null,
      idempotencyKey: input.idempotencyKey,
      reservedAt: now,
      committedAt: null,
      releasedAt: null,
    });
    return {
      reservationId,
      balanceMilliCredits: reserved.balanceMilliCredits,
      adminBypass: false,
    };
  });
}

export async function commitReservation(input: {
  uid: string;
  reservationId: string | null;
  provider?: string;
  providerRequestId?: string | null;
  actualCostUsd?: number | null;
  usage?: Record<string, unknown> | null;
}): Promise<void> {
  if (!input.reservationId) return;
  const now = Date.now();
  const resRef = reservationRef(input.reservationId);
  const debitLedger = ledgerRef(input.uid, `debit-${input.reservationId}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(resRef);
    if (!snap.exists) throw new HttpsError("not-found", "Credit reservation not found.");
    const reservation = snap.data()!;
    if (reservation.uid !== input.uid) throw new HttpsError("permission-denied", "Reservation owner mismatch.");
    if (reservation.state === "committed") return;
    if (reservation.state !== "reserved") throw new HttpsError("failed-precondition", "Reservation is not active.");
    tx.update(resRef, {
      state: "committed",
      committedAt: now,
      provider: input.provider ?? null,
      providerRequestId: input.providerRequestId ?? null,
      actualCostUsd: input.actualCostUsd ?? null,
      usage: input.usage ?? null,
    });
    tx.set(debitLedger, {
      uid: input.uid,
      deltaMilliCredits: -Math.abs(Number(reservation.milliCredits ?? 0)),
      reason: reservation.action,
      action: reservation.action,
      modelId: reservation.modelId ?? null,
      providerRequestId: input.providerRequestId ?? null,
      actualCostUsd: input.actualCostUsd ?? null,
      idempotencyKey: reservation.idempotencyKey,
      source: "usage",
      createdAt: now,
      expiresAt: null,
      metadata: {
        reservationId: input.reservationId,
        modelId: reservation.modelId ?? null,
        provider: input.provider ?? null,
        providerRequestId: input.providerRequestId ?? null,
        actualCostUsd: input.actualCostUsd ?? null,
      },
    });
  });
}

export async function releaseReservation(input: {
  uid: string;
  reservationId: string | null;
  reason: string;
}): Promise<void> {
  if (!input.reservationId) return;
  const now = Date.now();
  const ref = billingRef(input.uid);
  const resRef = reservationRef(input.reservationId);
  const releaseLedger = ledgerRef(input.uid, `release-${input.reservationId}`);
  await db().runTransaction(async (tx) => {
    const [billingSnap, resSnap] = await Promise.all([tx.get(ref), tx.get(resRef)]);
    if (!resSnap.exists) return;
    const reservation = resSnap.data()!;
    if (reservation.uid !== input.uid) throw new HttpsError("permission-denied", "Reservation owner mismatch.");
    if (reservation.state !== "reserved") return;
    const billing = readBilling(billingSnap.data(), now);
    const released = releaseToBuckets(
      billing.buckets,
      (reservation.allocations ?? []) as CreditAllocation[],
      now,
    );
    tx.set(ref, {
      ...billing,
      buckets: released.buckets,
      balanceMilliCredits: released.balanceMilliCredits - billing.debtMilliCredits,
      updatedAt: now,
    });
    tx.update(resRef, {
      state: "released",
      releasedAt: now,
      releaseReason: input.reason.slice(0, 500),
    });
    tx.set(releaseLedger, {
      uid: input.uid,
      deltaMilliCredits: 0,
      reason: "reservation_released",
      action: reservation.action,
      modelId: reservation.modelId ?? null,
      idempotencyKey: reservation.idempotencyKey,
      source: "adjustment",
      createdAt: now,
      expiresAt: null,
      metadata: { reservationId: input.reservationId, releaseReason: input.reason.slice(0, 500) },
    });
  });
}

interface BatchModelRequest {
  modelId: string;
  count: number;
}

const batchItemRef = (reservationId: string, itemId: string) =>
  reservationRef(reservationId).collection("items").doc(safeId(itemId));

const validRequestKey = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length < 8 || value.length > 160) {
    throw new HttpsError("invalid-argument", `A valid ${label} is required.`);
  }
  return value;
};

export const reserveImageBatch = onCall(callableOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to use PixTaffy credits.");
  const isAdmin = request.auth?.token?.admin === true;
  await ensureStarterGrant(uid, isVerified(request));
  const idempotencyKey = validRequestKey(request.data?.idempotencyKey, "batch request id");
  const rawModels = Array.isArray(request.data?.models) ? request.data.models : [];
  const models: BatchModelRequest[] = rawModels.map((raw: unknown) => {
    const value = (raw ?? {}) as Record<string, unknown>;
    return { modelId: String(value.modelId ?? ""), count: Math.floor(Number(value.count ?? 0)) };
  });
  const totalImages = models.reduce((sum, item) => sum + item.count, 0);
  if (models.length === 0 || models.some((item) => item.count <= 0) || totalImages > 15) {
    throw new HttpsError("invalid-argument", "A paid batch must contain between 1 and 15 images.");
  }
  const modelCounts: Record<string, number> = {};
  let totalMilliCredits = 0;
  for (const item of models) {
    const pricing = getPaidModelPrice(item.modelId);
    if (!pricing) throw new HttpsError("failed-precondition", `${item.modelId} is BYOK-only.`);
    modelCounts[item.modelId] = (modelCounts[item.modelId] ?? 0) + item.count;
    totalMilliCredits += pricing.milliCredits * item.count;
  }
  const reservation = await reserveCredits({
    uid,
    milliCredits: totalMilliCredits,
    idempotencyKey,
    action: "image_batch",
    modelId: null,
    isAdmin,
  });
  if (reservation.reservationId) {
    const ref = reservationRef(reservation.reservationId);
    const snap = await ref.get();
    await ref.set({
      batch: true,
      expectedItems: totalImages,
      modelCounts,
      claimedModelCounts: {},
      unassignedAllocations: (snap.data()?.allocations ?? []) as CreditAllocation[],
      balanceMilliCreditsAfterReserve: reservation.balanceMilliCredits,
      updatedAt: Date.now(),
    }, { merge: true });
  }
  return {
    reservationId: reservation.reservationId,
    totalMilliCredits,
    balanceMilliCredits: reservation.balanceMilliCredits,
    adminBypass: reservation.adminBypass,
  };
});

export async function claimBatchReservationItem(input: {
  uid: string;
  reservationId: string;
  itemId: string;
  modelId: string;
  milliCredits: number;
}): Promise<{ itemReservationId: string; balanceMilliCredits: number }> {
  const now = Date.now();
  const parentRef = reservationRef(input.reservationId);
  const itemRef = batchItemRef(input.reservationId, input.itemId);
  return db().runTransaction(async (tx) => {
    const [parentSnap, itemSnap] = await Promise.all([tx.get(parentRef), tx.get(itemRef)]);
    if (!parentSnap.exists) throw new HttpsError("not-found", "Batch credit reservation not found.");
    const parent = parentSnap.data()!;
    if (parent.uid !== input.uid) throw new HttpsError("permission-denied", "Reservation owner mismatch.");
    if (parent.action !== "image_batch" || parent.state !== "reserved") {
      throw new HttpsError("failed-precondition", "Batch credit reservation is not active.");
    }
    if (itemSnap.exists) throw new HttpsError("already-exists", "This batch item was already submitted.");
    const expected = Number(parent.modelCounts?.[input.modelId] ?? 0);
    const alreadyClaimed = Number(parent.claimedModelCounts?.[input.modelId] ?? 0);
    if (alreadyClaimed >= expected) {
      throw new HttpsError("resource-exhausted", "This batch has no remaining reservation for the selected model.");
    }
    const split = takeAllocations(
      (parent.unassignedAllocations ?? []) as CreditAllocation[],
      input.milliCredits,
    );
    if (!split) throw new HttpsError("resource-exhausted", "The batch reservation has no remaining credits.");
    tx.update(parentRef, {
      unassignedAllocations: split.remaining,
      claimedModelCounts: {
        ...(parent.claimedModelCounts ?? {}),
        [input.modelId]: alreadyClaimed + 1,
      },
      updatedAt: now,
    });
    tx.set(itemRef, {
      uid: input.uid,
      parentReservationId: input.reservationId,
      itemId: input.itemId,
      state: "reserved",
      milliCredits: Math.floor(input.milliCredits),
      allocations: split.taken,
      action: "image_generation",
      modelId: input.modelId,
      idempotencyKey: input.itemId,
      reservedAt: now,
      committedAt: null,
      releasedAt: null,
    });
    return {
      itemReservationId: itemRef.id,
      balanceMilliCredits: Number(parent.balanceMilliCreditsAfterReserve ?? 0),
    };
  });
}

export async function commitBatchReservationItem(input: {
  uid: string;
  reservationId: string;
  itemReservationId: string;
  providerRequestId?: string | null;
  actualCostUsd?: number | null;
  usage?: Record<string, unknown> | null;
}): Promise<void> {
  const now = Date.now();
  const itemRef = reservationRef(input.reservationId).collection("items").doc(input.itemReservationId);
  const debitLedger = ledgerRef(input.uid, `debit-${input.reservationId}-${input.itemReservationId}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(itemRef);
    if (!snap.exists) throw new HttpsError("not-found", "Batch item reservation not found.");
    const item = snap.data()!;
    if (item.uid !== input.uid) throw new HttpsError("permission-denied", "Reservation owner mismatch.");
    if (item.state === "committed") return;
    if (item.state !== "reserved") throw new HttpsError("failed-precondition", "Batch item reservation is not active.");
    tx.update(itemRef, {
      state: "committed",
      committedAt: now,
      provider: "openrouter",
      providerRequestId: input.providerRequestId ?? null,
      actualCostUsd: input.actualCostUsd ?? null,
      usage: input.usage ?? null,
    });
    tx.set(debitLedger, {
      uid: input.uid,
      deltaMilliCredits: -Math.abs(Number(item.milliCredits ?? 0)),
      reason: "image_generation",
      action: "image_generation",
      modelId: item.modelId ?? null,
      providerRequestId: input.providerRequestId ?? null,
      actualCostUsd: input.actualCostUsd ?? null,
      idempotencyKey: item.idempotencyKey,
      source: "usage",
      createdAt: now,
      expiresAt: null,
      metadata: {
        reservationId: input.reservationId,
        itemReservationId: input.itemReservationId,
        modelId: item.modelId ?? null,
        provider: "openrouter",
        providerRequestId: input.providerRequestId ?? null,
        actualCostUsd: input.actualCostUsd ?? null,
      },
    });
  });
}

export async function releaseBatchReservationItem(input: {
  uid: string;
  reservationId: string;
  itemReservationId: string;
  reason: string;
}): Promise<void> {
  const now = Date.now();
  const ref = billingRef(input.uid);
  const itemRef = reservationRef(input.reservationId).collection("items").doc(input.itemReservationId);
  const releaseLedger = ledgerRef(input.uid, `release-${input.reservationId}-${input.itemReservationId}`);
  await db().runTransaction(async (tx) => {
    const [billingSnap, itemSnap] = await Promise.all([tx.get(ref), tx.get(itemRef)]);
    if (!itemSnap.exists) return;
    const item = itemSnap.data()!;
    if (item.uid !== input.uid) throw new HttpsError("permission-denied", "Reservation owner mismatch.");
    if (item.state !== "reserved") return;
    const billing = readBilling(billingSnap.data(), now);
    const released = releaseToBuckets(billing.buckets, (item.allocations ?? []) as CreditAllocation[], now);
    tx.set(ref, {
      ...billing,
      buckets: released.buckets,
      balanceMilliCredits: released.balanceMilliCredits - billing.debtMilliCredits,
      updatedAt: now,
    });
    tx.update(itemRef, {
      state: "released",
      releasedAt: now,
      releaseReason: input.reason.slice(0, 500),
    });
    tx.set(releaseLedger, {
      uid: input.uid,
      deltaMilliCredits: 0,
      reason: "reservation_released",
      action: "image_generation",
      modelId: item.modelId ?? null,
      idempotencyKey: item.idempotencyKey,
      source: "adjustment",
      createdAt: now,
      expiresAt: null,
      metadata: {
        reservationId: input.reservationId,
        itemReservationId: input.itemReservationId,
        releaseReason: input.reason.slice(0, 500),
      },
    });
  });
}

async function releaseBatchRemainder(uid: string, reservationId: string, reason: string): Promise<number> {
  const now = Date.now();
  const ref = billingRef(uid);
  const parentRef = reservationRef(reservationId);
  const releaseLedger = ledgerRef(uid, `release-remainder-${reservationId}`);
  return db().runTransaction(async (tx) => {
    const [billingSnap, parentSnap] = await Promise.all([tx.get(ref), tx.get(parentRef)]);
    if (!parentSnap.exists) return 0;
    const parent = parentSnap.data()!;
    if (parent.uid !== uid) throw new HttpsError("permission-denied", "Reservation owner mismatch.");
    if (parent.action !== "image_batch" || parent.state !== "reserved") {
      return readBilling(billingSnap.data(), now).balanceMilliCredits;
    }
    const billing = readBilling(billingSnap.data(), now);
    const allocations = (parent.unassignedAllocations ?? []) as CreditAllocation[];
    const released = releaseToBuckets(billing.buckets, allocations, now);
    const balanceMilliCredits = released.balanceMilliCredits - billing.debtMilliCredits;
    tx.set(ref, { ...billing, buckets: released.buckets, balanceMilliCredits, updatedAt: now });
    tx.update(parentRef, {
      state: "closed",
      unassignedAllocations: [],
      releasedAt: now,
      releaseReason: reason.slice(0, 500),
      updatedAt: now,
    });
    tx.set(releaseLedger, {
      uid,
      deltaMilliCredits: 0,
      reason: "batch_remainder_released",
      action: "image_batch",
      idempotencyKey: parent.idempotencyKey,
      source: "adjustment",
      createdAt: now,
      expiresAt: null,
      metadata: {
        reservationId,
        releasedMilliCredits: allocations.reduce((sum, item) => sum + item.milliCredits, 0),
        releaseReason: reason.slice(0, 500),
      },
    });
    return balanceMilliCredits;
  });
}

export const releaseImageBatchRemainder = onCall(callableOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to manage PixTaffy credits.");
  const reservationId = validRequestKey(request.data?.reservationId, "batch reservation id");
  const balanceMilliCredits = await releaseBatchRemainder(uid, reservationId, "client_batch_finished");
  return { balanceMilliCredits };
});

export const releaseStaleImageBatches = onSchedule(
  { schedule: "every 15 minutes", region: REGION, timeZone: "UTC" },
  async () => {
    const cutoff = Date.now() - 30 * 60 * 1_000;
    const [parentSnap, itemSnap] = await Promise.all([
      db().collection("billingReservations").where("state", "==", "reserved").limit(200).get(),
      db().collectionGroup("items").where("state", "==", "reserved").limit(200).get(),
    ]);

    await Promise.all(itemSnap.docs
      .filter((doc) => Number(doc.data().reservedAt ?? 0) <= cutoff)
      .map(async (doc) => {
        const item = doc.data();
        try {
          const cached = await readPaidDelivery(String(item.uid), String(item.idempotencyKey));
          if (cached) {
            await commitBatchReservationItem({
              uid: String(item.uid),
              reservationId: String(item.parentReservationId),
              itemReservationId: doc.id,
              providerRequestId: cached.providerRequestId,
              actualCostUsd: cached.actualCostUsd,
              usage: cached.usage,
            });
            return;
          }
          await releaseBatchReservationItem({
            uid: String(item.uid),
            reservationId: String(item.parentReservationId),
            itemReservationId: doc.id,
            reason: "stale_batch_item_timeout",
          });
        } catch (error) {
          logger.error("Unable to reconcile stale batch item", { itemReservationId: doc.id, error });
        }
      }));

    await Promise.all(parentSnap.docs
      .filter((doc) => Number(doc.data().reservedAt ?? 0) <= cutoff)
      .map(async (doc) => {
        const reservation = doc.data();
        try {
          if (reservation.action === "image_batch") {
            await releaseBatchRemainder(String(reservation.uid), doc.id, "stale_batch_timeout");
          } else if (reservation.action === "image_generation") {
            const cached = await readPaidDelivery(String(reservation.uid), String(reservation.idempotencyKey));
            if (cached) {
              await commitReservation({
                uid: String(reservation.uid),
                reservationId: doc.id,
                provider: "openrouter",
                providerRequestId: cached.providerRequestId,
                actualCostUsd: cached.actualCostUsd,
                usage: cached.usage,
              });
            } else {
              await releaseReservation({
                uid: String(reservation.uid),
                reservationId: doc.id,
                reason: "stale_image_timeout",
              });
            }
          } else {
            const cached = await readPaidAssistDelivery(String(reservation.uid), String(reservation.idempotencyKey));
            if (cached) {
              await commitReservation({
                uid: String(reservation.uid),
                reservationId: doc.id,
                provider: "gemini",
                providerRequestId: null,
                actualCostUsd: cached.actualCostUsd,
                usage: cached.usage,
              });
            } else {
              await releaseReservation({
                uid: String(reservation.uid),
                reservationId: doc.id,
                reason: "stale_ai_assist_timeout",
              });
            }
          }
        } catch (error) {
          logger.error("Unable to reconcile stale paid reservation", { reservationId: doc.id, error });
        }
      }));
  },
);

async function revokePurchasedCredits(input: {
  uid: string;
  milliCredits: number;
  paymentId: string;
  reason: "refund" | "chargeback";
  revenueUsd: number;
}): Promise<void> {
  const now = Date.now();
  const idempotencyKey = `stripe-payment:${input.paymentId}`;
  const ledger = ledgerRef(input.uid, `revoke-${safeId(`${input.reason}:${idempotencyKey}`)}`);
  const ref = billingRef(input.uid);
  await db().runTransaction(async (tx) => {
    const [billingSnap, ledgerSnap] = await Promise.all([tx.get(ref), tx.get(ledger)]);
    if (ledgerSnap.exists) return;
    const billing = readBilling(billingSnap.data(), now);
    let remaining = Math.max(0, Math.floor(input.milliCredits));
    const buckets = billing.buckets.map((bucket) => {
      if (remaining <= 0 || bucket.source !== "purchase" || bucket.externalId !== idempotencyKey) return bucket;
      const revoked = Math.min(bucket.remainingMilliCredits, remaining);
      remaining -= revoked;
      return { ...bucket, remainingMilliCredits: bucket.remainingMilliCredits - revoked };
    });
    const debtMilliCredits = billing.debtMilliCredits + remaining;
    const balanceMilliCredits = computeBalanceMilliCredits(buckets, now) - debtMilliCredits;
    tx.set(ref, { ...billing, buckets, debtMilliCredits, balanceMilliCredits, updatedAt: now });
    tx.set(ledger, {
      uid: input.uid,
      deltaMilliCredits: -Math.abs(input.milliCredits),
      reason: input.reason,
      source: "adjustment",
      createdAt: now,
      expiresAt: null,
      metadata: {
        stripePaymentId: input.paymentId,
        unusedCreditsRevoked: input.milliCredits - remaining,
        debtCreated: remaining,
        revenueUsd: -Math.abs(input.revenueUsd),
      },
    });
  });
}

const verifyStripeSignature = (rawBody: Buffer, signatureHeader: string, secret: string): boolean => {
  const parts = signatureHeader.split(",").map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || signatures.length === 0) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1_000 - timestampSeconds) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const candidate = Buffer.from(signature, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
};

export const stripeBillingEvents = onRequest(
  { region: REGION, secrets: [stripeBillingEventsSecret] },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method not allowed");
      return;
    }
    const signature = request.header("stripe-signature");
    const secret = stripeBillingEventsSecret.value();
    if (!signature || !secret || !verifyStripeSignature(request.rawBody, signature, secret)) {
      response.status(401).send("Invalid signature");
      return;
    }

    const stripeEvent = JSON.parse(request.rawBody.toString("utf8")) as Record<string, any>;
    if (!["charge.refunded", "charge.dispute.created"].includes(String(stripeEvent.type))) {
      response.status(200).json({ received: true });
      return;
    }

    const charge = stripeEvent.data?.object as Record<string, any> | undefined;
    const stripeCustomerId = typeof charge?.customer === "string" ? charge.customer : charge?.customer?.id;
    const paymentIntentId = typeof charge?.payment_intent === "string"
      ? charge.payment_intent
      : charge?.payment_intent?.id;
    if (!stripeCustomerId || !paymentIntentId) {
      logger.warn("Stripe refund or dispute event is missing customer/payment intent", {
        stripeEventId: stripeEvent.id,
        stripeEventType: stripeEvent.type,
      });
      response.status(200).json({ received: true });
      return;
    }

    const customerSnap = await db().collection("customers").where("stripeId", "==", stripeCustomerId).limit(1).get();
    if (customerSnap.empty) {
      logger.warn("Stripe refund or dispute customer was not found", {
        stripeEventId: stripeEvent.id,
        stripeCustomerId,
      });
      response.status(200).json({ received: true });
      return;
    }

    const uid = customerSnap.docs[0].id;
    const paymentSnap = await db().doc(`customers/${uid}/payments/${paymentIntentId}`).get();
    const paymentData = paymentSnap.data() as Record<string, any> | undefined;
    const productId = paymentData ? await resolvePixTaffyProductId(paymentData) : null;
    const creditsByProduct: Record<string, number> = {
      credits_25: 25_000,
      credits_100: 100_000,
      credits_300: 300_000,
    };
    const revenueByProduct: Record<string, number> = {
      credits_25: 6,
      credits_100: 18,
      credits_300: 45,
    };
    const milliCredits = creditsByProduct[String(productId ?? "")];
    if (!milliCredits) {
      logger.warn("Stripe refund or dispute could not be matched to a PixTaffy credit pack", {
        stripeEventId: stripeEvent.id,
        paymentIntentId,
      });
      response.status(200).json({ received: true });
      return;
    }

    await revokePurchasedCredits({
      uid,
      milliCredits,
      paymentId: paymentIntentId,
      reason: stripeEvent.type === "charge.refunded" ? "refund" : "chargeback",
      revenueUsd: revenueByProduct[String(productId)],
    });
    logger.info("Applied Stripe credit revocation", {
      stripeEventId: stripeEvent.id,
      stripeEventType: stripeEvent.type,
      paymentIntentId,
      productId,
    });
    response.status(200).json({ received: true });
  },
);

export const getBillingState = onCall(callableOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to view billing.");
  const isAdmin = request.auth?.token?.admin === true;
  await ensureStarterGrant(uid, isVerified(request));
  const snap = await billingRef(uid).get();
  return publicState(readBilling(snap.data(), Date.now()), isAdmin);
});

const PRODUCT_PRICE_ENV: Record<string, string> = {
  credits_25: "STRIPE_PRICE_CREDITS_25",
  credits_100: "STRIPE_PRICE_CREDITS_100",
  credits_300: "STRIPE_PRICE_CREDITS_300",
  pro_monthly: "STRIPE_PRICE_PRO_MONTHLY",
};

async function findStripePriceId(productId: string): Promise<string | null> {
  const configured = process.env[PRODUCT_PRICE_ENV[productId]];
  if (configured?.startsWith("price_")) return configured;
  const products = await db().collection("products").get();
  for (const product of products.docs) {
    const productData = product.data();
    const prices = await product.ref.collection("prices").get();
    const match = prices.docs.find((price) => {
      const priceData = price.data();
      const metadataId = priceData.metadata?.pixtaffyProductId ?? productData.metadata?.pixtaffyProductId;
      return metadataId === productId && priceData.active !== false;
    });
    if (match?.id.startsWith("price_")) return match.id;
  }
  return null;
}

export const createCheckout = onCall(callableOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to purchase credits.");
  const productId = String(request.data?.productId ?? "");
  const envName = PRODUCT_PRICE_ENV[productId];
  if (!envName) throw new HttpsError("invalid-argument", "Unknown PixTaffy product.");
  const price = await findStripePriceId(productId);
  if (!price) throw new HttpsError("failed-precondition", "This PixTaffy price is not available yet.");
  const origin = String(request.data?.origin ?? "");
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|([a-z0-9-]+\.)?pixtaffy\.com)(:\d+)?$/i.test(origin)) {
    throw new HttpsError("invalid-argument", "Invalid checkout return origin.");
  }
  const mode = productId === "pro_monthly" ? "subscription" : "payment";
  const session = db().collection(`customers/${uid}/checkout_sessions`).doc();
  await session.set({
    mode,
    price,
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=canceled`,
    allow_promotion_codes: true,
    metadata: { pixtaffyProductId: productId },
    created: FieldValue.serverTimestamp(),
  });
  return { sessionId: session.id };
});

export const getCreditActivity = onCall(callableOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to view credit activity.");
  const requested = Number(request.data?.limit ?? 25);
  const pageSize = Math.max(1, Math.min(50, Math.floor(requested)));
  const snap = await db()
    .collection(`users/${uid}/billingLedger`)
    .orderBy("createdAt", "desc")
    .limit(pageSize)
    .get();
  return {
    entries: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});

async function resolvePixTaffyProductId(data: Record<string, any>): Promise<string | null> {
  const direct =
    data.prices?.[0]?.metadata?.pixtaffyProductId ??
    data.items?.[0]?.price?.metadata?.pixtaffyProductId ??
    data.price?.metadata?.pixtaffyProductId ??
    data.metadata?.pixtaffyProductId;
  if (direct) return String(direct);
  const productValue =
    data.items?.[0]?.price?.product ??
    data.prices?.[0]?.product ??
    data.price?.product;
  const stripeProductId = typeof productValue === "string" ? productValue : productValue?.id;
  if (!stripeProductId) return null;
  const productSnap = await db().doc(`products/${stripeProductId}`).get();
  const fromProduct = productSnap.data()?.metadata?.pixtaffyProductId;
  return fromProduct ? String(fromProduct) : null;
}

export const onStripePayment = onDocumentWritten(
  { document: "customers/{uid}/payments/{paymentId}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data() as Record<string, any>;
    const productId = await resolvePixTaffyProductId(data);
    const amountByProduct: Record<string, number> = {
      credits_25: 25_000,
      credits_100: 100_000,
      credits_300: 300_000,
    };
    const amount = amountByProduct[String(productId ?? "")];
    if (!amount) return;
    if (["refunded", "disputed", "chargeback"].includes(String(data.status)) && data.pixtaffyRevocationWritten !== true) {
      const revenueByProduct: Record<string, number> = { credits_25: 6, credits_100: 18, credits_300: 45 };
      await revokePurchasedCredits({
        uid: event.params.uid,
        milliCredits: amount,
        paymentId: event.params.paymentId,
        reason: data.status === "refunded" ? "refund" : "chargeback",
        revenueUsd: revenueByProduct[String(productId)],
      });
      await after.ref.set({ pixtaffyRevocationWritten: true }, { merge: true });
      return;
    }
    if (data.status !== "succeeded" || data.pixtaffyLedgerWritten === true) return;
    await grantCredits({
      uid: event.params.uid,
      source: "purchase",
      milliCredits: amount,
      idempotencyKey: `stripe-payment:${event.params.paymentId}`,
      expiresAt: null,
      metadata: {
        productId,
        stripePaymentId: event.params.paymentId,
        revenueUsd: productId === "credits_25" ? 6 : productId === "credits_100" ? 18 : 45,
      },
    });
    await after.ref.set({ pixtaffyLedgerWritten: true }, { merge: true });
  },
);

export const onStripeCheckoutSession = onDocumentWritten(
  { document: "customers/{uid}/checkout_sessions/{sessionId}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data() as Record<string, any>;
    const productId = String(data.metadata?.pixtaffyProductId ?? "");
    const amountByProduct: Record<string, number> = {
      credits_25: 25_000,
      credits_100: 100_000,
      credits_300: 300_000,
    };
    const amount = amountByProduct[productId];
    if (!amount || data.payment_status !== "paid" || data.pixtaffyLedgerWritten === true) return;
    const paymentId = String(data.payment_intent ?? data.paymentIntent ?? event.params.sessionId);
    await grantCredits({
      uid: event.params.uid,
      source: "purchase",
      milliCredits: amount,
      idempotencyKey: `stripe-payment:${paymentId}`,
      expiresAt: null,
      metadata: {
        productId,
        stripePaymentId: paymentId,
        stripeCheckoutSessionId: event.params.sessionId,
        revenueUsd: productId === "credits_25" ? 6 : productId === "credits_100" ? 18 : 45,
      },
    });
    await after.ref.set({ pixtaffyLedgerWritten: true }, { merge: true });
  },
);

const toMillis = (value: unknown): number | null => {
  if (typeof value === "number") return value * 1_000;
  if (value && typeof value === "object" && "seconds" in value) {
    return Number((value as { seconds: number }).seconds) * 1_000;
  }
  return null;
};

export const onStripeSubscription = onDocumentWritten(
  { document: "customers/{uid}/subscriptions/{subscriptionId}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data() as Record<string, any>;
    const productId = await resolvePixTaffyProductId(data);
    if (productId !== "pro_monthly") return;
    const periodStart = toMillis(data.current_period_start);
    const periodEnd = toMillis(data.current_period_end);
    const active = data.status === "active" || data.status === "trialing";
    await billingRef(event.params.uid).set({
      plan: active ? "pro" : "free",
      subscriptionStatus: data.status ?? null,
      subscriptionRenewsAt: periodEnd,
      paidCustomer: true,
      updatedAt: Date.now(),
    }, { merge: true });

    if (data.status === "active" && periodStart != null && data.pixtaffyLastGrantPeriodStart !== periodStart) {
      const duration = periodEnd != null ? Math.max(1, periodEnd - periodStart) : 30 * 24 * 60 * 60 * 1_000;
      await grantCredits({
        uid: event.params.uid,
        source: "subscription",
        milliCredits: 100_000,
        idempotencyKey: `stripe-subscription:${event.params.subscriptionId}:${periodStart}`,
        expiresAt: (periodEnd ?? Date.now()) + duration,
        metadata: { subscriptionId: event.params.subscriptionId, periodStart, periodEnd, revenueUsd: 15 },
      });
      await after.ref.set({ pixtaffyLastGrantPeriodStart: periodStart }, { merge: true });
    }
  },
);

export const onStripeCustomerWrite = onDocumentWritten(
  { document: "customers/{uid}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const stripeCustomerId = after.data()?.stripeId;
    if (!stripeCustomerId) return;
    await billingRef(event.params.uid).set({ stripeCustomerId, updatedAt: Date.now() }, { merge: true });
  },
);
