export const DEFAULT_GUEST_MODEL_ID = "openai-2";
export const GUEST_GRANT_MILLICREDITS = 3_000;
export const LEGACY_GUEST_SPEND_MILLICREDITS = 1_000;

type GuestCreditRecord = Record<string, unknown> | undefined;

export function guestSpentMilliCredits(data: GuestCreditRecord, now: number): number {
  if (!data) return 0;
  if (Number(data.expiresAt ?? now + 1) <= now) return 0;
  const stored = Number(data.spentMilliCredits);
  if (Number.isFinite(stored)) return Math.max(0, Math.floor(stored));
  return LEGACY_GUEST_SPEND_MILLICREDITS;
}

export function guestBalanceMilliCredits(
  claim: GuestCreditRecord,
  device: GuestCreditRecord,
  now: number,
): number {
  const spent = Math.min(
    GUEST_GRANT_MILLICREDITS,
    Math.max(guestSpentMilliCredits(claim, now), guestSpentMilliCredits(device, now)),
  );
  return GUEST_GRANT_MILLICREDITS - spent;
}

export function canReserveGuestCredits(spentMilliCredits: number, costMilliCredits: number): boolean {
  return costMilliCredits > 0 && spentMilliCredits + costMilliCredits <= GUEST_GRANT_MILLICREDITS;
}
