export const MILLICREDITS_PER_CREDIT = 1_000;
export const STARTER_GRANT_MILLICREDITS = 10_000;
export const SUBSCRIPTION_GRANT_MILLICREDITS = 100_000;
export const SUBSCRIPTION_ROLLOVER_CAP_MILLICREDITS = 200_000;

export type CreditSource = "starter" | "subscription" | "purchase" | "adjustment";

export interface CreditBucket {
  id: string;
  source: CreditSource;
  grantedMilliCredits: number;
  remainingMilliCredits: number;
  createdAt: number;
  expiresAt: number | null;
  externalId?: string | null;
}

export interface CreditAllocation {
  bucketId: string;
  source: CreditSource;
  milliCredits: number;
}

export const isBucketExpired = (bucket: CreditBucket, now: number): boolean =>
  bucket.expiresAt != null && bucket.expiresAt <= now;

export const normalizeBuckets = (buckets: CreditBucket[], now: number): CreditBucket[] =>
  buckets
    .filter((bucket) => bucket.remainingMilliCredits > 0 && !isBucketExpired(bucket, now))
    .map((bucket) => ({
      ...bucket,
      grantedMilliCredits: Math.max(0, Math.floor(bucket.grantedMilliCredits)),
      remainingMilliCredits: Math.max(0, Math.floor(bucket.remainingMilliCredits)),
    }));

export const computeBalanceMilliCredits = (buckets: CreditBucket[], now: number): number =>
  normalizeBuckets(buckets, now).reduce(
    (sum, bucket) => sum + bucket.remainingMilliCredits,
    0,
  );

const compareBucketsForSpend = (left: CreditBucket, right: CreditBucket): number => {
  const leftExpiry = left.expiresAt ?? Number.MAX_SAFE_INTEGER;
  const rightExpiry = right.expiresAt ?? Number.MAX_SAFE_INTEGER;
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
  return left.createdAt - right.createdAt;
};

export function reserveFromBuckets(
  inputBuckets: CreditBucket[],
  requestedMilliCredits: number,
  now: number,
): { buckets: CreditBucket[]; allocations: CreditAllocation[]; balanceMilliCredits: number } | null {
  const amount = Math.floor(requestedMilliCredits);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const buckets = normalizeBuckets(inputBuckets, now).sort(compareBucketsForSpend);
  if (computeBalanceMilliCredits(buckets, now) < amount) return null;

  let remaining = amount;
  const allocations: CreditAllocation[] = [];
  const nextBuckets = buckets.map((bucket) => {
    if (remaining <= 0) return bucket;
    const spend = Math.min(bucket.remainingMilliCredits, remaining);
    remaining -= spend;
    allocations.push({
      bucketId: bucket.id,
      source: bucket.source,
      milliCredits: spend,
    });
    return {
      ...bucket,
      remainingMilliCredits: bucket.remainingMilliCredits - spend,
    };
  });

  return {
    buckets: nextBuckets,
    allocations,
    balanceMilliCredits: computeBalanceMilliCredits(nextBuckets, now),
  };
}

export function releaseToBuckets(
  inputBuckets: CreditBucket[],
  allocations: CreditAllocation[],
  now: number,
): { buckets: CreditBucket[]; balanceMilliCredits: number } {
  const buckets = normalizeBuckets(inputBuckets, now);
  const byId = new Map(buckets.map((bucket) => [bucket.id, { ...bucket }]));

  for (const allocation of allocations) {
    const bucket = byId.get(allocation.bucketId);
    if (!bucket || allocation.milliCredits <= 0) continue;
    bucket.remainingMilliCredits = Math.min(
      bucket.grantedMilliCredits,
      bucket.remainingMilliCredits + Math.floor(allocation.milliCredits),
    );
  }

  const restored = Array.from(byId.values());
  return {
    buckets: restored,
    balanceMilliCredits: computeBalanceMilliCredits(restored, now),
  };
}

export function subscriptionGrantAmount(
  buckets: CreditBucket[],
  now: number,
): number {
  const current = normalizeBuckets(buckets, now)
    .filter((bucket) => bucket.source === "subscription")
    .reduce((sum, bucket) => sum + bucket.remainingMilliCredits, 0);
  return Math.max(
    0,
    Math.min(
      SUBSCRIPTION_GRANT_MILLICREDITS,
      SUBSCRIPTION_ROLLOVER_CAP_MILLICREDITS - current,
    ),
  );
}

export const historyLimitForBilling = (input: {
  isAdmin?: boolean;
  paidCustomer?: boolean;
  plan?: string | null;
  subscriptionStatus?: string | null;
}): number => {
  if (input.isAdmin) return Number.MAX_SAFE_INTEGER;
  const activePro =
    input.plan === "pro" &&
    (input.subscriptionStatus === "active" || input.subscriptionStatus === "trialing");
  if (activePro) return 2_000;
  if (input.paidCustomer) return 500;
  return 100;
};
