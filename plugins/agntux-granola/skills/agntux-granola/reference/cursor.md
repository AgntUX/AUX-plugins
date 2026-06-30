# Cursor advance reference — agntux-granola (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

Granola uses a **single-key time-window cursor with a fixed look-back
overlap**. The cursor is a single ISO-8601 UTC timestamp stored on the
`sync.md → cursor` line, representing the run-start timestamp of the
last fully successful run (`now` at Step 2, not the newest
`meeting.start_time`). On each incremental run the fetch window is
`[cursor − overlap_days, now]`, where `overlap_days` defaults to 7.

---

## Strategy name

**Single-key time-window cursor with look-back overlap**

This strategy applies when:

- The source's listing tool filters by item creation/start time (not by
  a modification or updated-at field).
- Items can be created or have their content finalised after their
  nominal start time — so a pure low-water-mark on `start_time` would
  permanently miss late-arriving content once the cursor advances past
  that meeting's start time.
- There is no server-side `updatedAt` or `modifiedTime` filter that
  would re-surface a modified-but-old item for free.
- Volume per run is manageable with a fixed-width overlap window
  (Granola meeting volume is low enough that re-checking the last 7
  days on every run is safe; the per-meeting dedup in Step 7 makes
  re-fetching idempotent).

Granola satisfies all four conditions. `list_meetings` accepts a
`time_range: custom` with `custom_start` / `custom_end` filtered on
`start_time`. Granola's AI summary is generated asynchronously
post-meeting — a meeting that ended several hours or days ago may
acquire a new summary between runs. If the cursor advanced to
`max(start_time)` from the previous run, the next run's window would
begin at that timestamp and miss meetings whose `start_time` is earlier
but whose summary arrived after the cursor was written.

### Why not advance to `max(start_time)`?

Advancing to `max(start_time)` creates a permanent blind spot. Suppose
the last run processed a meeting that started at T−4h. The cursor is
set to T−4h. Two hours later Granola finishes the AI summary for a
meeting that started at T−5h. The next run's window is `[T−4h, now]`,
so `start_time = T−5h` is below the window floor — that meeting is
never fetched again.

Advancing to `now` (run start) instead of `max(start_time)` would close
the primary gap: `cursor = T−0h`, next run window is `[T−0h, now]`, so
all future meetings are covered. But it still misses meetings from the
previous run window whose summaries arrived after Step 5 completed. The
look-back overlap closes this secondary gap by widening every window's
lower bound by `overlap_days`.

### Why not key on a per-meeting `updated_at`?

Granola's `list_meetings` API filters on `start_time`, not on
`updated_at`. There is no server-side filter for "meetings updated since
timestamp". A per-meeting updated-at cursor would require either a
full-corpus scan (no server-side pushdown) or a tracked-parent registry
(overly complex for a source with no parent-child reply graph). The
fixed overlap window achieves the same correctness guarantee with a
single scalar cursor and no registry.

### Does this source need a tracked-parent registry?

No. Granola meeting notes have no threaded reply graph. Each meeting is
self-contained (attendees + summary + transcript + action items all
belong to the same `meeting_id`). There are no Slack-style "reply on an
old parent not surfaced by the parent's cursor field" semantics.

The source-semantics advisor question: "when a new reply lands on an old
parent, does the parent's `updatedAt` / `mtime` / cursor field bump?"
does not apply — there are no replies and no parents. The look-back
overlap handles late-arriving summaries on the meeting itself.

**Conclusion: no tracked-parent registry.** The cursor is a single
scalar string. This must be preserved across plugin versions.

---

## Cursor shape

```yaml
# data/learnings/agntux-granola/sync.md — bootstrap state
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
```

```yaml
# After the first successful run
cursor: "2026-06-28T09:30:00Z"
last_run: "2026-06-28T09:30:00Z"
last_success: "2026-06-28T09:30:00Z"
items_processed: 8
lock: null
errors: (none)
```

The cursor is a **scalar ISO-8601 UTC string** on the `sync.md → cursor`
frontmatter key. It stores `now` (the run's start timestamp captured at
Step 2) — not `max(meeting.start_time)`.

### Bootstrap state

`cursor: null` and `last_success: null` together signal "first run ever".
If `cursor` is null or is not a parseable ISO-8601 timestamp, enter
bootstrap mode. The run continues — cursor malformation is never a
reason to abort.

---

## Step 2 — Parse and validate cursor

At Step 2 (before any tool calls):

1. Read `cursor` from `data/learnings/agntux-granola/sync.md`
   frontmatter.
2. Capture `now` as the run's start timestamp in ISO-8601 UTC. This is
   the value the cursor will advance to at Step 11.
3. Resolve `overlap_days` from `user.md → granola_overlap_days` if set;
   otherwise use the default of **7**.
4. If `cursor` is null: enter bootstrap mode (see below).
5. If `cursor` is a non-null string but not a valid ISO-8601 timestamp:
   log `granola-cursor-malformed` (kind: `parse`) with the raw value
   (truncated to 200 chars), treat as null, fall back to bootstrap mode,
   and continue the run.
6. If `cursor` is a valid ISO-8601 UTC timestamp: normal incremental run.

Never abort solely because the cursor is malformed.

---

## Window derivation

### Incremental run (cursor non-null and parseable)

```
overlap_floor = cursor − overlap_days      (default: cursor − 7 days)
window_start  = overlap_floor
window_end    = now
```

Pass `window_start` as `custom_start` and `window_end` as `custom_end`
to `list_meetings(time_range: "custom", ...)`.

The overlap window means every run re-fetches meetings whose `start_time`
falls in `[cursor − overlap_days, cursor]`. For meetings in that range
that have not changed since the last run (same summary, same attendees,
same action items), Step 7's entity-update protocol produces a no-op.
For meetings in that range whose Granola AI summary has been finalised
or updated since the last run, they are processed normally.

**Overlap size.** The default of 7 days is deliberately conservative:
Granola's AI summary is typically available within minutes to hours of
meeting end, so 7 days covers all realistic finalisation delays. For
users with heavy note-editing workflows, `user.md → granola_overlap_days`
can be raised. The overlap window does not grow unboundedly — it is
always `overlap_days` wide regardless of how long the plugin has been
running.

**Dedup within the overlap.** Meetings fetched via the overlap that
have not changed are suppressed at Step 7 (entity unchanged → no
action written → no dedup entry triggered). Meetings in the overlap
whose action item was already raised and is still open are suppressed
at Steps 8–9 by the `source_id` dedup check against
`actions/_index.md`. This means the overlap carries zero noise penalty
for the steady-state case where summaries are already finalised.

### Bootstrap run (cursor null or malformed)

```
window_start = now − bootstrap_window_days   (default: 30 days)
window_end   = now
```

When `bootstrap_window_days ≤ 30`, use `list_meetings(time_range:
"last_30_days")`. When `bootstrap_window_days > 30`, use
`list_meetings(time_range: "custom", custom_start: window_start,
custom_end: window_end)`.

No look-back overlap is applied on bootstrap — the bootstrap window
is already a wide look-back by construction.

---

## Advance rule

### Successful run

After Step 11's all-writes-succeeded gate, write:

```yaml
cursor: "<now as ISO-8601 UTC>"
```

where `now` is the run-start timestamp captured at Step 2 (not the
wall-clock time at Step 11, and not `max(meeting.start_time)` across
processed meetings — using run-start ensures the next run's
`[cursor − overlap_days, now]` window includes meetings that started
after Step 5 began but before Step 11 completed).

**Advance only when every action write in the run succeeded**
(transactional rule). If any action write failed, leave `cursor` at
its pre-run value and record the failure in `sync.md → errors`.

**Never regress the cursor.** On a zero-meeting run (no meetings in the
window), advance the cursor to `now` — the window moved forward even if
nothing was found. Log:

```
cursor advance — (no new meetings; cursor advanced to now)
```

### Partial-run and early-exit cases

If the run exits early (auth failure, network failure, rate-limit) before
any Step 10 writes begin, leave `cursor` at its pre-run value. The next
run re-scans the same window.

### Bootstrap run advance

After all action writes succeed on a bootstrap run, advance:

```yaml
cursor: "<now as ISO-8601 UTC>"
```

The next run's window is then `[now − overlap_days, next_now]`, which
covers the last `overlap_days` from the bootstrap run's end plus all new
meetings going forward.

### Onboarding-mode provision

Detect "first run ever" as `last_success: null AND cursor: null`.

On a first run ever:
- Cap `list_meetings` results at **20 meetings** (instead of the normal
  100 cap from Step 5a). Granola meeting volume is low, but the
  bootstrap window is 30 days and some users have dense meeting
  histories; capping at 20 keeps the onboarding run under 60 seconds.
- Apply a tighter bootstrap window of **min(bootstrap_window_days, 7)**
  on the first run — do not look back further than 7 days during
  onboarding. The second (background) scheduled run uses the full
  default window.
- Cap `get_meeting_transcript` calls at **5 meetings** (instead of the
  normal 20) on the first run.

Do NOT apply the onboarding-mode cap when `cursor` is null but
`last_success` is non-null — that is cursor-malformation recovery, not
first-time setup.

---

## Idempotency across the overlap window

Because the overlap window re-fetches meetings seen on prior runs, the
plugin must not re-raise already-open action items or duplicate entity
writes. The guards are:

1. **Entity change test (Step 7):** compare the hydrated meeting's
   summary, attendees, and action-item text against the stored entity
   body. If unchanged, skip to the next meeting — no write, no dedup
   entry, no cursor implication.
2. **Action dedup (Steps 8–9):** `source_id = granola:action:{meeting_id}`.
   An existing open action with this `source_id` is updated in place
   (if the summary has new items) rather than duplicated.
3. **Closed/dismissed action re-raise rule:** a closed action with
   `source_id = granola:action:{meeting_id}` may be re-raised only when
   the meeting summary or transcript contains new action items not
   present when the action was originally raised (material change, not
   formatting only).

These three guards together mean the look-back overlap is free of
side-effects for meetings whose content is stable.

---

## Cursor diff log line (Step 11)

Normal advance (cursor was non-null):

```
cursor advance — advanced: cursor {old} → {new} (overlap window: {new − overlap_days} → {new})
```

First write from null:

```
cursor advance — initialised: cursor (null → {new}) (bootstrap window: {window_start} → {new})
```

Zero-meeting run:

```
cursor advance — (no new meetings; cursor advanced: {old} → {new})
```

Cursor malformation recovery:

```
cursor advance — recovered: granola-cursor-malformed (treated as null); cursor written: (null → {new})
```

---

## Workspace identifier capture

Granola meeting deep links use a stable per-meeting URL:

```
https://granola.so/meetings/{meeting_id}
```

No per-tenant workspace subdomain or portal ID is required. The
`meeting_id` UUID is returned by `list_meetings` and `get_meetings`
directly. No workspace identifier capture step is needed at Step 2,
and no persistent identifier is written to `sync.md` frontmatter for
deep-link construction.

---

## `_sources.json` lookup-before-write protocol

The standard lookup-before-write protocol from Step 6 applies fully.

Key points for Granola:

- **Meeting entities** — `(subtype: meeting, source: granola, source_id:
  "granola:meeting:{meeting_id}")`. The UUID is stable for the lifetime
  of the meeting. Update the entity body in place when the AI summary,
  attendees, or action-item text changes since the last processed
  version.
- **Person entities from attendees** — use attendee email as `source_id`
  when available (`subtype: person, source: granola, source_id:
  "{attendee_email}"`). Email is the canonical cross-source alias —
  the same person from a Zoom or Google Meet meeting resolves to the
  same entity via `_sources.json` lookup. When email is unavailable,
  fall back to a display-name slug: `granola:person:{name_slug}`. On
  a subsequent run where the same display name resolves to an email,
  update the `source_id` and retain the name-slug as an alias.
- **Do NOT write to `_sources.json` directly.** The agntux-core
  PostToolUse hook owns it.

---

## No auto-learned denylist

Granola surfaces only meetings the authenticated user attended or was
invited to. The noise floor is inherently low (the user controls which
meetings Granola records). Sender-derived noise drops are not a
meaningful volume. The auto-learned denylist pattern is not applied.
Explicit `# Never raise` curation in
`data/instructions/agntux-granola.md` is sufficient.

---

## Eviction

There are no per-item cursor keys to evict — the cursor is a single
scalar. The 30-day parent-registry eviction rule does not apply (no
registry exists).

When `get_meetings` returns no result for a UUID seen in `list_meetings`
(meeting deleted between list and hydrate), log
`granola-meeting-not-found` (kind: `source`) with the UUID and continue.
This does not affect the cursor advance.

---

## sync.md template

Bootstrap state:

```yaml
---
plugin: agntux-granola
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
---
```

After the first successful run (onboarding mode, 7-day window, 5
meetings processed):

```yaml
---
plugin: agntux-granola
version: 0.1.0
cursor: "2026-06-28T09:30:00Z"
last_run: "2026-06-28T09:30:00Z"
last_success: "2026-06-28T09:30:00Z"
items_processed: 5
lock: null
errors: (none)
---
```

After a subsequent incremental run (overlap window `[cursor − 7d,
now]`, 3 meetings in the overlap already-stable + 2 new meetings):

```yaml
---
plugin: agntux-granola
version: 0.1.0
cursor: "2026-06-28T10:00:00Z"
last_run: "2026-06-28T10:00:00Z"
last_success: "2026-06-28T10:00:00Z"
items_processed: 2
lock: null
errors: (none)
---
```

Note: `items_processed` counts newly processed or updated meetings this
run (those that resulted in an entity write or action write). Overlap
meetings whose entity was unchanged and that passed the Step 7 no-op
check are NOT counted toward `items_processed`.

---

## Self-validation against fetch.md and frontmatter.yaml

| Claim in fetch.md / frontmatter.yaml | cursor.md alignment |
|---|---|
| Cursor is a single ISO-8601 UTC timestamp scalar (`frontmatter.yaml source-cursor-semantics`) | Confirmed — cursor shape section documents a scalar string, not a JSON object |
| Incremental fetch: `list_meetings(time_range: custom, custom_start: cursor, custom_end: now)` (`frontmatter.yaml source-cursor-semantics`) | Diverges intentionally: `custom_start = cursor − overlap_days` (not bare `cursor`) to catch late-arriving summaries; rationale documented in window derivation section |
| Bootstrap: `list_meetings(time_range: last_30_days)` when `bootstrap_window_days ≤ 30` | Confirmed — bootstrap run section |
| Cursor advances to `max(meeting.start_time)` (ingest specialist proposal) | Superseded: cursor advances to `now` (run start). This file documents and justifies the change; `frontmatter.yaml source-cursor-semantics` has been updated in the same PR to reflect the actual advance rule and overlap window |
| Advance only on full-run success (transactional rule) | Confirmed — advance rule section |
| Bootstrap default: 30 days (`frontmatter.yaml bootstrap-window-default-days: "30"`) | Confirmed — bootstrap run section cites this default |
| Per-run meeting cap: 100 meetings (fetch.md Step 5a) | Confirmed — onboarding-mode section references the 100-meeting normal cap; the 20-meeting onboarding cap is an addition |
| `granola-cursor-malformed` on non-parseable cursor (`frontmatter.yaml permitted-error-kinds`) | Confirmed — Step 2 parse section |
| `granola-meeting-not-found` on UUID not found in `get_meetings` (`frontmatter.yaml permitted-error-kinds`) | Confirmed — eviction section |
| No tracked-parent registry | Confirmed — strategy name section |
| No workspace identifier to capture | Confirmed — workspace identifier section |
| Deep link: `https://granola.so/meetings/{meeting_id}` (fetch.md action item shape) | Confirmed — workspace identifier section documents the same template |

### Divergence note for frontmatter.yaml

The ingest specialist's draft of `frontmatter.yaml` described the cursor
advancing to `max(meeting.start_time)`. That description has been updated
in this PR to reflect the actual advance rule (`cursor = now`) and the
overlap window (`custom_start = cursor − overlap_days`). The
`source-cursor-semantics` scalar value and the comment block in
`frontmatter.yaml` now match this file. No further manual sync is needed
before the render-skill build runs.
