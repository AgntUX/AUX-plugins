# Fetch — agntux-google-calendar
# Wholesale replacement of canonical reference/fetch.md for this plugin.
#
# Step 5 of the sync body delegates entirely to this file. Follow the
# sub-steps below in order. All tool calls use the runtime-prefixed form
# `mcp__claude_ai_GoogleCalendar__{tool}` — the host resolves the UUID
# prefix; never hardcode it.

---

## Overview

This plugin is **forward-looking only.** The fetch window is always
`[now(), now() + 7 days)`. Past events are not re-ingested; events whose
`start` has passed evict from the cursor map and their action files are
archived (Step 5i). The 80-event volume cap applies across all calendars
combined per run.

---

## Step 5a — List calendars and filter writable

```
mcp__claude_ai_GoogleCalendar__list_calendars()
```

Partition the result into:

- **Writable** — `accessRole` is `owner` or `writer`. Action items are
  generated from these calendars.
- **Read-only** — `accessRole` is `reader` or `freeBusyReader`. Retained
  for conflict detection only; do not generate action items.

Store both lists in working context. If `list_calendars` returns an auth
error, log `kind: auth` and stop.

---

## Step 5b — List events for the look-ahead window

For each calendar in the **full merged list** (writable + read-only):

```
mcp__claude_ai_GoogleCalendar__list_events(
  calendarId      = <calendar_id>,
  startTime       = <now() as RFC3339>,
  endTime         = <now() + 7 days as RFC3339>,
  singleEvents    = true,
  eventTypeFilter = ["default"],
  orderBy         = "startTime",
  pageSize        = 50
)
```

Skip events whose `event.eventType` is one of: `outOfOffice`, `focusTime`,
`workingLocation`, `birthday`, `fromGmail`.

**Pagination:** Continue via `nextPageToken` until absent. Stop and log
`kind: google-calendar-pagination-aborted` once the running total reaches
80 events. Deduplicate by `event.id` — prefer the writable-calendar copy.

If context budget is tight during the list phase, switch to `pageSize=10`
for subsequent pages.

---

## Step 5c — Per-event detail fetch (cursor diff)

For each event, compare `event.updated` against
`cursor["<calendarId>#<eventId>"]` (or
`cursor["<calendarId>#<eventId>#<occurrenceStart>"]` for recurring
instances).

**Call `get_event`** when any of:
1. No cursor entry (first time seen).
2. `event.updated > cursor_entry`.
3. Description appears truncated (ends mid-sentence or absent).
4. Attendee list appears incomplete.

```
mcp__claude_ai_GoogleCalendar__get_event(
  eventId    = <event.id>,
  calendarId = <event.calendarId>
)
```

Skip `get_event` (cache hit) when cursor matches `event.updated` exactly
and description/attendees are complete.

- `event.status == "cancelled"` → set `cancelled: true`; handle in Step 5e.
- 404 → log `kind: google-calendar-event-not-found`, remove cursor entry, skip.

---

## Step 5d — Classify each event into an action class

Apply in priority order (highest wins). Identify the user's attendee entry
via `attendee.self == true`.

**1. `response-needed`** — classify ONLY when the event is a freshly-arrived
invite the user has not yet acted on. Both conditions must hold:
- `attendee.self.responseStatus === "needsAction"`, AND
- either `event.recurringEventId` is unset (non-recurring event), OR no
  prior occurrence under the same `recurringEventId` is present in the cursor
  map with a `response-needed`-resolved or `meeting-prep` classification (i.e.,
  the user has no prior response record for this series in the cursor).

Recurring instances where the user has already responded to the series are NOT
`response-needed`. Apply: if an accepted/tentative prior occurrence exists in
the cursor for the same `recurringEventId` → classify as `meeting-prep`
(inherit the series-level acceptance). If declined → skip (do not emit).

**Fresh bootstrap with no cursor history:** treat the master series as accepted
if the next occurrence in the window has `responseStatus === "accepted"` or
`"tentative"` — classify that first occurrence as `meeting-prep`. If the first
occurrence is `needsAction` and no prior occurrence exists anywhere in the
cursor, classify as `response-needed`; subsequent occurrences in the same run
inherit that series-level decision.

Title: `"Respond to invite: {event.summary}"`
Route to `respond` view tool (`ui://agntux-google-calendar/respond`).

**2. `risk`** — double-booking
Condition: `[event.start, event.end)` overlaps another accepted/tentative
event (`A.start < B.end AND A.end > B.start`), and the user is also
accepted/tentative on the current event.
Title: `"Conflict: {event.summary} overlaps {other.summary}"`
Populate `conflicts` in compose payload. Route to `respond` view tool.

**3. `deadline`** — prep deliverable signal
Condition: `summary` or `description` (first 500 chars) matches
`\b(review|prepare|submit|deliver|finalize|send before|draft by)\b`
within the same sentence as a capitalised noun.
Title: `"Prep deliverable for {event.summary}"`
Informational only — no `host_prompt`; populate `url` deep link only.

**4. `meeting-prep`** — accepted/tentative meeting with ≥1 other attendee
Conditions: `responseStatus` is `"accepted"` or `"tentative"`, ≥2
entries in `attendees`, `event.start.dateTime` present (not all-day), and
no higher-priority signal applies.
Title: `"Prep for {event.summary} ({relative_time})"` where
`relative_time`: same day → `"today at {HH:MM}"`; +1 day →
`"tomorrow at {HH:MM}"`; 2–6 days → `"in {N} days"`.
Route to `respond` view tool ONLY when user is `"tentative"`.

**5. `other`** — catch-all. Skip; log `skipped: class-other`.
Read-only calendar events that trigger a `risk` signal appear only as
`other_event` in the conflict payload — no standalone action item.

---

## Step 5e — Handle cancelled events

For each event with `cancelled: true`:
1. Look up the action file in `actions/_index.md` by `source_id`
   `google-calendar:<calendarId>#<eventId>`.
2. If open: set `deleted_upstream: true`, `status: done`,
   `resolution: "auto-resolved — event cancelled upstream"`. Update index.
3. Remove `cursor["<calendarId>#<eventId>"]`.
4. Log `kind: google-calendar-event-cancelled`.

Do not create new action items for cancelled events.

---

## Step 5f — Build prep context (meeting-prep and response-needed only)

For `meeting-prep` and `response-needed` events, enrich the compose
payload from the agntux-core knowledge store (local filesystem — no MCP
calls). All paths are relative to the agntux project root.

### 5f.1 — Attendee people entries

For each attendee (excluding the user), look up
`people/<email-slug>.md` where `email-slug` = email with `@` → `-at-`
and `.` → `-` (e.g. `maya.chen@acme.com` → `people/maya-chen-at-acme-com.md`).
Also try `people/<local-part>.md`. Extract: display name, role, `last_active`,
first sentence of `## Summary` (≤120 chars). If absent, note `(new contact)`.

### 5f.2 — Project entity resolution

From `summary` and `description` (first 300 chars), extract project
codenames. Match against `user.md → # Glossary` and `projects/*.md`
(`name` / `aliases` frontmatter). For each match: read up to 3 recent
action items mentioning the project key (grep `actions/`, sort by
`updated_at` desc) and up to 3 `## knowledge-update` entries from the
project file. Record file paths.

### 5f.3 — Recent cross-source signals

Grep `sources/slack/threads/*.md`, `sources/gmail/threads/*.md`, and
`sources/linear/issues/*.md` for files modified within 14 days that
mention any attendee email or project codename. Deduplicate, cap at 6
items sorted by modification time desc. Record: file path, source type,
80-char matching excerpt.

### 5f.4 — Compose prep bullets

From 5f.1–5f.3, compose 4–6 bullets. Each bullet: ≤140 chars plain text,
with a `source` backlink `{ type, path, display }`. Favour recency and
direct relevance. Use fewer than 4 if fewer high-signal items exist — do
not pad. For `response-needed` with no prior signals, `prep_bullets: []`
is valid.

---

## Step 5g — Emit action files

For each non-`other`, non-`cancelled` event:

### Filename
`actions/{YYYY-MM-DD}-google-calendar-{event-slug}.md`
`{event-slug}` = 3–5 word kebab-case from `summary` (lowercase, stop-words
removed, ≤40 chars). For recurring instances append occurrence date:
`…-{slug}-{occurrence-date}.md`.

### Frontmatter
```yaml
---
source: agntux-google-calendar
source_id: google-calendar:<calendarId>#<eventId>
reason_class: <action_class>
reason_detail: "<[tag] detail string>"
priority: <high|medium|low>
status: open
created_at: <ISO-8601 run timestamp>
updated_at: <ISO-8601 run timestamp>
deleted_upstream: false
---
```

`reason_detail` tags: `[response-needed] Invite from {organizer.name}: "{summary}"` /
`[meeting-prep] {N} attendees; starts {relative_time}` /
`[risk] Overlaps {other.summary} ({other.start}–{other.end})` /
`[deadline] Prep deliverable signal in title/description`

Priority: `high` — within 24h or `response-needed` or `risk`;
`medium` — 2–4 days or standard `meeting-prep`; `low` — 5–7 days or `deadline`.

### Body sections (in order)

1. **`## Why this is here`** — 2–3 sentences citing the specific signal.
2. **`## Event context`** — one line each: title, start (`"Day, Month DD at HH:MM tz"`), end, location, video link, organizer, calendar, recurring flag.
3. **`## Attendees`** — `{displayName} <{email}> — {responseStatus}` per attendee; `(optional)` suffix where applicable.
4. **`## Respond payload`** (`response-needed`, `risk`, tentative `meeting-prep`) — per `reference/respond-payload.md`. This is the exact header the respond view reads via `extractFencedYaml(content, "Respond payload")`; a `## Compose payload`-named section is silently skipped → "Untitled event". Omit entirely for `deadline` class.
5. **`## Suggested actions`** — by class:
   - `response-needed`: `"Respond to invite"` (host_prompt) + `"Open in Google Calendar"` (url)
   - `meeting-prep` tentative: `"Change response"` (host_prompt) + `"Open in Google Calendar"` (url)
   - `meeting-prep` accepted: `"Open in Google Calendar"` (url only)
   - `risk`: `"Resolve conflict"` (host_prompt) + `"Open in Google Calendar"` (url)
   - `deadline`: `"Open in Google Calendar"` (url only)
   host_prompt form: `"Use the agntux-google-calendar plugin to open the respond view for action {id}"`
6. **`## User notes`** — empty section, present but blank.

The `schedule` view tool is NOT triggered by ingest. Its payload is
constructed by the calling plugin. See `reference/cross-plugin.md`.

---

## Step 5h — Volume cap and summary

If the 80-event cap was reached:
1. Log `kind: google-calendar-pagination-aborted` with `events_processed: 80`
   and `calendars_remaining: {N}`.
2. Write a warning in the Step 11 sync summary:
   `WARNING: volume cap (80 events) reached. {N} calendar(s) may have unchecked events.`
3. The cursor advances to the last successfully processed event's `updated`
   timestamp (Step 5i governs eviction).

---

## Step 5i — Identify and archive past-event action files

Scan the cursor map for entries whose event `start.dateTime` is before
`now()`. For each:
1. If action file is `status: open` — leave it; do NOT auto-resolve.
2. If `status: done` or `status: dismissed` — archive: write to
   `sources/google-calendar/archive/{original-filename}`, confirm write,
   remove original, update `actions/_index.md`.
3. Mark `pending_cursor_eviction: true` in working context (in-memory only).
4. Do NOT log eviction here — Step 11 logs `kind: google-calendar-cursor-evicted`
   per entry at cursor-write time.
