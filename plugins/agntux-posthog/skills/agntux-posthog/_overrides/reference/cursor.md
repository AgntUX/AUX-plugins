# Cursor advance reference — agntux-posthog (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

PostHog uses a **per-resource ISO-8601 UTC timestamp map** strategy: one JSON
object stored on the `sync.md → cursor` line, with one key per resource type.
There is no single global cursor; each resource type advances independently.

---

## Strategy name

**Per-resource timestamp map (multi-resource fan-out)**

This strategy applies when:

- The source exposes multiple independent resource types, each with its own
  natural recency field (`last_seen`, `fired_at`, `updated_at`, `created_at`).
- There is no single server-side change feed or global sequence token that
  covers all resource types uniformly.
- A failure in one resource type must not prevent other resource types from
  advancing their own cursors (fault-isolation requirement).

PostHog satisfies all three conditions. Five resource types — error issues,
alerts, experiments, comments, and inbox reports — have distinct API endpoints
and distinct recency fields. A single scalar cursor would either regress when
the slowest resource type stalls or advance beyond what the stalled type has
processed, causing a gap. A single ETag or opaque token is not offered by the
PostHog API across resource types. The per-resource map is the only correct
design.

---

## Why not a single scalar timestamp?

A single high-water-mark would use the minimum of all five resource types'
newest timestamps to stay conservative, meaning a quiet inbox (no new reports
for days) would hold back cursor advancement for busy error issues and alerts.
Alternatively, using max would advance past items on slow resource types,
creating permanent gaps. Neither is acceptable. The per-resource map avoids
both failure modes by letting each resource type advance at its own pace.

## Why not per-item keys in the cursor map?

PostHog resource types have no Slack-style threading requirement where old
parents resurface with new children via a cursor that does not bump. Error
issues DO have a merge/split edge case (see below), but that is handled by
evicting the merged-away id from `_sources.json` rather than by tracking each
issue id in the cursor map. A map of per-item id → last-seen timestamp would
grow unboundedly (PostHog projects accumulate thousands of error issues) and
is unnecessary. The per-resource-type map with exactly five keys is the
correct granularity.

## Why not a tracked-parent registry?

The question from the source-semantics advisor: "when a new reply lands on an
old parent, does the parent's cursor field bump?"

For PostHog:

- **Error issues** — yes. A new occurrence or assignment on an existing issue
  bumps `last_seen`. The per-resource cursor catches it automatically; no
  parent registry needed.
- **Experiments** — yes. Any state change (significance reached, end date
  updated) bumps `updated_at`. No parent registry needed.
- **Alerts** — yes. A new firing of an alert produces a new `fired_at`
  timestamp. No parent registry needed.
- **Comments** — comments have a `created_at` fixed at creation. However,
  comment threads are fetched in full (via `comment-thread`) at the time the
  root comment is processed; subsequent replies on the same root comment id
  are NOT re-fetched unless the root comment's `created_at` exceeds the
  cursor (which it never will after first ingest, since `created_at` is
  immutable). This means late replies on old comments are **not tracked
  incrementally**. The consequence is accepted: comments have a short
  attention window (you reply or dismiss within days) and the 7-day bootstrap
  window covers reasonable catch-up. A parent registry for comment threads
  would be over-engineered for this source's noise level.
- **Inbox reports** — `created_at` is immutable; once ingested, a report is
  not re-fetched unless the user dismisses and a new report appears. No
  parent registry needed.

**Conclusion:** No tracked-parent registry. No `#`-keyed entries in the cursor
map. The map holds exactly five keys.

---

## Cursor shape

```yaml
# data/learnings/agntux-posthog/sync.md — bootstrap state
cursor: null
last_success: null
```

```yaml
# After the first successful run across all resource types
cursor: '{"errors":"2026-06-19T10:00:00Z","alerts":"2026-06-19T09:45:00Z","experiments":"2026-06-18T14:30:00Z","comments":"2026-06-19T10:00:00Z","inbox":"2026-06-19T08:00:00Z"}'
```

The cursor is a **JSON object serialised as a single-line string** on the
`sync.md → cursor` key. Each key within the JSON object corresponds to a
PostHog resource type:

| Key | Resource type | Recency field tracked |
|---|---|---|
| `errors` | Error tracking issues | `last_seen` (ISO-8601 UTC) |
| `alerts` | Fired alerts | `fired_at` (ISO-8601 UTC) |
| `experiments` | Experiments | `updated_at` (ISO-8601 UTC) |
| `comments` | Comments and mentions | `created_at` (ISO-8601 UTC) |
| `inbox` | Inbox flagged reports | `created_at` (ISO-8601 UTC) |

All timestamp values in the map are ISO-8601 UTC strings (e.g.
`"2026-06-19T10:00:00Z"`). The `validate-cursor.mjs` hook treats each key
independently as a monotonically-advancing low-water-mark and will reject any
write that regresses an existing key's value.

Parse the cursor JSON at Step 2. If `cursor` is `null` (bootstrap), treat all
five keys as individually null. If `cursor` is a valid JSON object but a
specific key is absent, treat that key as null for this run and initialise it
on the first successful write for that resource type.

If the cursor value is present but not parseable as JSON, log
`posthog-cursor-evicted` (kind: `source`) to `sync.md → errors` and treat all
keys as null, falling back to the bootstrap window for every resource type.

---

## Bootstrap window (first run)

Bootstrap state is `cursor: null AND last_success: null`.

On bootstrap, for each resource type, fetch items where the recency field falls
within `(now − bootstrap_window_days days, now]`. The default
`bootstrap_window_days` is **7** (declared in `frontmatter.yaml`).

The 7-day window is appropriate for PostHog because:

- Error issues older than 7 days are typically already triaged or noise.
- Fired alerts older than 7 days are stale and do not require acknowledgement.
- Experiments are long-running but `updated_at` gates the window, so only
  recently-updated experiments are surfaced.
- Comments requiring a response that are older than 7 days have likely been
  handled or abandoned.
- Inbox reports older than 7 days are typically already dismissed upstream.

The 7-day window keeps the first-run interaction snappy (target <1 minute for
the Personalization State A wrap-up `sync` call). PostHog projects are not
typically high-volume relative to Gmail or Slack; a 7-day window does not
require additional onboarding-mode tightening beyond the per-resource caps
declared in `fetch.md` (50 error issues, 30 alerts, 20 experiments, 40
comments, 20 inbox reports).

If a resource type's bootstrap fetch returns zero items within the window, that
key is initialised to `null` and the first run that yields items sets the
initial value.

---

## Advance rule — per-resource

Each resource type advances its own key independently in Step 11.

### Incremental run (key non-null)

1. At Step 5 time, the value of `cursor.{key}` is in scope from Step 2.
2. Filter the fetched list for items where the recency field is **strictly
   greater than** `cursor.{key}`. Strict greater-than prevents re-processing
   the boundary item on every subsequent run.
3. After all action writes for that resource type have succeeded this run
   (transactional rule — see below), advance `cursor.{key}` to:
   `max(recency_field across all items of that type successfully processed this run)`

### Bootstrap run (key null)

Filter for items where the recency field falls within the bootstrap window
`(now − bootstrap_window_days days, now]`. After all writes succeed, advance
`cursor.{key}` to `max(recency_field)` across items processed.

### Why max-across-run, not start-of-run

The PostHog connector does not offer a `since` / `after` timestamp filter on
all endpoints. Even where it does, using start-of-run would cause items created
or updated between Step 4's `now` capture and end-of-run to be missed on the
next pass (they predate the next run's start timestamp but postdate the current
run's). Using max-of-processed-items guarantees the next run's filter threshold
is exactly the newest item seen.

### Per-resource-type volume caps (from fetch.md)

| Resource type | Per-run cap |
|---|---|
| Error issues | 50 (paged) |
| Alerts | 30 (paged) |
| Experiments | 20 (paged) |
| Comments | 40 (paged) |
| Inbox reports | 20 (paged) |

When a resource type returns more items than its cap after the cursor filter is
applied, sort ascending by recency field (oldest first) and process only the
first N items (the cap). Advance the key to the recency field of the last item
processed. The next scheduled run picks up from that threshold and continues
processing the remainder.

---

## Transactional cursor advance (Step 11 rule)

Each resource type's key advances **only when every action write for that
resource type this run succeeded**. Fault isolation is per-resource-type:

- If all error-issue writes succeeded and all alert writes succeeded but one
  experiment write failed, `cursor.errors` and `cursor.alerts` advance;
  `cursor.experiments` does NOT advance. The next run retries all experiments
  from the pre-run `cursor.experiments` value.
- If an auth failure aborts the run mid-way, no keys advance regardless of how
  many resource types had already completed successfully. Auth failure is a
  whole-run abort; the lock is released and all keys stay at their pre-run
  values.
- A rate-limit (HTTP 429) on a single resource type causes that type to be
  logged as `posthog-rate-limited` (kind: `source`) and skipped. The remaining
  resource types continue and advance their own keys. The rate-limited type's
  key does not advance.

The Step 11 cursor diff log line format (per-resource-type map):

```
cursor advance — advanced: errors×1, alerts×1 | skipped: experiments (rate-limited) | unchanged: comments×0, inbox×0
```

When a key transitions from null to its first value:

```
cursor advance — added: inbox (null → 2026-06-19T08:00:00Z)
```

When keys are evicted (see error-issue merge/split below):

```
cursor advance — advanced: errors×1 | evicted: (none — eviction applies to _sources.json, not cursor map)
```

---

## Idempotency and deduplication

The cursor's strict-greater-than filter is the primary idempotency mechanism:
an item whose recency field equals or predates `cursor.{key}` is silently
skipped and never re-fetched into the action-worthiness pipeline.

A secondary deduplication check at Steps 8–9 catches the rare case where a
source-side clock anomaly or connector delay causes an item to surface again
despite the cursor filter. Before raising any action item, look up the
candidate `source_id` (`posthog:{project_id}:{resource_type}:{resource_id}`)
in `_sources.json` and in `actions/_index.md`:

- An existing **open** action with the same `source_id` is treated as the same
  item. Do NOT raise a new action. Update the entity body if the upstream state
  has changed (e.g., error issue occurrence count increased; experiment
  significance newly reached).
- An existing **closed or dismissed** action with the same `source_id` may be
  raised again if the upstream item is in a new actionable state (e.g., a
  resolved error issue regressed to active with higher occurrence count).
- No existing action → create a new action item normally.

This prevents duplicate actions for the same fired alert or same error issue
across consecutive 60-minute runs even when the connector returns overlapping
pages at page boundaries.

---

## Error-issue merge/split edge case

PostHog error tracking allows issues to be merged (two issues are merged into
one, with one id surviving) or split (one issue is split into two new ids, the
original id is retired). These operations are permanent: the merged-away or
split-original id will stop appearing in `query-error-tracking-issues-list`
results.

### Merged-away id

When issue B is merged into issue A:

- Issue B's id disappears from the active issues list.
- Issue A's id continues with a higher occurrence count and a newer `last_seen`.
- Any open action item referencing `posthog:{project_id}:error:{B_id}` becomes
  a stale reference.

**Handling:**

1. At Step 5a, after fetching the full active issues list, cross-reference
   against any open action items in `actions/_index.md` whose `source_id`
   matches `posthog:{project_id}:error:*`. If a previously-seen issue id is
   absent from the current active list, AND it was last seen within
   `bootstrap_window_days` days (i.e., it is not simply aging out of the
   bootstrap window), log a `posthog-merged-into` entry in `sync.md → errors`
   (kind: `source`) with the missing id.
2. The orphaned action item is NOT automatically closed — a merge might be a
   sync delay. If the id is absent for two consecutive runs, update the
   entity's body to note "this error issue may have been merged or resolved in
   PostHog" and mark the action as `needs-review` rather than closed, leaving
   the final decision to the user.
3. Remove the merged-away `source_id` from `_sources.json` via the standard
   PostToolUse hook on the next entity write. Do NOT write `_sources.json`
   directly. The cursor map itself carries no per-issue keys, so there is
   nothing to evict from the cursor map.

### Split-original id

When issue A is split into issues B and C:

- Issue A's id disappears from the active list.
- Issues B and C appear as new ids with `last_seen` timestamps that likely
  fall within the current bootstrap window or above `cursor.errors`.
- Issues B and C will be picked up naturally on the next run where their
  `last_seen` exceeds `cursor.errors`.

**Handling:** the same orphaned-id logic above applies to A. Issues B and C
are new items caught by the normal cursor advance. No special handling is
required beyond the orphaned-id check.

### Why the cursor map requires no special handling for merge/split

The cursor map holds only resource-type-level cursors, not per-item id keys.
A merged-away id does not leave a dangling cursor entry. The only residue is
in `_sources.json` (managed by the PostToolUse hook) and in
`actions/_index.md` (managed by the orphaned-id check above). The cursor map
itself remains clean.

---

## Workspace identifier capture

PostHog's deep-link URL template requires the `project_id` as a workspace
scope token:

```
https://app.posthog.com/project/{project_id}/{resource_path}
```

The `project_id` is read from `user.md → posthog_project_id` at Step 5. It
does not need to be captured from API responses and persisted — the user has
already configured it. It is stable per tenant and does not change between
runs. No separate workspace-identifier capture step is needed.

If `project_id` is absent from `user.md`, log `posthog-project-not-found`
(kind: `source`) and exit; all resource types are skipped and no cursor keys
advance.

---

## No auto-learned denylist

PostHog is not a high-volume noise source in the way Gmail is. The five
resource types surface targeted signals (error spikes, fired alerts, experiment
results, direct mentions, flagged reports) rather than a broad inbox. The
noise floor is low enough that explicit `# Never raise` curation in
`data/instructions/agntux-posthog.md` is sufficient. The auto-learned denylist
pattern is not applied to this plugin.

---

## sync.md template

Bootstrap state:

```yaml
---
plugin: agntux-posthog
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful run across all resource types:

```yaml
---
plugin: agntux-posthog
version: 0.1.0
cursor: '{"errors":"2026-06-19T10:00:00Z","alerts":"2026-06-19T09:45:00Z","experiments":"2026-06-18T14:30:00Z","comments":"2026-06-19T10:00:00Z","inbox":"2026-06-19T08:00:00Z"}'
last_run: "2026-06-19T11:00:01Z"
last_success: "2026-06-19T11:00:01Z"
items_processed: 23
lock: null
errors: (none)
---
```

After a run where one resource type was rate-limited (experiments skipped):

```yaml
---
plugin: agntux-posthog
version: 0.1.0
cursor: '{"errors":"2026-06-19T12:00:00Z","alerts":"2026-06-19T11:45:00Z","experiments":"2026-06-18T14:30:00Z","comments":"2026-06-19T12:00:00Z","inbox":"2026-06-19T08:00:00Z"}'
last_run: "2026-06-19T13:00:01Z"
last_success: "2026-06-19T13:00:01Z"
items_processed: 14
lock: null
errors:
  - kind: source
    code: posthog-rate-limited
    resource: experiments
    at: "2026-06-19T13:00:00Z"
    message: "connector returned 429 for experiment-list; resource type skipped this run"
---
```

Note that `cursor.experiments` remains at its pre-run value (`2026-06-18T14:30:00Z`)
in the rate-limited example. It will advance on the next run when the connector
is no longer throttled.

---

## Self-validation against fetch.md

| fetch.md claim | cursor.md alignment |
|---|---|
| Cursor is a JSON object with five per-resource keys | Confirmed — cursor shape section above documents the exact key names and recency fields |
| Each key advances to max(recency_field) for items of that type successfully processed this run | Confirmed — advance rule section per resource type |
| Only when every action write for that resource type succeeded (transactional rule per resource type) | Confirmed — transactional cursor advance section documents per-type fault isolation |
| Bootstrap: filter within bootstrap_window_days (default 7) | Confirmed — bootstrap window section cites the 7-day default |
| Cursor JSON malformed → posthog-cursor-evicted, fall back to bootstrap window | Confirmed — cursor shape section documents this fallback |
| Rate-limited resource type skipped; other types continue and advance independently | Confirmed — transactional rule section and sync.md example both document this |
| source_id format posthog:{project_id}:{resource_type}:{resource_id} | Confirmed — idempotency / deduplication section references this format for lookup |
| No per-issue id keys in the cursor map | Confirmed — "why not per-item keys" section explains this explicitly |
| Error issue merge/split handled by _sources.json eviction, not cursor map | Confirmed — merge/split section documents the separation of concerns |
| No tracked-parent registry | Confirmed — tracked-parent registry section documents the per-resource analysis and conclusion |
