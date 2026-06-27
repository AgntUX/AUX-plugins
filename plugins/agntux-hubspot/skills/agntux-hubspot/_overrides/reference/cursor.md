# Cursor semantics — agntux-hubspot
# Wholesale replacement of canonical reference/cursor.md for this plugin.

This file is the authoritative runtime cursor reference for `agntux-hubspot`. It
supersedes any cursor notes in `reference/sync.md` or `_overrides/frontmatter.yaml`
where those conflict with what is written here.

The strategy is a **per-object-type `hs_lastmodifieddate` high-water-mark map**:
each CRM object type the plugin monitors (deal, task, ticket, contact, company,
engagement) carries an independent ISO 8601 UTC timestamp representing the newest
`hs_lastmodifieddate` seen among records successfully processed in the last run.
Each type advances and recovers independently.

This differs from the single-global-cursor shape in
`canonical/prompts/ingest/cursor-strategies.md` (written for a simpler single-type
integration). The per-object-type map is required because the plugin queries each
type separately via `search_crm_objects`, caps each independently, and may hit
pagination limits on one type while completing another in the same run.

---

## 1. Cursor type and storage shape

**Type:** JSON object stored on a single line as the `cursor` key in
`data/learnings/agntux-hubspot/sync.md` frontmatter. Keys: lowercase singular CRM
object-type names (`deal`, `task`, `ticket`, `contact`, `company`, `engagement`).
Values: ISO 8601 UTC millisecond timestamps, e.g. `"2026-06-25T18:00:00.000Z"`.

**Absent key** means bootstrap mode for that type. `null` value is treated as absent.

`cursor: null` (top-level) means all types are in bootstrap mode.

Serialise the cursor object as a single JSON line with no indentation
(`JSON.stringify(obj)`). Never pretty-print — the sync file parser reads the
`cursor:` line atomically.

### Bootstrap state

```yaml
---
plugin: agntux-hubspot
version: 0.1.0
cursor: null
owner_id: null
portal_id: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

### Steady-state (after first successful run)

```yaml
---
plugin: agntux-hubspot
version: 0.1.0
cursor: {"deal":"2026-06-25T18:00:00.000Z","task":"2026-06-25T17:45:00.000Z","ticket":"2026-06-25T17:30:00.000Z","contact":"2026-06-25T16:00:00.000Z","company":"2026-06-25T15:00:00.000Z","engagement":"2026-06-25T18:00:00.000Z"}
owner_id: "12345678"
portal_id: "98765432"
last_run: "2026-06-25T18:05:22Z"
last_success: "2026-06-25T18:05:22Z"
items_processed: 47
lock: null
errors: (none)
---
```

---

## 2. Reading the cursor at Step 2

1. `null` → bootstrap mode for all types.
2. Valid JSON object (starts with `{`) → `JSON.parse`. Keys present with a
   non-null string are in incremental mode; absent or null keys are in bootstrap
   mode.
3. Present but neither null nor valid JSON → malformed. Log
   `hubspot-cursor-evicted` with the raw value and reason
   `"cursor top-level JSON malformed"`. Reset cursor to null; treat all types as
   bootstrap. The `_sources.json` lookup-before-write protocol prevents duplicate
   entity creation on re-processing.

---

## 3. Computing the query filter per type (Step 5c)

For each type processed this run, compute `filter_ts_ms` (epoch milliseconds
passed as the `hs_lastmodifieddate GTE` filter to `search_crm_objects`):

**Bootstrap mode** (key absent or null):

```
filter_ts_ms = floor((now − bootstrap_window_days × 86 400s).epochMs)
```

`bootstrap_window_days` is read from `user.md` frontmatter; default `30`.

**Incremental mode** (key present with a timestamp string):

```
filter_ts_ms = floor((parse(cursor[type]) − 30s).epochMs)
```

The **30-second safety margin** absorbs HubSpot's search-index lag (~20 s for
`hs_lastmodifieddate` updates). Overlapping re-fetches are harmless: the
`_sources.json` lookup-before-write protocol merges them rather than creating
duplicates. Never pass the raw stored timestamp directly as the filter value.

**Contacts note:** contacts use `lastmodifieddate` (not `hs_lastmodifieddate`) as
the modification property. Apply the same 30-second margin but pass the result
under `lastmodifieddate` in the filter group.

---

## 4. Advance rule (transactional, per type)

The cursor advances **only at Step 11, and only when every action write in the
current run has succeeded.**

**Per-type advance:** for each type processed this run, compute
`max(hs_lastmodifieddate)` (or `lastmodifieddate` for contacts) across all
records whose writes succeeded. This is the new `cursor[type]` value.
**Non-regression rule:** if the new max is ≤ the existing stored value, leave the
existing value unchanged. **Zero-record types** (query returned nothing above
`filter_ts`): leave that type's entry unchanged; do not advance to `now`.

All per-type updates are applied in a **single atomic write** at Step 11,
together with `last_success` and lock release. Do not write intermediate cursor
values during the run.

**Failure handling:** if any action write in Step 10 failed (validator rejection,
filesystem error, lock contention, retry budget exhausted): record each failure in
`sync.md → errors` (FIFO cap: last 10 entries), re-attempt once within the run,
and if any write is still failing **do not advance the cursor for any type**.
Leave `sync.md → cursor` entirely at its pre-run value. The next run re-processes
all types from the same pre-run thresholds, keeping the run boundary clean.

**Pagination-overflow exception:** when the per-type cap is hit mid-pagination
(section 5), advance that type's cursor to `max(hs_lastmodifieddate)` across
records already collected — even though the window was not exhausted. This is not
a write failure; the type's cursor still advances.

**Cursor diff log line (Step 11):**

```
cursor advance — added: contact×1 | advanced: deal×8, task×3, engagement×5 | evicted: (none) | skipped (write failure): (none)
```

- `added`: types whose key was absent and are written for the first time.
- `advanced`: types whose timestamp moved forward.
- `evicted`: types reset due to malformed value (section 8).
- `skipped (write failure)`: types not advanced due to the all-or-nothing rule.

Omit any clause whose count is zero.

---

## 5. Volume caps and pagination

Per-type record caps per run (enforced during the paginated fetch loop):

| Object type | Cap per run |
|---|---|
| deal | 100 |
| task | 50 |
| ticket | 50 |
| contact | 50 |
| company | 30 |
| engagement | 30 |

HubSpot's v3 CRM search API returns pages via `paging.next.after` tokens. For
each type, follow tokens until either no more pages remain or the per-type cap is
reached. When the cap is reached: stop fetching further pages for that type, log
`hubspot-pagination-overflow` with the object type and record count, and advance
that type's cursor using the pagination-overflow exception from section 4.
One type hitting its cap does not abort the run.

**Sort direction:** always sort `hs_lastmodifieddate ASCENDING` within each
paginated fetch. This processes the oldest records first; newest records in the
window are deferred. The 30-second margin on the next pass re-examines the
boundary.

**Combined 200-record cap:** if total records across all types in a single run
reaches 200, stop fetching additional types. Log `hubspot-pagination-overflow`.
Advance cursors for all types fully processed before the cap; apply the
pagination-overflow exception for any type mid-pagination; leave unstarted types
at their pre-run cursor values.

---

## 6. Bootstrap and onboarding-mode behaviour

**Standard bootstrap (individual type, `last_success` non-null):** fetch window
`hs_lastmodifieddate >= (now − bootstrap_window_days × 86 400s)`; per-type cap
from section 5; normal advance rule applies.

**First-run onboarding (`last_success: null` AND `cursor: null`):** the
Personalization State A wrap-up fires `/agntux-sync agntux-hubspot` synchronously
with the user present (target: < 60 seconds wall time).

- Process only `deal` and `task`. Leave `ticket`, `contact`, `company`,
  `engagement` keys absent; the first background run picks them up.
- Tighter per-type cap: **20 records** each for `deal` and `task`.
- Bootstrap window: default 30 days (same as steady state).

After the onboarding run the cursor map contains only the two processed types:

```json
{"deal":"2026-06-25T18:00:00.000Z","task":"2026-06-25T17:45:00.000Z"}
```

The background run treats the remaining four types as bootstrap under standard
per-type caps.

Do not apply the tighter onboarding cap when `last_success` is non-null and
`cursor` is null (manual reset). The onboarding cap triggers only on the combined
`last_success: null AND cursor: null` condition.

---

## 7. Meaningful-change dedup gate

HubSpot automation frequently touches `hs_lastmodifieddate` without changing
anything the plugin monitors. At Step 8, before raising an action item for a
record that already has an entity file (`_sources.json` lookup found), compare the
record's current **monitored property set** against the values stored in the
entity's `## Properties` section. If none changed, suppress the action item.

The gate applies to action-item creation only. `## Recent Activity` bullets may
still be updated even when the action-item gate fires. Noise-dropped records still
advance the cursor; they are not logged as errors and do not count toward the
10-action-items-per-run cap.

**Monitored properties per type** (raise action only if one of these changed):

| Object type | Monitored properties |
|---|---|
| deal | `dealstage`, `closedate`, `amount`, `hubspot_owner_id`, `hs_deal_stage_probability` |
| task | `hs_task_status`, `hs_task_priority`, `hs_task_body`, `hs_timestamp` |
| ticket | `hs_pipeline_stage`, `hs_ticket_priority`, `content` |
| contact | `hs_lead_status`, `email`, `hubspot_owner_id` |
| company | `name`, `domain`, `hubspot_owner_id` |
| engagement | `hs_engagement_type`, `hs_call_disposition`, `hs_meeting_outcome`, `hs_body_preview` |

The entity file's `## Properties` section is the prior-value record. No separate
content-hash store is maintained.

---

## 8. Gap recovery and cursor eviction

**Stale cursor (old but parseable):** HubSpot's `search_crm_objects` supports
arbitrary date ranges with no documented expiry window (unlike Gmail's 30-day
`historyId` purge). An old cursor causes a large catch-up batch; no
`hubspot-cursor-evicted` error. Process records ascending by `hs_lastmodifieddate`
up to the per-type cap, advance via the pagination-overflow exception, and defer
the remainder to the next scheduled run.

**Malformed per-type entry** (`cursor[type]` present but not a valid ISO 8601
timestamp string): log `hubspot-cursor-evicted` with the object type and the raw
value; reset that type's entry to null (bootstrap mode for that type only); leave
all other type entries unchanged; continue the run. The meaningful-change gate
(section 7) limits noise from re-processing.

**Malformed top-level JSON** (`JSON.parse` throws): log `hubspot-cursor-evicted`
with reason `"cursor top-level JSON malformed"`; reset `cursor` to null; continue
with the standard per-type caps from section 5 (not the onboarding caps —
this is not a first-ever run).

Do NOT reset the entire cursor map when only one type's entry is malformed.

---

## 9. Tracked-parent registry — NOT needed for HubSpot

The source-semantics advisor's key question: when a new engagement (note, call,
meeting) is logged against a CRM record, does the parent's `hs_lastmodifieddate`
bump?

For HubSpot: engagements are independent CRM objects with their own
`hs_lastmodifieddate`; they surface via the `engagement` cursor key directly.
A new note on a deal does NOT bump the deal's `hs_lastmodifieddate`, but the
engagement itself is fetched independently. No tracked-parent registry is needed.

`source_id` for every HubSpot entity is `hubspot:{object_type}#{hs_object_id}`.
Entity dedup is purely by `(subtype, source: "hubspot", source_id:
"hubspot:{type}#{id}")`. No parent-keyed variant exists.

---

## 10. Worked examples

### Example A — Normal incremental run

Prior cursor:

```
cursor: {"deal":"2026-06-25T12:00:00.000Z","task":"2026-06-25T11:45:00.000Z","ticket":"2026-06-25T10:00:00.000Z","contact":"2026-06-25T09:00:00.000Z","company":"2026-06-24T18:00:00.000Z","engagement":"2026-06-25T12:00:00.000Z"}
```

This run: deals (8 records, newest `2026-06-25T18:00:00.000Z`), tasks (3 records,
newest `2026-06-25T17:45:00.000Z`), engagements (5 records, newest
`2026-06-25T18:00:00.000Z`). Tickets, contacts, companies returned zero records.
All writes succeed.

New cursor:

```
cursor: {"deal":"2026-06-25T18:00:00.000Z","task":"2026-06-25T17:45:00.000Z","ticket":"2026-06-25T10:00:00.000Z","contact":"2026-06-25T09:00:00.000Z","company":"2026-06-24T18:00:00.000Z","engagement":"2026-06-25T18:00:00.000Z"}
```

`ticket`, `contact`, `company` unchanged (zero records). Cursor diff line:

```
cursor advance — advanced: deal×8, task×3, engagement×5
```

---

### Example B — First-run onboarding

Prior cursor: `null`. `last_success: null`. Onboarding cap applies.

This run: deals (20 records cap hit, newest `2026-06-25T18:00:00.000Z`), tasks
(14 records, newest `2026-06-25T17:45:00.000Z`). `ticket`, `contact`, `company`,
`engagement` keys left absent. All writes succeed.

New cursor:

```
cursor: {"deal":"2026-06-25T18:00:00.000Z","task":"2026-06-25T17:45:00.000Z"}
```

Cursor diff line:

```
cursor advance — added: deal×20 (cap hit; onboarding), task×14
```

Next background run: four absent types enter standard bootstrap.

---

## 11. Sync state frontmatter keys (complete reference)

| Key | Type | Description |
|---|---|---|
| `cursor` | JSON object (one line) or null | Per-object-type high-water-mark map. Keys: `deal`, `task`, `ticket`, `contact`, `company`, `engagement`. Values: ISO 8601 UTC millisecond timestamps. Null at bootstrap. |
| `owner_id` | string or null | HubSpot owner id (`get_user_details`). Written once; reused across runs. |
| `portal_id` | string or null | HubSpot portal id (`get_organization_details`). Written once on bootstrap; required for deep-link URLs. |
| `lock` | ISO 8601 string or null | Soft lock timestamp. Null when idle. Stale after 1 hour. |
| `last_run` | ISO 8601 string or null | Timestamp of most recent run attempt (success or failure). |
| `last_success` | ISO 8601 string or null | Timestamp of last run where every action write succeeded and cursor advanced. |
| `items_processed` | integer | Count of records processed (not noise-dropped) in the last run. |
| `errors` | list | Last 10 error/debug entries, FIFO-bounded, newest first. |
