import test from "node:test";
import assert from "node:assert/strict";
import {
  canReserveGuestCredits,
  DEFAULT_GUEST_MODEL_ID,
  guestBalanceMilliCredits,
  GUEST_GRANT_MILLICREDITS,
} from "./guestCredits";

const now = 1_800_000_000_000;

test("guest credits start at three with GPT Image 2 as the default", () => {
  assert.equal(DEFAULT_GUEST_MODEL_ID, "openai-2");
  assert.equal(GUEST_GRANT_MILLICREDITS, 3_000);
  assert.equal(guestBalanceMilliCredits(undefined, undefined, now), 3_000);
});

test("legacy one-image records count as one spent credit", () => {
  assert.equal(guestBalanceMilliCredits({ status: "completed" }, undefined, now), 2_000);
});

test("expired device records no longer consume guest credits", () => {
  assert.equal(guestBalanceMilliCredits(undefined, { spentMilliCredits: 3_000, expiresAt: now - 1 }, now), 3_000);
});

test("guest reservations cannot exceed the three-credit grant", () => {
  assert.equal(canReserveGuestCredits(0, 2_000), true);
  assert.equal(canReserveGuestCredits(2_000, 1_000), true);
  assert.equal(canReserveGuestCredits(2_000, 2_000), false);
});
