---
type: plugin-instructions
plugin: agntux-stripe
schema_version: "1.0.0"
updated_at: 2026-06-20T00:00:00Z
authored_by: personalization
status: draft
---

# Always raise

- Disputes with an `evidence_due_by` deadline within 14 days: raise a
  `response-needed` action regardless of charge amount.
  (source: 2026-06-20 canonical Stripe dispute handling)

- Payout failures (`payout.failed`): always raise; cash-flow impact is
  immediate and account-level.
  (source: 2026-06-20 canonical Stripe payout handling)

- Subscription trial endings (`customer.subscription.trial_will_end`)
  with fewer than 4 days remaining: raise a `deadline` action.
  (source: 2026-06-20 canonical Stripe subscription handling)

# Never raise

- Successful charges and payments (`charge.succeeded`,
  `payment_intent.succeeded`) unless the amount is unusually large
  relative to the account's own recent transaction history, or the
  customer is already in `related_entities` with an open
  `response-needed` action.

- Routine catalog updates (`product.created`, `price.created`,
  `coupon.created`, `payment_link.created`) unless the user has
  explicitly requested review of new catalog items in this file.

- Settled payouts (`payout.paid`): informational only; no action item.

- Events outside the tracked event-type families (non-actionable
  Stripe subsystems: `radar.*`, `sigma.*`, `identity.*`,
  `financial_connections.*`).

# Rewrites

(None defined in initial stub. User-feedback Mode A may add label
rewrites here, e.g. charge-description normalisation or customer-name
aliases.)

# Notes

## Confirm before every write — Stripe operations move real money

Every write-back action in this plugin is a real money operation on a
live Stripe account. The six write handlers are:

1. **Refund** — issues a partial or full refund against a charge or
   payment intent. Irreversible once processed by Stripe; the funds
   leave the account immediately.

2. **Dispute evidence submit** — submits evidence against a chargeback
   to Stripe. Once submitted with `submit: true`, the evidence is
   locked for that dispute round. A `submit: false` call saves a draft
   without locking.

3. **Invoice finalize** — locks a draft invoice and delivers it to the
   customer. After finalization the invoice can only be closed by
   voiding it.

4. **Invoice void** — marks a finalized invoice as uncollectable.
   Irreversible: the invoice cannot be re-activated or re-collected
   after voiding.

5. **Subscription pause** — sets `pause_collection.behavior =
   mark_uncollectible` on the subscription. Future invoices will be
   marked uncollectible until collection is resumed. Does not cancel
   the subscription.

6. **Subscription update** — changes the quantity and/or price on an
   active subscription. Takes effect at the next billing cycle or
   immediately depending on the proration behavior Stripe applies.

7. **Subscription cancel** — immediately cancels the subscription.
   Irreversible: the subscription cannot be reactivated; a new
   subscription must be created.

The iframe is the authorisation gate for all six operations. The user's
explicit click of the confirmation button in the iframe is the consent
event. No operation executes without that click. Do not attempt to
pre-execute or simulate any write-back action in chat.

## Payload composition rules per operation

### Refund

- `amount`: default to the full `max_refundable` amount from the
  action file's `## Compose payload`. If `max_refundable` is zero
  (unknown), default to `charge_amount`. The user may reduce the
  amount in the iframe before confirming.
- `reason`: default to `suggested_reason` from the payload if
  non-empty. Fall back to `requested_by_customer` if no signal is
  available. Valid Stripe values: `duplicate`, `fraudulent`,
  `requested_by_customer`.
- `currency`: always carry the ISO 4217 code from the source payment
  object. Do not convert amounts; store and pass in minor units (e.g.,
  cents for USD).
- Do not include `charge` or `payment_intent` both — use
  `payment_intent` when the `payment_intent_id` is available (covers
  all charges on that intent); fall back to `charge` when only a
  charge id is available.

### Dispute evidence

- `evidence`: draft evidence text should summarise the transaction
  record — date, amount, customer identifier, and the business's
  position on why the charge is legitimate. Cite any delivery
  confirmation, terms-of-service acceptance, or service logs
  available in the action context.
- `submit`: always default to `true` (submit immediately). The UI
  allows saving as a draft (`submit: false`) but immediate submission
  is the default because evidence deadlines are time-sensitive.
- The `evidence_due_by` date is prominent in the composer; always
  surface it in the action body's context section so the user sees
  the deadline before committing.

### Invoice finalize

- Finalization locks the invoice and triggers delivery to the customer
  via the channel(s) configured on the Stripe account (email,
  dashboard notification). Confirm that the amount and due date
  displayed in the composer are correct before clicking Confirm.
- No payload fields are editable in the finalize composer beyond what
  is already on the draft invoice — the action is binary
  (finalize or do not). If the amount or recipient needs changing,
  the user should edit the invoice in Stripe first.

### Invoice void

- Voiding is irreversible. Surface a clear warning in the action body:
  "Voiding this invoice marks it uncollectable permanently. If
  payment is needed, a new invoice must be created." The iframe
  displays this warning natively, but also note it in the action body
  `reason_detail`.
- Only finalized invoices can be voided. Draft invoices should be
  deleted, not voided — the composer enforces this by checking the
  invoice `status` field.

### Subscription pause (edit, pause mode)

- Pause sets `pause_collection.behavior = mark_uncollectible`. This
  stops charging the customer without cancelling the subscription.
  Future invoices are created but immediately marked uncollectible.
- Resume billing by calling `PostSubscriptionsSubscriptionExposedId`
  with `pause_collection = ""` (empty string clears the pause). That
  path is not yet surfaced in the composer; the user should use the
  Stripe Dashboard to resume, or a future edit-composer version.
- Note the current period end in the action body so the user knows
  when the next billing cycle would have occurred.

### Subscription update (edit, update mode)

- `new_quantity`: carry the current quantity from the Compose payload
  as the default. The user adjusts in the iframe.
- `new_price_id` (optional): leave blank to keep the current plan.
  Only populate if the user explicitly specifies a new Stripe price ID
  in the iframe. Price IDs are in the form `price_xxx`.
- Proration: the API applies Stripe's default proration behaviour
  unless overridden. Do not add proration_behavior to the envelope
  unless the user's instructions here explicitly request a specific
  setting.

### Subscription cancel

- The composer offers two cancellation modes; **at end of billing
  period is the default** (least disruptive):
  - **At period end** — `PostSubscriptionsSubscriptionExposedId` with
    `cancel_at_period_end: true`. Access continues until
    `current_period_end`, then the subscription ends; no further
    charges.
  - **Immediately** — `DeleteSubscriptionsSubscriptionExposedId`. The
    subscription stops at once; no partial refunds are issued
    automatically.
- Surface the `current_period_end` date prominently so the user can
  choose between the two modes.

## Amount handling

All Stripe amounts in the Compose payload are in **minor units**
(e.g., cents for USD, pence for GBP). Do not convert to display units
during ingest or payload composition. The `formatAmount` helper in the
iframe converts for display. Pass amounts to connector envelopes in
minor units as received.

## Tone

Terse and transactional. No filler phrases. For money-moving actions,
surface the exact amount and object ID in every confirmation context
so the user can verify before clicking. Avoid hedging language like
"you may want to consider" — these are binary commit actions.

## Deduplication across runs

The Stripe plugin uses the underlying Stripe object id (e.g., `dp_xxx`,
`pi_xxx`) as the `source_id` for entity deduplication — not the event
id (`evt_xxx`). Multiple events about the same object within a run
or across runs update one entity and one open action, not multiples.
This is enforced by the `_sources.json` lookup-before-write protocol
in the ingest skill.
