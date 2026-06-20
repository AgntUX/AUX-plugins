# Cursor advance reference — agntux-mercury (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

Mercury uses the **per-account createdAt map with embedded pending-id
set** strategy. The cursor is a JSON object stored on the
`sync.md → cursor` line. Each key is a Mercury account UUID; each value
holds the incremental low-water-mark timestamp (`created_at`) and the
set of transaction ids currently in a non-terminal status
(`pending_ids`).

---

## Strategy name

**Per-account createdAt low-water-mark map with pending-id re-poll set**

This strategy compounds two patterns:

1. **Per-container last-processed-timestamp map** — same family as the
   Slack per-channel `ts` map. "Container" is a Mercury account; the
   low-water-mark field is `createdAt` (immutable on Mercury
   transactions).

2. **Explicit mutable-status tracking set** — `pending_ids` embedded in
   the per-account cursor value. Ids are added when a transaction first
   surfaces as `pending`, re-polled individually each run via
   `getTransactionById`, and removed when status becomes terminal.

The compound is necessary because Mercury transaction status is mutable
after first sight (`pending` → `sent` / `failed` / `reversed` /
`cancelled`). Once the cursor advances past a pending transaction's
`createdAt`, the server-side `start` filter on `listTransactions` will
no longer re-surface it. The `pending_ids` set closes this gap at
O(number of pending transactions) rather than O(re-scan window size).

---

## Cursor shape

```yaml
# data/learnings/agntux-mercury/sync.md — example after a successful run
cursor: '{"acct-uuid-checking":{"created_at":"2026-06-19T14:00:00Z","pending_ids":[{"id":"txn-uuid-a","since":"2026-06-19T14:05:00Z"}]},"acct-uuid-savings":{"created_at":"2026-06-19T11:30:00Z","pending_ids":[]}}'
```

The cursor value is a **JSON object** serialised to a single-line
string on the `sync.md → cursor` frontmatter key.

### Map key

The key is the Mercury `accountId` UUID **exactly as returned by
`getAccounts`**. Do not reformat, normalise, or alias the UUID.
Keying on account name or type is wrong: accounts can be renamed and
multiple accounts of the same type can exist.

### Value shape

```json
{
  "created_at": "<ISO-8601 UTC timestamp>",
  "pending_ids": [
    {"id": "<transaction-uuid>", "since": "<ISO-8601 UTC timestamp>"}
  ]
}
```

**`created_at`** — the `createdAt` of the newest transaction
successfully processed from this account on the most recent run that
processed at least one transaction. Written as `YYYY-MM-DDTHH:MM:SSZ`.
Passed as the `start` parameter to `listTransactions` on the next
incremental run.

**`pending_ids`** — sorted list (ascending by `since`) of transaction
UUIDs in a non-terminal status at the end of the most recent run. Each
entry is a JSON object with `id` (transaction UUID) and `since` (first-
seen run timestamp, set once and never updated). Empty array (`[]`) when
no transactions are waiting to settle. The `validate-cursor.mjs` hook
accepts the legacy bare-string array form for forward-compat; the object
form is canonical for all new writes.

### Bootstrap state

```yaml
cursor: null
last_success: null
```

`null` cursor + `null` `last_success` together signal "first run ever".
When `cursor` is non-null but a specific `accountId` is absent, that
account is new — treat it as bootstrap: apply `bootstrap_window_days`
as the `start` offset from `now`.

---

## Advance rule

### Low-water-mark (`created_at`) advance

At the end of each account's processing (recorded for Step 11 commit):

```
new_created_at(accountId) = max(createdAt)
  across ALL transactions from this account
  that were durably written OR intentionally suppressed this run
```

"Durably written" means entity and action-item writes succeeded.
"Intentionally suppressed" means fetched, evaluated, and determined
non-action-worthy — suppressed transactions still advance the cursor.
Transactions whose writes failed do NOT contribute to `new_created_at`;
the next run re-surfaces them.

**Why `createdAt` and not `postedAt` or `updatedAt`:** `listTransactions`
filters server-side on `start` (createdAt >=), so `createdAt` is the
only consistent low-water-mark field. `postedAt` is absent on pending
transactions. `updatedAt` does not exist on Mercury transactions.
Advancing the cursor past a pending transaction's `createdAt` is correct
because the `pending_ids` set (not the low-water-mark) tracks status
updates after the cursor moves past.

### Pending-id set update

After each account's main incremental page and re-poll step:

- **Remove** ids that returned a terminal status (`sent`, `failed`,
  `reversed`, `cancelled`, `blocked`).
- **Add** ids from the main incremental page with status `pending` that
  are not already in the set, with `since` set to the current run time.
- **Evict** ids whose `since` is more than 30 days old (see "Pending-id
  eviction" below).

The updated `pending_ids` list is written as part of the Step 11
transactional advance.

### Full-run success gate (transactional rule)

Advance the cursor map **only when every action write across all
accounts this run succeeded**. If any write failed:

- Leave the entire cursor map at its pre-run state.
- Record failures in `sync.md → errors`.
- The next run re-processes from the same thresholds.

Exception: accounts not reached this run (due to the 200-transaction
cap) retain their pre-run `created_at` exactly. The transactional rule
applies to accounts that were processed: if all their writes succeeded,
those accounts' cursor entries advance regardless of skipped accounts.

---

## Pending-id re-poll step (Step 5b preamble)

Execute for each account before the main incremental `listTransactions`
page, each run where `pending_ids` is non-empty.

For each entry in `cursor[accountId].pending_ids`:

```
getTransactionById({ transactionId: <entry.id> })
```

Evaluate the returned transaction:

- **Still `pending`**: no action; id stays in `pending_ids`. Update the
  entity body if any other field changed (amount, description).
- **Now `sent`**: update entity to reflect settled status; close any
  prior `response-needed` action item for this transaction; remove id.
- **Now `failed`, `reversed`, or `cancelled`**: raise or update a `risk`
  action item per `fetch.md`'s triage signal table; remove id.
- **Not found**: log `mercury-pending-not-found` (kind: `source`) with
  the transaction id; remove id — a missing id cannot be retried.

A `429` from `getTransactionById` logs `mercury-rate-limited` and aborts
the re-poll pass for this account. Leave `pending_ids` unchanged for that
account. Do NOT advance the cursor for accounts where re-poll was aborted
by rate-limiting.

---

## Pending-id eviction (stale-pending cleanup)

At Step 2 (cursor read time), scan every account's `pending_ids` for
entries whose `since` is more than 30 days before the current run's
`now`. For each stale entry:

1. Remove the id from `pending_ids`.
2. Log a `mercury-pending-evicted` entry to `sync.md → errors`
   (kind: `source`) with the transaction id and accountId.
3. Do NOT update the entity file for the evicted transaction — the
   last-known state in the entity is its most accurate record.

---

## Bootstrap run (cursor null)

When `cursor` is null AND `last_success` is null (first run ever):

- For each account, call `listTransactions` with
  `start: (now − bootstrap_window_days)`. Default 30 days (from
  `frontmatter.yaml`).
- Apply the 200-transaction total cap across all accounts per
  `fetch.md`.
- Add any `status: pending` transaction ids to `pending_ids` with
  `since` set to the current run time.
- After all writes succeed, write a cursor entry for every account
  processed.

**Onboarding-mode provision:** the first run executes synchronously
during Personalization State A wrap-up (target < 1 minute). Apply a
tighter first-run cap: at most **50 transactions total** and
`bootstrap_window_days` of **14** regardless of the frontmatter default.
The 200-item cap and 30-day window apply from the second run onward.

Detect "first run ever" as `last_success is null AND cursor is null`.
Do not trigger the onboarding-mode provision on subsequent runs where
only some accounts are new to the map.

---

## Account eviction (account closed)

After Step 5a (`getAccounts` completes), compare cursor map keys against
the returned `accountId` list. For each cursor key absent from
`getAccounts`:

1. Remove the entry from the in-memory cursor map.
2. Log a `mercury-cursor-evicted` entry to `sync.md → errors`
   (kind: `source`) with the accountId and its last `created_at`.
3. Do NOT write the eviction back to `sync.md` until the Step 11
   transactional advance — if the run fails before Step 11, eviction
   is re-evaluated on the next run (idempotent).

---

## No tracked-parent registry

Mercury has no chat-style threading. The `relatedTransactions` field
links a transaction to related items (e.g., a fee to its originating
payment) — this is a **reference relationship**, not a parent-reply
structure. Each related transaction has its own `createdAt` and surfaces
via the main incremental page naturally.

The tracked-parent registry is **not needed and MUST NOT be created.**
The cursor map key space contains only bare `<accountId>` entries — no
`<accountId>#<transactionId>` entries. This must be preserved across
plugin versions.

When a transaction has `relatedTransactions`, read the related ids for
entity enrichment only. Optionally call `getTransactionById` during
Step 5c (selective detail fetch) to enrich the entity. Do not add those
ids to any registry.

---

## Cursor diff expression (Step 11)

Log this line at Step 11 cursor-advance time:

```
cursor advance — added: <accountId>×N, advanced: <accountId>×M, evicted: <accountId>×K, pending-added: <count>, pending-removed: <count>
```

- `added` — account ids newly inserted this run.
- `advanced` — existing account ids whose `created_at` moved forward.
- `evicted` — account ids removed (absent from `getAccounts`).
- `pending-added` — total ids added to any account's `pending_ids`.
- `pending-removed` — total ids removed from any account's `pending_ids`
  (terminal status reached or stale-evicted).

Use `(none)` for any category with no changes. Example:

```
cursor advance — added: acct-uuid-savings×1, advanced: acct-uuid-checking×1, evicted: (none), pending-added: 2, pending-removed: 1
```

On a zero-transaction run:

```
cursor advance — (no change; zero new transactions and pending set unchanged)
```

The `validate-cursor.mjs` hook checks that the cursor is parseable JSON
and that no existing `created_at` value regresses. A write where any
existing entry's `created_at` moves backward is rejected.

---

## Workspace identifier capture

Mercury's deep-link URLs use the `dashboardLink` field returned directly
on each account object by `getAccounts` — a fully-formed URL (e.g.,
`https://app.mercury.com/accounts/<accountId>`). No separate workspace
subdomain capture step is required.

Use `dashboardLink` verbatim. Persist it in the account entity body so
action items can reference it without a `getAccounts` call.

For transaction-level deep links, there is no stable per-transaction
permalink in the Mercury API response. Use the account's `dashboardLink`
as the `url` for all transaction-level `suggested_action` items. If a
future Mercury API version exposes a per-transaction URL, capture it
from the `getTransactionById` response and prefer it.

---

## `_sources.json` lookup-before-write protocol

The lookup-before-write protocol from Step 6 fully applies:

- **Account entities** — `(subtype: account, source: mercury,
  source_id: "<accountId>")`.
- **Transaction entities** — `(subtype: transaction, source: mercury,
  source_id: "<transactionId>")`.
- **Person / company entities** from `counterpartyName` or
  `getRecipient` / `listCustomers` — attempt lookup by email; on miss,
  secondary-lookup by email alias; only create new if no match.
- Do NOT write to `_sources.json` directly. The agntux-core PostToolUse
  hook owns it.

Each transaction is its own top-level atomic entity-source pair; there
is no tracked-parent registry lookup to perform.

---

## sync.md template

Bootstrap state:

```yaml
---
plugin: agntux-mercury
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful run (two accounts, one pending transaction):

```yaml
---
plugin: agntux-mercury
version: 0.1.0
cursor: '{"acct-uuid-checking":{"created_at":"2026-06-19T14:00:00Z","pending_ids":[{"id":"txn-uuid-a","since":"2026-06-19T14:05:00Z"}]},"acct-uuid-savings":{"created_at":"2026-06-19T11:30:00Z","pending_ids":[]}}'
last_run: "2026-06-19T14:05:22Z"
last_success: "2026-06-19T14:05:22Z"
items_processed: 12
lock: null
errors: (none)
---
```

After a run where an account was closed and a stale pending id evicted:

```yaml
---
plugin: agntux-mercury
version: 0.1.0
cursor: '{"acct-uuid-checking":{"created_at":"2026-07-19T10:00:00Z","pending_ids":[]}}'
last_run: "2026-07-19T10:03:11Z"
last_success: "2026-07-19T10:03:11Z"
items_processed: 8
lock: null
errors:
  - kind: source
    ts: "2026-07-19T10:03:11Z"
    error_kind: mercury-cursor-evicted
    detail: "Evicted accountId acct-uuid-savings (last_created_at 2026-06-19T11:30:00Z, absent from getAccounts)"
  - kind: source
    ts: "2026-07-19T10:03:11Z"
    error_kind: mercury-pending-evicted
    detail: "Evicted pending txn-uuid-c from acct-uuid-checking (since 2026-06-19T16:22:00Z, 30 days without terminal status)"
---
```
