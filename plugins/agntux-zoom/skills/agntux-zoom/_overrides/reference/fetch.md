# Zoom fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
Zoom uses a five-phase shape: resolve user timezone (Step 5a), list meetings and
recordings in the cursor window (Step 5b), fetch per-meeting assets and recording
resources for new or updated meetings (Step 5c), search Team Chat for unread
mentions and recently-modified Docs (Step 5d), then triage action signals (Step
5e). Action items are raised for meetings with user-assigned next steps, unread
Team Chat mentions, and recently-modified Docs the user needs to review.

## Step 5 — Fetch from Zoom

Call the tools listed below using the host-resolved names. The host UUID-prefixes
them at runtime (e.g. `mcp__<uuid>__search_meetings`); call them by whatever name
the host exposes. All tools are read-only — do NOT call any write or scheduling
tool during ingest.

All cursors are read from `data/learnings/agntux-zoom/sync.md → cursor` at Step
2. The cursor is a JSON object with keys `meetings_since` and `chat_since`; parse
it at Step 2 and keep both values in scope for Step 5. Bootstrap state:
`cursor: null` (treat both keys as null).

Do NOT hard-code any user email, user ID, meeting topic, channel name, or
account-specific identifier — all user identity is resolved at runtime from
`user.md` or from the first Zoom API response. This fetch shape is
general-purpose for any Zoom user.

---

### Step 5a — Resolve user timezone

`search_meetings` requires the user's timezone before it can be called. Resolve
it once per run before any other Zoom tool call:

1. Read `user.md → timezone` (e.g. `America/New_York`). If present and
   non-empty, use it directly.
2. If `user.md → timezone` is absent, check whether a prior run has written
   `data/learnings/agntux-zoom/sync.md → timezone` and use that value.
3. If neither source yields a timezone, log `zoom-timezone-unresolved`
   (kind: `source`), release the lock, and exit. Do NOT proceed — all
   `search_meetings` calls will fail without it.

Store the resolved timezone in working memory for the rest of the run. Persist
it to `data/learnings/agntux-zoom/sync.md → timezone` at Step 11 if it was not
already stored there (first-run capture).

---

### Step 5b — List meetings and recordings in cursor window

**Compute the fetch window** from the cursor parsed at Step 2:

- `window_start` = `cursor.meetings_since` (incremental) or
  `now − bootstrap_window_days` (bootstrap / null cursor).
- `window_end` = `now` (the run's start timestamp, captured at Step 2).

#### 5b-i — List meetings via search_meetings

```
search_meetings({
  from: <window_start as yyyy-mm-dd in user timezone>,
  to:   <window_end   as yyyy-mm-dd in user timezone>,
  timezone: <resolved timezone>
})
```

Page while the response carries a `next_page_token`. Cap at **200 meetings per
run** across all pages. If the cap is reached, log `zoom-pagination-overflow`
(kind: `source`) with the count deferred and stop paging; proceed with meetings
collected so far.

Key fields per meeting: `meeting_uuid`, `meeting_number`, `topic`,
`schedule_start_time`, `meeting_status` (`HISTORY` | `SCHEDULED`), `host`,
`duration`, `timezone`.

Keep all returned meetings in working memory, keyed by `meeting_uuid`.

#### 5b-ii — List recordings via recordings_list

`recordings_list` enforces a maximum 1-month (31-day) window per call. When the
fetch window exceeds 31 days (bootstrap or a long gap since the last run), split
into consecutive sub-windows of at most 31 days each, with no overlap.

**Sub-window boundary rule.** Convert `window_start` and `window_end` to
`yyyy-mm-dd` dates first. Then partition using a non-overlapping exclusive-left
boundary so that each handoff date appears in exactly one sub-window:

```
sub_start_date = date(window_start)   # yyyy-mm-dd, truncated from UTC timestamp
sub_end_date   = date(window_end)

chunks = []
cursor_date = sub_start_date
while cursor_date <= sub_end_date:
  chunk_end = min(cursor_date + 30 days, sub_end_date)  # +30 gives ≤31-day span [cursor_date … chunk_end]
  chunks.append([cursor_date, chunk_end])
  cursor_date = chunk_end + 1 day                        # exclusive: next chunk starts the day after

for each [chunk_from, chunk_to] in chunks (oldest to newest):
  recordings_list({
    from: <chunk_from as yyyy-mm-dd>,
    to:   <chunk_to   as yyyy-mm-dd>
  })
  # paginate via next_page_token within each sub-window
```

Using `+30 days` (not 31) as the increment ensures the span
`[chunk_from … chunk_to]` is at most 31 calendar days inclusive, satisfying the
API's max-1-month-window constraint. The final chunk will be shorter if the
remaining span is less than 31 days.

If the total window spans multiple months, iterate from oldest to newest. Cap at
**100 recording items total** across all sub-windows and pages. If the cap is
reached, log `zoom-pagination-overflow` (kind: `source`) with the count deferred.

Key fields per recording item: `id` (meetingId / UUID), `topic`, `start_time`,
`duration`, `total_size`, `recording_count`. Merge recording metadata into the
in-memory meeting map keyed by meeting UUID (match on UUID where possible,
fallback to `meeting_number`).

---

### Step 5c — Fetch per-meeting assets and recording resources

For each meeting collected in Step 5b, determine whether asset/transcript fetch
is needed:

**Asset fetch is needed when any of the following is true:**

- `meeting_status` is `HISTORY` (completed meeting) AND the meeting is new to
  the store (no existing entity with `source_id: zoom:meeting:{meeting_uuid}`).
- The meeting entity exists but its stored `schedule_start_time` or `topic`
  differs from the API response (meeting was updated — rescheduled or renamed).
- The meeting has a recording entry from Step 5b-ii but no recording asset has
  been stored yet.

**Asset fetch is NOT needed when:**

- `meeting_status` is `SCHEDULED` AND more than 2 hours remain before
  `schedule_start_time`. (Upcoming meetings are noted as entities but no deep
  asset fetch is warranted yet. The meeting will be re-evaluated on a later run
  once completed.)
- The meeting entity already exists with current fields and no recording exists.

#### 5c-i — get_meeting_assets

```
get_meeting_assets({
  meetingId: <double-encoded meeting_uuid>
})
```

**Double-encoding requirement.** Zoom meeting UUIDs that contain `/` or `+`
characters must be double-URL-encoded before passing as a path segment.
Apply `encodeURIComponent(encodeURIComponent(meeting_uuid))` before the call.
If the meeting_uuid contains neither `/` nor `+`, single encoding is sufficient,
but double-encoding is always safe.

Returns: `meeting_summary` (fields: `summary_overview`, `summary_details`
(full text), `next_steps` (array of text items)), `my_notes`, `recording`
(metadata), `whiteboards`, `docs`, `agenda_doc`, `participants` (array of
display names and emails).

**On 403 (not host or not granted):** log `zoom-meeting-access-denied` (kind:
`source`) with the `meeting_uuid`, skip asset fetch for this meeting, still
create or update the entity with list-level data from Step 5b, and continue.
Do NOT abort the run.

**On 404 (bad or expired meeting ID):** log `zoom-meeting-not-found` (kind:
`source`) with the `meeting_uuid`, skip the meeting entirely, and continue.

**On success:** extract `meeting_summary.next_steps` (array of text items),
`participants` (array of `{display_name, email}`), and recording metadata into
working memory for this meeting.

#### 5c-ii — get_recording_resource (conditional)

Call only when the meeting has a cloud recording (confirmed by either Step 5b-ii
or the `recording` field returned by `get_meeting_assets`):

```
get_recording_resource({
  meetingId: <double-encoded meeting_uuid>,
  types: "transcript,summary,nextStep,playUrl"
})
```

Returns: `transcripts` (timeline array of `{text, ts, end_ts, display_name}`),
`summaries` (`overall_summary` string + `items` array), `next_steps`
(`items[].text`), `play_urls` (array of playback URLs).

Store the `play_urls[0]` (first play URL) as the `recording_url` on the meeting
entity. Merge `next_steps.items[].text` with those from `get_meeting_assets`
(union, dedupe by exact text match).

**On 404:** log `zoom-recording-not-found` (kind: `source`) with the
`meeting_uuid`, skip transcript/recording details for this meeting, continue.

**Volume cap interaction.** Cap the combined get_meeting_assets +
get_recording_resource calls at **50 meetings per run**. If more than 50
meetings need asset fetch (Step 5b returned many new HISTORY meetings), prioritise
by recency (`schedule_start_time` descending — newest first). Log the count of
deferred meetings with `zoom-pagination-overflow` if the cap is hit. The next
run's cursor window will re-evaluate deferred meetings.

---

### Step 5d — Search Team Chat and Zoom Docs

#### 5d-i — Unread Team Chat mentions

```
search_zoom({
  search_entities: [
    {
      entity_type: "chat",
      filters: {
        from: <cursor.chat_since as ISO-8601 UTC>  # or now − bootstrap_window_days on bootstrap
        to:   <now as ISO-8601 UTC>,
        unread: true
      }
    }
  ]
})
```

On bootstrap (cursor.chat_since null): set `from` to `now − bootstrap_window_days`.

Page while a continuation token is present. Cap at **100 chat messages per run**.
Key fields per message: `message_id`, `sender_display_name`, `sender_email` (if
present), `channel_name` (or DM partner name), `timestamp`, `message` (text
body), `mention_type` (if available).

Keep only messages where the user is explicitly mentioned or where it is a direct
message to the user (i.e., filter out channel noise that does not require a
response). If the connector does not expose a mention filter, keep all unread
messages from the window and apply triage at Step 5e.

#### 5d-ii — Recently modified Zoom Docs

```
search_zoom({
  search_entities: [
    {
      entity_type: "zoom_doc",
      filters: {
        from: <cursor.chat_since as ISO-8601 UTC>,
        to:   <now as ISO-8601 UTC>,
        doc_view: "shared_with_me"
      }
    }
  ]
})
```

Cap at **50 Docs per run**. Key fields per Doc item: `file_id`, `title`,
`modified_at`, `owner_display_name`, `doc_url`.

For Docs that are new or recently modified AND appear action-worthy (see triage
in Step 5e), fetch the full content:

```
get_file_content({ fileId: <file_id> })
```

Limit full-content fetches to at most **10 Docs per run** (content fetches are
higher-cost; triage on title and metadata first, fetch content only when the
Doc is clearly action-worthy based on title alone or cannot be triaged without
content).

---

### Step 5e — Triage signals

Evaluate each collected item for the following conditions. An item may satisfy
more than one signal. Carry matching items forward to Steps 6–10.

#### Meeting signals

1. **User-assigned next steps** (`meeting_status: HISTORY`, `get_meeting_assets`
   returned `meeting_summary.next_steps` items whose text contains the user's
   name or matches their email, OR `get_recording_resource` returned
   `next_steps.items` whose text contains the user's name or email): the user has
   an outstanding action item from this meeting. Action class: `response-needed`.
   Raise one action item per meeting (group all next steps for that meeting into
   a single action body; do not raise one action per next step).

2. **Upcoming meeting within 2 hours** (`meeting_status: SCHEDULED`,
   `schedule_start_time` within 2 hours of `now`): an imminent meeting the user
   should be aware of. Action class: `deadline`. Raise only when no open deadline
   action with the same `source_id` already exists (dedup at Step 9).

   **Placeholder-meeting guard (do not raise a prep action):** skip the
   `deadline` action when the meeting looks like a personal placeholder rather
   than a real working session — i.e. ALL of: the topic is a Zoom default title
   (case-insensitive match of `My Meeting`, `Zoom Meeting`, `<host>'s Zoom
   Meeting`, or `<host>'s Personal Meeting Room`), `attendee_size <= 1` (only the
   host, no other invitees), and there is no agenda, summary, or recording. Still
   write the lightweight `meeting` entity (so the meeting is on record), but do
   NOT raise an action item — these are almost always instant/test meetings and
   raising a prep action for them is noise for every user. A meeting with real
   invitees or a non-default title is never suppressed by this guard, even if it
   has no agenda yet.

3. **New completed meeting with recording** (`meeting_status: HISTORY`, recording
   present, entity is new this run): a completed meeting has a recording
   available. Action class: `other`. Include the recording play URL and summary.

   Do NOT raise a separate `other` action for a meeting that already raised a
   `response-needed` action from signal 1 — merge the recording URL and summary
   into that action item's body instead.

4. **Meeting with unresolved AI summary** (`meeting_status: HISTORY`,
   `get_meeting_assets` returned `meeting_summary.summary_overview` non-empty,
   entity is new this run, no next steps assigned to user): the AI generated a
   summary worth storing but no user-assigned next steps were found. Write the
   entity with the summary but do NOT raise an action item — this is a reference
   store update only.

#### Team Chat signals

5. **Unread direct message or explicit @mention** (chat message from Step 5d-i,
   `unread: true`, direct message OR the user's name/email appears in the message
   text): requires a response. Action class: `response-needed`. Raise one action
   item per sender per conversation thread per run (do not raise one action per
   message when multiple unread messages exist from the same sender in the same
   channel within the window — group them). Source ID:
   `zoom:chat:{channel_or_dm_id}:{zoom_user_id}`.

#### Zoom Docs signals

6. **Doc shared or modified, no open action exists** (Doc from Step 5d-ii,
   modified_at > cursor.chat_since or new to the store, no open action item with
   source_id `zoom:doc:{file_id}`): a Doc the user should review. Action class:
   `other`. Include title, owner, a one-sentence excerpt from the first 200 chars
   of content (if fetched), and the doc URL.

---

### Step 5 — On fetch failure

Log all failures to `data/learnings/agntux-zoom/sync.md → errors`. Slice the
errors list to the last 10 entries (newest-first) before writing. See the
failure modes table at the end of this file for the full per-kind action
policy. Key rules:

- **Run-level exits** (auth 401/403 on list calls, 429 rate-limit, network, or
  timezone-unresolved): release the lock and exit immediately. Step 11's
  transactional rule keeps both cursor keys at their pre-run values.
- **Per-item skips** (404/403 on `get_meeting_assets`, 404 on
  `get_recording_resource`): log with the UUID, skip that item, continue the run.
- **Cursor malformed**: log `zoom-cursor-malformed` (kind: `parse`), treat both
  keys as null, fall back to bootstrap window, continue.

---

## Entity subtype mapping table

| Zoom resource | Entity subtype | Plain-language label |
|---|---|---|
| Meeting participant | `person` (source_id: participant email; fallback to display_name if email unavailable) | "person" |
| Meeting / scheduled call | `meeting` | "meeting" |
| Team Chat message thread | `chat-thread` | "chat thread" |
| Zoom Doc / Notes file | `document` | "document" |

`person` entities are created from meeting participants and chat senders
(lookup-before-write at Step 6; never create duplicates for the same email).
`meeting` entities carry topic, start time, duration, host, participants list,
AI summary text, next steps, and recording_url (if a recording is available).
`chat-thread` entities carry channel/DM name, sender, timestamp, and message
text. `document` entities carry title, owner, modified_at, doc_url, and a brief
excerpt.

---

## Action item shapes by signal type

### User-assigned next steps from meeting (response-needed)

```yaml
title: "Action items from: {meeting_topic}"
kind: response-needed
source_id: "zoom:next-steps:{meeting_uuid}"
suggested_actions:
  - label: "Open recording"
    url: "{recording_play_url}"        # omit when no recording URL is available
  - label: "Open in Zoom"
    url: "https://zoom.us/rec/play/{meeting_uuid}"
```

Body: meeting date/time (user's local timezone), participants, AI summary
excerpt (first 300 chars of `summary_overview`), and a bulleted list of the
user-assigned next steps.

### Upcoming meeting within 2 hours (deadline)

```yaml
title: "Meeting in <N> minutes: {meeting_topic}"
kind: deadline
source_id: "zoom:upcoming:{meeting_uuid}"
suggested_actions:
  - label: "Open in Zoom"
    url: "https://zoom.us/j/{meeting_number}"
```

Body: start time (user's local timezone), duration, participants (list data
from Step 5b — no asset fetch for SCHEDULED meetings).

### New recording available (other)

```yaml
title: "Recording available: {meeting_topic}"
kind: other
source_id: "zoom:recording:{meeting_uuid}"
suggested_actions:
  - label: "Watch recording"
    url: "{recording_play_url}"
  - label: "Open in Zoom"
    url: "https://zoom.us/rec/play/{meeting_uuid}"
```

Body: meeting date, duration, AI summary excerpt, first 3 speaker turns from
transcript if available. Do NOT raise a separate `other` action for a meeting
that already raised a `response-needed` from the next-steps signal — merge the
recording URL and summary into that action's body instead.

### Unread Team Chat mention or DM (response-needed)

```yaml
title: "Unread message from {sender_display_name} in {channel_or_dm_name}"
kind: response-needed
source_id: "zoom:chat:{channel_or_dm_id}:{zoom_user_id}"
suggested_actions:
  - label: "Open in Zoom"
    url: "https://zoom.us/launch/chat"
```

Body: sender name, channel/DM name, timestamp of the most recent message, text
of up to 3 messages (oldest to newest). Group all unread messages from the same
sender in the same channel within the window into one action item.

### Zoom Doc shared or updated (other)

```yaml
title: "Document updated: {doc_title}"
kind: other
source_id: "zoom:doc:{file_id}"
suggested_actions:
  - label: "Open document"
    url: "{doc_url}"
```

Body: title, owner display name, modified timestamp (user's local timezone),
one-sentence excerpt from content (first 200 chars, if fetched).

---

## Deduplication

`source_id` namespaces: `zoom:next-steps:`, `zoom:upcoming:`, `zoom:recording:`,
`zoom:chat:`, `zoom:doc:`. These are distinct — the same `meeting_uuid` can hold
open actions in multiple namespaces simultaneously without conflict.

Before raising any action at Steps 8–9, check `_sources.json` and
`actions/_index.md`. Open existing action → update entity body, do NOT raise new
action. Closed/dismissed → re-raise only on material change (new next steps, new
batch of unread messages). New `source_id` → create normally.

---

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| Auth failure (401 / 403 from search_meetings or recordings_list) | `auth` | exit, release lock, retry next run |
| Network-level failure | `network` | exit, release lock, retry next run |
| Rate limit (429) from any tool | `source` + `zoom-rate-limited` | stop fetching, release lock, retry next run |
| Timezone not resolvable | `source` + `zoom-timezone-unresolved` | exit, release lock, retry next run |
| `get_meeting_assets` returns 404 | `source` + `zoom-meeting-not-found` | log with UUID, skip asset fetch, continue |
| `get_meeting_assets` returns 403 | `source` + `zoom-meeting-access-denied` | log with UUID, skip asset fetch, store list-level entity, continue |
| `get_recording_resource` returns 404 | `source` + `zoom-recording-not-found` | log with UUID, skip transcript detail, continue |
| recordings_list window > 31 days without chunking | `source` + `zoom-recordings-window-exceeded` | split window, retry sub-windows |
| Per-run meeting asset cap (50) reached | `source` + `zoom-pagination-overflow` | log deferred count, continue to writes for collected items; cursor advances to `now` for processed items only |
| Per-run meetings list cap (200) reached | `source` + `zoom-pagination-overflow` | log deferred count, continue |
| Per-run chat cap (100) or Docs cap (50) reached | `source` + `zoom-pagination-overflow` | log deferred count, continue |
| Cursor JSON malformed / not parseable | `parse` + `zoom-cursor-malformed` | treat both keys as null, fall back to bootstrap window, log, continue |
