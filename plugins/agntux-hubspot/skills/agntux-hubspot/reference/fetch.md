# Step 5 — Fetch from HubSpot CRM

Wholesale replacement of `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
All HubSpot-specific fetch detail lives here. Nothing here changes the step
numbering, the transactional cursor rule, or the 10-actions-per-run cap.

Do NOT hard-code portal-specific record ids, pipeline names, or stage names.
HubSpot has no unified event stream — each object type is queried independently
via `search_crm_objects`. All amounts are numeric strings in the deal's own
currency (`deal_currency_code`); do not convert.

---

## 5a. Resolve the current owner

Call `get_user_details()` once per run (cache result in working memory). Extract:
- `ownerId` → `hubspot_owner_id` filter value for all searches.
- Available object types → skip types the portal does not expose.

If no `ownerId` is returned, log `kind: hubspot-owner-unresolved`, release lock,
and exit. Do NOT proceed without an owner id.

**Persist.** Write the resolved `ownerId` to
`data/learnings/agntux-hubspot/sync.md` frontmatter (`owner_id`). On subsequent
runs, read from the sync file and skip `get_user_details` when `owner_id` is
already non-null and `last_success` is within 7 days.

---

## 5b. Capture portal id (bootstrap only)

On first run (`portal_id` absent from sync file), call
`get_organization_details()`. Extract `portalId` (integer) and write it as
`portal_id` to the sync file frontmatter. Required for deep-link URL
construction. Skip when already non-null.

---

## 5c. Determine query window per object type

For each object type, read its cursor entry (see `reference/cursor.md`):

- **Bootstrap** (`cursor[object_type]` absent or null): `filter_ts = now −
  bootstrap_window_days × 86400` (default 30 days; read from `user.md`
  `bootstrap_window_days` if set).
- **Incremental** (`cursor[object_type]` present): `filter_ts =
  cursor[object_type] − 30s` (30-second margin absorbs HubSpot indexing lag).

All `filter_ts` values are converted to millisecond epoch integers for the
`search_crm_objects` filter (`filter_ts_ms`). Log mode and value per type.

**Processing order within a run:** `deal → task → ticket → contact → company →
engagement`. Prioritises directly actionable work ahead of informational records.

---

## 5d–5i. Per-type search shape

All six object types share the same `search_crm_objects` call structure:

```
filterGroups: [{ filters: [
  { propertyName: <owner_prop>, operator: "EQ", value: "{owner_id}" },
  <status exclusion filter if applicable>,
  { propertyName: <modified_prop>, operator: "GTE", value: "{filter_ts_ms}" }
]}]
sorts: [{ propertyName: <sort_prop>, direction: <dir> }]
limit: <per-page limit>
```

Follow `paging.next.after` tokens until the per-type cap is reached. When a cap
is hit, log `kind: hubspot-pagination-overflow` with the object type and stop
fetching that type for this run.

Per-type parameters:

| Type | `owner_prop` | `modified_prop` | Status exclusion | `sort_prop` / dir | Cap |
|---|---|---|---|---|---|
| deal | `hubspot_owner_id` | `hs_lastmodifieddate` | `hs_is_closed NEQ true` | `hs_lastmodifieddate` / DESC | 100 |
| task | `hubspot_owner_id` | `hs_lastmodifieddate` | `hs_task_status NEQ COMPLETED` | `hs_lastmodifieddate` / DESC | 50 |
| ticket | `hubspot_owner_id` | `hs_lastmodifieddate` | `hs_pipeline_stage NOT_IN ["closed"]`* | `hs_lastmodifieddate` / DESC | 50 |
| contact | `hubspot_owner_id` | `lastmodifieddate` | — | `lastmodifieddate` / DESC | 50 |
| company | `hubspot_owner_id` | `hs_lastmodifieddate` | — | `hs_lastmodifieddate` / DESC | 30 |
| engagement | `hubspot_owner_id` | `hs_lastmodifieddate` | — | `hs_lastmodifieddate` / DESC | 30 |

\* If the `NOT_IN: ["closed"]` filter is rejected, omit the stage filter and
rely on the date window; flag only records where `closed_date` is null.

Note: contacts use `lastmodifieddate` (not `hs_lastmodifieddate`) for both the
filter and sort.

### Properties to request per type

Pass an explicit `properties` list on every call.

**deal:** `dealname, dealstage, pipeline, closedate, amount, deal_currency_code,
hs_lastmodifieddate, hubspot_owner_id, hs_deal_stage_probability, hs_is_closed,
hs_is_closed_won, notes_last_updated`

**task:** `hs_task_subject, hs_task_body, hs_task_status, hs_task_type,
hs_timestamp, hs_lastmodifieddate, hubspot_owner_id, hs_task_priority,
hs_queue_membership_ids`

**ticket:** `subject, content, hs_pipeline, hs_pipeline_stage,
hs_ticket_priority, hs_lastmodifieddate, hubspot_owner_id, hs_ticket_category,
closed_date, createdate`

**contact:** `firstname, lastname, email, phone, company, jobtitle,
hubspot_owner_id, lastmodifieddate, hs_lead_status, associatedcompanyid,
notes_last_updated, createdate`

**company:** `name, domain, industry, city, country, hubspot_owner_id,
hs_lastmodifieddate, numberofemployees, annualrevenue, notes_last_updated,
createdate`

**engagement:** `hs_engagement_type, hs_activity_type, hs_lastmodifieddate,
hubspot_owner_id, hs_createdate, hs_body_preview, hs_call_disposition,
hs_meeting_outcome, hs_email_subject`

### Signals to flag per type

**deal:** stage change (vs last-seen in entity `## Properties`); approaching
close (future `closedate` within 7 days on an open deal); slipping close (see
§Fix 3 rule below); `notes_last_updated` > 14 days ago on an open deal; amount
non-null and deal still open (threshold from `user.md` if set).

Close-date signal rules (Fix 3):
- Treat `closedate` equal to `""` (empty string) as absent/null — do not
  parse it as a date.
- `closedate` is a FUTURE date within 7 days → `action_class: deadline`
  ("approaching close").
- `closedate` is a PAST date on a deal where `hs_is_closed` is false →
  `action_class: risk` ("slipping — close date passed"). Do NOT classify
  this as "approaching close".
- `closedate` absent, null, or empty string → no close-date signal.

**task:** See task action-selection rules below (Fix 1).

**ticket:** stage change; priority `HIGH` or `CRITICAL`; ticket open with
`createdate` > 7 days ago and no `closed_date`.

**contact:** raise action only when `hs_lead_status` changes to a follow-up
stage (`IN_PROGRESS`, `OPEN`); contact created < 24 h ago; `notes_last_updated`
shows activity with no linked deal or task.

**company:** raise action only when newly created (< 48 h) or
`notes_last_updated` shows recent activity with no open deal attached.

**engagement:** call with `hs_call_disposition` indicating follow-up needed →
`response-needed`; meeting with `hs_meeting_outcome = COMPLETED` and next-step
language in body → `needs-decision`; outgoing email with no reply within 3 days
→ `response-needed`; note added by a colleague on a record the user owns →
`needs-decision`.

### Task action-selection rules (Fix 1)

The task fetch returns up to 50 open tasks sorted by `hs_lastmodifieddate DESC`
(most-recently-touched first). This sort ensures recently-touched tasks reach
the page cap before long-abandoned ones. After fetch, classify each task:

**Recency floor.** Action-raise eligibility is based on the DUE DATE only:
- `hs_timestamp` (due date, epoch ms) is in the FUTURE, OR
- `hs_timestamp` is in the past but the task is overdue by no more than
  `hubspot_task_stale_floor_days` days, measured from `hs_timestamp`.

The `hs_lastmodifieddate` field is NOT used in the action-raise decision.
HubSpot automations and workflows bump `hs_lastmodifieddate` on long-abandoned
tasks (including auto-generated review tasks) without making them newly
actionable. Recently-modified-but-long-overdue tasks still ingest as task
entities (knowledge), but do NOT raise an action.

The 14-day window is the default floor. It can be tuned via `user.md`
frontmatter key `hubspot_task_stale_floor_days` (integer); if set, use that
value instead of 14. Do NOT hardcode subject-string patterns to identify stale
tasks — the recency floor handles stale backlog generically across all portals.

**Classify each fetched task:**

| Condition | Classification | Raise action? |
|---|---|---|
| `hs_timestamp` in the future within 48 h | due-soon | YES — `action_class: deadline` |
| `hs_timestamp` in the future beyond 48 h | upcoming | NO (ingest as entity only) |
| `hs_timestamp` in the past, overdue by ≤ floor days (by due date) | overdue-recent | YES — `action_class: deadline` |
| `hs_timestamp` in the past, overdue by > floor days (by due date) | stale backlog | NO — ingest as entity only, do NOT raise action |
| No `hs_timestamp`, recently modified (`hs_lastmodifieddate` within floor) | active-untimed | Raise if body has actionable language → `needs-decision` |
| No `hs_timestamp`, NOT recently modified | stale backlog | NO |

**Action-selection priority when the 10-action cap binds.** After classifying
all fetched tasks, rank action-worthy tasks in this order before applying the
per-run cap:

1. Due-soon (future `hs_timestamp` within 48 h) — ordered by `hs_timestamp` ASC
   (soonest first).
2. Overdue-recent (past `hs_timestamp` within floor) — ordered by
   `hs_timestamp` DESC (closest to today's due date first, i.e. least overdue
   first).
3. Active-untimed — ordered by `hs_lastmodifieddate` DESC.

Stale-backlog tasks (no action raised) are still written to the knowledge store
as task entities in Step 7, but do NOT consume action slots.

---

## 5j. Deep-fetch via get_crm_objects (selective)

After the search passes, build a shortlist of records needing additional
properties not returned by `search_crm_objects`:
- Deals where `hs_deal_stage_probability` was not returned inline.
- Tasks where `hs_task_body` was truncated.

Call `get_crm_objects` with the object type and collected ids. Cap at **20
records per object type** per deep-fetch call; defer the remainder (the shallow
set is sufficient for Steps 6–8 classification).

---

## 5k. Resolve display names and stage labels (Fix 2)

### Owner display names

Call `search_owners` only for owner ids that do not belong to the current user
(e.g. a colleague who logged an engagement). Do not call `search_owners` for
the current user's own id.

### Pipeline stage labels

`search_crm_objects` returns `dealstage` and `hs_pipeline_stage` as raw
internal ids. These ids are:
- Named internal slugs on the default HubSpot pipeline (e.g.
  `appointmentscheduled`, `qualifiedtobuy`, `contractsent`).
- Bare numeric ids on custom pipelines (e.g. `137039182`, `1320018734`).

`search_properties` returns property metadata but does NOT include the
human-readable labels for enumerated stage options. Do NOT rely on
`search_properties` for stage label resolution.

**Correct approach — build a stage-label map once per run:**

For deals, call `get_crm_objects` with `objectType: "pipeline"` (or the
equivalent HubSpot pipelines endpoint via `query_crm_data` if the direct call
is unsupported) to retrieve all deal pipelines. For each pipeline, extract each
stage entry and build a two-level map:

```
stage_labels["deal"][pipeline_id][stage_id] = stage_label
```

For tickets, repeat for `objectType: "ticket_pipeline"` (or equivalent):

```
stage_labels["ticket"][pipeline_id][stage_id] = stage_label
```

Cache both maps for the run. When writing entity properties or action summaries,
always look up the human-readable label via:

```
stage_labels[object_type][pipeline_id][raw_stage_id]
```

**Fallback.** If a stage id cannot be resolved in the map (e.g. a newly created
custom stage not yet in the fetched pipeline list), humanize the raw id as a
last resort: split on underscores/hyphens, title-case each word, join with
spaces (e.g. `appointmentscheduled` → `Appointmentscheduled`; `137039182` →
`137039182`). Log the unresolved id as `hubspot-stage-unresolved` in the sync
debug log. NEVER display the raw stage id verbatim to the user without at least
this fallback humanization.

Apply the resolved label everywhere the stage appears: entity `## Properties`
sections, action item body, and `suggested_actions` label text.

---

## Thread and parent-child semantics

HubSpot records have no thread structure. Each record is an independent entity.
Engagements are linked to parent CRM objects via HubSpot associations, but the
ingest pass does not traverse associations — engagements carry their own
`hs_lastmodifieddate` and are surfaced directly. One entity per record.

---

## Source ID format

```
hubspot:{object_type}#{hs_object_id}
```

`hs_object_id` is the top-level `id` field returned by `search_crm_objects` and
`get_crm_objects`. Do not construct source ids from display names or email
addresses — `hs_object_id` is stable across renames.

Examples: `hubspot:deal#12345` · `hubspot:task#67890` · `hubspot:ticket#11111`
· `hubspot:contact#22222` · `hubspot:company#33333` · `hubspot:engagement#44444`

---

## Suggested actions

Deep-link URL pattern (using `portal_id` from step 5b):

```
https://app.hubspot.com/contacts/{portal_id}/{url_type}/{hs_object_id}
```

URL type segments: `deal` → `deal`, `contact` → `contact`, `company` →
`company`, `ticket` → `ticket`, `task` → `task`, `engagement` → `activity`.

| Object type | Action-worthy `host_prompt` | URL label |
|---|---|---|
| deal | `"Use the agntux-hubspot plugin to log activity on deal action {id}"` | "Open deal in HubSpot" |
| task | `"Use the agntux-hubspot plugin to mark task action {id} complete"` | "Open task in HubSpot" |
| ticket | `"Use the agntux-hubspot plugin to update ticket status for action {id}"` | "Open ticket in HubSpot" |
| contact | — (URL only) | "Open contact in HubSpot" |
| company | — (URL only) | "Open company in HubSpot" |
| engagement | — (URL only) | "Open activity in HubSpot" |

Emit `host_prompt` entries only for types where an action-worthy suggested
action exists (deal, task, ticket). All types emit an `url` open-in-HubSpot
entry using the deep-link pattern above.

---

## Failure modes

| Symptom | `kind` | Action |
|---|---|---|
| Auth error (401 / expired token) | `auth` | release lock, exit |
| Network failure | `network` | release lock, exit |
| Rate limit (429) | `source` + `hubspot-rate-limited` | stop fetching, release lock, exit |
| `get_user_details` returns no owner id | `hubspot-owner-unresolved` | release lock, exit |
| Required property absent from result | `hubspot-property-missing` | log property name, skip record, continue |
| Cursor entry malformed for one type | `hubspot-cursor-evicted` | reset that type to bootstrap, continue |
| Per-type cap hit | `hubspot-pagination-overflow` | log type + count, advance cursor for processed records, stop that type |
| Malformed JSON / missing fields in response | `parse` | log, skip item, continue |
| Object type unavailable on this portal | `source` | log type, skip, continue |
| Pipeline stage id not in label map | `hubspot-stage-unresolved` | log id + object type, apply fallback humanization, continue |

On any failure, log to `data/learnings/agntux-hubspot/sync.md → errors` (slice
to last 10 entries, newest-first). The transactional cursor rule in Step 11
ensures the cursor does not advance past successfully processed records only.
