# Stripe fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.

The change-detection strategy is **capability-detected at runtime**: the Events
API (`stripe_api_read` on the events list operation) is attempted first as the
primary change feed. If that operation is not available on the connected Stripe
connector, the run falls through transparently to per-resource queries as the
primary feed instead. What gets surfaced to the user is identical either way —
only the fetch mechanism differs.

## Step 5 — Fetch from Stripe

Call the tools listed below using the host-resolved names. The host
UUID-prefixes them at runtime as
`mcp__8e4b8d3c-987a-4d48-a040-55e9abaf4aed__<tool>`; use whatever names the
host exposes in the tool list.

All Stripe amounts are returned in minor units (the smallest currency unit,
e.g., cents for USD). Conversion to display units (dollars, euros, etc.)
happens downstream when presenting to the user — do NOT perform currency
conversion during ingest; store amounts in minor units in entity frontmatter
and note the currency code alongside the amount.

Do NOT hard-code account-specific customer names, volume thresholds, or
business-logic assumptions. The fetch shape below is general-purpose; per-user
signal weighting lives in `data/instructions/agntux-stripe.md` and `user.md`.

---

### Step 5a — Attempt Events API (primary change feed, capability-detected)

The Stripe Events API is the preferred change-detection mechanism because it
returns a unified time-ordered stream across all resource types. Attempt it
first on every run. If it is not available, fall through to Step 5b as the
primary feed — do NOT produce an empty run.

**Capability probe.** Before the first Events API call on a new run, probe
whether the events list operation is available:

```
stripe_api_search({ query: "list events" })
```

Evaluate the response:

- **Operation found** (returns an `operation_id` such as `GetEvents` or
  `v1.events.list`): proceed with the Events API fetch below.
- **Operation not found / not available** (response contains no matching
  `operation_id`, or the tool returns an "operation not available" error, or
  `stripe_api_read` called with the candidate `operation_id` returns a
  connector-level "operation not available" error): log
  `stripe-events-api-unavailable` (kind: `source`) to working memory — NOT
  to `sync.md → errors` (this is a capability fact, not a per-run failure);
  skip the Events API entirely for this run and **proceed immediately to
  Step 5b as the primary feed**.

If the `operation_id` was successfully used in a prior run in the same
session, skip the discovery call — cache the result in working memory and
proceed directly to the fetch call.

**Incremental fetch (cursor non-null, Events API available):**

The cursor is stored as an ISO-8601 UTC string. Convert to Unix epoch:

```
stripe_api_read({
  operation_id: <events-list-operation-id>,
  parameters: {
    "created[gt]": <cursor_unix_epoch>,
    limit: 100,
    expand: []
  }
})
```

**Bootstrap fetch (cursor null, Events API available):**

```
stripe_api_read({
  operation_id: <events-list-operation-id>,
  parameters: {
    "created[gt]": <unix_epoch_of_(now − bootstrap_window_days * 86400)>,
    limit: 100,
    expand: []
  }
})
```

**Pagination and cap.** The Events API returns results newest-first. Collect
all pages (continue while `has_more: true`, advancing via
`starting_after: <last_event.id>`). Cap at **200 events per run** total
across all pages. If the cap is reached, log `stripe-pagination-overflow`
(kind: `source`) and stop. After collection, reverse the list to process
**oldest-first** (ascending by `created`) so the cursor advances through a
contiguous window.

**Event object structure.** Each event carries:
- `id` — `evt_xxx` identifier (use as `source_ref` for the action item).
- `type` — dot-notation name, e.g. `payment_intent.succeeded`,
  `invoice.payment_failed`, `customer.subscription.deleted`.
- `created` — Unix epoch timestamp of the event.
- `data.object` — the Stripe object as it existed at event time (full
  resource snapshot; no separate fetch required for most object types).
- `data.previous_attributes` — fields that changed (present on `*.updated`
  events). Use this to detect status transitions and amount changes.

Read all triage-relevant fields directly from `data.object`.

**Event type families to track.** Process events whose `type` matches these
prefixes. Skip all other event types (e.g. `radar.*`, `sigma.*`,
`identity.*`, `financial_connections.*`):

| Family prefix | Stripe resource | Notes |
|---|---|---|
| `charge.*` | Charge | Includes `charge.failed`, `charge.refunded`, `charge.disputed` |
| `payment_intent.*` | PaymentIntent | Includes `payment_intent.succeeded`, `payment_intent.payment_failed` |
| `invoice.*` | Invoice | Includes `invoice.payment_failed`, `invoice.finalized`, `invoice.overdue` |
| `customer.subscription.*` | Subscription | Includes `customer.subscription.deleted`, `customer.subscription.trial_will_end` |
| `customer.*` (non-subscription) | Customer | Includes `customer.created`, `customer.updated`, `customer.deleted` |
| `dispute.*` | Dispute | Includes `dispute.created`, `dispute.funds_withdrawn`, `dispute.lost` |
| `refund.*` | Refund | `refund.created`, `refund.failed` |
| `coupon.*` | Coupon | `coupon.created`, `coupon.deleted` |
| `promotion_code.*` | PromotionCode | `promotion_code.created` |
| `product.*` | Product | `product.created`, `product.updated`, `product.deleted` |
| `price.*` | Price | `price.created`, `price.updated`, `price.deactivated` |
| `payment_link.*` | PaymentLink | `payment_link.created`, `payment_link.updated` |
| `payout.*` | Payout | `payout.created`, `payout.paid`, `payout.failed` |
| `payment_method_configuration.*` | PaymentMethodConfiguration | `payment_method_configuration.created`, `payment_method_configuration.updated` |

If an event `type` is not in the families above, increment a
`stripe-event-type-unknown` counter in working memory. Append one summary
entry to `sync.md → errors` per run only if the unknown count exceeds 5.

When the Events API path completes, skip Step 5b entirely for this run
(per-resource queries are redundant when Events covers all families).

---

### Step 5b — Per-resource change detection (primary path when Events API unavailable; supplement on bootstrap)

Step 5b runs as the **primary change feed** when Step 5a determined the
Events API is not available. It also runs as a **supplementary catalog-seeding
pass** on bootstrap runs even when Events is available, to ensure
products, prices, and customers are fully seeded beyond what Events carries.

For each tracked resource family, page the per-resource list/search operation
filtered by `created` greater than the per-resource cursor timestamp. Each
resource family advances its cursor independently (see `cursor.md`).

**Available tools:**

```
# Time-windowed search — covers: charges, payment_intents, invoices,
# subscriptions, customers, products, prices
search_stripe_resources({
  resource_type: "charges",        # or payment_intents | invoices | subscriptions
                                   #    customers | products | prices
  query: "created>TIMESTAMP",      # ISO-8601 or Unix epoch; use per-resource cursor value
  filters: { status: "..." }       # optional — apply where relevant (see per-resource table below)
})

# Generic API read — for types not covered by search_stripe_resources:
# disputes, refunds, coupons, promotion_codes, payment_links, payouts,
# payment_method_configurations
stripe_api_read({
  operation_id: <operation-id>,    # discover via stripe_api_search before first call
  parameters: {
    "created[gt]": <unix_epoch>,   # per-resource cursor, converted to Unix epoch
    limit: 100
  }
})
```

**Recommended status filters per resource family.** Apply these to reduce
noise — only retrieve records that are action-relevant:

| Resource family | `search_stripe_resources` or `stripe_api_read` | Suggested filter |
|---|---|---|
| `charges` | `search_stripe_resources` | no status filter (all statuses are potentially triage-worthy) |
| `payment_intents` | `search_stripe_resources` | no status filter |
| `invoices` | `search_stripe_resources` | `status: open` or `status: past_due` |
| `subscriptions` | `search_stripe_resources` | `status: past_due` or `status: canceled` |
| `customers` | `search_stripe_resources` | no filter (new customers are always interesting) |
| `products` | `search_stripe_resources` | no filter |
| `prices` | `search_stripe_resources` | no filter |
| `disputes` | `stripe_api_read` (GetDisputes) | filter by status needing response if the operation supports it |
| `refunds` | `stripe_api_read` (GetRefunds) | no filter |
| `coupons` | `stripe_api_read` (GetCoupons) | no filter |
| `promotion_codes` | `stripe_api_read` (GetPromotionCodes) | no filter |
| `payment_links` | `stripe_api_read` (GetPaymentLinks) | no filter |
| `payouts` | `stripe_api_read` (GetPayouts) | no filter |

**Operation discovery.** For resource types served by `stripe_api_read`,
discover the operation_id before the first call per run:

```
stripe_api_search({ query: "list disputes" })       # → e.g. GetDisputes
stripe_api_search({ query: "list refunds" })        # → e.g. GetRefunds
stripe_api_search({ query: "list coupons" })        # → e.g. GetCoupons
```

Cache discovered operation_ids in working memory; do not re-discover within
the same run.

**Pagination, cap, and processing order.** Apply the same 200-item-per-run
cap across all resource families combined. Process results oldest-first within
each family (ascending by `created`). Collect pages while `has_more: true`
using the operation's cursor/pagination parameter. If the cap is reached,
log `stripe-pagination-overflow` (kind: `source`), stop, and advance per-
resource cursors only for families fully processed up to the cap.

**Change detection on per-resource queries.** Because `created` is immutable,
per-resource queries detect new objects reliably. They do NOT detect mutations
(e.g., a charge moving from `requires_capture` to `succeeded`). When the
Events API is available, mutations are caught there; when it is not, rely on
the status-filter approach above (queries for open/past_due items) plus
periodic full-window refreshes triggered by user instructions if needed.

**Deduplication across resource families.** Use the `_sources.json`
lookup-before-write protocol (Step 6) with the underlying object id as
`source_id` — identical to the Events API path. On per-resource queries the
`source_ref` on the action item is the object id (e.g., `dp_xxx`) rather than
an `evt_xxx` event id.

---

### Step 5 summary — on fetch failure

On any failure from any Stripe tool call:

- Log to `data/learnings/agntux-stripe/sync.md → errors` with kind
  `network | auth | parse | source | internal` (or the stripe-specific
  extension from the permitted-error-kinds list).
- Slice the errors list to the last 10 entries (newest-first) before writing.
- **Auth failure (401 / invalid API key):** release the lock and exit. Do NOT
  proceed — all subsequent calls will fail identically.
- **Rate limit (429 / `stripe-rate-limited`):** log, stop fetching, release
  lock, exit. Step 11's transactional rule keeps cursor at its pre-run value.
- **Individual object not found (404 for a known id):** log
  `stripe-object-not-found` (kind: `source`) with the id, skip this object,
  and continue. Do NOT abort the run.
- **Network failure:** log (kind: `network`), release lock, exit.
- **Cursor JSON malformed:** log `stripe-cursor-evicted` (kind: `source`),
  treat cursor as null (bootstrap), and continue.
- **Pagination overflow:** log `stripe-pagination-overflow` (kind: `source`)
  noting the item count cap, continue to action writes for items already
  collected. Step 11 advances cursors to the newest item processed.
- **Events API not available:** log `stripe-events-api-unavailable`
  (kind: `source`) to working memory only (not `sync.md → errors`); fall
  through to Step 5b as the primary feed. This is not a run failure.
- **Per-resource `search_stripe_resources` unknown resource_type:** log
  (kind: `source`), switch to `stripe_api_read` fallback for that type.

---

## Triage signal summary — what makes a Stripe object action-worthy

Use these signals in Steps 6–8. Never hard-code dollar thresholds — evaluate
significance relative to the account's own transaction history and any limits
declared in `data/instructions/agntux-stripe.md`.

**`response-needed` (requires the user to act within a deadline):**
- Dispute created or funds withdrawn — a chargeback has been filed. The user
  must respond to Stripe within the dispute's `evidence_due_by` deadline
  (typically 7–21 days). High priority.
- Dispute warning needing response — pre-dispute inquiry.
- Payout failed — a bank payout was rejected; the user must correct account
  details or contact their bank.
- Invoice payment failed — a subscription invoice could not be collected;
  the user or their team may need to update the payment method or contact
  the customer.

**`risk` signals:**
- Charge failed — a charge attempt failed. Triage-worthy when the amount is
  meaningful relative to the account's own recent history, or when it is a
  retry failure (attempt number > 1).
- Payment intent payment failed — same as above at the intent level.
- Dispute lost — decided against the user's account; funds permanently lost.
- Subscription deleted — cancelled. Triage-worthy when the subscription amount
  was meaningful relative to ARR or when cancellation is unexpected.
- Payout failed — also a risk signal (in addition to `response-needed` above).
- Refund failed — a refund could not be issued; the user's team should follow
  up with the customer manually.

**`deadline` signals:**
- Subscription trial ending — the trial ends in 3 days. Action-worthy so the
  user can decide whether to convert or cancel.
- Invoice payment action required — invoice requires a 3D Secure action from
  the customer; the user may need to contact the customer.
- Any dispute where `evidence_due_by` is within 7 days.

**`knowledge-update` signals (informational — no action item unless genuinely new):**
- Charge succeeded or payment intent succeeded — action-worthy only if the
  amount is unusually large relative to account history, or if the customer
  has an active `response-needed` action that this payment resolves.
- Customer created — informational; update/create entity.
- Product created, price created, coupon created — catalog updates.
  Informational; action-worthy only if the user's instructions specify a
  review step for new catalog items.
- Invoice finalized — informational unless also overdue (check `due_date`).
- Payout paid — a payout has settled. Informational; no action needed.
- Payment method configuration updated — raise only if the user's instructions
  flag configuration changes as notable.

---

## Suggested actions per resource family

Construct the `Open in Stripe` URL using the Stripe Dashboard deep-link
pattern below. The account is identified at runtime from the Stripe API key
scope — no workspace identifier capture is needed for URL construction;
use the Stripe Dashboard base URL directly with the object id.

### Disputes

```yaml
suggested_actions:
  - label: "Submit dispute evidence"
    host_prompt: "Use the agntux-stripe plugin to open the dispute evidence composer for action {id}"
  - label: "Open in Stripe"
    url: "https://dashboard.stripe.com/disputes/{dispute_id}"
```

### Failed charges / payment intents

```yaml
suggested_actions:
  - label: "Review failed payment"
    host_prompt: "Use the agntux-stripe plugin to open the payment detail for action {id}"
  - label: "Open in Stripe"
    url: "https://dashboard.stripe.com/payments/{charge_or_pi_id}"
```

### Invoices

```yaml
suggested_actions:
  - label: "Review invoice"
    host_prompt: "Use the agntux-stripe plugin to open the invoice detail for action {id}"
  - label: "Open in Stripe"
    url: "https://dashboard.stripe.com/invoices/{invoice_id}"
```

### Subscriptions

```yaml
suggested_actions:
  - label: "Review subscription"
    host_prompt: "Use the agntux-stripe plugin to open the subscription detail for action {id}"
  - label: "Open in Stripe"
    url: "https://dashboard.stripe.com/subscriptions/{subscription_id}"
```

### Payouts

```yaml
suggested_actions:
  - label: "Review payout"
    host_prompt: "Use the agntux-stripe plugin to open the payout detail for action {id}"
  - label: "Open in Stripe"
    url: "https://dashboard.stripe.com/payouts/{payout_id}"
```

For all other resource families (refunds, coupons, products, prices, promotion
codes, payment links, payment-method configurations), use the `Open in Stripe`
URL pointing to the relevant Dashboard section:

```yaml
suggested_actions:
  - label: "Open in Stripe"
    url: "https://dashboard.stripe.com/{resource-section}/{object_id}"
```

where `{resource-section}` is e.g. `refunds`, `coupons`, `products`, `prices`.

---

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| Auth error (401, invalid key) from any tool | `auth` | exit, release lock, retry next run |
| Network-level failure | `network` | exit, release lock, retry next run |
| Rate limit (429) from any tool | `source` + `stripe-rate-limited` | stop fetching, release lock, retry next run |
| `stripe_api_read` or `search_stripe_resources` returns 404 for a known id | `source` + `stripe-object-not-found` | log with id, skip object, continue |
| Events API or per-resource response has malformed JSON / missing fields | `parse` | log, skip item, continue |
| Cursor value is not a valid ISO-8601 string | `source` + `stripe-cursor-evicted` | reset to bootstrap, log, continue |
| Per-run 200-item cap hit | `source` + `stripe-pagination-overflow` | log item count, advance cursor(s) to newest processed, exit step |
| `stripe_api_search` returns no matching operation_id | `parse` | log, skip that resource-type for this run, continue |
| Events API operation not available (capability-detection fallback) | `source` + `stripe-events-api-unavailable` | log to working memory only, fall through to Step 5b as primary feed |
| `search_stripe_resources` returns unknown resource_type error | `source` | log, switch to `stripe_api_read` fallback for that type |
