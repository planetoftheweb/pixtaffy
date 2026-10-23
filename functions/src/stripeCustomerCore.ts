import type Stripe from "stripe";

interface CustomerDocument {
  get(): Promise<{ data(): { stripeId?: unknown } | undefined }>;
  set(data: Record<string, unknown>, options: { merge: true }): Promise<unknown>;
}

interface CustomerClient {
  customers: {
    retrieve(id: string): Promise<Pick<Stripe.Customer | Stripe.DeletedCustomer, "id" | "deleted">>;
    create(params: Stripe.CustomerCreateParams): Promise<{ id: string }>;
  };
}

interface SubscriptionClient {
  subscriptions: {
    list(params: Stripe.SubscriptionListParams): AsyncIterable<Pick<Stripe.Subscription, "id" | "status">>;
    cancel(id: string): Promise<unknown>;
  };
}

function isMissingStripeResource(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const stripeError = error as { type?: string; code?: string; statusCode?: number };
  return stripeError.statusCode === 404 || (
    stripeError.type === "StripeInvalidRequestError" && stripeError.code === "resource_missing"
  );
}

export async function ensureStripeCustomerCore(uid: string, deps: {
  stripe: CustomerClient;
  customer: CustomerDocument;
  getEmail(): Promise<string | undefined>;
  arrayUnion(id: string): unknown;
}): Promise<string> {
  const snap = await deps.customer.get();
  const storedId = snap.data()?.stripeId;
  const existing = typeof storedId === "string" && storedId ? storedId : undefined;
  if (existing) {
    try {
      const customer = await deps.stripe.customers.retrieve(existing);
      if (!customer.deleted) return existing;
    } catch (error) {
      // A legacy test-mode ID cannot be retrieved with the live key. Other
      // failures must propagate so a temporary outage never creates duplicates.
      if (!isMissingStripeResource(error)) throw error;
    }
  }

  const email = await deps.getEmail();
  const customer = await deps.stripe.customers.create({
    email,
    metadata: { firebaseUID: uid },
  });
  await deps.customer.set({
    stripeId: customer.id,
    stripeLink: `https://dashboard.stripe.com/customers/${customer.id}`,
    email: email ?? null,
    ...(existing ? { legacyStripeIds: deps.arrayUnion(existing) } : {}),
  }, { merge: true });
  return customer.id;
}

const CANCELABLE_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);

export async function cancelStripeSubscriptionsForUser(uid: string, deps: {
  stripe: SubscriptionClient;
  customer: Pick<CustomerDocument, "get">;
  subscription(id: string): Pick<CustomerDocument, "set">;
  now(): unknown;
  warn(message: string, ids: { uid: string; stripeCustomerId: string }): void;
}): Promise<void> {
  const snap = await deps.customer.get();
  const stripeCustomerId = snap.data()?.stripeId;
  if (typeof stripeCustomerId !== "string" || !stripeCustomerId) return;

  try {
    for (const status of CANCELABLE_STATUSES) {
      // Stripe's async iterator traverses every page, including >100 results.
      for await (const sub of deps.stripe.subscriptions.list({ customer: stripeCustomerId, status, limit: 100 })) {
        if (!CANCELABLE_STATUSES.has(sub.status)) continue;
        await deps.stripe.subscriptions.cancel(sub.id);
        await deps.subscription(sub.id).set({
          status: "canceled",
          ended_at: deps.now(),
        }, { merge: true });
      }
    }
  } catch (error) {
    if (!isMissingStripeResource(error)) throw error;
    deps.warn("[stripeSync] Stripe resource missing during user deletion", { uid, stripeCustomerId });
  }
  // Preserve the Stripe customer and its payment history.
}
