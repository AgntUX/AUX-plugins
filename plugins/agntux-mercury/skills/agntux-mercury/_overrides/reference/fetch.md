# Mercury fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
Mercury uses a multi-phase shape: refresh catalog resources (accounts,
cards, approvals, credit, invoices) in Step 5a, then page through
transaction history per account in Step 5b, then fetch single-transaction
detail selectively in Step 5c, then derive the automation_label for each
transaction in Step 5d.

## Step 5 — Fetch from Mercury

Call the Mercury MCP tools (host may UUID-prefix these at runtime; call
them by their host-resolved names). The primary tools for this step are:
`getAccounts`, `getAccountCards`, `listCredit`, `getTreasury`,
`listSendMoneyApprovalRequests`, `listInvoices`, `listTransactions`,
and `getTransaction` / `getTransactionById` for detail fetches.

Do NOT call `getOrganization`, `getUsers`, `getRecipients`,
`getCustomer`/`listCustomers`, `listCategories`, or `getAccountStatements`
every run — these are low-churn catalog resources. Pull them once on
bootstrap (cursor null) and then only when a specific signal warrants
a refresh (e.g., a new team member appears in an approval request, or a
new recipient surfaces in a transaction). This keeps run time bounded.

### Step 5a — Refresh catalog resources

Call these tools once per run in the order listed. They are all
low-volume and return complete snapshots — no pagination needed.

**Accounts + balances:**
```
getAccounts()
```
Returns all checking, savings, and treasury accounts with their
`id`, `type`, `kind`, `name`, `availableBalance`, `currentBalance`,
`status`, `legalBusinessName`, and `dashboardLink`. Store this list
in-memory for the remainder of the run — it anchors entity lookup
(Step 6) and the per-account cursor map (Step 5b).

Check each account's `status`. Flag accounts newly transitioned to
`frozen` or `closed` as `risk` signals in Step 8.

**Cards per account:**
```
getAccountCards({ accountId: <id> })   # once per active account
```
Call for every account returned by `getAccounts`. Each card carries:
`cardId`, `nameOnCard`, `lastFourDigits`, `network`, `status`
(`active`|`locked`|`inactive`), `type` (`virtual`|`physical`),
`physicalCardStatus`, `spendLimit` (`amountCents`, `interval`,
`atmAmountCents`), `userId`.

**Required: record card fields for every card.** Always write `type`,
`status`, `physicalCardStatus`, `spendLimit`, `nameOnCard` (cardholder),
`lastFourDigits`, and `network` into the card entity body.

**Card-status signals are change-driven, not presence-driven.**
- Raise a `risk` signal in Step 8 only when a card's `status` has
  changed from the value previously stored in its entity (e.g., active →
  locked/frozen, or a card hitting its spend limit for the first time).
- A card that is **newly discovered** this run (no prior entity exists)
  is a **quiet fact**: write the entity and record all fields, but do NOT
  raise a triage action. A physical card whose `physicalCardStatus` is
  `inactive` because it has never been activated is normal for a brand-new
  card — record the field, do not alert.
- On bootstrap (cursor null), ALL cards are newly-discovered by
  definition. Write entities for all of them; raise no card-status actions.

**Mercury IO credit:**
```
listCredit()
```
Returns credit accounts with `id`, `status`, `availableBalance`,
`currentBalance`. A credit account with `status: active` and
`availableBalance > 0` is an `opportunity` signal in Step 8
(available credit the user may not be aware of).

**Treasury:**
```
getTreasury()
```
Returns treasury cash-management balances. Treat this as a
`knowledge-update` — update the treasury account entity's balance.
Only call `getTreasuryTransactions` when the treasury account is
actively being used (balance > 0 or prior transactions exist). Skip
on the first bootstrap run unless treasury data is immediately returned.

**Pending send-money approvals:**
```
listSendMoneyApprovalRequests({ status: "pendingApproval" })
```
Returns all send-money requests awaiting sign-off. Each carries the
amount, recipient, requestor, and a timestamp. These are time-sensitive
`response-needed` items — process them before transactions in Step 5b.
Any approval present is action-worthy.

Also call with `status: "approved"` and check for recently approved
items that should close an existing `response-needed` action:
```
listSendMoneyApprovalRequests({ status: "approved" })
```
Use the result to reconcile and close any open approval action items in
Step 8.5 (the canonical reconcile step).

**Invoices:**
```
listInvoices()
```
Returns all open invoices with amount, due date, status, and associated
customer/recipient. Invoices approaching or past their due date are
`deadline` signals. For an invoice flagged as triage-worthy, call:
```
getInvoice({ invoiceId: <id> })
```
to retrieve full detail (attachments, line items, counterparty).

Do NOT call `listInvoiceAttachments` on every invoice — only on
invoices where the user explicitly needs attachment context (e.g.,
a disputed invoice where evidence is needed). This is not triggered
during routine ingest.

### Step 5b — Fetch transactions per account

For each account returned by Step 5a's `getAccounts`, page through
recent transactions using `listTransactions`.

**Incremental filter (cursor non-null):**
```
listTransactions({
  accountId: <id>,
  start: <cursor[accountId]>,     # server-side createdAt >= filter
  limit: 50                        # default page size
})
```
The server returns transactions with `createdAt >= start`. Apply a
strict client-side filter: keep only transactions where
`createdAt > cursor[accountId]` to exclude the boundary row (the last
item of the previous run, which the server's >= filter includes).

**Bootstrap run (cursor null or accountId absent from map):**
```
listTransactions({
  accountId: <id>,
  start: <ISO-8601 timestamp of (now − bootstrap_window_days)>,
  limit: 50
})
```
Default `bootstrap_window_days` is 90 (declared in `frontmatter.yaml`; user-overridable via `user.md`).

**Pagination.** If the response carries `page.nextPage`, continue
paging:
```
listTransactions({
  accountId: <id>,
  start_after: <page.nextPage token>
})
```
Continue until `page.nextPage` is absent or the per-run transaction cap
is reached.

**Per-run transaction cap.** Process at most **200 transactions total
across all accounts** per run. If the cap is reached mid-account, stop
paging for that account, log `mercury-pagination-overflow` (kind:
`source`) with the number of transactions deferred, and exit Step 5b.
Do NOT advance the cursor for accounts where paging was interrupted —
Step 11's transactional rule keeps the cursor at its pre-run value so
the next run continues from the right boundary. Accounts already fully
paged before the cap is hit DO have their cursor advanced normally.

**Status filter.** By default, fetch only `status: sent` transactions
(completed payments). Also fetch `status: pending` to surface pending
approvals and large in-flight items. Skip `cancelled`, `failed`,
`reversed`, and `blocked` on first pass — but DO record these statuses
if they appear for a transaction entity that was previously `pending`
(a reversal or failure is a `risk` signal in Step 8).

**Per-account sort.** `listTransactions` returns results newest-first
by default. Process in the order returned; the cursor advances to
max(createdAt) across all processed transactions, which is the first
item's createdAt on the first page.

### Step 5c — Fetch single-transaction detail (selective)

Do NOT call `getTransaction` or `getTransactionById` for every
transaction — the list result carries sufficient fields for triage.
Fetch full detail only when:

- The transaction amount exceeds a significance threshold (see Step 8
  signals) AND the `kind` is not a routine internalTransfer.
- The transaction has attachments (indicated by the list result if the
  connector surfaces an attachment count or flag).
- An existing action item references this transaction id and needs
  updated detail for reconciliation.

```
getTransactionById({ transactionId: <id> })
```

Full detail adds: `attachments`, `counterparty` (full object),
`details{}`, and `relatedTransactions`. Use this to enrich the entity
body and to populate the action item's body section.

### Step 5d — Derive automation_label for each transaction

**IMPORTANT: Mercury exposes no automation-rule or auto-transfer-rule
API.** Only the resulting transactions are visible. Do NOT attempt to
call any automation-rule tool — none exists in the connector.

For every transaction, derive an `automation_label` field using the
three heuristics below. ALWAYS present this label as inferred — never
claim it is authoritative.

**Heuristic A — Recurring counterparty + amount pattern.**
Query the in-memory transaction set (all transactions fetched this run
plus any prior entity records for this counterpartyName). Flag as
`auto_inferred` if:
- The same `counterpartyName` appears in ≥ 3 transactions across the
  history window.
- The amounts are identical (or within ±1% — to tolerate minor
  micro-deposit variations).
- The intervals between occurrences are consistent: mean interval ≤ 35
  days (weekly, biweekly, monthly, or similar) with standard deviation
  ≤ 5 days across the observed cadence.

All three sub-conditions must hold simultaneously.

**Heuristic B — Scheduling / recurring language in bankDescription.**
Flag as `auto_inferred` if `bankDescription` contains any of these
tokens (case-insensitive):
`recurring`, `autopay`, `auto pay`, `automatic`, `scheduled`,
`subscription`, `monthly`, `annual`, `auto-debit`, `autodebit`,
`standing order`, `direct debit`.

**Heuristic C — Repeating internalTransfer between own accounts.**
Flag as `auto_inferred` if:
- `kind` is `internalTransfer`.
- The destination accountId appears in the user's own account list
  (from Step 5a getAccounts).
- The same source→destination pair with the same amount appears in
  ≥ 2 prior transactions within the last 35 days.

**Label assignment.**
- If any heuristic fires: `automation_label: "Auto (inferred)"`
- If no heuristic fires: `automation_label: "Manual"`
- If insufficient history to evaluate heuristics A and C (bootstrap
  run with < 3 prior transactions for this counterparty):
  `automation_label: "Manual"` (default to manual when evidence is
  absent; do not guess).

**Display rule.** In ALL entity body prose and action item body text,
present the automation_label as:
- `"Auto (inferred)"` — never `"Automated"`, never `"Auto"` alone,
  never `"Scheduled"` without the `(inferred)` qualifier.
- `"Manual"` — for transactions where no heuristic fired.

The `(inferred)` qualifier is mandatory. This is not a Mercury-provided
field — it is a local heuristic. Users must not mistake it for a
Mercury signal.

**Do not store heuristic state between runs.** The automation_label is
derived fresh each run from the available transaction history in the
entity store. There is no separate automation-rule registry to maintain.

### Step 5 summary — on fetch failure

On any failure from any Mercury tool call:

- Log to `data/learnings/agntux-mercury/sync.md → errors` with
  kind `network | auth | parse | source | internal` (or the
  mercury-specific extension from the permitted-error-kinds list).
- Slice the errors list to the last 10 entries (newest-first) before
  writing.
- If the failure is in Step 5a (catalog resources): release the lock
  and exit. Do NOT proceed to Step 5b — account/card state is required
  for entity lookup.
- If the failure is in Step 5b for a specific account: log the error,
  skip that account's transaction page, and continue with remaining
  accounts. Do NOT advance the cursor for the failed account.
- If the connector returns a `429` or rate-limit signal: log
  `mercury-rate-limited` (kind: `source`), stop fetching for that
  tool call, and exit. Step 11's transactional rule keeps cursor at
  its pre-run value.
- Step 11's transactional rule keeps `cursor` at its pre-run value
  for any account where the page was not fully and successfully processed.

## Cursor shape for Mercury

The cursor is a per-account JSON map on the `sync.md → cursor` line:

```yaml
# data/learnings/agntux-mercury/sync.md — example after a successful run
cursor: '{"acct-uuid-checking":"2026-06-19T14:00:00Z","acct-uuid-savings":"2026-06-19T11:30:00Z"}'
```

Each key is the Mercury `accountId` UUID exactly as returned by
`getAccounts`. Each value is the ISO-8601 UTC `createdAt` timestamp of
the newest transaction successfully processed from that account.

Advance each entry to `max(createdAt)` across all transactions
successfully processed from that account this run. Advance only when
every action write in the run succeeds (Step 11 transactional rule).

**Eviction.** At Step 2 (cursor read time), compare the cursor map's
keys against the account list from `getAccounts`. Remove entries for
any accountId that no longer appears in the account list (account
closed or removed). Log each eviction as `mercury-cursor-evicted`
(kind: `source`) with the accountId and its `last_createdAt`. Write
the evicted-map only as part of the transactional cursor advance at
Step 11 — do not write it at Step 2.

Bootstrap state:
```yaml
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
```

After the first successful run across two accounts:
```yaml
cursor: '{"acct-uuid-checking":"2026-06-19T14:00:00Z","acct-uuid-savings":"2026-06-19T11:30:00Z"}'
last_run: "2026-06-19T14:05:22Z"
last_success: "2026-06-19T14:05:22Z"
items_processed: 12
lock: null
errors: (none)
```

## Triage signal summary — what makes a Mercury item action-worthy

Use these signals in Steps 6–8. Never hard-code thresholds in the
canonical skill body — evaluate signals relative to the user's own
account history and balances.

**`response-needed` (pending approvals):**
- Any record from `listSendMoneyApprovalRequests` with
  `status: pendingApproval`. These are the highest-priority items:
  money cannot move until the user acts.

**`risk` signals:**
- **Low balance (relative rule — no cold-start alerts):**
  Raise a low-balance signal only when ALL of the following hold:
  1. A baseline exists: at least one prior successful ingest run has
     stored a balance history for this account (do NOT raise on the
     bootstrap run or when the entity has no prior balance recorded).
  2. The account's current `availableBalance` has dropped meaningfully
     relative to that account's own recent baseline. "Meaningful" means
     a significant percentage drop relative to the account's own recent
     average — not a fixed dollar amount. Use the account's own history
     as the reference; do not compare accounts to each other.
  3. OR the account's `availableBalance` is below a user-configured
     floor declared in `user.md` under `mercury.low_balance_floors`
     (keyed by accountId or account name). If no floor is configured for
     an account, the absolute-threshold check is SKIPPED entirely —
     never invent a default dollar floor.
  On bootstrap or any run where no prior balance baseline is available,
  skip the low-balance check for that account entirely.
- An absolute low-balance dollar threshold is NEVER hard-coded in the
  ingest skill; the only absolute check is the optional user-configured
  floor described above.
- A transaction with unusual amount: defined as > 3× the account's
  mean transaction amount over the last 30 days.
- Transaction `status` changes to `reversed`, `failed`, or `blocked`
  for an item that was previously `pending` or `sent`.
- Card `status` transition (any direction: active→locked,
  locked→active, active→inactive, etc.).
- Account `status` transitions to `frozen` or `closed`.

**`deadline` signals:**
- Invoice `dueDate` is within 7 days of `now` (approaching due).
- Invoice `dueDate` has passed and `status` is not `paid` (overdue).

**`opportunity` signals:**
- Mercury IO credit account (`listCredit`) has `status: active` and
  `availableBalance > 0`. Surface once per run if not already open.

**`knowledge-update` signals (informational — no action item unless
genuinely new information):**
- New account or recipient not previously seen in entities.
- Balance change > 5% from the previously stored value on any account.
- New team member returned by `getUsers`.
- Card added or removed from an account.

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| `getAccounts` auth error | `auth` | exit, retry next run |
| `getAccounts` network failure | `network` | exit, retry next run |
| `listTransactions` returns 429 / rate-limit | `source` + `mercury-rate-limited` | stop, exit, retry next run |
| `listTransactions` page cap exceeded | `source` + `mercury-pagination-overflow` | log, stop paging, continue with next account |
| `getTransaction` returns not-found for a known id | `source` | log, skip detail fetch, use list-level data |
| `listSendMoneyApprovalRequests` fails | `network` or `source` | log, skip approvals, continue — do not exit |
| `listInvoices` fails | `network` or `source` | log, skip invoices, continue — do not exit |
| `listCredit` fails | `network` or `source` | log, skip credit check, continue |
| Cursor map unparseable JSON | `parse` | treat as bootstrap, log, continue |
| accountId in cursor absent from getAccounts | `source` + `mercury-cursor-evicted` | evict entry, log, continue |
