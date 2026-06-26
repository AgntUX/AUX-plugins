# Cursor advance reference — agntux-zoom (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/cursor.md`.

Zoom uses a **dual-key ISO-8601 UTC window cursor** strategy. The cursor is a
JSON object stored on the `sync.md → cursor` line with exactly two keys:
`meetings_since` (lower bound of the meetings and recordings fetch window) and
`chat_since` (lower bound of the Team Chat / Docs search window). Both keys
advance to the run's `now` timestamp on every successful run.

---

## Strategy name

**Dual-key ISO-8601 UTC window cursor**

This strategy applies when:

- The source exposes two independent data surfaces — meetings/recordings and
  Team Chat/Docs — each with their own time-window filter parameter.
- Both surfaces support a server-side `from`/`to` date or timestamp filter,
  so incremental pulls are server-side, not client-side.
- The two surfaces have different rate and volume characteristics (meetings
  fetch is bounded by completed/scheduled count; chat is bounded by message
  volume and mentions).
- A failure on one surface should not reset the other surface's cursor (but
  the transactional rule requires both advance together or neither does, to
  keep the cursor JSON atomic).

Zoom satisfies all four conditions. `search_meetings` accepts `from`/`to`
date parameters. `recordings_list` accepts `from`/`to` date parameters with a
max 31-day window per call. `search_zoom` accepts `from`/`to` ISO-8601 UTC
filters. A single scalar cursor would work but would lose the semantic
distinction between the two surfaces and complicate the 31-day chunking logic
for recordings. The dual-key shape makes each surface's window explicit.

### Does this source need a tracked-parent registry?

For Zoom meetings: **no**. Each meeting has a stable UUID (`meeting_uuid`)
that does not change across the meeting lifecycle (scheduled → in-progress →
completed). A meeting's participants, summary, and next steps are fetched fresh
each time via `get_meeting_assets`. There are no Slack-style "old parent
resurfaces with new children via an unchanged cursor field" semantics — a
meeting with new notes or a delayed recording simply re-enters the fetch window
on the next run because the cursor window always starts at `meetings_since`,
and the entity update protocol in Step 7 handles changed fields in place.

For Team Chat: messages are immutable once sent; the `from`/`to` filter yields
only new messages on each run. No parent registry needed.

**Conclusion: no tracked-parent registry.** The cursor map contains exactly
two flat keys: `meetings_since` and `chat_since`. This must be preserved
across plugin versions.

---

## Cursor shape

```yaml
# data/learnings/agntux-zoom/sync.md — bootstrap state
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
timezone: null
```

```yaml
# After the first successful run
cursor: '{"meetings_since":"2026-06-25T18:12:50Z","chat_since":"2026-06-25T18:12:50Z"}'
timezone: America/New_York
last_run: "2026-06-25T18:12:50Z"
last_success: "2026-06-25T18:12:50Z"
items_processed: 14
lock: null
errors: (none)
```

The cursor is a **JSON object serialised as a single-line string** on the
`sync.md → cursor` frontmatter key.

### Top-level keys

| Key | Type | Meaning |
|---|---|---|
| `meetings_since` | ISO-8601 UTC string | Lower bound of the `[meetings_since, now]` window passed to `search_meetings` and `recordings_list`. Advance to `now` (run start) on every successful run. |
| `chat_since` | ISO-8601 UTC string | Lower bound of the `from` filter passed to `search_zoom` for both Team Chat and Zoom Docs. Advance to `now` (run start) on every successful run. |

### Bootstrap state

`cursor: null` and `last_success: null` together signal "first run ever". Parse
the cursor at Step 2. If `cursor` is null or `JSON.parse` fails, treat both
keys as absent and enter bootstrap mode. The run continues — cursor
malformation is never a reason to abort.

---

## Step 2 — Parse and validate cursor

At Step 2 (before any tool calls):

1. Read `cursor` from `data/learnings/agntux-zoom/sync.md` frontmatter.
2. If `cursor` is null: enter bootstrap mode. Set `meetings_since = null`;
   `chat_since = null`.
3. If `cursor` is a non-null string: attempt `JSON.parse`.
   - On parse failure: log `zoom-cursor-malformed` (kind: `parse`) with the
     raw cursor string (truncated to 200 chars). Treat both keys as null. Fall
     back to bootstrap mode. Continue the run.
   - On parse success but `meetings_since` key absent: treat `meetings_since`
     as null (bootstrap that surface); use `chat_since` if present.
   - On parse success but `chat_since` key absent: treat `chat_since` as null;
     use `meetings_since` if present.
   - On parse success with both keys present: normal incremental run.

Never abort solely because the cursor is malformed.

Also capture `now` (the run's start timestamp as ISO-8601 UTC) at Step 2. This
is the value both cursor keys will advance to at Step 11.

---

## Window derivation

### Meetings / recordings window

```
window_start = cursor.meetings_since  (or  now − bootstrap_window_days  if null)
window_end   = now
```

For `search_meetings`: pass `window_start` and `window_end` as `from`/`to` in
the user's local timezone (convert from UTC using the resolved timezone).

For `recordings_list`: pass as `from`/`to` in `yyyy-mm-dd` format. When
`window_end − window_start > 31 days`, split into consecutive sub-windows of
at most 31 days each (no overlap, oldest to newest). Log
`zoom-recordings-window-exceeded` (kind: `source`) at informational level if
splitting was required — not an error, just a signal that the window was wide.

### Team Chat / Docs window

```
chat_start = cursor.chat_since  (or  now − bootstrap_window_days  if null)
chat_end   = now
```

Pass `chat_start` and `chat_end` as `from`/`to` ISO-8601 UTC strings in the
`search_zoom` `filters` object.

---

## Advance rules

### Successful run — both keys advance together

After Step 11's all-writes-succeeded gate, write:

```json
{
  "meetings_since": "<now as ISO-8601 UTC>",
  "chat_since":     "<now as ISO-8601 UTC>"
}
```

where `now` is the run's start timestamp captured at Step 2 (not the wall-clock
time at Step 11 — using run-start avoids a gap if Step 5 took minutes to
complete).

**Advance only when every action write in the run succeeded** (transactional
rule). If any action write failed, leave both cursor keys at their pre-run
values and record the failure in `sync.md → errors`.

**Never regress either key.** On a zero-change run (nothing new in the window),
advance both keys to `now` — the window moved forward even if no new items were
found. Log:

```
cursor advance — (no new items; window advanced to now)
```

### Partial-run advance

If the run exits early due to auth, network, rate-limit, or timezone failure
before Step 10 writes begin, leave both cursor keys at their pre-run values.
The next run re-scans the same window from the stored cursor.

Do NOT advance one key but not the other — the cursor object is atomic. Either
both advance or neither does.

### Bootstrap run (either key null)

Trigger: `cursor` is null OR `last_success` is null OR a key is absent from
the parsed cursor object.

Set the absent key(s) to `now − bootstrap_window_days` (default 30 days, as
declared in `frontmatter.yaml`; user-overridable via `user.md →
bootstrap_window_days`). Proceed with the computed window. After all action
writes succeed, advance both keys to `now`.

### Onboarding-mode provision

Detect "first run ever" as `last_success: null AND cursor: null`.

On a first run ever:
- Cap `search_meetings` results at **30 meetings** (instead of the normal 200
  cap). This keeps the onboarding run fast while the user is present.
- Cap `recordings_list` results at **20 recordings** total across all
  sub-windows.
- Cap `get_meeting_assets` + `get_recording_resource` calls at **10 meetings**
  (instead of the normal 50 cap).
- Cap `search_zoom` chat results at **30 messages** and Docs at **20 items**.
- Set `window_start = now − min(bootstrap_window_days, 14)` — do not look back
  more than 14 days on the first run, regardless of `bootstrap_window_days`,
  to keep duration under 90 seconds.

Do NOT apply the onboarding-mode cap when `cursor` is null but `last_success`
is non-null — that is cursor-malformation recovery, not first-time setup.

---

## Idempotency and deduplication

Zoom resource IDs used as `source_id` values:

| Action signal | `source_id` | Stable across |
|---|---|---|
| User-assigned next steps | `zoom:next-steps:{meeting_uuid}` | Recording availability, summary updates |
| Upcoming meeting (2h) | `zoom:upcoming:{meeting_uuid}` | Status changes until meeting starts |
| New recording | `zoom:recording:{meeting_uuid}` | Stable once recording created |
| Unread chat mention/DM | `zoom:chat:{channel_or_dm_id}:{zoom_user_id}` | New messages in same thread |
| Zoom Doc updated | `zoom:doc:{file_id}` | Subsequent edits to same Doc |

The same `meeting_uuid` can produce open actions in multiple namespaces
simultaneously (`zoom:next-steps:` and `zoom:recording:` for the same meeting
coexist, as they represent distinct user actions). The dedup check at Steps 8–9
uses the full `source_id` including namespace prefix.

---

## Eviction

There are no per-item cursor keys to evict — the cursor is a two-key window
map, not an item registry. When `get_meeting_assets` returns 404 for a UUID,
log `zoom-meeting-not-found` (kind: `source`) with the UUID and skip the
meeting; log `zoom-cursor-evicted` only if the missing meeting was the sole
content of the window (which would leave the cursor stranded at an old value).
In practice, the window-based cursor advances to `now` regardless of per-item
failures, so eviction is a non-issue for this plugin.

The 30-day tracked-parent registry eviction rule does not apply — no such
registry exists for this plugin.

---

## Workspace identifier capture (Step 2 append)

Zoom meeting deep-link URLs use a stable numeric `meeting_number` (the
short numeric ID shown in Zoom invites, e.g. `123 456 7890`) and the UUID:

```
https://zoom.us/j/{meeting_number}              # join link (scheduled)
https://zoom.us/rec/play/{meeting_uuid}          # recording playback (completed)
```

Neither URL requires a per-account subdomain. No workspace identifier capture
step is needed for Zoom meeting or recording deep links. The `meeting_number`
and `meeting_uuid` are returned by `search_meetings` and `recordings_list`
directly.

---

## Cursor diff log line (Step 11)

Normal advance:

```
cursor advance — meetings_since: {old} → {new}, chat_since: {old} → {new}
```

Zero-change run:

```
cursor advance — (no new items; window advanced to now: {new})
```

Bootstrap first write from null:

```
cursor advance — initialised: meetings_since (null → {new}), chat_since (null → {new})
```

If one key was absent and the other present (partial-bootstrap recovery):

```
cursor advance — meetings_since: {old} → {new}, chat_since: (recovered null → {new})
```

---

## `_sources.json` lookup-before-write protocol

The standard lookup-before-write protocol from Step 6 applies fully.

Key points for Zoom:

- **Person entities from meeting participants** — use `participant_email` as
  `source_id` when available. When email is unavailable (some participants join
  as guests without a Zoom account), use `zoom:person:{display_name_normalised}`
  as a fallback. On the next run where the same display name appears with an
  email, merge the entities by updating the `source_id` to the email and
  retaining the display-name alias.
- **Meeting entities** — `(subtype: meeting, source: zoom, source_id:
  "zoom:meeting:{meeting_uuid}")`. UUID is stable across the meeting lifecycle.
  Update the entity body in place when summary, recording_url, or next_steps
  change.
- **Chat-thread entities** — `(subtype: chat-thread, source: zoom, source_id:
  "zoom:chat:{channel_or_dm_id}:{zoom_user_id}")`. `zoom_user_id` is the
  numeric Zoom user ID returned by `search_zoom` results and is stable across
  runs regardless of whether the sender's email is resolved. When `zoom_user_id`
  is absent for an anonymous guest, fall back to `display_name_normalised`.
  Never use email as the `source_id` component — email may be absent on one run
  and present on the next, producing two non-matching `source_id` values for the
  same sender in the same channel, which breaks action-item dedup. Email is used
  only for the `person` entity's cross-source alias lookup in `_sources.json`,
  not as the action-item key.
- **Document entities** — `(subtype: document, source: zoom, source_id:
  "zoom:doc:{file_id}")`. File ID is stable across edits.
- **Do NOT write to `_sources.json` directly.** The agntux-core PostToolUse
  hook owns it.

---

## sync.md template

Bootstrap state:

```yaml
---
plugin: agntux-zoom
version: 0.1.0
cursor: null
last_run: null
last_success: null
items_processed: 0
lock: null
errors: (none)
timezone: null
---
```

After the first successful run (onboarding mode, 8 meetings and 6 chat items
processed):

```yaml
---
plugin: agntux-zoom
version: 0.1.0
cursor: '{"meetings_since":"2026-06-25T18:12:50Z","chat_since":"2026-06-25T18:12:50Z"}'
last_run: "2026-06-25T18:12:50Z"
last_success: "2026-06-25T18:12:50Z"
items_processed: 14
lock: null
errors: (none)
timezone: America/New_York
---
```

After a run where no new meetings were found but new chat messages were
processed (cursor still advances because both keys move to `now` atomically):

```yaml
---
plugin: agntux-zoom
version: 0.1.0
cursor: '{"meetings_since":"2026-06-25T18:42:50Z","chat_since":"2026-06-25T18:42:50Z"}'
last_run: "2026-06-25T18:42:50Z"
last_success: "2026-06-25T18:42:50Z"
items_processed: 2
lock: null
errors: (none)
timezone: America/New_York
---
```

---

## Self-validation against fetch.md and frontmatter.yaml

| Claim in fetch.md / frontmatter.yaml | cursor.md alignment |
|---|---|
| Dual-key JSON cursor (`frontmatter.yaml source-cursor-semantics`) | Confirmed — cursor shape section |
| `meetings_since` = lower bound of meetings/recordings window | Confirmed — window derivation section |
| `chat_since` = lower bound of search_zoom window | Confirmed — window derivation section |
| Both keys advance to `now` (run start) on success | Confirmed — advance rules section |
| recordings_list: chunk into ≤31-day sub-windows when window > 31 days | Confirmed — window derivation section |
| Advance only on full-run success (transactional rule); both keys together | Confirmed — advance rules section |
| Bootstrap: cursor null → window starts at now − bootstrap_window_days | Confirmed — bootstrap run section |
| Onboarding-mode caps on first-run-ever | Confirmed — onboarding-mode section |
| No tracked-parent registry | Confirmed — tracked-parent registry section |
| `zoom-cursor-malformed` on JSON parse failure | Confirmed — Step 2 parse section |
| `zoom-timezone-unresolved` exits before any Zoom tool call | Confirmed — Step 2 parse section (timezone resolved at 5a, failure logged and exits) |
| Person entity source_id is participant email | Confirmed — sources.json protocol section |
| No workspace subdomain in Zoom deep links | Confirmed — workspace identifier section |
