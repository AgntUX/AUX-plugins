# Granola fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
Granola uses a three-phase shape: list meeting notes in the cursor window (Step
5a), batch-hydrate meeting details (Step 5b), then conditionally fetch verbatim
transcripts for meetings that need deeper content to confirm action-item
assignment (Step 5c). Action items are raised for meetings where the user has
assigned follow-ups or action items. Decisions and key information are stored as
entity updates without raising action items.

## Step 5 — Fetch from Granola

Call the tools listed below using the host-resolved names. The host UUID-prefixes
them at runtime (e.g. `mcp__<uuid>__list_meetings`); call them by whatever name
the host exposes. All tools are read-only — do NOT call any write tool during
ingest.

The cursor is read from `data/learnings/agntux-granola/sync.md → cursor` at
Step 2. The cursor is a single ISO-8601 UTC timestamp string (or null on
bootstrap). Keep the cursor value in scope for Step 5.

Do NOT hard-code any folder name, user email, user ID, or account-specific
identifier — all user identity is resolved at runtime from `user.md` or from
the first Granola API response. This fetch shape is general-purpose for any
Granola user.

---

### Step 5a — List meeting notes in the cursor window

**Compute the fetch window** from the cursor parsed at Step 2:

- `window_start` = `cursor` (incremental run) or `now − bootstrap_window_days`
  (bootstrap / null cursor).
- `window_end` = `now` (the run's start timestamp, captured at Step 2).

**Incremental fetch (cursor non-null):**

```
list_meetings({
  time_range: "custom",
  custom_start: <window_start as ISO-8601 UTC>,
  custom_end:   <window_end   as ISO-8601 UTC>
})
```

**Bootstrap fetch (cursor null):**

When `bootstrap_window_days` is 30 or less, prefer the canonical enum value:

```
list_meetings({
  time_range: "last_30_days"
})
```

When `bootstrap_window_days` exceeds 30, use `custom`:

```
list_meetings({
  time_range: "custom",
  custom_start: <ISO-8601 UTC of (now − bootstrap_window_days)>,
  custom_end:   <now as ISO-8601 UTC>
})
```

Default `bootstrap_window_days` is **30** (declared in `frontmatter.yaml`;
user-overridable via `user.md → bootstrap_window_days`).

**Folder scoping (optional).** If the user has configured a folder scope in
`user.md → granola_folder` (a folder name string), first call:

```
list_meeting_folders()
```

Match the configured name (case-insensitive) against the returned folder list
to resolve a `folder_id`. Pass `folder_id` to all `list_meetings` calls this
run. If no folder matches, log `granola-folder-not-found` (kind: `source`)
with the configured name, fall back to fetching all folders (omit
`folder_id`), and continue. Do NOT abort the run for a folder mismatch.

If no folder scope is configured in `user.md`, skip `list_meeting_folders`
entirely and fetch all meetings without a `folder_id` filter.

**Per-run cap.** Cap at **100 meetings per run**. If the listing returns more
than 100 meetings, process the 100 most recent (sort by `start_time`
descending — newest first). Log `granola-pagination-overflow` (kind: `source`)
with the count of deferred meetings. The next run's cursor window will cover
the deferred range.

**Key fields per meeting from list_meetings:** `id` (meeting UUID),
`title`, `start_time` (ISO-8601), `end_time` (ISO-8601), `duration_minutes`,
`attendees` (array of display names and/or emails, if present), `folder_id`
(if any). Keep all returned meetings in working memory keyed by `id`.

---

### Step 5b — Batch-hydrate meeting details

Call `get_meetings` in batches of up to 10 meeting UUIDs per call to retrieve
full meeting detail for all meetings collected in Step 5a.

```
get_meetings({
  meeting_ids: [<up to 10 UUIDs>]
})
```

Repeat until all meetings have been hydrated. Process batches in recency order
(newest first).

**Returns per meeting:** AI summary, private notes, attendees (names and roles
where available), action items / follow-ups (if the connector surfaces them as
structured fields), and full metadata. Merge hydrated fields into the in-memory
meeting map (keyed by `id`).

**On a meeting ID not found** (meeting deleted from Granola between the
`list_meetings` call and the `get_meetings` call): log
`granola-meeting-not-found` (kind: `source`) with the `id`, remove that
meeting from the in-memory map, and continue. Do NOT abort the run.

---

### Step 5c — Conditional transcript fetch

Call `get_meeting_transcript` only when all three conditions hold:

1. The meeting has action items or follow-up text in the hydrated summary that
   mentions a person's name or email but does not explicitly identify who is
   responsible — you need verbatim content to determine whether the user is the
   assignee.
2. The meeting entity is new to the store, OR it has changed since the last run
   (attendee list or summary differs from the stored entity body).
3. The meeting's `start_time` falls within the current run's fetch window.

Do NOT call `get_meeting_transcript` for:

- Meetings where `get_meetings` already clearly identified the user as an
  assignee or clearly identified someone else as the only assignee.
- Meetings that are reference-only (no action items in the summary and no
  follow-ups; these are stored as entity updates without action items).
- Meetings already processed in a prior run whose entity is unchanged.

```
get_meeting_transcript({
  meeting_id: <meeting UUID>
})
```

Cap transcript fetches at **20 meetings per run**. If the cap is reached,
prioritise meetings with the most recent `start_time` and defer the rest to the
next run. The next run will re-evaluate the deferred meetings if they remain
within the cursor window.

**On transcript unavailable** (tool returns empty or an error for a specific
meeting): log `granola-transcript-unavailable` (kind: `source`) with the
meeting UUID, skip the transcript for this meeting, and continue. Still process
the meeting using the summary and notes from `get_meetings` — do NOT drop the
meeting entirely.

---

### Step 5 — Triage signals

Evaluate each hydrated meeting (with or without transcript) for the following
conditions. Carry matching meetings forward to Steps 6–10.

#### Signal 1 — Action item or follow-up assigned to the user (response-needed)

A meeting is action-worthy with class `response-needed` when ANY of the
following hold:

- The AI summary, private notes, or structured action-item fields from
  `get_meetings` contain text indicating a task, follow-up, or commitment
  attributable to the user (the user's name or email appears in the context
  of an action, or the meeting has a private-notes section in first person
  indicating the user recorded a follow-up for themselves).
- The verbatim transcript (if fetched) contains explicit assignment of an action
  to the user by name or email.

Raise **one action item per meeting** (do not raise one per action item
mentioned in the meeting — group all follow-ups and action items from the same
meeting into a single action body). Source ID:
`granola:action:{meeting_id}`.

#### Signal 2 — Key decision or information requiring review (other)

A meeting is worth storing as a reference update (entity write without an
action item) when:

- The AI summary contains a key decision, resolution, or important context the
  user was part of but no user-assigned action items were identified.
- The meeting is new to the store (no prior entity with
  `source_id: granola:meeting:{meeting_id}`).

Write or update the `meeting` entity with the summary. Do NOT raise an action
item for this signal — it is a knowledge-store update only.

#### Signal 3 — Meeting with no summary or actions (entity-only)

When `get_meetings` returns a meeting with no AI summary, no private notes, and
no action items (e.g., a very short meeting or one Granola did not fully
process): write a minimal `meeting` entity with the available list-level fields
(title, date, attendees). Do NOT raise an action item. This keeps the meeting on
record for the ask sub-command without generating noise.

---

### Step 5 — On fetch failure

Log all failures to `data/learnings/agntux-granola/sync.md → errors`. Slice the
errors list to the last 10 entries (newest-first) before writing. See the
failure modes table at the end of this file for the full per-kind action policy.
Key rules:

- **Run-level exits** (auth 401/403 on `list_meetings`, 429 rate-limit,
  network failure): release the lock and exit immediately. The transactional
  rule at Step 11 keeps the cursor at its pre-run value.
- **Per-item skips** (meeting not found in `get_meetings`, transcript
  unavailable): log with the meeting UUID, skip that item, continue the run.
- **Cursor malformed** (stored value not a parseable ISO-8601 timestamp): log
  `granola-cursor-malformed` (kind: `parse`), treat as null, fall back to
  bootstrap window, and continue.

---

## Entity subtype mapping table

| Granola resource | Entity subtype | Plain-language label |
|---|---|---|
| Meeting attendee or mentioned person | `person` (source_id: attendee email; fallback to display name slug if email unavailable) | "person" |
| Meeting note (with summary, transcript, or actions) | `meeting` | "meeting" |

`person` entities are created from meeting attendees and any people mentioned
in action items (lookup-before-write at Step 6; never create duplicates for the
same email). `meeting` entities carry title, start time, end time, duration,
attendee list, AI summary excerpt, private notes excerpt, and a list of
action-item text items.

---

## Action item shapes by signal type

### User-assigned action items from meeting (response-needed)

```yaml
title: "Follow-ups from: {meeting_title}"
kind: response-needed
source_id: "granola:action:{meeting_id}"
suggested_actions:
  - label: "Open in Granola"
    url: "https://granola.so/meetings/{meeting_id}"
```

Body: meeting date and time (user's local timezone from `user.md`), duration,
attendees (display names), AI summary excerpt (first 300 characters of the
summary text), and a bulleted list of the action items or follow-ups assigned
to or recorded by the user. Include private-notes content only when it contains
the user's own first-person follow-up notes (strip boilerplate or template
text).

---

## Deduplication

`source_id` namespaces: `granola:action:` and `granola:meeting:` are distinct —
the same `meeting_id` may hold an open action (`granola:action:{meeting_id}`)
while also being referenced as a meeting entity (`granola:meeting:{meeting_id}`).

Before raising any action at Steps 8–9, check `_sources.json` and
`actions/_index.md`:

- An existing **open** action with the same `source_id` means the item was
  already raised. Update the entity body if the meeting summary has changed
  (new action items added or existing ones updated), but do NOT raise a new
  action item.
- A **closed or dismissed** action may be re-raised only when new action items
  have been added to the meeting since the prior run (updated summary or
  transcript contains new assignments not present when the action was closed).
- New `source_id` → create a new action item normally.

---

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| Auth failure (401 / 403) from `list_meetings` | `auth` | exit, release lock, retry next run |
| Network-level failure | `network` | exit, release lock, retry next run |
| Rate limit (429) from any tool | `source` + `granola-rate-limited` | stop fetching, release lock, retry next run |
| `get_meetings` returns no result for a known meeting UUID | `source` + `granola-meeting-not-found` | log with UUID, skip meeting, continue |
| `get_meeting_transcript` returns empty or error | `source` + `granola-transcript-unavailable` | log with UUID, skip transcript, still process meeting from summary data, continue |
| Per-run meeting cap (100) reached in Step 5a | `source` + `granola-pagination-overflow` | log deferred count, process collected meetings; cursor advances to newest processed |
| Per-run transcript cap (20) reached in Step 5c | `source` + `granola-pagination-overflow` | log deferred count, continue with summary-only triage for remaining meetings |
| Cursor value not a parseable ISO-8601 timestamp | `parse` + `granola-cursor-malformed` | treat as null, fall back to bootstrap window, log, continue |
| Configured folder name not found in `list_meeting_folders` | `source` + `granola-folder-not-found` | log with folder name, fall back to all-folder fetch, continue |
