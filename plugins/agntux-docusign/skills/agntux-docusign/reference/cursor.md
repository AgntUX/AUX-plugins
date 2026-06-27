# Cursor advance reference — agntux-docusign (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

DocuSign uses a **dual-key JSON object** cursor with two independent
sweeps that advance under separate rules. The two keys — `envelopes_since`
and `agreements_ctoken` — differ in both value type and advance semantics.

---

## Strategy name

**Dual-key JSON object: timestamp watermark (envelopes) + opaque continuation
token (agreements)**

The two keys map to two structurally independent ingest sweeps run in the same
pass (Step 5b and Step 5c respectively). Each sweep can succeed or fail
independently. Advance semantics are therefore per-phase, not all-or-nothing.

---

## Cursor shape

The cursor is a **JSON object serialised as a single-line string** on
`sync.md → cursor`. Never a multi-line YAML mapping. `validate-cursor.mjs`
accepts the JSON-string form and rejects any write that regresses
`envelopes_since` to an earlier timestamp.

| Key | Type | Meaning |
|---|---|---|
| `envelopes_since` | ISO-8601 UTC string or `null` | Newest `lastModifiedDateTime` seen across all envelopes processed this run. Passed as `from_date` to `getEnvelopes` on the next incremental run. `null` triggers bootstrap (`now − bootstrap_window_days` days). |
| `agreements_ctoken` | Opaque string or `null` | Continuation token from the most recent `getAllAgreements` call. `null` means fresh sweep from the top. Non-null means a prior sweep paused mid-page; resume from this position. Reset to `null` on natural sweep completion. |

Parse the cursor JSON at Step 2. If `cursor` is `null` or unparseable, log
`docusign-cursor-evicted` (kind: `parse`) and treat both keys as `null`.
Do NOT abort the run on a malformed cursor — fall back to bootstrap and continue.

Bootstrap state: `cursor: null`. After first successful run:
```
cursor: '{"envelopes_since":"2026-06-26T10:00:00Z","agreements_ctoken":null}'
```
Mid-sweep (cap hit, agreements paused):
```
cursor: '{"envelopes_since":"2026-06-26T11:00:00Z","agreements_ctoken":"ABCxyz..."}'
```

---

## Advance rule — `envelopes_since` (Step 5b watermark)

`envelopes_since` is a **high-water-mark** on `lastModifiedDateTime`:

```
new envelopes_since = max(lastModifiedDateTime)
  across ALL envelopes processed in Step 5b this run
  (main cursor-window sweep only — in-flight re-sweep is excluded)
```

"Processed" means evaluated through triage, including noise-suppressed
envelopes. Envelopes whose writes failed do NOT contribute to the new mark.

**Inclusive boundary:** DocuSign's `from_date` is inclusive. An envelope
whose `lastModifiedDateTime` equals the stored cursor will surface again; the
dedup check at Step 9 (`actions/_index.md` on `source_id: "envelope:{envelopeId}"`)
suppresses the duplicate. No off-by-one correction is needed at the cursor level.

**Pagination overflow (150-envelope cap):** when the cap fires mid-page,
advance `envelopes_since` to `max(lastModifiedDateTime)` among envelopes
actually processed (not the newest in the full window). Log
`docusign-pagination-overflow` (kind: `source`) with the deferred count.
The next run picks up from the advanced mark; no envelopes are permanently
skipped because `from_date` is inclusive.

**Zero-envelope run:** leave `envelopes_since` unchanged. Not an error.

### In-flight re-sweep does NOT advance the cursor

The in-flight re-sweep (second `getEnvelopes` call with `status: "sent"` and
no `from_date`) reads envelopes whose `lastModifiedDateTime` may be older than
`envelopes_since`. This is intentional — long-open envelopes that have not
changed recently still need visibility.

**The in-flight sweep must not contribute to `envelopes_since` advance.**
Including pre-cursor timestamps in the `max()` would silently regress the
cursor. The rule:

- Collect in-flight sweep results.
- Run triage and dedup (Step 9) normally — duplicates suppressed, new
  stuck-envelope actions raised.
- Do NOT include any `lastModifiedDateTime` from in-flight results in the
  `max()` for `envelopes_since`.

Step 9 dedup (`actions/_index.md` on `source_id`) is the sole gate that
prevents re-raising an already-open action for an in-flight envelope.

---

## Advance rule — `agreements_ctoken` (Step 5c continuation token)

`agreements_ctoken` is a **paging continuation token**, not a timestamp.
Its lifecycle is bounded by sweep completion, not by processed-item timestamps:

1. **Each run, Step 5c:** pass `cursor.agreements_ctoken` (null or opaque
   string) as `ctoken` to `getAllAgreements`. Collect the ctoken from the response.
2. **Sweep completed naturally** (response carries no ctoken or empty ctoken):
   reset `agreements_ctoken` to `null`. The next run starts a fresh sweep from
   the top. Already-raised actions are suppressed by dedup at Step 9.
3. **Sweep paused by per-run cap (100 agreements):** persist the last received
   ctoken to `agreements_ctoken`. The next run resumes at this position.
4. **Navigator capability absent (403 `EnableNavigatorAPIDataOut`):** see the
   dedicated section below. `agreements_ctoken` is left UNCHANGED.

**Why no timestamp watermark for agreements:** `getAllAgreements` does not
expose a server-side date filter. Using `metadata.created_at` as a client-side
filter would miss agreements whose expiration date crossed a threshold since
their creation. The ctoken continuation + fresh-sweep pattern ensures every
agreement is re-evaluated for date-based signals on each full sweep cycle.

---

## Navigator capability detection — graceful skip (Step 5c)

DocuSign's `getAllAgreements` requires the Navigator add-on
(`EnableNavigatorAPIDataOut`). Accounts without Navigator receive a **403**
whose error body references `EnableNavigatorAPIDataOut`. This is the common
case for users on standard DocuSign plans.

When Step 5c receives a 403 with `EnableNavigatorAPIDataOut` in the error code
or message:

- **`agreements_ctoken` is left UNCHANGED.** Neither advanced nor reset. Do
  not modify the key in any direction.
- **The run is still considered successful for cursor purposes.** The envelope
  phase outcome determines whether `envelopes_since` advances; the
  capability-absent 403 in the agreements phase does not block that advancement.
- **`last_success` is updated** at Step 11 as if both phases completed normally.

This is a **feature-gating response**, not a credential failure. It must not
be treated as an auth error that holds both cursors. The envelope phase is
unaffected and its cursor advances independently.

### No-op on subsequent runs

Once detected, Step 5c must no-op cleanly on every subsequent run until
Navigator availability changes:

1. At Step 11, set `navigator_unavailable: true` in `sync.md → learnings`.
   This is a co-resident frontmatter key, not part of the cursor JSON object.
2. On each subsequent run, read `sync.md → learnings.navigator_unavailable`
   at Step 2. If `true`, skip Step 5c entirely — do not call `getAllAgreements`.
3. Log `docusign-navigator-unavailable` (kind: `source`) exactly **once** at
   the first detection run. Do not repeat on subsequent skipped runs.
4. If a future run finds `navigator_unavailable: true` but the user has since
   enabled Navigator, the first `getAllAgreements` call will succeed — clear
   `navigator_unavailable` (set to `false`) in the same Step 11 write that
   records the agreements ctoken.

`navigator_unavailable` persists independently of cursor resets. Clearing the
cursor for gap recovery does NOT re-probe Navigator availability.

---

## Transactional advance rule (per-phase gating)

Advance is **per-phase**, not all-or-nothing. A Navigator-absent skip counts
as agreements-phase success, so `envelopes_since` is never blocked by a
missing Navigator add-on.

| Phase | Scope | Phase succeeds when |
|---|---|---|
| Step 5b (envelopes) | All `getEnvelopes` paging, selective `getEnvelope` / `listRecipients` / `listEnvelopeDocuments` calls, and all envelope action writes | Every action write completed without error after retry |
| Step 5c (agreements) | All `getAllAgreements` paging, selective `getAgreementDetails` calls, and all agreement action writes | Every action write completed without error after retry, **OR** the phase was skipped due to Navigator capability being absent (counts as phase success) |

- `envelopes_since` advances at Step 11 **if and only if the envelope phase
  succeeded**. If envelope writes failed after retry, `envelopes_since` stays
  at its pre-run value; `agreements_ctoken` may still advance independently.
- `agreements_ctoken` advances at Step 11 **if and only if the agreements
  phase succeeded**. If agreement writes failed after retry, `agreements_ctoken`
  stays at its pre-run value.

The two sweeps are structurally independent: a rate-limit on `getAllAgreements`
should not prevent the envelope cursor from advancing, and vice versa.

Record each phase failure in `sync.md → errors` (FIFO-capped to last 10,
newest-first). The lock is always released in Step 11 regardless of phase outcomes.

---

## Onboarding mode (bootstrap)

Detect "first run ever" as `last_success is null AND cursor is null`.

- **`envelopes_since` bootstrap:** use `now − bootstrap_window_days` as
  `from_date`. Default `bootstrap_window_days` is 30 (from `frontmatter.yaml`).
- **Standard per-run caps apply from the first run:** 150 envelopes (Step 5b)
  and 100 agreements (Step 5c). DocuSign volumes are typically low, so no
  tighter first-run scope is required.

If a user has an unusually large DocuSign footprint (detected by
`docusign-pagination-overflow` on the first run), subsequent scheduled runs
drain the backlog monotonically without special handling.

---

## Gap recovery

| Condition | Detection | Recovery |
|---|---|---|
| Null cursor | `cursor: null` | Bootstrap both keys: `now − bootstrap_window_days` for `envelopes_since`; `null` ctoken for fresh agreements sweep. |
| Cursor JSON unparseable | `JSON.parse` throws | Log `docusign-cursor-evicted` (kind: `parse`). Treat both keys as `null`. Bootstrap both sweeps. Dedup at Step 9 suppresses duplicate action creation. |
| `envelopes_since` regresses | `validate-cursor.mjs` rejects write | Do not write the cursor; log `internal` error. Pre-regression cursor value remains; no envelopes permanently skipped. |
| Agreements ctoken stale or invalid | `getAllAgreements` errors on non-null ctoken | Log `source` error. Reset `agreements_ctoken` to `null`; restart sweep from top in same run if budget allows, or defer to next run. |
| Navigator absent (403 `EnableNavigatorAPIDataOut`) | First 403 with `EnableNavigatorAPIDataOut` error code | Log `docusign-navigator-unavailable` (kind: `source`) once. Leave `agreements_ctoken` UNCHANGED. Set `learnings.navigator_unavailable: true`. `envelopes_since` advances per envelope-phase outcome. Skip Step 5c on subsequent runs until flag cleared. |
| DocuSign account ID absent | `sync.md → account_id` null and `getUserInfo` fails | Log `docusign-account-id-unresolved` (kind: `auth`). Exit immediately; do not advance either cursor key. |

---

## Cursor-lifetime identity field — `account_id`

`account_id` is co-resident with the cursor in `sync.md` frontmatter but is
NOT part of the cursor JSON object. Resolved once at Step 5a on the first run
(from `getUserInfo → accounts[0].account_id`) and persisted in the same atomic
Step 11 write as the cursor. On subsequent runs it is read from
`sync.md → account_id` directly. `account_id` survives cursor resets.

```yaml
account_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
cursor: '{"envelopes_since":"2026-06-26T10:00:00Z","agreements_ctoken":null}'
```

---

## No tracked-parent registry

DocuSign envelopes have no threading. The cursor object contains exactly
`envelopes_since` and `agreements_ctoken` and nothing else. The
`<container_id>#<parent_id>` tracked-parent key shape must not be created.

---

## No auto-learned denylist

DocuSign is a low-volume, high-signal source. Every envelope is a signing
workflow or status update. The user's `# Never raise` curation in
`data/instructions/agntux-docusign.md` is sufficient.

---

## Workspace identifier capture

Deep-link URL pattern: `https://app.docusign.com/documents/details/{envelopeId}`

No per-tenant subdomain appears in this URL. `account_id` is used for API calls
but not for permalink construction. No workspace identifier capture step or
extra frontmatter key is required.

Do not use signing-ceremony URLs (per-recipient, single-use, expire quickly)
for `suggested_actions`. Always use the `documents/details/{envelopeId}` permalink.

---

## Cursor diff log entry format (Step 11)

```
cursor advance — envelopes: <old> → <new>, agreements_ctoken: <null|resumed|complete|held>
```

First run (both sweeps complete):
```
cursor advance — envelopes: null → "2026-06-26T10:00:00Z", agreements_ctoken: null → null (sweep complete)
```

Navigator capability absent (agreements phase skipped; envelope cursor still advances):
```
cursor advance — envelopes: "2026-06-26T10:00:00Z" → "2026-06-26T12:05:00Z", agreements_ctoken: (unchanged; navigator_unavailable — phase skipped)
```

---

## `_sources.json` lookup-before-write protocol

The standard lookup-before-write protocol (Step 6) applies. Key points:

- **Envelope entities** (`subtype: envelope`, `source: docusign`,
  `source_id: "envelope:{envelopeId}"`): `envelopeId` is stable and unique
  per account. Merge on match; do not create duplicates.
- **Agreement entities** (`subtype: agreement`, `source: docusign`,
  `source_id: "agreement:{agreementId}"`): same stability guarantee.
  `envelope:` and `agreement:` namespaces are distinct and will not collide.
- **Person entities** (signers, recipients): anchor on email address. Call
  `listRecipients` to extract signer emails when not already available. Look
  up by `(subtype: person, source: docusign, source_id: "<email>")` first,
  then by email alias. Do not create a self-entity for the connected user's
  own email (read from `user.md`).

Do NOT write to `_sources.json` directly — the agntux-core PostToolUse hook
owns it.

---

## sync.md templates

### Bootstrap state

```yaml
---
plugin: agntux-docusign
version: 0.1.0
account_id: null
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

### After a run where Navigator is absent (agreements phase skipped; envelope cursor advances)

```yaml
---
plugin: agntux-docusign
version: 0.1.0
account_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
cursor: '{"envelopes_since":"2026-06-26T12:05:00Z","agreements_ctoken":null}'
last_run: "2026-06-26T12:05:22Z"
last_success: "2026-06-26T12:05:22Z"
items_processed: 7
lock: null
learnings:
  navigator_unavailable: true
errors:
  - kind: source
    code: docusign-navigator-unavailable
    at: "2026-06-26T12:05:22Z"
    message: "getAllAgreements returned 403 EnableNavigatorAPIDataOut; agreements phase skipped; agreements_ctoken unchanged"
---
```

- `last_success` is updated — a Navigator-absent skip is a successful run.
- `envelopes_since` advanced to the newest envelope processed this run.
- `agreements_ctoken` unchanged (the token is never touched by the skip).
- `learnings.navigator_unavailable: true` suppresses Step 5c on subsequent
  runs until cleared on the first successful `getAllAgreements` call.
- The error entry is written once (first detection). Subsequent no-op runs
  do not append a new error entry.
