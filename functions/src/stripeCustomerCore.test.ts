import test, { mock } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { cancelStripeSubscriptionsForUser, ensureStripeCustomerCore } from "./stripeCustomerCore";

const uid = "firebase-user";
const missing = { type: "StripeInvalidRequestError", code: "resource_missing" };
const transient = { type: "StripeAPIError", statusCode: 503 };

function customerFixture(storedId?: string) {
  let data: Record<string, unknown> | undefined = storedId
    ? { stripeId: storedId, legacyStripeIds: ["cus_older"], preserved: true }
    : undefined;
  const customer = {
    get: mock.fn(async () => ({ data: () => data })),
    set: mock.fn(async (patch: Record<string, unknown>, options: { merge: true }) => {
      assert.deepEqual(options, { merge: true });
      const legacy = data?.legacyStripeIds as string[] | undefined;
      data = { ...data, ...patch };
      if (patch.legacyStripeIds) {
        const transform = patch.legacyStripeIds as { arrayUnion: string };
        data.legacyStripeIds = [...new Set([...(legacy ?? []), transform.arrayUnion])];
      }
    }),
  };
  const stripe = {
    customers: {
      retrieve: mock.fn(async (id: string): Promise<Pick<Stripe.Customer | Stripe.DeletedCustomer, "id" | "deleted">> => ({ id })),
      create: mock.fn(async (_params: Stripe.CustomerCreateParams) => ({ id: "cus_live" })),
      del: mock.fn(async (_id: string) => { throw new Error("Customer deletion is forbidden"); }),
    },
  };
  return {
    customer,
    stripe,
    getEmail: mock.fn(async () => "user@example.com"),
    arrayUnion: mock.fn((id: string) => ({ arrayUnion: id })),
    data: () => data,
  };
}

test("valid stored customer is retrieved and reused without creating or writing", async () => {
  const deps = customerFixture("cus_live");
  assert.equal(await ensureStripeCustomerCore(uid, deps), "cus_live");
  assert.deepEqual(deps.stripe.customers.retrieve.mock.calls[0].arguments, ["cus_live"]);
  assert.equal(deps.stripe.customers.create.mock.callCount(), 0);
  assert.equal(deps.getEmail.mock.callCount(), 0);
  assert.equal(deps.customer.set.mock.callCount(), 0);
});

for (const [label, result] of [
  ["resource_missing", missing],
  ["HTTP 404", { statusCode: 404 }],
  ["deleted", null],
] as const) {
  test(`${label} stored customer is replaced with its legacy ID preserved`, async () => {
    const deps = customerFixture("cus_test");
    deps.stripe.customers.retrieve.mock.mockImplementation(async (id) => {
      if (result) throw result;
      return { id, deleted: true };
    });
    assert.equal(await ensureStripeCustomerCore(uid, deps), "cus_live");
    assert.equal(deps.stripe.customers.create.mock.callCount(), 1);
    assert.deepEqual(deps.stripe.customers.create.mock.calls[0].arguments, [{
      email: "user@example.com",
      metadata: { firebaseUID: uid },
    }]);
    assert.deepEqual(deps.arrayUnion.mock.calls[0].arguments, ["cus_test"]);
    assert.deepEqual(deps.data(), {
      stripeId: "cus_live",
      stripeLink: "https://dashboard.stripe.com/customers/cus_live",
      email: "user@example.com",
      legacyStripeIds: ["cus_older", "cus_test"],
      preserved: true,
    });
  });
}

test("first checkout creates a customer without a legacy ID", async () => {
  const deps = customerFixture();
  assert.equal(await ensureStripeCustomerCore(uid, deps), "cus_live");
  assert.equal(deps.stripe.customers.retrieve.mock.callCount(), 0);
  assert.equal(deps.arrayUnion.mock.callCount(), 0);
  assert.equal(deps.data()?.legacyStripeIds, undefined);
});

for (const error of [transient, { type: "StripeAuthenticationError", statusCode: 401 }]) {
  test(`customer retrieval error ${error.type} is rethrown without creating`, async () => {
    const deps = customerFixture("cus_live");
    deps.stripe.customers.retrieve.mock.mockImplementation(async () => { throw error; });
    await assert.rejects(ensureStripeCustomerCore(uid, deps), (actual) => actual === error);
    assert.equal(deps.stripe.customers.create.mock.callCount(), 0);
    assert.equal(deps.customer.set.mock.callCount(), 0);
  });
}

type Subscription = Pick<Stripe.Subscription, "id" | "status">;

function deletionFixture(storedId?: string, subscriptions: Subscription[] = []) {
  const base = customerFixture(storedId);
  const documents = new Map<string, Record<string, unknown>>(
    subscriptions.map((sub) => [sub.id, { status: sub.status, preserved: true }]),
  );
  const canceled: string[] = [];
  const writes: string[] = [];
  const stripe = {
    ...base.stripe,
    subscriptions: {
      list: mock.fn((params: Stripe.SubscriptionListParams): AsyncIterable<Subscription> => ({
        async *[Symbol.asyncIterator]() {
          for (const sub of subscriptions) {
            if (sub.status === params.status) yield sub;
          }
        },
      })),
      cancel: mock.fn(async (id: string) => { canceled.push(id); }),
    },
  };
  return {
    ...base,
    stripe,
    subscription: (id: string) => ({
      set: async (patch: Record<string, unknown>, options: { merge: true }) => {
        assert.ok(canceled.includes(id), "Stripe cancellation must precede the Firestore write");
        assert.deepEqual(options, { merge: true });
        documents.set(id, { ...documents.get(id), ...patch });
        writes.push(id);
      },
    }),
    now: () => 1_800_000_000_000,
    warn: mock.fn((_message: string, _ids: { uid: string; stripeCustomerId: string }) => {}),
    documents,
    canceled,
    writes,
  };
}

test("user deletion cancels only active, trialing and past_due subscriptions and retains the customer", async () => {
  const statuses: Stripe.Subscription.Status[] = [
    "active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused",
  ];
  const deps = deletionFixture("cus_live", statuses.map((status) => ({ id: `sub_${status}`, status })));
  await cancelStripeSubscriptionsForUser(uid, deps);
  const expected = ["sub_active", "sub_trialing", "sub_past_due"];
  assert.deepEqual(deps.canceled, expected);
  assert.deepEqual(deps.writes, expected);
  for (const status of statuses) {
    const canceled = expected.includes(`sub_${status}`);
    assert.deepEqual(deps.documents.get(`sub_${status}`), {
      status: canceled ? "canceled" : status,
      preserved: true,
      ...(canceled ? { ended_at: deps.now() } : {}),
    });
  }
  assert.deepEqual(deps.stripe.subscriptions.list.mock.calls.map((call) => call.arguments[0]), [
    { customer: "cus_live", status: "active", limit: 100 },
    { customer: "cus_live", status: "trialing", limit: 100 },
    { customer: "cus_live", status: "past_due", limit: 100 },
  ]);
  assert.equal(deps.stripe.customers.del.mock.callCount(), 0);
  assert.equal(deps.customer.set.mock.callCount(), 0);
});

test("user deletion consumes the full subscription iterator beyond one page", async () => {
  const deps = deletionFixture("cus_live", Array.from({ length: 105 }, (_, i) => ({
    id: `sub_${i}`, status: "active",
  })));
  await cancelStripeSubscriptionsForUser(uid, deps);
  assert.equal(deps.canceled.length, 105);
  assert.equal(deps.writes.length, 105);
});

for (const storedId of [undefined, ""]) {
  test(`user deletion with ${storedId === undefined ? "no document" : "no stripeId"} makes no Stripe calls`, async () => {
    const deps = deletionFixture(storedId);
    if (storedId === "") {
      deps.customer.get.mock.mockImplementation(async () => ({ data: () => ({ preserved: true }) }));
    }
    await cancelStripeSubscriptionsForUser(uid, deps);
    assert.equal(deps.stripe.subscriptions.list.mock.callCount(), 0);
    assert.equal(deps.stripe.subscriptions.cancel.mock.callCount(), 0);
    assert.equal(deps.stripe.customers.del.mock.callCount(), 0);
  });
}

test("user deletion with a missing Stripe customer warns using only IDs and makes no changes", async () => {
  const deps = deletionFixture("cus_test");
  deps.stripe.subscriptions.list.mock.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() { throw missing; },
  }));
  await cancelStripeSubscriptionsForUser(uid, deps);
  assert.equal(deps.stripe.subscriptions.cancel.mock.callCount(), 0);
  assert.equal(deps.stripe.customers.del.mock.callCount(), 0);
  assert.deepEqual(deps.writes, []);
  assert.equal(deps.warn.mock.callCount(), 1);
  assert.deepEqual(deps.warn.mock.calls[0].arguments[1], { uid, stripeCustomerId: "cus_test" });
});

test("transient cancellation failures propagate without marking the subscription canceled", async () => {
  const deps = deletionFixture("cus_live", [{ id: "sub_active", status: "active" }]);
  deps.stripe.subscriptions.cancel.mock.mockImplementation(async () => { throw transient; });
  await assert.rejects(cancelStripeSubscriptionsForUser(uid, deps), (error) => error === transient);
  assert.deepEqual(deps.writes, []);
  assert.equal(deps.warn.mock.callCount(), 0);
  assert.equal(deps.stripe.customers.del.mock.callCount(), 0);
});
