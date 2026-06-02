# Cursor semantics — agntux-google-calendar
# Wholesale replacement of canonical reference/cursor.md for this plugin.
#
# This file is the authoritative runtime cursor reference for
# `agntux-google-calendar`. It supersedes any cursor notes in
# `reference/sync.md` or `_overrides/frontmatter.yaml` where those conflict.

---

## 1. Cursor type and storage shape

**Type:** JSON object with two dimensions:
1. `look_ahead_window_end` — RFC3339 timestamp marking the end of the last
   successfully fetched look-ahead window (typically `last_run_time + 7 days`).
2. Per-event entries: `"<calendarId>#<eventId>"` → `"<event.updated RFC3339>"`.
   For recurring event instances: `"<calendarId>#<eventId>#<occurrenceStart>"` → `"<event.updated RFC3339>"`.

**Storage:** `data/learnings/agntux-google-calendar/sync.md` frontmatter,
under the `cursor` key. Serialised as a compact JSON object on one line
(for YAML scalar compatibility):

```yaml
cursor: >-
  {"look_ahead_window_end":"2026-06-09T10:00:00Z","primary#abc123":"2026-06-01T08:00:00Z","primary#def456":"2026-06-01T09:30:00Z"}
```

The `look_ahead_window_end` value is informational — it records where the
last window ended so that a gap-recovery check can detect if the next run
is starting significantly after expected. It does NOT drive fetch filtering
(the fetch window is always `[now(), now()+7d]`; this plugin is
forward-looking, not catch-up oriented).

---

## 2. Per-event cursor entries

Each cursor entry encodes the `event.updated` timestamp at the time the
event was last successfully processed. On subsequent runs, the entry is
compared against the `event.updated` returned by `list_events`:

- **Match (equal):** event unchanged since last run; skip `get_event` call
  and skip re-emitting the action file (no-op unless the file is absent).
- **Mismatch (cursor entry < event.updated):** event was modified; fetch
  full detail via `get_event` and re-emit the action file with updated
  content.
- **No cursor entry:** event is new to this run; fetch full detail and
  emit action file.

Recurring event instances use the compound key
`<calendarId>#<eventId>#<occurrenceStart>` because each occurrence has
the same `eventId` but may have been individually modified (RSVP'd, time
changed, cancelled). The `occurrenceStart` is the occurrence's
`originalStartTime.dateTime` as returned by the Calendar API.

---

## 3. Advance rule (transactional)

Per-event cursor entries are written **only at Step 11, and only when the
corresponding action file write for that event succeeded.**

If an action file write fails (validator rejection, filesystem error, lock
contention):
- Do NOT update the cursor entry for that event.
- Leave the previous cursor entry value (or absent key) in place.
- The next run re-fetches the event and retries the action file write.

The `look_ahead_window_end` value is updated at Step 11 to
`now() + 7 days` as part of the same atomic write that clears the lock.
It advances regardless of individual event write failures (it is a
window marker, not a success marker).

Cursor advance log format (written to sync state at Step 11):

```
cursor advance — new: 5 events | updated: 3 events | evicted: 2 events | failed (write error): 0
```

---

## 4. Eviction — past events

Events whose `start.dateTime < now()` at the time of the run evict from
the cursor map as part of the **Step 11 atomic write** — not during Step 5i.

**Sequencing distinction:**
- **Step 5i** handles the *action file* side of eviction: archive closed
  action files to `sources/google-calendar/archive/`, leave open action
  files untouched, and mark each eviction candidate in the working context
  with a `pending_cursor_eviction: true` flag.
- **Step 11** performs the *cursor map* side: for every entry flagged
  `pending_cursor_eviction: true`, remove the cursor key
  `cursor["<calendarId>#<eventId>"]` (or the compound recurring key) as
  part of the same atomic write that advances per-event cursors and clears
  the lock. This keeps the cursor map and the lock release in a single
  serialised write, which is the transactional guarantee.

Log `kind: google-calendar-cursor-evicted` per eviction at Step 11.

The cursor map is thus self-pruning: it grows during the 7-day look-ahead
window and shrinks as events pass. Steady-state size is proportional to
the number of events per 7-day window — typically 10–50 entries for a
busy calendar.

---

## 4a. `singleEvents` expansion assumption

The `list_events` call in Step 5b must include `singleEvents: true` to
cause the Calendar API to expand recurring events into individual instances.
Without this parameter the API default is `singleEvents: false`, which
returns a single recurrence-rule object per recurring series rather than
expanded instances — making compound cursor keys of the form
`<calendarId>#<eventId>#<occurrenceStart>` impossible to construct.

**Requirement:** Every `list_events` call in this plugin passes
`singleEvents: true` explicitly. Do not rely on the API default.

When `singleEvents: true` is set:
- Each occurrence of a recurring event returns its own item with a unique
  `id` (typically `<masterId>_<occurrenceStartDateTimeNoHyphens>`).
- The `originalStartTime.dateTime` field identifies the occurrence's
  nominal start (unchanged even if the instance was moved).
- The compound cursor key uses `originalStartTime.dateTime` as the
  `<occurrenceStart>` segment.

If the `list_events` tool does not support `singleEvents` as a named
parameter (connector limitation), apply the following workaround: treat
every returned event as a single instance (key by `eventId` only), and
accept that for recurring series the cursor key collides across instances.
In that case, an instance modification triggers a re-fetch for all
instances with the same `eventId`, which is a safe conservative behaviour
at the cost of extra `get_event` calls. Log the connector limitation as
`kind: internal` with a note at Step 2 if this branch is taken.

---

## 5. Cold-start (bootstrap) behaviour

When `cursor` is empty (`{}`) or `look_ahead_window_end` is absent:

- This is a first-run or fully reset state.
- The fetch window is still `[now(), now()+7d]` — identical to steady
  state. There is no historical backfill for this plugin.
- All events in the window are treated as new (no cursor entries to
  compare against); all pass through `get_event` and action-file
  emission.
- `bootstrap_window_default_days` from `user.md` is NOT applied here —
  that parameter governs backwards-looking plugins. Google Calendar is
  forward-only; `bootstrap_window_days` overrides are ignored.

After first-run completion, the cursor map is populated with all events
processed and `look_ahead_window_end` is set. The next run begins
incremental processing.

---

## 6. Gap recovery

A gap occurs when `now()` is significantly later than
`look_ahead_window_end` from the last run (e.g. the plugin was disabled
for several days). Detection at Step 4:

- If `look_ahead_window_end` is more than 48 hours before `now()`, log a
  `cursor-gap-recovery` event. No special action is required — the fetch
  window `[now(), now()+7d]` is always fresh. Any events that were in the
  old look-ahead window but are now in the past will already be absent
  from the new window and will evict naturally.
- Events that were in-flight (action files open) for events now in the
  past remain open; the user resolves them manually.

**Manual reset:** Delete all per-event entries from the cursor map in
`data/learnings/agntux-google-calendar/sync.md`, leaving only
`{"look_ahead_window_end": null}` or `{}`. The next run treats all
window events as new. Document this in `reference/runbook.md` as
`cursor-manual-reset`.

---

## 7. Sync state frontmatter keys (complete reference)

All cursor-related keys live in
`data/learnings/agntux-google-calendar/sync.md` frontmatter:

| Key | Type | Description |
|---|---|---|
| `cursor` | Compact JSON string | Per-event updated-ts map + `look_ahead_window_end`. |
| `lock` | ISO 8601 string or null | Soft lock timestamp. Null when idle. |
| `last_run` | ISO 8601 string or null | Timestamp of most recent run attempt. |
| `last_success` | ISO 8601 string or null | Timestamp of last fully successful run. |
| `events_processed` | integer | Count of events processed in the last run. |
| `volume_cap_hit` | boolean | True if the 80-event cap was reached in the last run. |
| `errors` | list | Last 10 error/debug entries, FIFO-bounded. |

Minimum initial sync state (created at Preflight if absent):

```yaml
---
type: plugin-sync-state
plugin_slug: agntux-google-calendar
schema_version: "1.0.0"
created_at: {today}
updated_at: {today}
cursor: "{}"
lock: null
last_run: null
last_success: null
events_processed: 0
volume_cap_hit: false
errors: []
---
```
