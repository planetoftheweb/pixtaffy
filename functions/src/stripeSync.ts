/**
 * Self-managed Stripe integration replacing the firestore-stripe-payments
 * Firebase Extension (0.3.4).
 *
 * This module provides:
 *  - stripeWebhook: HTTPS endpoint for Stripe webhook events. Writes to the
 *    same Firestore paths the extension used (customers, payments,
 *    subscriptions, checkout_sessions, products, prices) so existing bridge
 *    functions (onStripePayment, onStripeCheckoutSession, etc.) continue to
 *    fire without changes.
 *  - createPortalLink: callable replacing
 *    ext-firestore-stripe-payments-createPortalLink.
 *  - createCheckoutSession: called internally by createCheckout to build a
 *    Stripe Checkout Session via the API instead of relying on the extension's
 *    Firestore trigger.
 *
 * Secrets required (Firebase secret manager):
 *  - STRIPE_API_KEY: Stripe secret key (sk_live_... or sk_test_...)
 *  - STRIPE_WEBHOOK_SECRET: signing secret for the new webhook endpoint
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";

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

const stripeApiKey = defineSecret("STRIPE_API_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const stripe = (): Stripe =>
  new Stripe(stripeApiKey.value(), { apiVersion: "2025-02-24.acacia" });

const db = () => admin.firestore();

// ---------------------------------------------------------------------------
// Firestore helpers -- write to the same paths the extension used
// ---------------------------------------------------------------------------

const customerRef = (uid: string) => db().doc(`customers/${uid}`);
const paymentRef = (uid: string, paymentId: string) =>
  db().doc(`customers/${uid}/payments/${paymentId}`);
const subscriptionRef = (uid: string, subscriptionId: string) =>
  db().doc(`customers/${uid}/subscriptions/${subscriptionId}`);
const checkoutSessionRef = (uid: string, sessionId: string) =>
  db().doc(`customers/${uid}/checkout_sessions/${sessionId}`);
const productRef = (productId: string) =>
  db().doc(`products/${productId}`);
const priceRef = (productId: string, priceId: string) =>
  db().doc(`products/${productId}/prices/${priceId}`);

/**
 * Find the Firebase UID that owns a Stripe customer ID. The extension stored
 * the Stripe customer ID as `stripeId` on `customers/{uid}`.
 */
async function uidForStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const snap = await db()
    .collection("customers")
    .where("stripeId", "==", stripeCustomerId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Find or create a Stripe customer for a Firebase user. Returns the Stripe
 * customer ID and whether it was newly created.
 */
async function ensureStripeCustomer(uid: string): Promise<string> {
  const snap = await customerRef(uid).get();
  const existing = snap.data()?.stripeId;
  if (typeof existing === "string" && existing.startsWith("cus_")) return existing;

  const user = await admin.auth().getUser(uid);
  const customer = await stripe().customers.create({
    email: user.email ?? undefined,
    metadata: { firebaseUID: uid },
  });
  await customerRef(uid).set(
    { stripeId: customer.id, stripeLink: `https://dashboard.stripe.com/customers/${customer.id}`, email: user.email ?? null },
    { merge: true },
  );
  return customer.id;
}

// ---------------------------------------------------------------------------
// Webhook signature verification (same algorithm as billing.ts)
// ---------------------------------------------------------------------------

function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
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
  return signatures.some((sig) => {
    if (!/^[a-f0-9]{64}$/i.test(sig)) return false;
    const candidate = Buffer.from(sig, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

// ---------------------------------------------------------------------------
// Webhook event handlers -- keep Firestore in the same shape the extension did
// ---------------------------------------------------------------------------

function stripeTimestampToFirestore(ts: number | null | undefined): admin.firestore.Timestamp | null {
  if (ts == null) return null;
  return admin.firestore.Timestamp.fromMillis(ts * 1_000);
}

async function handleCustomerEvent(event: Stripe.Event): Promise<void> {
  const customer = event.data.object as Stripe.Customer;
  const uid = (customer.metadata?.firebaseUID as string) ?? null;
  if (!uid) {
    logger.warn("[stripeSync] Customer event missing firebaseUID metadata", { customerId: customer.id });
    return;
  }
  await customerRef(uid).set(
    {
      stripeId: customer.id,
      stripeLink: `https://dashboard.stripe.com/customers/${customer.id}`,
      email: customer.email ?? null,
    },
    { merge: true },
  );
}

async function handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const stripeCustomerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id;
  if (!stripeCustomerId) return;

  const uid = await uidForStripeCustomer(stripeCustomerId);
  if (!uid) {
    logger.warn("[stripeSync] Checkout session customer not found", {
      sessionId: session.id,
      stripeCustomerId,
    });
    return;
  }

  const firestoreSessionId = (session.client_reference_id as string) ?? session.id;
  const docRef = checkoutSessionRef(uid, firestoreSessionId);
  const existing = await docRef.get();

  const data: Record<string, unknown> = {
    sessionId: session.id,
    mode: session.mode,
    payment_status: session.payment_status,
    amount_total: session.amount_total,
    currency: session.currency,
    url: session.url ?? null,
    created: stripeTimestampToFirestore(session.created),
  };

  if (session.mode === "payment" && session.payment_intent) {
    data.payment_intent = typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent.id;
  }
  if (session.mode === "subscription" && session.subscription) {
    data.subscription = typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;
  }

  if (session.metadata) {
    data.metadata = session.metadata;
  }

  if (existing.exists) {
    await docRef.set(data, { merge: true });
  } else {
    await docRef.set(data);
  }
}

async function handlePaymentIntentEvent(event: Stripe.Event): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const stripeCustomerId = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
  if (!stripeCustomerId) return;
  const uid = await uidForStripeCustomer(stripeCustomerId);
  if (!uid) return;

  const prices: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];

  if (pi.metadata?.price) {
    prices.push({ id: pi.metadata.price, metadata: pi.metadata });
  }

  const status = pi.status === "succeeded" ? "succeeded"
    : pi.status === "canceled" ? "canceled"
    : pi.status;

  await paymentRef(uid, pi.id).set(
    {
      amount: pi.amount,
      amount_received: pi.amount_received,
      currency: pi.currency,
      status,
      created: stripeTimestampToFirestore(pi.created),
      metadata: pi.metadata ?? {},
      prices,
      items,
    },
    { merge: true },
  );
}

async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const stripeCustomerId = typeof charge.customer === "string"
    ? charge.customer
    : charge.customer?.id;
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!stripeCustomerId || !paymentIntentId) return;
  const uid = await uidForStripeCustomer(stripeCustomerId);
  if (!uid) return;

  await paymentRef(uid, paymentIntentId).set(
    { status: "refunded" },
    { merge: true },
  );
}

async function handleSubscriptionEvent(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const stripeCustomerId = typeof sub.customer === "string"
    ? sub.customer
    : sub.customer?.id;
  if (!stripeCustomerId) return;
  const uid = await uidForStripeCustomer(stripeCustomerId);
  if (!uid) return;

  const firstItem = sub.items?.data?.[0];
  const priceData = firstItem?.price;

  const data: Record<string, unknown> = {
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    cancel_at: stripeTimestampToFirestore(sub.cancel_at ?? null),
    canceled_at: stripeTimestampToFirestore(sub.canceled_at ?? null),
    current_period_start: stripeTimestampToFirestore(sub.current_period_start),
    current_period_end: stripeTimestampToFirestore(sub.current_period_end),
    created: stripeTimestampToFirestore(sub.created),
    ended_at: stripeTimestampToFirestore(sub.ended_at ?? null),
    trial_start: stripeTimestampToFirestore(sub.trial_start ?? null),
    trial_end: stripeTimestampToFirestore(sub.trial_end ?? null),
    metadata: sub.metadata ?? {},
  };

  if (priceData) {
    data.price = {
      id: priceData.id,
      product: typeof priceData.product === "string" ? priceData.product : priceData.product?.id,
      metadata: priceData.metadata ?? {},
    };
    data.items = sub.items.data.map((item) => ({
      id: item.id,
      price: {
        id: item.price.id,
        product: typeof item.price.product === "string" ? item.price.product : item.price.product?.id,
        metadata: item.price.metadata ?? {},
      },
    }));
  }

  await subscriptionRef(uid, sub.id).set(data, { merge: true });

  if (sub.status === "canceled" || sub.status === "unpaid") {
    await subscriptionRef(uid, sub.id).set(data);
  }
}

async function handleProductEvent(event: Stripe.Event): Promise<void> {
  const product = event.data.object as Stripe.Product;
  await productRef(product.id).set(
    {
      active: product.active,
      name: product.name,
      description: product.description ?? null,
      images: product.images ?? [],
      metadata: product.metadata ?? {},
      role: product.metadata?.firebaseRole ?? null,
    },
    { merge: true },
  );
}

async function handleProductDeleted(event: Stripe.Event): Promise<void> {
  const product = event.data.object as Stripe.Product;
  await productRef(product.id).delete();
}

async function handlePriceEvent(event: Stripe.Event): Promise<void> {
  const price = event.data.object as Stripe.Price;
  const stripeProductId = typeof price.product === "string" ? price.product : price.product?.id;
  if (!stripeProductId) return;

  await priceRef(stripeProductId, price.id).set(
    {
      active: price.active,
      billing_scheme: price.billing_scheme,
      currency: price.currency,
      unit_amount: price.unit_amount,
      type: price.type,
      interval: price.recurring?.interval ?? null,
      interval_count: price.recurring?.interval_count ?? null,
      trial_period_days: price.recurring?.trial_period_days ?? null,
      metadata: price.metadata ?? {},
      product: stripeProductId,
    },
    { merge: true },
  );
}

async function handlePriceDeleted(event: Stripe.Event): Promise<void> {
  const price = event.data.object as Stripe.Price;
  const stripeProductId = typeof price.product === "string" ? price.product : price.product?.id;
  if (!stripeProductId) return;
  await priceRef(stripeProductId, price.id).delete();
}

// ---------------------------------------------------------------------------
// stripeWebhook -- single HTTPS endpoint replacing the extension's webhook
// ---------------------------------------------------------------------------

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.created",
  "customer.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "product.created",
  "product.updated",
  "product.deleted",
  "price.created",
  "price.updated",
  "price.deleted",
]);

export const stripeWebhook = onRequest(
  { region: REGION, secrets: [stripeApiKey, stripeWebhookSecret] },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("Method not allowed");
      return;
    }

    const signature = request.header("stripe-signature");
    const secret = stripeWebhookSecret.value();
    if (!signature || !secret || !verifyWebhookSignature(request.rawBody, signature, secret)) {
      response.status(401).send("Invalid signature");
      return;
    }

    const event = JSON.parse(request.rawBody.toString("utf8")) as Stripe.Event;
    const eventType = event.type;

    if (!HANDLED_EVENTS.has(eventType)) {
      response.status(200).json({ received: true, handled: false });
      return;
    }

    try {
      switch (eventType) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
          await handleCheckoutSessionCompleted(event);
          break;
        case "customer.created":
        case "customer.updated":
          await handleCustomerEvent(event);
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await handleSubscriptionEvent(event);
          break;
        case "payment_intent.succeeded":
        case "payment_intent.payment_failed":
        case "payment_intent.canceled":
          await handlePaymentIntentEvent(event);
          break;
        case "charge.refunded":
          await handleChargeRefunded(event);
          break;
        case "product.created":
        case "product.updated":
          await handleProductEvent(event);
          break;
        case "product.deleted":
          await handleProductDeleted(event);
          break;
        case "price.created":
        case "price.updated":
          await handlePriceEvent(event);
          break;
        case "price.deleted":
          await handlePriceDeleted(event);
          break;
      }
      logger.info("[stripeSync] Handled webhook event", { eventType, eventId: event.id });
      response.status(200).json({ received: true, handled: true });
    } catch (error) {
      logger.error("[stripeSync] Webhook handler error", { eventType, eventId: event.id, error });
      response.status(500).json({ received: true, error: "Internal error" });
    }
  },
);

// ---------------------------------------------------------------------------
// createPortalLink -- drop-in replacement for the extension callable
// ---------------------------------------------------------------------------

export const createPortalLink = onCall(
  { region: REGION, cors: ALLOWED_ORIGINS, enforceAppCheck: true, secrets: [stripeApiKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to manage billing.");
    const returnUrl = typeof request.data?.returnUrl === "string"
      ? request.data.returnUrl
      : "https://pixtaffy.com/?billing=1";
    const stripeCustomerId = await ensureStripeCustomer(uid);
    const session = await stripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  },
);

// ---------------------------------------------------------------------------
// createCheckoutSession -- called by createCheckout (billing.ts) to build
// a Stripe Checkout Session via the API.
// ---------------------------------------------------------------------------

export async function createCheckoutSession(input: {
  uid: string;
  firestoreSessionId: string;
  priceId: string;
  mode: "payment" | "subscription";
  successUrl: string;
  cancelUrl: string;
  allowPromotionCodes: boolean;
  metadata: Record<string, string>;
}): Promise<{ url: string; stripeSessionId: string }> {
  const stripeCustomerId = await ensureStripeCustomer(input.uid);

  const params: Stripe.Checkout.SessionCreateParams = {
    customer: stripeCustomerId,
    mode: input.mode,
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: input.allowPromotionCodes,
    client_reference_id: input.firestoreSessionId,
    metadata: input.metadata,
  };

  if (input.mode === "subscription") {
    params.subscription_data = { metadata: input.metadata };
  } else {
    params.payment_intent_data = { metadata: input.metadata };
  }

  const session = await stripe().checkout.sessions.create(params);

  if (!session.url) {
    throw new HttpsError("internal", "Stripe returned a checkout session without a URL.");
  }

  await checkoutSessionRef(input.uid, input.firestoreSessionId).set(
    {
      sessionId: session.id,
      url: session.url,
      mode: input.mode,
      price: input.priceId,
      created: admin.firestore.FieldValue.serverTimestamp(),
      metadata: input.metadata,
    },
    { merge: true },
  );

  return { url: session.url, stripeSessionId: session.id };
}
