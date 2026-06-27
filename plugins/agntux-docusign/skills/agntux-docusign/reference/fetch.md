# DocuSign fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
DocuSign uses a three-phase shape: resolve account identity once (Step 5a),
page through envelopes modified in the cursor window (Step 5b), then page through
managed agreements for renewal and expiration signals (Step 5c).

## Step 5 — Fetch from DocuSign

Call tools by whatever name the host exposes (UUID-prefixed at runtime).
All cursor state is read from `data/learnings/agntux-docusign/sync.md → cursor`
at Step 2. The cursor is a JSON object; parse it at Step 2 and keep
`envelopes_since` and `agreements_ctoken` in scope for Step 5.
Bootstrap state: `cursor: null` (treat both keys as null).

Do NOT hard-code any account ID, user email, envelope ID, or agreement title —
all account identity is resolved at runtime.

---

### Step 5a — Resolve account identity

The DocuSign API requires an `accountId` for every tool call. Resolve it once.

1. Read `data/learnings/agntux-docusign/sync.md → account_id`. If non-null and
   non-empty, use it and skip the getUserInfo call.
2. If absent (first run), call `getUserInfo`. Extract `accounts[0].account_id`
   and persist it to `sync.md → account_id` at Step 11 sub-step 5.

If getUserInfo fails or returns no accounts: log `docusign-account-id-unresolved`
(kind: `auth`), release the lock, and exit. Every subsequent tool call requires
the account ID and will fail identically.

---

### Step 5b — Fetch envelopes modified in the cursor window

**Compute from_date:**

- **Incremental** (`cursor.envelopes_since` non-null): use `cursor.envelopes_since`
  as `from_date`. Boundary is inclusive; an envelope at exactly the cursor
  timestamp resurfaces but the Step 9 dedup suppresses a duplicate action.
- **Bootstrap** (`cursor` null or `cursor.envelopes_since` null): use
  `now − bootstrap_window_days days` (ISO-8601 UTC). Default `bootstrap_window_days`
  is **30** (overridable via `user.md → bootstrap_window_days`).

**Primary sweep** (incremental window):

```
getEnvelopes({
  accountId: <account_id>,
  from_date: <cursor.envelopes_since | now − bootstrap_window_days>,
  order_by: "last_modified",
  order: "asc",      # oldest-first so the cursor advances through a contiguous window
  count: 100,
  start_position: 0  # increment for paging
})
```

**In-flight re-sweep** (envelopes older than the cursor window still awaiting signature):

```
getEnvelopes({
  accountId: <account_id>,
  status: "sent",
  order_by: "last_modified",
  order: "desc",
  count: 50          # cap; most users have < 50 open envelopes
})
```

Process oldest-first results from the primary sweep; the in-flight sweep is
supplementary and its envelopes are deduped at Step 9.

**Pagination.** Page by incrementing `start_position` by `count` until all
results are retrieved. Cap at **150 envelopes per run** across both calls. If
the cap is reached, log `docusign-pagination-overflow` (kind: `source`) with
the deferred count and stop. Advance `envelopes_since` to the newest
`last_modified_date_time` among envelopes actually processed.

**Per-envelope detail fetch.** The list response carries `envelopeId`, `status`,
`subject`, `senderInfo`, `recipients` (summary), `sentDateTime`,
`completedDateTime`, `lastModifiedDateTime`, `expiredDateTime` — sufficient for
most signals. Call `getEnvelope` and `listRecipients` only when:

- Envelope is `sent` or `delivered` and you need to identify the pending signer.
- Envelope is `completed` and document names are needed for the action body.

```
getEnvelope({ accountId: <account_id>, envelopeId: <envelopeId> })

listRecipients({ accountId: <account_id>, envelopeId: <envelopeId>, include_tabs: false })
```

From `listRecipients`, extract `signers[].email`, `.name`, `.status`, `.routingOrder`.
The pending signer is the signer with the lowest `routingOrder` whose status is
`sent` or `delivered`. Determine whether the connected user's email (from
`user.md` or Step 5a) appears in the pending-signer list.

Call `listEnvelopeDocuments` only when document names are needed for a
meaningful action body (e.g., the envelope subject is generic):

```
listEnvelopeDocuments({ accountId: <account_id>, envelopeId: <envelopeId> })
```

If `getEnvelope`, `listRecipients`, or `listEnvelopeDocuments` returns 404,
log `docusign-envelope-not-found` (kind: `source`) with the `envelopeId`,
skip this envelope, and continue.

**Step 5b triage signals.** An envelope may satisfy more than one:

1. **Waiting on USER to sign** (`status: sent` or `delivered`, connected user
   is in the pending-signer list): Action class: `response-needed`.

2. **Sent envelope stuck** (`status: sent` or `delivered`, user is sender,
   pending signer is NOT the user, `last_modified_date_time` > 2 days ago):
   Action class: `response-needed`. Do NOT re-raise if an open action with the
   same `source_id` already exists (dedup at Step 9).

3. **Envelope completed** (`status: completed`, `completedDateTime` within cursor
   window): Action class: `knowledge-update`. Include all signer names and
   document names.

4. **Envelope declined or voided** (`status: declined` or `voided`): Action
   class: `knowledge-update`. Include `voidedReason` when present.

Envelopes in `created` status do NOT produce action items. `delivered` envelopes
follow the same pending-signer logic as `sent`.

---

### Step 5c — Fetch managed agreements for renewal and expiration signals

**Capability gate (required).** DocuSign Navigator is an optional add-on. Accounts
without it return HTTP 403 with a detail string containing `"EnableNavigatorAPIDataOut"`
when `getAllAgreements` is called. This is a common, expected condition.

**If `getAllAgreements` returns HTTP 403 with a detail containing
`"EnableNavigatorAPIDataOut"` or any variant naming Navigator or its plan item:**

1. Log kind `docusign-navigator-unavailable`, message `"DocuSign Navigator not
   enabled on this account — agreements phase skipped"`.
2. Set `agreements_ctoken` to `null` in the cursor (no-op, not mid-sweep).
3. Do NOT retry, exit, or treat as fatal. Proceed directly to Step 6.

The envelope cursor advances normally; subsequent runs detect the same 403 and
skip again with no degradation. `docusign-navigator-unavailable` is a declared
permitted-error-kind in `frontmatter.yaml`.

**After confirming no Navigator-unavailable 403,** proceed with the agreements sweep.
`getAllAgreements` uses an opaque `ctoken` for continuation. Pass
`cursor.agreements_ctoken` if non-null to resume a prior sweep.

```
getAllAgreements({
  accountId: <account_id>,
  sort: "expiration_date",   # surface soonest-expiring first
  limit: 50,
  ctoken: <cursor.agreements_ctoken | null>
})
```

Collect the returned `ctoken` from each response. If the response indicates no
more pages, reset `agreements_ctoken` to null. Cap at **100 agreements per run**;
if the cap fires, persist the last `ctoken` so the next run continues.

**Agreement triage signals:**

1. **Expiring soon** (`expiration_date` within 30 days or `user.md → agreement_expiry_warning_days`):
   `response-needed` if within 14 days, `knowledge-update` if 15–30 days. Do NOT
   re-raise if an open action with the same `source_id` already exists.

2. **Auto-renewal imminent** (`renewal_type: auto`, `expiration_date` within 30 days):
   Action class: `knowledge-update`.

3. **Agreement newly effective** (`effective_date` within cursor window, `status: active`):
   Action class: `knowledge-update`.

Agreements whose `expiration_date` is in the past do NOT produce action items
unless the expiration is within 7 days ago — raise `knowledge-update` once.

Call `getAgreementDetails` only when the list result lacks `effective_date`,
`expiration_date`, or `renewal_type`:

```
getAgreementDetails({ accountId: <account_id>, agreementId: <agreementId> })
```

If `getAgreementDetails` returns 404, log `docusign-agreement-not-found`
(kind: `source`), skip the agreement, and continue.

---

### Step 5 — On fetch failure

- Log to `sync.md → errors` with the appropriate kind from `frontmatter.yaml →
  permitted-error-kinds`. Slice errors to the last 10 (newest-first).
- **Auth failure (401 / 403):** release lock and exit — EXCEPT a 403 whose
  detail string names Navigator/`EnableNavigatorAPIDataOut` (see Step 5c above).
- **Rate limit (429):** log `docusign-rate-limited` (kind: `source`), release
  lock, exit. Transactional rule keeps both cursor keys at pre-run values.
- **Network failure:** log (kind: `network`), release lock, exit.
- **Per-envelope 404:** log `docusign-envelope-not-found` with envelopeId, skip,
  continue.
- **Per-agreement 404:** log `docusign-agreement-not-found` with agreementId,
  skip, continue.
- **Parse failure / malformed response:** log (kind: `parse`), skip item, continue.
- **Cursor JSON malformed:** log `docusign-cursor-evicted` (kind: `parse`), treat
  both keys as null (bootstrap fallback), continue.
- **Pagination overflow:** log `docusign-pagination-overflow` (kind: `source`)
  with deferred count; advance cursor to newest item processed.

---

## Cursor shape for DocuSign

```yaml
# Bootstrap state
cursor: null

# After first successful run
cursor: '{"envelopes_since":"2026-06-26T10:00:00Z","agreements_ctoken":null}'

# Mid-sweep: run ended before agreements sweep completed
cursor: '{"envelopes_since":"2026-06-26T11:00:00Z","agreements_ctoken":"ABCxyz..."}'
```

| Key | Type | Meaning |
|---|---|---|
| `envelopes_since` | ISO-8601 UTC | Newest `last_modified_date_time` across envelopes processed this run. Passed as `from_date` on the next incremental run. |
| `agreements_ctoken` | string or null | Opaque continuation token from last `getAllAgreements`. Null = start fresh. Persisted mid-sweep when the per-run cap fires. |

Parse the cursor JSON at Step 2. If `cursor` is null or unparseable,
log `docusign-cursor-evicted` (kind: `parse`) and treat both keys as null.

**Advance rules (Step 11 transactional rule):**

- Advance `envelopes_since` to `max(last_modified_date_time)` across all
  envelopes processed this run. Advance only when every action write succeeded.
  This is independent of the agreements phase — envelope cursor advances even
  when agreements was skipped (Navigator unavailable).
- Update `agreements_ctoken` to the last received ctoken; reset to null when the
  sweep completes. Only update when the agreements portion completed without
  error. When skipped due to Navigator unavailable, leave `agreements_ctoken`
  at null (not a failure, not recovered by next run).
- On fatal exit (auth, network, rate-limit, or write failure), leave both cursor
  keys at pre-run values. A Navigator-unavailable skip is NOT a fatal exit.

---

## Entity subtype mapping

| DocuSign resource | Entity subtype | Source ID pattern |
|---|---|---|
| Envelope | `envelope` | `envelope:{envelopeId}` |
| Managed agreement | `agreement` | `agreement:{agreementId}` |
| Signer / recipient | `person` (lookup-before-write at Step 6; anchor on email) | standard person protocol |

Never create a duplicate person for the same email — check `_sources.json` first.
Do not create a self-entity for the connected user's own email.

---

## Action item shapes by signal type

### Envelope waiting on user to sign (response-needed)

```yaml
title: "Sign required: {envelope subject}"
kind: response-needed
source_id: "envelope:{envelopeId}"
suggested_actions:
  - label: "Review and sign"
    url: "https://app.docusign.com/documents/details/{envelopeId}"
  - label: "Open in DocuSign"
    url: "https://app.docusign.com/documents/details/{envelopeId}"
```

Body: envelope subject, sender name, document names, sent date, expiration date.

### Sent envelope stuck on pending signer (response-needed)

```yaml
title: "Awaiting signature: {envelope subject}"
kind: response-needed
source_id: "envelope:{envelopeId}"
suggested_actions:
  - label: "Send reminder"
    host_prompt: "Use the agntux-docusign plugin to send a signing reminder for action {id}"
  - label: "Open in DocuSign"
    url: "https://app.docusign.com/documents/details/{envelopeId}"
```

Body: envelope subject, pending signer name and email, days open, document names.

### Envelope completed (knowledge-update)

```yaml
title: "Signed: {envelope subject}"
kind: knowledge-update
source_id: "envelope:{envelopeId}"
suggested_actions:
  - label: "Open in DocuSign"
    url: "https://app.docusign.com/documents/details/{envelopeId}"
```

Body: all signer names, completed date, document names.

### Envelope declined or voided (knowledge-update)

```yaml
title: "Declined: {envelope subject}"     # or "Voided: ..." for voided envelopes
kind: knowledge-update
source_id: "envelope:{envelopeId}"
suggested_actions:
  - label: "Open in DocuSign"
    url: "https://app.docusign.com/documents/details/{envelopeId}"
```

Body: envelope subject, who declined (name/email), void reason if applicable.

### Agreement expiring soon (response-needed or knowledge-update)

```yaml
title: "Agreement expiring: {agreement title}"
kind: response-needed   # within 14 days; knowledge-update for 15–30 days
source_id: "agreement:{agreementId}"
suggested_actions:
  - label: "Open in DocuSign"
    url: "https://app.docusign.com/documents/details/{agreementId}"
```

Body: agreement title, parties, effective date, expiration date, renewal type, total value if available.

### Auto-renewal imminent (knowledge-update)

```yaml
title: "Auto-renewing: {agreement title}"
kind: knowledge-update
source_id: "agreement:{agreementId}"
suggested_actions:
  - label: "Open in DocuSign"
    url: "https://app.docusign.com/documents/details/{agreementId}"
```

Body: agreement title, parties, auto-renewal date, term length, total value.

---

## Deduplication

Before raising any action item at Steps 8–9, look up the candidate `source_id`
in `_sources.json` and `actions/_index.md`:

- **Existing open action** with same `source_id`: do NOT raise a new action.
  Update the entity body with changed fields (signer status, subject, expiration date).
- **Closed or dismissed action**: re-raise ONLY if the envelope or agreement has
  materially changed (e.g., voided envelope recreated, expiration date shifted
  closer). A cosmetic field change does not justify re-raising.
- **New `source_id`**: create a new action item normally.

The `envelope:` and `agreement:` namespaces are distinct; the same ID will not
collide across resource types.

---

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| Auth failure (401 / 403) from any tool EXCEPT Navigator-unavailable case | `auth` | exit, release lock, retry next run |
| `getAllAgreements` returns 403 with detail containing "EnableNavigatorAPIDataOut" / Navigator plan item | `docusign-navigator-unavailable` | log informational note, skip agreements phase, continue with envelopes; do NOT exit |
| Network-level failure | `network` | exit, release lock, retry next run |
| Rate limit (429) from any tool | `source` + `docusign-rate-limited` | stop fetching, release lock, retry next run |
| `getEnvelope` or `listRecipients` returns 404 for known envelopeId | `source` + `docusign-envelope-not-found` | log with envelopeId, skip envelope, continue |
| `getAgreementDetails` returns 404 for known agreementId | `source` + `docusign-agreement-not-found` | log with agreementId, skip agreement, continue |
| `getAllAgreements` or `getEnvelopes` response malformed / missing fields | `parse` | log, skip item, continue |
| getUserInfo returns no accounts | `auth` + `docusign-account-id-unresolved` | exit, release lock, retry next run |
| Cursor JSON not parseable | `parse` + `docusign-cursor-evicted` | reset both keys to null (bootstrap), log, continue |
| Per-run envelope cap (150) reached | `source` + `docusign-pagination-overflow` | log deferred count, advance envelopes_since to newest processed, exit step |
| Per-run agreement cap (100) reached | `source` + `docusign-pagination-overflow` | log deferred count, persist ctoken, continue to writes |
