# Cursor advance reference — agntux-calendly (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

Calendly uses a **dual-key rolling-window + client-side-filter** strategy.
The cursor is a JSON object stored on the `sync.md → cursor` line. It has
exactly two keys: `events_updated_at` (ISO-8601 UTC timestamp anchoring
incremental event fetches) and `routing_submissions_since` (ISO-8601 UTC
timestamp anchoring routing-form submission fetches).

---

## Strategy name

**Dual-key rolling-window + client-side filter**

Calendly's `list_scheduled_events` API exposes `min_start_time` /
`max_start_time` filters on event START TIME only — there is no server-side
`updated_at` or incremental-sync parameter. To detect reschedules,
cancellations, and no-show flags, the plugin must:

1. Fetch a fixed-width rolling window anchored at runtime (`now − lookback`
   through `now + forward_horizon`).
2. Client-filter results to events where `updated_at > cursor.events_updated_at`.

Routing-form submissions are immutable once created; their API supports a
`created_at`-style boundary. A separate cursor key with a strict-greater-than
filter is the right shape for that surface.

### Does this source need a tracked-parent registry?

For Calendly scheduled events: **no**. A cancellation, no-show flag, or
reschedule all bump the event's own `updated_at`, so the event re-surfaces
in the rolling window and passes the client-side filter without any
parent registry. The cursor map contains only the two flat keys
`events_updated_at` and `routing_submissions_since`. This must be preserved
across plugin versions.

---

## Cursor shape

```yaml
# data/learnings/agntux-calendly/sync.md — bootstrap state
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
```

```yaml
# After the first successful run
cursor: '{"events_updated_at":"2026-06-21T10:00:00Z","routing_submissions_since":"2026-06-21T09:45:00Z"}'
```

The cursor is a **JSON object serialised as a single-line string** on the
`sync.md → cursor` frontmatter key.

### Top-level keys

| Key | Type | Meaning |
|---|---|---|
| `events_updated_at` | ISO-8601 UTC string | Newest `updated_at` seen across all scheduled events (both active and canceled passes) successfully processed this run. Anchors the client-side filter on subsequent runs. |
| `routing_submissions_since` | ISO-8601 UTC string | Newest `created_at` seen across all routing-form submissions successfully processed this run. Anchors the boundary for subsequent runs. |

### Bootstrap state

`cursor: null` and `last_success: null` together signal "first run ever".
Parse the cursor at Step 2. If `cursor` is null or `JSON.parse` fails, treat
both keys as absent and enter bootstrap mode. The run continues — cursor
malformation is never a reason to abort.

---

## Step 2 — Parse and validate cursor

At Step 2 (before any tool calls):

1. Read `cursor` from `data/learnings/agntux-calendly/sync.md` frontmatter.
2. If `cursor` is null: enter bootstrap mode. `events_updated_at = null`;
   `routing_submissions_since = null`.
3. If `cursor` is a non-null string: attempt `JSON.parse`.
   - On parse failure: log `calendly-cursor-malformed` (kind: `parse`) with the
     raw cursor string (truncated to 200 chars). Treat both keys as null. Fall
     back to bootstrap mode. Continue the run.
   - On parse success but `events_updated_at` key absent: treat
     `events_updated_at` as null; use `routing_submissions_since` if present.
   - On parse success but `routing_submissions_since` key absent: treat it as
     null; use `events_updated_at` if present.
   - On parse success with both keys present: normal incremental run.

Never abort solely because the cursor is malformed.

---

## Rolling-window parameters

### Lookback (7 days from `now`)

The lookback window for `min_start_time` is always **`now − 7 days`**,
computed from the run's `now` timestamp captured at Step 2. It is NOT
computed from `cursor.events_updated_at − 7 days`.

Rationale: anchoring the lookback to `now` (not to cursor) avoids missing
reschedules where an event's new `start_time` falls within the forward
horizon but outside a cursor-anchored lookback. The client-side
`updated_at > cursor` filter drops events that haven't changed.

7 days covers same-day reschedules, cancellations on past events, and
no-show flags (typically set within hours of a completed meeting). Do not
shorten below 7 days.

### Forward horizon (60 days from `now`)

The `max_start_time` is always **`now + 60 days`**, computed at Step 2.
60 days captures advance bookings that a 30-day horizon would miss.

Volume cap interaction: if more than 150 events fall within the window,
the cap sorts ascending by `start_time` and processes the oldest 150. The
cursor advances to the newest `updated_at` among those 150. The next run's
`min_start_time` is still `now − 7 days`, so the window re-scans and picks
up deferred events. Do NOT narrow the forward horizon to throttle volume —
the cap + cursor advance pair handles it.

---

## Advance rules

### Incremental run — `events_updated_at`

After Step 11's all-writes-succeeded gate:

```
new_events_updated_at =
  max(updated_at) across all scheduled events
  (both active and canceled passes)
  successfully processed this run
```

"Successfully processed" means the item's action write (or intentional
suppression at Step 8) completed without error. An event whose
`list_event_invitees` expansion failed but whose event-level action wrote
successfully IS included. An event whose event-level action write failed
is NOT included.

**Advance only when every action write in the run succeeded** (transactional
rule). If any write failed, leave `events_updated_at` at its pre-run value
and record the failure in `sync.md → errors`.

Using `max(updated_at)` across processed items (not start-of-run timestamp)
sets the threshold exactly at the last item touched — no gap, no overlap with
the rolling-window fetch-by-`start_time` approach.

**Never regress `events_updated_at`.** On a zero-change run, leave the cursor
at its stored value. Log:

```
cursor advance — (no change; 0 events passed updated_at filter)
```

### Incremental run — `routing_submissions_since`

```
new_routing_submissions_since =
  max(created_at) across all routing-form submissions
  successfully processed this run
```

Routing-form submissions are immutable; `created_at` never changes. The cursor
is a strict low-water mark: next run fetches where
`created_at > routing_submissions_since`.

Advance under the same transactional rule as `events_updated_at`. Both keys
advance together or neither does.

### Bootstrap run (either key null)

Trigger: `cursor` is null OR `last_success` is null OR a specific key is
absent from the parsed cursor object.

For `events_updated_at` bootstrap: set `min_start_time = now − bootstrap_window_days`
(default 30 days from `frontmatter.yaml`). Set `max_start_time = now + 60 days`.
No status filter on bootstrap — fetch all statuses. No client-side
`updated_at` filter — all events in the window are new.

For `routing_submissions_since` bootstrap: fetch all submissions and
client-filter by `created_at >= (now − bootstrap_window_days)`.

After all action writes succeed, advance both keys to their respective
`max()` values across items processed.

### Onboarding-mode provision

Detect "first run ever" as `last_success: null AND cursor: null`.

On a first run ever:
- Cap the event fetch at **50 events total** across both status passes
  (tighter than the normal 150-event cap).
- Set `min_start_time = now − 14 days` and `max_start_time = now + 30 days`
  (narrower than normal window).
- Cap the routing-submission fetch at **25 submissions**.

Rationale: the first run fires synchronously during Personalization State A
wrap-up with the user present; target total duration under 60 seconds. The
second (background) scheduled run uses the full window and caps.

Do NOT apply the onboarding-mode cap when `cursor` is null but
`last_success` is non-null — that is cursor-malformation recovery, not
first-time setup.

---

## Idempotency and deduplication

Calendly resource IDs are stable UUIDs. `source_id` values are constructed
from these UUIDs:

| Action signal | `source_id` | Stable across |
|---|---|---|
| New booking | `calendly:booking:{event_uuid}` | Reschedules, invitee additions |
| Upcoming (48h) | `calendly:upcoming:{event_uuid}` | Same event re-checked across runs |
| Cancellation | `calendly:canceled:{event_uuid}` | Always unique to the canceled event |
| No-show | `calendly:no-show:{event_uuid}` | All no-show invitees grouped per event |
| Routing lead | `calendly:routing-submission:{submission_uuid}` | Immutable after creation |

The Steps 8–9 dedup check uses these `source_id` values against
`actions/_index.md`. Re-scanning an event on a subsequent run matches the
existing open action rather than creating a duplicate; the entity body is
updated with changed fields (new `start_time`, invitee, location) but no new
action is raised while the existing one is open.

The same UUID can produce at most one open action per namespace simultaneously
(e.g., `calendly:booking:` and `calendly:no-show:` for the same `event_uuid`
coexist — they are different `source_id` namespaces).

---

## No-show window aging

No-show flags are set by the host after a meeting ends; these meetings appear
in the lookback window (`start_time` between `now − 7 days` and `now`). Each
run re-evaluates past meetings within the lookback and client-filters for
`updated_at > cursor`. Once the host sets the no-show flag the event's
`updated_at` bumps and the no-show action is raised on the next run.

Once committed to the cursor, subsequent runs see `updated_at <= cursor` and
skip the event. The rolling lookback + cursor filter pair handles this
completely without any secondary registry.

---

## Eviction

There are no per-event or per-submission cursor keys to evict. Both keys
advance monotonically and are never individually evicted. The 30-day
parent-registry eviction rule does not apply — no tracked-parent registry
exists for this plugin.

When `get_scheduled_event` returns 404 for a UUID, log
`calendly-event-not-found` (kind: `source`) with the UUID and skip the event.
Log `calendly-cursor-evicted` only when the purged event would have been the
max-`updated_at` candidate; note the fallback value used.

---

## Cursor diff log line (Step 11)

```
cursor advance — events_updated_at: {old} → {new}, routing_submissions_since: {old} → {new}
```

On a zero-change run:

```
cursor advance — (no change; 0 events or submissions passed cursor filter)
```

On first-ever write from null:

```
cursor advance — added: events_updated_at (null → {new}), routing_submissions_since (null → {new})
```

If only one key advances:

```
cursor advance — events_updated_at: {old} → {new}, routing_submissions_since: (unchanged)
```

The `validate-cursor.mjs` hook checks that the cursor is parseable JSON and
that neither key regresses.

---

## Workspace identifier capture

Calendly deep-link URLs use the event UUID directly — no tenant-scoped
subdomain in the path:

```
https://calendly.com/app/scheduled_events/{event_uuid}
```

No workspace identifier capture step is needed for event deep links.

For routing-form submissions:

```
https://calendly.com/app/routing_forms/{form_uuid}/submissions/{submission_uuid}
```

The `form_uuid` comes from the same `list_routing_form_submissions` call;
retain it in working memory during Step 5c when constructing
`suggested_action.url` fields. No token needs to be persisted in `sync.md`
frontmatter for this plugin.

---

## `_sources.json` lookup-before-write protocol

The standard lookup-before-write protocol from Step 6 applies fully.

Key points for Calendly:

- **Person entities from invitees** — `(subtype: person, source: calendly,
  source_id: "{invitee_email}")`. Use email as both `source_id` and the
  secondary lookup key; a returning booker receives a new invitee UUID each
  booking, so email is the only stable cross-booking identity. Do NOT use
  the invitee's Calendly UUID as `source_id` for person entities.
- **Scheduled-event entities** — `(subtype: scheduled-event, source:
  calendly, source_id: "{event_uuid}")`. UUID is stable across reschedules;
  update the entity body in place on status change.
- **Event-type reference entities** — `(subtype: event-type, source:
  calendly, source_id: "calendly:event-type:{event_type_uuid}")`. Reference
  entities; no action items.
- **Do NOT write to `_sources.json` directly.** The agntux-core PostToolUse
  hook owns it.

---

## No auto-learned denylist

Calendly's signal surface is low-noise by design — all events are explicitly
booked via the host's own scheduling links. The auto-learned denylist pattern
(from `agntux-gmail`) is not applied. Explicit filtering via
`data/instructions/agntux-calendly.md → # Never raise` is sufficient.

---

## sync.md template

Bootstrap state:

```yaml
---
plugin: agntux-calendly
version: 0.1.1
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful run (onboarding mode, 12 events and 3 routing
submissions processed):

```yaml
---
plugin: agntux-calendly
version: 0.1.1
cursor: '{"events_updated_at":"2026-06-21T10:00:00Z","routing_submissions_since":"2026-06-19T14:30:00Z"}'
last_run: "2026-06-21T22:01:15Z"
last_success: "2026-06-21T22:01:15Z"
items_processed: 15
lock: null
errors: (none)
---
```

After a run where `routing_submissions_since` did not advance:

```yaml
---
plugin: agntux-calendly
version: 0.1.1
cursor: '{"events_updated_at":"2026-06-21T16:45:00Z","routing_submissions_since":"2026-06-19T14:30:00Z"}'
last_run: "2026-06-21T22:30:00Z"
last_success: "2026-06-21T22:30:00Z"
items_processed: 3
lock: null
errors: (none)
---
```

---

## Self-validation against fetch.md and frontmatter.yaml

| Claim in fetch.md / frontmatter.yaml | cursor.md alignment |
|---|---|
| Dual-key JSON cursor (`frontmatter.yaml source-cursor-semantics`) | Confirmed — cursor shape section |
| `events_updated_at` = newest `updated_at` seen this run | Confirmed — advance rules section |
| `routing_submissions_since` = newest `created_at` seen this run | Confirmed — advance rules section |
| `min_start_time = now − 7d` (anchored to `now`, not cursor) | Confirmed with rationale — rolling-window section |
| `max_start_time = now + 60 days` | Confirmed — forward horizon section |
| Client-side filter: `updated_at > cursor.events_updated_at` | Confirmed — strategy name and advance rules |
| Advance only on full-run success (transactional rule); both keys together | Confirmed — advance rules section |
| Bootstrap: cursor null → fetch within `bootstrap_window_days` (default 30) | Confirmed — bootstrap run section |
| Onboarding-mode cap: first-run-ever gets tighter window and lower caps | Confirmed — onboarding-mode section |
| No tracked-parent registry | Confirmed — tracked-parent registry section |
| `calendly-cursor-malformed` on JSON parse failure | Confirmed — Step 2 parse section |
| `calendly-cursor-evicted` on purged event | Confirmed — eviction section |
| Stable UUID `source_id` per namespace | Confirmed — idempotency section |
| No workspace identifier needed; event deep links are UUID-only | Confirmed — workspace identifier section |
| Person entity `source_id` is invitee email, not invitee UUID | Confirmed — `_sources.json` protocol section |
