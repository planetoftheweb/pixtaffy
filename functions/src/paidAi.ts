import { geminiAssistCost } from "./geminiRates";
import { enforceRateLimit } from './rateLimit';
import { stagingOrigins } from "./corsOrigins";
import { createHash, randomUUID } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";
import { buildRunAiAssistOptions, resolveAiAssistBackend, resolveAiAssistVertexConfig } from "./aiAssistBackend";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  claimBatchReservationItem,
  commitBatchReservationItem,
  commitReservation,
  ensureStarterGrant,
  releaseBatchReservationItem,
  releaseReservation,
  reserveCredits,
  reserveAssistCredits,
} from "./billing";
import { AI_ASSIST_MILLICREDITS, getPaidModelPrice, paidModelPrices, type AiAssistAction } from "./pricing";
import { generateOpenRouterImageCore } from "./openRouterProvider";
import {
  normalizeOpenAIImageBackground,
  supportsOpenAIBackground,
} from "./openaiImageBackground";
import {
  canReserveGuestCredits,
  DEFAULT_GUEST_MODEL_ID,
  guestBalanceMilliCredits,
  guestSpentMilliCredits,
  GUEST_GRANT_MILLICREDITS,
} from "./guestCredits";
import {
  deleteExpiredPaidDeliveries,
  readPaidAssistDelivery,
  readPaidDelivery,
  writePaidAssistDeliveryWithRetry,
  writePaidDeliveryWithRetry,
  type CachedPaidDelivery,
} from "./paidDelivery";

const REGION = "us-central1";
const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");
const AI_ASSIST_BACKEND = resolveAiAssistBackend(process.env);
const PIXTAFFY_GEMINI_API_KEY = AI_ASSIST_BACKEND === "apikey"
  ? defineSecret("PIXTAFFY_GEMINI_API_KEY")
  : undefined;
const ALLOWED_ORIGINS: Array<string | RegExp> = [
  ...stagingOrigins(),
  "https://pixtaffy.com",
  "https://www.pixtaffy.com",
  "https://pixtaffy.web.app",
  "https://pixtaffy.firebaseapp.com",
  /^https:\/\/pixtaffy--[a-z0-9-]+\.web\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

const baseOptions = {
  region: REGION,
  cors: ALLOWED_ORIGINS,
  enforceAppCheck: true,
  timeoutSeconds: 300,
  memory: "1GiB" as const,
};

const db = () => getFirestore();
const GUEST_DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const GUEST_IP_DAILY_LIMIT = 5;

function requireAuth(request: CallableRequest): { uid: string; isAdmin: boolean } {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to use PixTaffy AI.");
  return { uid, isAdmin: request.auth?.token?.admin === true };
}

function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 160) {
    throw new HttpsError("invalid-argument", "A valid request id is required.");
  }
  return value;
}

const dateKey = () => new Date().toISOString().slice(0, 10);
const holdExpiry = (day: string) => Timestamp.fromMillis(Date.parse(`${day}T00:00:00Z`) + 3 * 24 * 60 * 60 * 1_000);

export async function reserveSpendCapacity(provider: "openrouter" | "gemini", maximumCostUsd: number, holdId?: string): Promise<void> {
  const day = holdId ? holdId.slice(0, 10) : dateKey();
  const ref = db().doc(`systemSpend/${day}`);
  // Rules restrict systemSpend and its holds to admins; ordinary clients have no access.
  const holdRef = holdId ? db().doc(`systemSpend/${day}/holds/${holdId}`) : null;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const hold = holdRef ? await tx.get(holdRef) : null;
    if (hold?.exists) return;
    const spent = Number(snap.data()?.[`${provider}Usd`] ?? 0);
    const reservedField = `${provider}ReservedUsd`;
    const reserved = Number(snap.data()?.[reservedField] ?? 0);
    const cap = provider === "openrouter" ? 25 : 5;
    if (spent + reserved + maximumCostUsd > cap) {
      throw new HttpsError(
        "unavailable",
        `PixTaffy ${provider === "openrouter" ? "image generation" : "AI assist"} reached today's safety limit. BYOK generation is still available.`,
      );
    }
    tx.set(ref, { [reservedField]: reserved + maximumCostUsd, updatedAt: Date.now() }, { merge: true });
    if (holdRef) tx.set(holdRef, { amount: maximumCostUsd, provider, state: "held", day, expireAt: holdExpiry(day) });
  });
}

export async function releaseSpendCapacity(provider: "openrouter" | "gemini", maximumCostUsd: number, holdId?: string): Promise<void> {
  const day = holdId ? holdId.slice(0, 10) : dateKey();
  const ref = db().doc(`systemSpend/${day}`);
  const holdRef = holdId ? db().doc(`systemSpend/${day}/holds/${holdId}`) : null;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const hold = holdRef ? await tx.get(holdRef) : null;
    if (holdRef && (!hold?.exists || hold.data()?.state !== "held")) return;
    const amount = holdRef ? Number(hold!.data()!.amount) : maximumCostUsd;
    if (holdRef) tx.update(holdRef, { state: "released", releasedAt: Date.now(), expireAt: holdExpiry(day) });
    const field = `${provider}ReservedUsd`;
    const current = Number(snap.data()?.[field] ?? 0);
    tx.set(ref, { [field]: Math.max(0, current - amount), updatedAt: Date.now() }, { merge: true });
  });
}

export async function recordSpend(
  provider: "openrouter" | "gemini",
  costUsd: number,
  modelOrAction: string,
  reservedCostUsd = 0,
  holdId?: string,
): Promise<number> {
  const safeCost = Number.isFinite(costUsd) ? Math.max(0, costUsd) : 0;
  const day = holdId ? holdId.slice(0, 10) : dateKey();
  const ref = db().doc(`systemSpend/${day}`);
  const holdRef = holdId ? db().doc(`systemSpend/${day}/holds/${holdId}`) : null;
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const hold = holdRef ? await tx.get(holdRef) : null;
    const field = `${provider}Usd`;
    if (hold?.data()?.state === "settled") return { total: Number(snap.data()?.[field] ?? 0), recorded: false };
    const amount = holdRef ? (hold?.data()?.state === "held" ? Number(hold.data()!.amount) : 0) : reservedCostUsd;
    if (holdRef) tx.set(holdRef, { state: "settled", settledAt: Date.now(), expireAt: holdExpiry(day), day }, { merge: true });
    const total = Number(snap.data()?.[field] ?? 0) + safeCost;
    const byModel = { ...(snap.data()?.[`${provider}ByModel`] ?? {}) };
    const reservedField = `${provider}ReservedUsd`;
    const remainingReserved = Math.max(0, Number(snap.data()?.[reservedField] ?? 0) - amount);
    const reportingKey = createHash("sha256").update(modelOrAction).digest("hex").slice(0, 16);
    byModel[reportingKey] = Number(byModel[reportingKey] ?? 0) + safeCost;
    tx.set(ref, {
      [field]: total,
      [reservedField]: remainingReserved,
      [`${provider}ByModel`]: byModel,
      reportingLabels: { ...(snap.data()?.reportingLabels ?? {}), [reportingKey]: modelOrAction },
      updatedAt: Date.now(),
    }, { merge: true });
    return { total, recorded: true };
  }).then(({ total, recorded }) => {
    if (!recorded) return total;
    const warningThresholds = provider === "openrouter" ? [10, 20] : [2, 4];
    const crossed = warningThresholds.filter((threshold) => total >= threshold && total - safeCost < threshold);
    for (const threshold of crossed) {
      logger.warn("PixTaffy provider spend warning", { provider, thresholdUsd: threshold, totalUsd: total });
    }
    return total;
  });
}

export async function markAssistDeliveryFailed(
  reservationId: string,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let failure: unknown;
  for (const delay of [0, 200, 600]) {
    try {
      if (delay > 0) await sleep(delay);
      await db().doc(`billingReservations/${reservationId}`).update({ deliveryFailedAt: Date.now() });
      return;
    } catch (error) {
      failure = error;
    }
  }
  logger.error("Unable to mark AI assist delivery failed", {
    reservationId, message: failure instanceof Error ? failure.message : String(failure),
  });
}

const disabledModelRef = (modelId: string) =>
  db().doc(`paidAiDisabledModels/${createHash("sha256").update(modelId).digest("hex")}`);

async function assertModelEnabled(modelId: string): Promise<void> {
  const snap = await disabledModelRef(modelId).get();
  if (snap.data()?.disabled === true) {
    throw new HttpsError("failed-precondition", "This model is temporarily BYOK-only while its price is reviewed.");
  }
}

function requireAnonymousAuth(request: CallableRequest): string {
  const uid = request.auth?.uid;
  const provider = (request.auth?.token as any)?.firebase?.sign_in_provider;
  if (!uid || provider !== "anonymous") {
    throw new HttpsError("failed-precondition", "Guest credits are available before registration.");
  }
  return uid;
}

function guestRequests(data: FirebaseFirestore.DocumentData | undefined): Record<string, Record<string, unknown>> {
  const requests = data?.requests;
  return requests && typeof requests === "object" ? { ...requests } : {};
}

function guestRequestIp(request: CallableRequest, uid: string): string {
  const forwarded = request.rawRequest.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return String(firstForwarded || request.rawRequest.ip || `unknown:${uid}`).trim().slice(0, 160);
}

function guestClaimRefs(uid: string, installId: string, ip: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  return {
    claim: db().doc(`guestGenerationClaims/${digest(uid)}`),
    device: db().doc(`guestGenerationDevices/${digest(installId)}`),
    ip: db().doc(`guestGenerationIpBuckets/${dateKey()}-${digest(ip)}`),
  };
}

async function reserveGuestClaim(input: {
  uid: string;
  installId: string;
  ip: string;
  idempotencyKey: string;
  modelId: string;
  milliCredits: number;
}): Promise<number> {
  const now = Date.now();
  const requestHash = createHash("sha256").update(input.idempotencyKey).digest("hex");
  const refs = guestClaimRefs(input.uid, input.installId, input.ip);
  return db().runTransaction(async (tx) => {
    const [claimSnap, deviceSnap, ipSnap] = await Promise.all([
      tx.get(refs.claim),
      tx.get(refs.device),
      tx.get(refs.ip),
    ]);
    const claimData = claimSnap.data();
    const deviceData = deviceSnap.data();
    const claimRequests = guestRequests(claimData);
    const deviceRequests = guestRequests(deviceData);
    const existingRequest = claimRequests[requestHash] ?? deviceRequests[requestHash];
    const spent = Math.max(
      guestSpentMilliCredits(claimData, now),
      guestSpentMilliCredits(deviceData, now),
    );
    if (existingRequest?.status === "reserved" || existingRequest?.status === "completed") {
      if (existingRequest.modelId !== input.modelId || Number(existingRequest.milliCredits) !== input.milliCredits) {
        throw new HttpsError("already-exists", "This guest request id belongs to a different image request.");
      }
      return Math.max(0, GUEST_GRANT_MILLICREDITS - spent);
    }
    if (!canReserveGuestCredits(spent, input.milliCredits)) {
      throw new HttpsError(
        "resource-exhausted",
        "You have used your 3 guest credits. Create an account and verify your email for 10 starter credits.",
      );
    }
    const ipCount = Number(ipSnap.data()?.count ?? 0);
    if (ipCount >= GUEST_IP_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "The guest image limit for this network has been reached today. Create an account to continue.");
    }
    const requestRecord = {
      modelId: input.modelId,
      milliCredits: input.milliCredits,
      reservedAt: now,
      status: "reserved",
    };
    const nextSpent = spent + input.milliCredits;
    tx.set(refs.claim, {
      uidHash: createHash("sha256").update(input.uid).digest("hex"),
      spentMilliCredits: nextSpent,
      requests: { ...claimRequests, [requestHash]: requestRecord },
      updatedAt: now,
    }, { merge: true });
    tx.set(refs.device, {
      spentMilliCredits: nextSpent,
      requests: { ...deviceRequests, [requestHash]: requestRecord },
      expiresAt: now + GUEST_DEVICE_WINDOW_MS,
      updatedAt: now,
    }, { merge: true });
    tx.set(refs.ip, { count: ipCount + 1, updatedAt: now, date: dateKey() }, { merge: true });
    return GUEST_GRANT_MILLICREDITS - nextSpent;
  });
}

async function releaseGuestClaim(input: {
  uid: string;
  installId: string;
  ip: string;
  idempotencyKey: string;
}): Promise<void> {
  const requestHash = createHash("sha256").update(input.idempotencyKey).digest("hex");
  const refs = guestClaimRefs(input.uid, input.installId, input.ip);
  await db().runTransaction(async (tx) => {
    const [claimSnap, deviceSnap, ipSnap] = await Promise.all([
      tx.get(refs.claim),
      tx.get(refs.device),
      tx.get(refs.ip),
    ]);
    const now = Date.now();
    const claimData = claimSnap.data();
    const deviceData = deviceSnap.data();
    const claimRequests = guestRequests(claimData);
    const deviceRequests = guestRequests(deviceData);
    const request = claimRequests[requestHash] ?? deviceRequests[requestHash];
    if (request?.status !== "reserved") return;
    const milliCredits = Math.max(0, Number(request.milliCredits ?? 0));
    const released = { ...request, status: "released", releasedAt: now };
    tx.set(refs.claim, {
      spentMilliCredits: Math.max(0, guestSpentMilliCredits(claimData, now) - milliCredits),
      requests: { ...claimRequests, [requestHash]: released },
      updatedAt: now,
    }, { merge: true });
    tx.set(refs.device, {
      spentMilliCredits: Math.max(0, guestSpentMilliCredits(deviceData, now) - milliCredits),
      requests: { ...deviceRequests, [requestHash]: released },
      updatedAt: now,
    }, { merge: true });
    const count = Number(ipSnap.data()?.count ?? 0);
    if (count > 0) tx.set(refs.ip, { count: count - 1, updatedAt: now }, { merge: true });
  });
}

async function completeGuestClaim(input: {
  uid: string;
  installId: string;
  ip: string;
  providerRequestId: string | null;
  actualCostUsd: number;
  idempotencyKey: string;
}): Promise<void> {
  const refs = guestClaimRefs(input.uid, input.installId, input.ip);
  const completedAt = Date.now();
  const requestHash = createHash("sha256").update(input.idempotencyKey).digest("hex");
  await db().runTransaction(async (tx) => {
    const [claimSnap, deviceSnap] = await Promise.all([tx.get(refs.claim), tx.get(refs.device)]);
    for (const [ref, snap] of [[refs.claim, claimSnap], [refs.device, deviceSnap]] as const) {
      const data = snap.data();
      const requests = guestRequests(data);
      const request = requests[requestHash];
      if (!request || request.status === "completed") continue;
      tx.set(ref, {
        requests: {
          ...requests,
          [requestHash]: {
            ...request,
            status: "completed",
            completedAt,
            providerRequestId: input.providerRequestId,
            actualCostUsd: input.actualCostUsd,
          },
        },
        updatedAt: completedAt,
      }, { merge: true });
    }
  });
}

async function settleCachedDelivery(delivery: CachedPaidDelivery): Promise<void> {
  if (delivery.reservation.kind === "batch" && delivery.reservation.reservationId && delivery.reservation.itemReservationId) {
    await commitBatchReservationItem({
      uid: delivery.uid,
      reservationId: delivery.reservation.reservationId,
      itemReservationId: delivery.reservation.itemReservationId,
      providerRequestId: delivery.providerRequestId,
      actualCostUsd: delivery.actualCostUsd,
      usage: delivery.usage,
    });
  } else if (delivery.reservation.kind === "single") {
    await commitReservation({
      uid: delivery.uid,
      reservationId: delivery.reservation.reservationId,
      provider: "openrouter",
      providerRequestId: delivery.providerRequestId,
      actualCostUsd: delivery.actualCostUsd,
      usage: delivery.usage,
    });
  }
}

async function settleDeliveryWithRetry(delivery: CachedPaidDelivery): Promise<void> {
  let lastError: unknown;
  for (const delay of [0, 200, 600]) {
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    try {
      await settleCachedDelivery(delivery);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export const getPaidAiCatalog = onCall(baseOptions, async (request) => {
  requireAuth(request);
  return {
    models: paidModelPrices().map((price) => ({
      modelId: price.requestedModelId,
      label: price.label,
      milliCredits: price.milliCredits,
    })),
    helpers: AI_ASSIST_MILLICREDITS,
  };
});

export const getGuestCreditState = onCall(baseOptions, async (request) => {
  const uid = requireAnonymousAuth(request);
  const installId = String(request.data?.guestInstallId ?? "");
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(installId)) {
    throw new HttpsError("invalid-argument", "A valid guest installation id is required.");
  }
  const refs = guestClaimRefs(uid, installId, guestRequestIp(request, uid));
  const [claimSnap, deviceSnap] = await Promise.all([refs.claim.get(), refs.device.get()]);
  const now = Date.now();
  const balanceMilliCredits = guestBalanceMilliCredits(claimSnap.data(), deviceSnap.data(), now);
  return {
    grantedMilliCredits: GUEST_GRANT_MILLICREDITS,
    spentMilliCredits: GUEST_GRANT_MILLICREDITS - balanceMilliCredits,
    balanceMilliCredits,
  };
});

export const generateGuestImage = onCall(
  { ...baseOptions, secrets: [OPENROUTER_API_KEY] },
  async (request) => {
    const uid = requireAnonymousAuth(request);
    const prompt = String(request.data?.prompt ?? "").trim();
    if (!prompt || prompt.length > 20_000) throw new HttpsError("invalid-argument", "A valid prompt is required.");
    const installId = String(request.data?.guestInstallId ?? "");
    if (!/^[A-Za-z0-9._:-]{16,160}$/.test(installId)) {
      throw new HttpsError("invalid-argument", "A valid guest installation id is required.");
    }
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const aspectRatio = String(request.data?.aspectRatio ?? "1:1").slice(0, 12);
    const background = normalizeOpenAIImageBackground(
      String(request.data?.background ?? "auto").toLowerCase(),
    );
    const modelId = String(request.data?.modelId ?? DEFAULT_GUEST_MODEL_ID);
    const cached = await readPaidDelivery(uid, idempotencyKey).catch((error) => {
      logger.error("Guest delivery lookup failed", { error });
      throw new HttpsError("unavailable", "PixTaffy could not safely check your guest image. Try again.");
    });
    if (cached) {
      if (cached.modelId !== modelId) {
        throw new HttpsError("already-exists", "This guest request id belongs to a different model.");
      }
      return cached.payload;
    }

    const pricing = getPaidModelPrice(modelId);
    if (!pricing) throw new HttpsError("failed-precondition", "This model is not available with guest credits.");
    const ip = guestRequestIp(request, uid);
    const claimInput = { uid, installId, ip, idempotencyKey, modelId, milliCredits: pricing.milliCredits };
    await Promise.all([enforceRateLimit(uid, "images", { perHour: 20, perDay: 100 }), assertModelEnabled(modelId)]);
    const balanceMilliCredits = await reserveGuestClaim(claimInput);

    let spendCapacityHeld = false;
    let deliveryStored = false;
    try {
      await reserveSpendCapacity("openrouter", pricing.costCeilingUsd);
      spendCapacityHeld = true;
      const generated = await generateOpenRouterImageCore({
        apiKey: OPENROUTER_API_KEY.value(),
        modelSlug: pricing.openRouterModelId,
        prompt,
        aspectRatio,
        background: supportsOpenAIBackground(modelId) ? background : "auto",
        user: createHash("sha256").update(`pixtaffy-guest:${uid}`).digest("hex"),
        title: "PixTaffy Guest Image",
      });
      const payload = {
        imageUrl: `data:${generated.mimeType};base64,${generated.base64Data}`,
        base64Data: generated.base64Data,
        mimeType: generated.mimeType,
        modelId,
        milliCreditsCharged: pricing.milliCredits,
        balanceMilliCredits,
      };
      const delivery: CachedPaidDelivery = {
        version: 1,
        uid,
        idempotencyKey,
        modelId,
        createdAt: Date.now(),
        reservation: { kind: "admin", reservationId: null, itemReservationId: null },
        payload,
        providerRequestId: generated.providerRequestId,
        actualCostUsd: generated.actualCostUsd,
        usage: generated.usage,
      };
      await writePaidDeliveryWithRetry(delivery);
      deliveryStored = true;
      await recordSpend("openrouter", generated.actualCostUsd, `guest:${modelId}`, pricing.costCeilingUsd)
        .then(() => { spendCapacityHeld = false; })
        .catch((error) => logger.error("Guest image spend settlement deferred", { error }));
      if (generated.actualCostUsd > pricing.costCeilingUsd) {
        await disabledModelRef(modelId).set({
          disabled: true,
          modelId,
          actualCostUsd: generated.actualCostUsd,
          costCeilingUsd: pricing.costCeilingUsd,
          disabledAt: Date.now(),
          reason: "guest_actual_cost_exceeded_ceiling",
        }).catch((error) => logger.error("Unable to disable the over-ceiling guest model", { error }));
      }
      await completeGuestClaim({
        uid,
        installId,
        ip,
        providerRequestId: generated.providerRequestId,
        actualCostUsd: generated.actualCostUsd,
        idempotencyKey,
      });
      return payload;
    } catch (error) {
      if (spendCapacityHeld) {
        await releaseSpendCapacity("openrouter", pricing.costCeilingUsd).catch((releaseError) => {
          logger.error("Unable to release guest OpenRouter capacity", { releaseError });
        });
      }
      if (!deliveryStored) {
        await releaseGuestClaim(claimInput).catch((releaseError) => {
          logger.error("Unable to release failed guest claim", { releaseError });
        });
      }
      throw error instanceof HttpsError
        ? error
        : new HttpsError("internal", error instanceof Error ? error.message : "Guest image generation failed.");
    }
  },
);

export const generateWithCredits = onCall(
  { ...baseOptions, secrets: [OPENROUTER_API_KEY] },
  async (request) => {
    const { uid, isAdmin } = requireAuth(request);
    const modelId = String(request.data?.modelId ?? "");
    const pricing = getPaidModelPrice(modelId);
    if (!pricing) {
      throw new HttpsError("failed-precondition", "This model is available with BYOK only.");
    }
    const prompt = String(request.data?.prompt ?? "").trim();
    if (!prompt || prompt.length > 50_000) throw new HttpsError("invalid-argument", "A valid prompt is required.");
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const batchReservationId = typeof request.data?.batchReservationId === "string"
      ? request.data.batchReservationId
      : null;
    if (batchReservationId && !/^[a-f0-9]{64}$/.test(batchReservationId)) {
      throw new HttpsError("invalid-argument", "Invalid batch reservation id.");
    }
    const aspectRatio = String(request.data?.aspectRatio ?? "1:1");
    const background = normalizeOpenAIImageBackground(
      String(request.data?.background ?? "auto").toLowerCase(),
    );
    const cached = await readPaidDelivery(uid, idempotencyKey).catch((error) => {
      logger.error("Paid delivery lookup failed", { uidHash: createHash("sha256").update(uid).digest("hex").slice(0, 12), error });
      throw new HttpsError("unavailable", "PixTaffy could not safely check this request. Try again with the same request id.");
    });
    if (cached) {
      if (cached.modelId !== modelId) throw new HttpsError("already-exists", "This request id belongs to a different model.");
      await settleDeliveryWithRetry(cached).catch((error) => {
        logger.error("Cached paid delivery settlement is still pending", { providerRequestId: cached.providerRequestId, error });
      });
      return cached.payload;
    }
    await Promise.all([enforceRateLimit(uid, "images", { perHour: 20, perDay: 100 }), assertModelEnabled(modelId)]);
    await ensureStarterGrant(uid, request.auth?.token?.email_verified === true);
    const batchItem = batchReservationId && !isAdmin
      ? await claimBatchReservationItem({
          uid,
          reservationId: batchReservationId,
          itemId: idempotencyKey,
          modelId,
          milliCredits: pricing.milliCredits,
        })
      : null;
    const reservation = batchItem
      ? { reservationId: null, balanceMilliCredits: batchItem.balanceMilliCredits, adminBypass: false }
      : await reserveCredits({
          uid,
          milliCredits: pricing.milliCredits,
          idempotencyKey,
          action: "image_generation",
          modelId,
          isAdmin,
        });

    let spendCapacityHeld = false;
    try {
      await reserveSpendCapacity("openrouter", pricing.costCeilingUsd);
      spendCapacityHeld = true;
      const generated = await generateOpenRouterImageCore({
        apiKey: OPENROUTER_API_KEY.value(),
        modelSlug: pricing.openRouterModelId,
        prompt,
        aspectRatio,
        background: supportsOpenAIBackground(modelId) ? background : "auto",
        user: createHash("sha256").update(`pixtaffy:${uid}`).digest("hex"),
        title: "PixTaffy",
      });
      const actualCostUsd = generated.actualCostUsd;
      const payload = {
        imageUrl: `data:${generated.mimeType};base64,${generated.base64Data}`,
        base64Data: generated.base64Data,
        mimeType: generated.mimeType,
        modelId,
        milliCreditsCharged: pricing.milliCredits,
        balanceMilliCredits: reservation.balanceMilliCredits,
      };
      const delivery: CachedPaidDelivery = {
        version: 1,
        uid,
        idempotencyKey,
        modelId,
        createdAt: Date.now(),
        reservation: batchItem && batchReservationId
          ? {
              kind: "batch",
              reservationId: batchReservationId,
              itemReservationId: batchItem.itemReservationId,
            }
          : reservation.adminBypass
            ? { kind: "admin", reservationId: null, itemReservationId: null }
            : { kind: "single", reservationId: reservation.reservationId, itemReservationId: null },
        payload,
        providerRequestId: generated.providerRequestId,
        actualCostUsd,
        usage: generated.usage,
      };
      await writePaidDeliveryWithRetry(delivery);
      await recordSpend("openrouter", actualCostUsd, modelId, pricing.costCeilingUsd)
        .then(() => { spendCapacityHeld = false; })
        .catch((error) => {
          // Leave the reserved capacity in place when accounting is briefly
          // unavailable. This fails closed and avoids overspending the cap.
          logger.error("OpenRouter spend settlement deferred", { providerRequestId: generated.providerRequestId, error });
        });
      if (actualCostUsd > pricing.costCeilingUsd) {
        await disabledModelRef(modelId).set({
          disabled: true,
          modelId,
          actualCostUsd,
          costCeilingUsd: pricing.costCeilingUsd,
          disabledAt: Date.now(),
          reason: "actual_cost_exceeded_ceiling",
        }).catch((error) => {
          logger.error("Unable to disable an over-ceiling paid model", { modelId, actualCostUsd, error });
        });
      }
      await settleDeliveryWithRetry(delivery).catch((error) => {
        // The credit is already reserved and the generated result is safely
        // cached. Return it now; a retry with the same request id settles the
        // same reservation without calling the provider again.
        logger.error("Paid delivery settlement deferred", { providerRequestId: generated.providerRequestId, error });
      });
      return payload;
    } catch (error) {
      if (spendCapacityHeld) {
        await releaseSpendCapacity("openrouter", pricing.costCeilingUsd).catch((releaseError) => {
          logger.error("Unable to release OpenRouter spend capacity", { modelId, releaseError });
        });
      }
      if (batchItem && batchReservationId) {
        await releaseBatchReservationItem({
          uid,
          reservationId: batchReservationId,
          itemReservationId: batchItem.itemReservationId,
          reason: error instanceof Error ? error.message : "OpenRouter request failed",
        });
      } else {
        await releaseReservation({
          uid,
          reservationId: reservation.reservationId,
          reason: error instanceof Error ? error.message : "OpenRouter request failed",
        });
      }
      throw error instanceof HttpsError
        ? error
        : new HttpsError("internal", error instanceof Error ? error.message : "Image generation failed.");
    }
  },
);

export const cleanupPaidDeliveries = onSchedule(
  { schedule: "every day 04:15", region: REGION, timeZone: "UTC" },
  async () => {
    const deleted = await deleteExpiredPaidDeliveries();
    logger.info("Expired paid delivery cache cleaned", { deleted });
  },
);

function parseJsonText(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function actionPrompt(action: AiAssistAction, payload: Record<string, any>): string {
  const context = typeof payload.context === "string" ? payload.context.slice(0, 20_000) : "";
  const text = typeof payload.text === "string" ? payload.text.slice(0, 20_000) : "";
  switch (action) {
    case "expand_prompt":
      return `Expand this image-generation request into one vivid, production-ready creative brief. Preserve the intent and return only the expanded prompt.\n\nRequest: ${text}\n\nContext: ${context}`;
    case "image_description":
      return "Describe the supplied image as a concise, reusable image-generation prompt. Return only the prompt.";
    case "style_extraction":
      return 'Analyze the supplied image style. Return JSON only: {"name":"short style name","description":"specific visual description"}.';
    case "image_analysis":
      return payload.optionType === "color"
        ? 'Extract the dominant brand palette. Return JSON only: {"name":"palette name","colors":["#RRGGBB"]} with 3 to 8 colors.'
        : 'Analyze the supplied visual. Return JSON only: {"name":"short name","description":"specific reusable description"}.';
    case "correction_analysis":
      return `Audit the supplied image for spelling, factual, labeling, alignment, and legibility problems. Return JSON only: {"analysisSummary":"...","issues":["..."],"fixPrompt":"complete correction prompt"}. Context: ${context}`;
    case "brand_guidelines_image":
    case "brand_guidelines_pdf":
      return 'Extract brand guidelines from the supplied file. Return JSON only: {"brandColors":[{"name":"...","colors":["#RRGGBB"]}],"visualStyles":[{"name":"...","description":"..."}],"summary":"..."}.';
    case "region_detection":
      return `Identify 3 to 12 meaningful rectangular presentation regions in reading order. Coordinates are normalized from 0 to 1. Return JSON only: {"regions":[{"label":"...","x":0,"y":0,"w":0,"h":0}]}. Canvas: ${payload.width}x${payload.height}.`;
    case "ai_name":
      return `Name each supplied region in order using 2 to 5 words. Return JSON only: {"names":["..."]}. Regions: ${JSON.stringify(payload.regions ?? []).slice(0, 10_000)}`;
  }
}

function requireAssistAction(value: unknown): AiAssistAction {
  const action = String(value ?? "") as AiAssistAction;
  if (!(action in AI_ASSIST_MILLICREDITS)) throw new HttpsError("invalid-argument", "Unknown AI assist action.");
  return action;
}

const ASSIST_BLOCK_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

export function isAssistBlocked(response: {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string }>;
}): boolean {
  const reason = response.promptFeedback?.blockReason;
  return Boolean(reason && reason !== "BLOCK_REASON_UNSPECIFIED")
    || Boolean(response.candidates?.some((candidate) => ASSIST_BLOCK_REASONS.has(candidate.finishReason ?? "")));
}

export function mapAiAssistError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof SyntaxError) return new HttpsError("internal", "AI assist failed. Try again.");
  const raw = (error ?? {}) as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  const description = [raw.status, raw.code, raw.name, raw.message].map(String).join(" ");
  if (isAssistBlocked(error as Parameters<typeof isAssistBlocked>[0] ?? {})) {
    return new HttpsError("failed-precondition", "The AI could not complete this request. Try rephrasing it.");
  }
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(description)) {
    return new HttpsError("resource-exhausted", "PixTaffy AI is busy right now. Wait a moment and try again.");
  }
  if (/504|DEADLINE_EXCEEDED|timeout|timed[ -]?out|abort/i.test(description)) {
    return new HttpsError("deadline-exceeded", "The AI request timed out. Wait a moment and try again.");
  }
  if (/\b5\d\d\b|UNAVAILABLE|INTERNAL|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(description)) {
    return new HttpsError("unavailable", "PixTaffy AI is temporarily unavailable. Wait a moment and try again.");
  }
  return new HttpsError("internal", "AI assist failed. Try again.");
}

export const runAiAssist = onCall(
  buildRunAiAssistOptions(baseOptions, process.env, () => PIXTAFFY_GEMINI_API_KEY!),
  async (request) => {
    const requestedAt = Date.now();
    const { uid, isAdmin } = requireAuth(request);
    const action = requireAssistAction(request.data?.action);
    const idempotencyKey = validateIdempotencyKey(request.data?.idempotencyKey);
    const cachedAssist = await readPaidAssistDelivery(uid, idempotencyKey).catch((error) => {
      logger.error("Paid assist delivery lookup failed", { action, error });
      throw new HttpsError("unavailable", "PixTaffy could not safely check this AI request. Try again in a moment.");
    });
    if (cachedAssist) {
      if (cachedAssist.action !== action) throw new HttpsError("already-exists", "This request id belongs to a different AI action.");
      await (async () => {
        const replay = await reserveAssistCredits({
          uid, milliCredits: AI_ASSIST_MILLICREDITS[action], idempotencyKey,
          action, modelId: "gemini-flash-latest", isAdmin, cachedDelivery: true,
        });
        if (replay.alreadyCommitted) return;
        await commitReservation({
          uid,
          reservationId: replay.reservationId,
          provider: "gemini",
          providerRequestId: null,
          actualCostUsd: cachedAssist.actualCostUsd,
          usage: cachedAssist.usage,
        });
      })().catch((error) => {
        logger.error("Cached AI assist settlement failed", { action, error });
        throw new HttpsError("unavailable", "PixTaffy could not settle this AI request. Try again in a moment.");
      });
      return {
        result: cachedAssist.result,
        milliCreditsCharged: cachedAssist.milliCreditsCharged,
        balanceMilliCredits: cachedAssist.balanceMilliCredits,
      };
    }
    const payload = (request.data?.payload ?? {}) as Record<string, any>;
    const imageBase64 = typeof payload.imageBase64 === "string" ? payload.imageBase64 : null;
    if (imageBase64 && imageBase64.length > 20_000_000) {
      throw new HttpsError("invalid-argument", "The uploaded file is too large for AI analysis.");
    }
    await enforceRateLimit(uid, "helpers", { perHour: 60, perDay: 300 });
    await ensureStarterGrant(uid, request.auth?.token?.email_verified === true);
    const reservation = await reserveAssistCredits({
      uid,
      milliCredits: AI_ASSIST_MILLICREDITS[action],
      idempotencyKey,
      action,
      modelId: "gemini-flash-latest",
      isAdmin,
    });

    if (reservation.alreadyCommitted) {
      throw new HttpsError("unavailable", "This AI request was already charged but its result is unavailable. Try again in a moment.");
    }
    // The day prefix locates this hold even if settlement happens after midnight UTC.
    const holdId = `${dateKey()}-${randomUUID()}`;
    const helperSpendReserveUsd = 0.05;
    let cacheWriteAttempted = false;
    try {
      await reserveSpendCapacity("gemini", helperSpendReserveUsd, holdId);
      const vertexConfig = AI_ASSIST_BACKEND === "vertex" ? resolveAiAssistVertexConfig(process.env) : undefined;
      const ai = vertexConfig
        ? new GoogleGenAI({ vertexai: true, project: vertexConfig.project, location: vertexConfig.location })
        : new GoogleGenAI({ apiKey: PIXTAFFY_GEMINI_API_KEY!.value() });
      const parts: any[] = [{ text: actionPrompt(action, payload) }];
      if (imageBase64) {
        parts.unshift({ inlineData: { data: imageBase64, mimeType: payload.mimeType || "image/png" } });
      }
      const response = await ai.models.generateContent({
        model: vertexConfig ? vertexConfig.model : "gemini-flash-latest",
        contents: [{ role: "user", parts }],
        config: {
          temperature: action === "expand_prompt" ? 0.7 : 0.2,
          ...(action === "expand_prompt" || action === "image_description"
            ? {}
            : { responseMimeType: "application/json" }),
        },
      });
      const usage = response.usageMetadata as any;
      const { actualCostUsd, unknownModel } = geminiAssistCost({
        backend: AI_ASSIST_BACKEND,
        location: vertexConfig?.location,
        model: vertexConfig?.model ?? "gemini-flash-latest",
        modelVersion: response.modelVersion,
        requestedAt,
        usage,
      });
      if (unknownModel) logger.warn("Unknown AI assist model; using maximum spend rates.");
      // Provider usage is billable even when validation or delivery later fails.
      await recordSpend("gemini", actualCostUsd, action, helperSpendReserveUsd, holdId)
        .catch((error) => {
          logger.error("Gemini spend settlement deferred", { action, error });
        });
      if (isAssistBlocked(response)) throw mapAiAssistError(response);
      const text = response.text?.trim();
      if (!text) throw new Error("Gemini returned an empty response.");
      const isJson = action !== "expand_prompt" && action !== "image_description";
      const result = isJson ? parseJsonText(text) : text;
      cacheWriteAttempted = true;
      const delivery = await writePaidAssistDeliveryWithRetry({
        version: 1,
        uid,
        idempotencyKey,
        action,
        createdAt: Date.now(),
        reservationId: reservation.reservationId,
        result,
        milliCreditsCharged: AI_ASSIST_MILLICREDITS[action],
        balanceMilliCredits: reservation.balanceMilliCredits,
        actualCostUsd,
        usage: usage ?? null,
      });
      if (delivery.reservationId !== reservation.reservationId) {
        await releaseReservation({
          uid, reservationId: reservation.reservationId, reason: "Existing AI delivery won the request race",
        }).catch(() => logger.error("Unable to release superseded AI assist reservation"));
      }
      let commitError: unknown = null;
      for (const delay of [0, 200, 600]) {
        if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
        try {
          await commitReservation({
            uid,
            reservationId: delivery.reservationId,
            provider: "gemini",
            providerRequestId: null,
            actualCostUsd: delivery.actualCostUsd,
            usage: delivery.usage,
          });
          commitError = null;
          break;
        } catch (error) {
          commitError = error;
        }
      }
      if (commitError) {
        // The reserved credits remain deducted. The stale-reservation job
        // will reconcile the ledger without granting a free provider call.
        logger.error("Gemini credit settlement deferred", { action, commitError });
      }
      return {
        result: delivery.result,
        milliCreditsCharged: delivery.milliCreditsCharged,
        balanceMilliCredits: delivery.balanceMilliCredits,
      };
    } catch (error) {
      const raw = error as { status?: unknown; code?: unknown; message?: unknown };
      logger.error("AI assist failed", { status: raw?.status, code: raw?.code, message: error instanceof SyntaxError ? "Invalid AI response JSON" : raw?.message });
      if (holdId) {
        await releaseSpendCapacity("gemini", helperSpendReserveUsd, holdId).catch((releaseError) => {
          logger.error("Unable to release Gemini spend capacity", { action, releaseError });
        });
      }
      if (cacheWriteAttempted) {
        if (reservation.reservationId) {
          await markAssistDeliveryFailed(reservation.reservationId);
        }
        // A failed save may be durable. Keep credits reserved so a same-key
        // replay or the stale job commits the cached delivery instead of refunding it.
        throw new HttpsError("unavailable", "PixTaffy could not deliver this AI result. Try again in a moment.");
      }
      await releaseReservation({
        uid,
        reservationId: reservation.reservationId,
        reason: error instanceof Error ? error.message : "Gemini request failed",
      });
      throw mapAiAssistError(error);
    }
  },
);

export const refreshOpenRouterModelCatalog = onSchedule(
  { schedule: "every day 03:15", region: REGION, timeZone: "UTC" },
  async () => {
    const [imageResponse, generalResponse] = await Promise.all([
      fetch("https://openrouter.ai/api/v1/images/models"),
      fetch("https://openrouter.ai/api/v1/models"),
    ]);
    if (!imageResponse.ok) throw new Error(`OpenRouter image catalog HTTP ${imageResponse.status}`);
    if (!generalResponse.ok) throw new Error(`OpenRouter model catalog HTTP ${generalResponse.status}`);
    const imageJson = await imageResponse.json() as any;
    const generalJson = await generalResponse.json() as any;
    const imageModels = new Map<string, any>((imageJson?.data ?? []).map((model: any) => [model.id, model]));
    const generalModels = new Map<string, any>((generalJson?.data ?? []).map((model: any) => [model.id, model]));
    const checkedAt = Date.now();
    await Promise.all(paidModelPrices().map(async (price) => {
      const ref = disabledModelRef(price.requestedModelId);
      const imageModel = imageModels.get(price.openRouterModelId);
      const generalModel = generalModels.get(price.openRouterModelId);
      const catalogPricing = imageModel?.pricing ?? generalModel?.pricing ?? null;
      const explicitPerImageCost = [
        catalogPricing?.per_image,
        catalogPricing?.image_generation,
        catalogPricing?.request,
      ].map(Number).find((value) => Number.isFinite(value) && value >= 0) ?? null;
      const catalogRef = db().doc(`paidAiModelCatalog/${createHash("sha256").update(price.requestedModelId).digest("hex")}`);
      await catalogRef.set({
        requestedModelId: price.requestedModelId,
        openRouterModelId: price.openRouterModelId,
        available: Boolean(imageModel),
        pricing: catalogPricing,
        explicitPerImageCost,
        costCeilingUsd: price.costCeilingUsd,
        checkedAt,
      });
      if (!imageModel) {
        await ref.set({
          disabled: true,
          modelId: price.requestedModelId,
          openRouterModelId: price.openRouterModelId,
          disabledAt: checkedAt,
          reason: "model_missing_from_catalog",
          lastCatalogCheckAt: checkedAt,
        }, { merge: true });
      } else if (explicitPerImageCost != null && explicitPerImageCost > price.costCeilingUsd) {
        await ref.set({
          disabled: true,
          modelId: price.requestedModelId,
          openRouterModelId: price.openRouterModelId,
          catalogCostUsd: explicitPerImageCost,
          costCeilingUsd: price.costCeilingUsd,
          disabledAt: checkedAt,
          reason: "catalog_price_exceeded_ceiling",
          lastCatalogCheckAt: checkedAt,
        }, { merge: true });
      } else {
        const existing = await ref.get();
        const reason = existing.data()?.reason;
        await ref.set({
          ...(reason === "model_missing_from_catalog" || reason === "catalog_price_exceeded_ceiling"
            ? { disabled: false, reason: null }
            : {}),
          lastCatalogCheckAt: checkedAt,
          openRouterModelId: price.openRouterModelId,
        }, { merge: true });
      }
    }));
  },
);
