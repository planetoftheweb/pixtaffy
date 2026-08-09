import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBalanceMilliCredits,
  historyLimitForBilling,
  releaseToBuckets,
  reserveFromBuckets,
  subscriptionGrantAmount,
  type CreditBucket,
} from "./billingCore";

const now = 1_800_000_000_000;

const bucket = (
  id: string,
  source: CreditBucket["source"],
  remainingMilliCredits: number,
  expiresAt: number | null,
): CreditBucket => ({
  id,
  source,
  grantedMilliCredits: remainingMilliCredits,
  remainingMilliCredits,
  createdAt: now - 1_000,
  expiresAt,
});

test("spends expiring credits before permanent purchased credits", () => {
  const result = reserveFromBuckets(
    [bucket("purchase", "purchase", 5_000, null), bucket("starter", "starter", 2_000, now + 10_000)],
    3_000,
    now,
  );
  assert.ok(result);
  assert.deepEqual(result.allocations, [
    { bucketId: "starter", source: "starter", milliCredits: 2_000 },
    { bucketId: "purchase", source: "purchase", milliCredits: 1_000 },
  ]);
  assert.equal(result.balanceMilliCredits, 4_000);
});

test("expired credits cannot be reserved", () => {
  const buckets = [bucket("expired", "starter", 5_000, now - 1)];
  assert.equal(computeBalanceMilliCredits(buckets, now), 0);
  assert.equal(reserveFromBuckets(buckets, 100, now), null);
});

test("release restores each original bucket without exceeding its grant", () => {
  const original = [bucket("starter", "starter", 5_000, now + 10_000)];
  const reserved = reserveFromBuckets(original, 500, now);
  assert.ok(reserved);
  const released = releaseToBuckets(reserved.buckets, reserved.allocations, now);
  assert.equal(released.balanceMilliCredits, 5_000);
});

test("subscription grant respects the 200-credit rollover cap", () => {
  assert.equal(subscriptionGrantAmount([bucket("sub", "subscription", 150_000, now + 10_000)], now), 50_000);
  assert.equal(subscriptionGrantAmount([bucket("sub", "subscription", 200_000, now + 10_000)], now), 0);
});

test("history limits match free, paid, pro, and admin tiers", () => {
  assert.equal(historyLimitForBilling({}), 100);
  assert.equal(historyLimitForBilling({ paidCustomer: true }), 500);
  assert.equal(historyLimitForBilling({ plan: "pro", subscriptionStatus: "active" }), 2_000);
  assert.equal(historyLimitForBilling({ isAdmin: true }), Number.MAX_SAFE_INTEGER);
});
