# Cursor advance reference — agntux-stripe (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

The cursor strategy is **capability-detected**: when the Events API is
available it uses a **single scalar ISO-8601 UTC low-water-mark** (one
timestamp across all resource types); when it is not available it uses a
**per-resource timestamp map** (one timestamp per resource family, advancing
independently). The transactional advance rule, deduplication protocol, and
what surfaces to the user are identical in both modes.

---

## Strategy A — Single scalar low-water-mark (Events API available)

Applies when Step 5a's capability probe successfully calls the events list
operation.

### Why scalar

The Events API is a single server-side change feed covering all resource types
(`created[gt]` filter). Every event carries a monotonically advancing
`event.created` timestamp; one scalar advances uniformly with one API call.

### Cursor shape (scalar mode)

```yaml
# After a successful run (scalar mode)
cursor: "2026-06-20T21:00:00Z"
last_run: "2026-06-20T21:05:12Z"
last_success: "2026-06-20T21:05:12Z"
items_processed: 43
lock: null
errors: (none)
```

The `cursor` value is a plain ISO-8601 UTC string (second granularity, `Z`
suffix) — NOT a JSON object or YAML map. The `validate-cursor.mjs` hook treats
this as monotonically advancing; any write that moves it backward is rejected.

### Epoch conversion (scalar mode)

`event.created` is a Unix epoch integer. Convert to ISO-8601 UTC for storage:

```
new Date(event.created * 1000).toISOString()
```

When passing the stored cursor back as a filter, convert to Unix epoch:

```
Math.floor(Date.parse(cursor) / 1000)
```

Pass as `"created[gt]"` in Events API parameters.

### Advance rule (scalar mode)

After all action writes succeed, advance cursor to:

```
max(event.created, normalised to ISO-8601 UTC)
  across ALL events successfully processed this run
```

Intentionally suppressed (noise-dropped) events advance the cursor; events
whose writes failed do NOT.

**Pagination overflow (200-event cap):** advance to the `event.created` of the
last event processed (oldest-to-newest order). Log `stripe-pagination-overflow`
(kind: `source`). **The cursor never regresses** — if max this run ≤ current
cursor, leave unchanged.

### Cursor diff log entry (scalar mode, Step 11)

```
cursor advance — advanced: (scalar) 2026-06-19T21:00:00Z → 2026-06-20T21:00:00Z, events: 43
```

Zero-event run: `cursor advance — (no change; zero new events above cursor)`

Pagination-overflow run:

```
cursor advance — advanced: (scalar) 2026-06-20T18:00:00Z → 2026-06-20T21:00:00Z, events: 200 (cap hit; stripe-pagination-overflow logged)
```

Failed-write run: `cursor advance — (not advanced; N write failures; cursor held at <prior> for retry next run)`

---

## Strategy B — Per-resource timestamp map (Events API unavailable)

Applies when Step 5a's probe determines the events list operation is not
available. Step 5b is the primary change feed; each resource family advances
independently.

### Why per-resource map

Without the Events API there is no unified change feed. Per-resource queries
filter by `created` (immutable object creation timestamp). A single scalar
would force all families to share the slowest-advancing cursor, causing
unnecessary re-fetching.

### Cursor shape (per-resource map mode)

`sync.md → cursor` is a YAML mapping of resource-family names to ISO-8601 UTC
strings. A family whose value is `null` or absent is treated as bootstrap for
that family only.

```yaml
# After a successful run (per-resource map mode)
cursor:
  charges: "2026-06-20T18:00:00Z"
  payment_intents: "2026-06-20T18:00:00Z"
  invoices: "2026-06-20T17:45:00Z"
  subscriptions: "2026-06-20T15:00:00Z"
  customers: "2026-06-20T12:00:00Z"
  products: "2026-06-19T09:00:00Z"
  prices: "2026-06-19T09:00:00Z"
  disputes: "2026-06-20T16:30:00Z"
  refunds: "2026-06-20T14:00:00Z"
  coupons: "2026-06-18T10:00:00Z"
  promotion_codes: "2026-06-18T10:00:00Z"
  payment_links: "2026-06-15T08:00:00Z"
  payouts: "2026-06-20T08:00:00Z"
last_run: "2026-06-20T21:05:12Z"
last_success: "2026-06-20T21:05:12Z"
items_processed: 37
lock: null
errors: (none)
```

The `validate-cursor.mjs` hook accepts a plain string (scalar) or a YAML
mapping on the `cursor` key; it rejects any per-key regression within the map.

### Epoch conversion (per-resource map mode)

Store each per-resource cursor as ISO-8601 UTC. Convert to Unix epoch when
passing to the read tool:

```
Math.floor(Date.parse(cursor_for_family) / 1000)
```

Pass as `created>TIMESTAMP` in `search_stripe_resources` or as
`"created[gt]": <unix_epoch>` in `stripe_api_read` parameters.

### Advance rule (per-resource map mode)

After all action writes succeed, for each resource family advance its cursor
key to:

```
max(item.created, normalised to ISO-8601 UTC)
  across ALL items of that family successfully processed this run
```

Families with no items returned keep their prior value. The map is written
atomically at Step 11.

**Pagination overflow (200-item cap, all families combined):** advance only for
families fully processed before the cap. Interrupted families keep their
pre-run values; log `stripe-pagination-overflow` (kind: `source`).

**Per-key non-regression:** if a family's max this run ≤ its current value,
leave that key unchanged.

### Source_ref in per-resource map mode

In map mode `source_ref` on action items is the underlying **object id**
(e.g., `dp_xxx`, `ch_xxx`) rather than an `evt_xxx` event id.

### Cursor diff log entry (per-resource map mode, Step 11)

```
cursor advance — advanced: (map) charges 2026-06-19T18:00:00Z → 2026-06-20T18:00:00Z, invoices (unchanged), disputes 2026-06-19T16:00:00Z → 2026-06-20T16:30:00Z, items: 37
```

Failed-write run: `cursor advance — (not advanced; N write failures; cursor map held at pre-run values for retry next run)`

---

## Mode detection and cursor format migration

At Step 2 (read state), after reading `sync.md → cursor`:

1. `null` → bootstrap in whichever mode Step 5a probes to.
2. Valid ISO-8601 UTC string → scalar mode. If Step 5a probes Events API
   unavailable this run, use the scalar as the bootstrap floor for all
   families and switch to map mode going forward.
3. YAML mapping → per-resource map mode. If Step 5a probes Events API
   available this run, derive a scalar from `max(all map values)` and switch
   to scalar mode.
4. Present but neither a valid ISO-8601 string nor a YAML mapping → malformed.
   Log `stripe-cursor-evicted` (kind: `source`) with the malformed value; treat
   as null (bootstrap). Some items may be re-processed; the `_sources.json`
   protocol prevents duplicate entity creation.

Mode switches are transparent to the user.

---

## Transactional cursor advance (Step 11 rule — both modes)

Advance the cursor (scalar or map) **only when every action write this run
succeeded**. If any Step 10 write failed:

1. Record each failure in `sync.md → errors` (FIFO-capped to last 10).
2. Re-attempt each failed write once within the same run.
3. If any write is still pending after retry, **do not advance the cursor**.
   Leave `sync.md → cursor` at its pre-run value (scalar or map, unchanged).
4. The next run re-processes from the same cursor threshold and picks up failed
   items exactly.

Noise-dropped items (Step 8) are NOT failures and DO contribute to cursor
advance.

---

## `_sources.json` lookup-before-write protocol (both modes)

The Stripe Events API fires multiple events per underlying object (e.g.,
`dispute.created`, `dispute.funds_withdrawn`, `dispute.lost` all carry the same
`data.object.id: dp_xxx`). Per-resource queries may also return the same object
across runs. Without deduplication each event/result would create a separate
entity.

### Source ID convention

`source_id` for entity dedup is the **underlying Stripe object id** —
`data.object.id` from an event (Events API mode) or the object's `id` field
from a per-resource query (map mode). Event ids (`evt_xxx`) are NOT `source_id`
— they are ephemeral change-feed artefacts.

| Object type | Example source_id | subtype |
|---|---|---|
| Dispute | `dp_xxx` | dispute |
| Charge | `ch_xxx` | payment |
| PaymentIntent | `pi_xxx` | payment |
| Invoice | `in_xxx` | invoice |
| Subscription | `sub_xxx` | subscription |
| Customer | `cus_xxx` | person or company |
| Refund | `re_xxx` | refund |
| Payout | `po_xxx` | payout |
| Product / Price | `prod_xxx` / `price_xxx` | product |
| Coupon / PromotionCode | `<coupon_id>` / `promo_xxx` | coupon / promo_code |
| PaymentLink | `plink_xxx` | payment_link |
| PaymentMethodConfiguration | `pmc_xxx` | payment_method_config |

The `source` field in all `_sources.json` entries is `"stripe"`.

### Lookup procedure (Step 6)

1. Extract the object id from `data.object.id` (Events API) or `id` (map mode).
2. Read `<root>/entities/_sources.json`. Treat not-found as empty.
3. Look up `(subtype, source: "stripe", source_id: "<id>")`.
4. **Found** — open the existing entity and merge updated state (Step 7). Do
   NOT create a new entity file.
5. **Not found** — create a new entity file. The PostToolUse hook upserts
   `_sources.json` after the write.

Do NOT write to `_sources.json` directly — the agntux-core PostToolUse hook
owns it.

### Action-item dedup

Events API path: `source_ref` is the `evt_xxx` id of the first event that
raised the action. On subsequent events for the same object within the same run,
check `actions/_index.md` for an open action whose related entity matches the
object id; update rather than create.

Per-resource map path: `source_ref` is the object id. Check `actions/_index.md`
for an open action with the same `source_ref` before creating a new one.

---

## sync.md templates

### Bootstrap state (either mode)

```yaml
---
plugin: agntux-stripe
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

### After first successful run — scalar mode (Events API available)

```yaml
---
plugin: agntux-stripe
version: 0.1.0
cursor: "2026-06-20T21:00:00Z"
last_run: "2026-06-20T21:05:12Z"
last_success: "2026-06-20T21:05:12Z"
items_processed: 43
lock: null
errors: (none)
---
```

### After first successful run — per-resource map mode (Events API unavailable)

```yaml
---
plugin: agntux-stripe
version: 0.1.0
cursor:
  charges: "2026-06-20T18:00:00Z"
  payment_intents: "2026-06-20T18:00:00Z"
  invoices: "2026-06-20T17:45:00Z"
  subscriptions: "2026-06-20T15:00:00Z"
  customers: "2026-06-20T12:00:00Z"
  products: "2026-06-19T09:00:00Z"
  prices: "2026-06-19T09:00:00Z"
  disputes: "2026-06-20T16:30:00Z"
  refunds: "2026-06-20T14:00:00Z"
  payouts: "2026-06-20T08:00:00Z"
last_run: "2026-06-20T21:05:12Z"
last_success: "2026-06-20T21:05:12Z"
items_processed: 37
lock: null
errors:
  - kind: source
    code: stripe-events-api-unavailable
    at: "2026-06-20T21:00:03Z"
    message: "Events API operation not found via stripe_api_search; per-resource map mode active"
---
```

`stripe-events-api-unavailable` is logged once on first detection, then
suppressed on subsequent runs unless the mode changes.

### After a pagination-overflow run

```yaml
---
plugin: agntux-stripe
version: 0.1.0
cursor: "2026-06-20T21:30:00Z"    # scalar — or a partial map if map mode
last_run: "2026-06-20T22:00:01Z"
last_success: "2026-06-20T22:00:01Z"
items_processed: 200
lock: null
errors:
  - kind: source
    code: stripe-pagination-overflow
    at: "2026-06-20T22:00:01Z"
    message: "200-item cap reached; 200 items processed, remainder deferred to next run"
---
```

### After a run where a write failed (cursor not advanced)

```yaml
---
plugin: agntux-stripe
version: 0.1.0
cursor: "2026-06-20T21:30:00Z"    # unchanged; scalar or map, pre-run value
last_run: "2026-06-20T23:00:01Z"
last_success: "2026-06-20T22:00:01Z"
items_processed: 0
lock: null
errors:
  - kind: internal
    code: contract-not-registered
    at: "2026-06-20T23:00:01Z"
    message: "validator rejected entity write for dp_xxx; cursor not advanced"
---
```

`last_success` remains at its prior value; cursor is unchanged. The next run
retries from the same threshold.

---

## Onboarding-mode tighter cap

Detect first run ever as `last_success is null AND cursor is null`. On first
run apply a cap of **50 items** (not 200) and a bootstrap window of **14 days**
(not the 30-day `bootstrap_window_days` default). The 200-item cap and 30-day
window apply from the second run onward. In map mode each family's bootstrap
window is 14 days for the onboarding run.

Do not apply the tighter cap on subsequent runs where cursor is null due to a
reset; only trigger on the combined `last_success is null AND cursor is null`
condition.

---

## No tracked-parent registry (both modes)

The tracked-parent registry pattern is not applicable to Stripe. In Events API
mode every new event surfaces above the scalar cursor with a new
`event.created` timestamp. In per-resource map mode new objects surface above
the per-family cursor by their `created` timestamp. Object-level deduplication
is handled entirely by the `_sources.json` lookup-before-write protocol.

This decision must be preserved across plugin versions.

---

## No workspace identifier capture (both modes)

Stripe Dashboard deep-link URLs use the pattern:

```
https://dashboard.stripe.com/{resource-section}/{object_id}
```

No per-tenant subdomain or workspace token exists; no identifier capture step
or extra frontmatter key is required in either cursor mode.

---

## No auto-learned denylist (both modes)

Stripe events and per-resource results are account-scoped with no
sender-identity axis for denylist learning. Noise is controlled by the
event-type allowlist (Events API mode) and status-filter approach (per-resource
map mode) in `fetch.md`. The `agntux-gmail` auto-learned denylist pattern must
not be added.
