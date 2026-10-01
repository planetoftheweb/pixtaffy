# Stripe Extension Migration Guide

This document describes how to migrate PixTaffy from the Firebase Extension
`stripe/firestore-stripe-payments` (v0.3.4) to self-managed Cloud Functions.

The self-managed functions write to the **same Firestore paths** the extension
uses (`customers/{uid}`, `products/{id}/prices/{id}`, etc.) so the existing
bridge functions (`onStripePayment`, `onStripeCheckoutSession`,
`onStripeSubscription`, `onStripeCustomerWrite`) and client code continue to
work without changes.

## What changed

| Before (extension)                                   | After (self-managed)                         |
|------------------------------------------------------|----------------------------------------------|
| Extension creates Stripe Checkout from Firestore doc | `createCheckout` calls Stripe API directly   |
| `ext-firestore-stripe-payments-createPortalLink`     | `createPortalLink` (own callable)            |
| Extension webhook syncs customers/payments/subs      | `stripeWebhook` HTTPS function               |
| Extension syncs products/prices from Stripe          | `stripeWebhook` handles product/price events |
| `stripeBillingEvents` handles refunds/disputes       | Unchanged (still active)                     |

## New secrets required

Set these in the Firebase secret manager before deploying:

```bash
firebase functions:secrets:set STRIPE_API_KEY
# Paste your Stripe secret key (sk_live_... or sk_test_...)

firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
# Paste the signing secret from the NEW Stripe webhook endpoint (whsec_...)
```

Existing secrets that remain in use:
- `PIXTAFFY_STRIPE_EVENTS_WEBHOOK_SECRET` -- for the existing `stripeBillingEvents` refund/dispute handler

Optional environment variables (already in use, no change):
- `STRIPE_PRICE_CREDITS_25`, `STRIPE_PRICE_CREDITS_100`,
  `STRIPE_PRICE_CREDITS_300`, `STRIPE_PRICE_PRO_MONTHLY` -- hardcoded price
  IDs skip the Firestore products lookup

## Cutover steps (test mode first)

### 1. Deploy the new functions

```bash
cd functions && npm run build
firebase deploy --only functions
```

This deploys the new `stripeWebhook` and `createPortalLink` alongside the
extension. Both can coexist because they listen on different URLs.

Verify the deployed URL for `stripeWebhook`:

```
https://us-central1-brandoit.cloudfunctions.net/stripeWebhook
```

### 2. Create a NEW Stripe webhook endpoint

In the [Stripe Dashboard](https://dashboard.stripe.com/webhooks), create a
**new** webhook endpoint pointing to the `stripeWebhook` URL above.

Subscribe it to these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.created`
- `customer.updated`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `charge.refunded`
- `product.created`
- `product.updated`
- `product.deleted`
- `price.created`
- `price.updated`
- `price.deleted`

Copy the signing secret and store it:

```bash
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

### 3. Verify in test mode

1. Use a Stripe test-mode key in `STRIPE_API_KEY`
2. Create a test checkout from the PixTaffy pricing page
3. Confirm the Checkout URL is returned directly (no Firestore polling delay)
4. Complete the test payment in Stripe's hosted checkout
5. Confirm `onStripePayment` / `onStripeCheckoutSession` bridges fire and
   credits are granted
6. Open the customer portal via "Manage billing" and confirm it loads
7. Issue a test refund in the Stripe dashboard and confirm credits are revoked

### 4. Switch to live mode

1. Set `STRIPE_API_KEY` to the live Stripe secret key
2. Set `STRIPE_WEBHOOK_SECRET` to the live webhook's signing secret
3. Deploy again: `firebase deploy --only functions`
4. Do a small live purchase (credits_25) and verify the full flow

### 5. Disable the extension's webhook (do NOT uninstall yet)

In the Stripe Dashboard, disable or delete the **extension's** webhook
endpoint. The extension registered its own endpoint during installation. With
the new `stripeWebhook` handling all events, the extension's endpoint is
redundant. Disabling it prevents duplicate writes.

Keep `stripeBillingEvents` (the refund/dispute webhook) active -- it uses a
separate Stripe webhook endpoint and signing secret.

### 6. Monitor dual-operation period

During the transition, both the extension and the self-managed functions will
be deployed. This is safe because:

- `createCheckout` now calls Stripe directly, so the extension's Firestore
  trigger for `checkout_sessions` will still fire but the doc already has a
  `url` so the extension's write is a no-op merge.
- Bridge functions are idempotent (`pixtaffyLedgerWritten` flag prevents
  double-granting).
- Webhook writes from both the extension and self-managed endpoint are
  idempotent (Firestore `set` with `merge: true`).

### 7. Uninstall the extension (later)

After the self-managed functions have been stable in production for at least
two weeks:

```bash
firebase ext:uninstall firestore-stripe-payments
```

Or use the Firebase Console > Extensions to remove it.

**Deadline**: Firebase Extensions platform decommission is March 31, 2027.

## Firestore paths (unchanged)

| Path                                              | Written by           |
|---------------------------------------------------|----------------------|
| `customers/{uid}`                                 | stripeWebhook        |
| `customers/{uid}/checkout_sessions/{sessionId}`   | createCheckout + stripeWebhook |
| `customers/{uid}/payments/{paymentId}`            | stripeWebhook        |
| `customers/{uid}/subscriptions/{subscriptionId}`  | stripeWebhook        |
| `products/{productId}`                            | stripeWebhook        |
| `products/{productId}/prices/{priceId}`           | stripeWebhook        |

## Firestore rules

No rule changes are needed. The `customers` and `products` collections are
already configured as read-only for clients (writes come from Cloud Functions
via the admin SDK which bypasses security rules).

## Client changes

- `billingService.openCustomerPortal` now calls `createPortalLink` instead of
  `ext-firestore-stripe-payments-createPortalLink`.
- `billingService.startCheckout` uses the `url` returned directly by
  `createCheckout` when available, falling back to the Firestore snapshot
  listener for backward compatibility.

## Risk notes

- **Dual writes during transition**: Both the extension and self-managed
  webhook may write to the same Firestore docs. All writes use `merge: true`
  and the bridge functions use idempotency flags, so duplicates are harmless.
- **Customer creation**: The self-managed `createCheckoutSession` creates a
  Stripe customer if one does not exist for the Firebase user. The extension
  also creates customers. During transition, the `ensureStripeCustomer`
  function checks for an existing `stripeId` before creating.
- **`stripeBillingEvents`** remains unchanged and uses its own webhook
  endpoint with `PIXTAFFY_STRIPE_EVENTS_WEBHOOK_SECRET`. It handles
  `charge.refunded` and `charge.dispute.created` events. The new
  `stripeWebhook` also handles `charge.refunded` (writes status to the
  payments subcollection). Both are idempotent.
