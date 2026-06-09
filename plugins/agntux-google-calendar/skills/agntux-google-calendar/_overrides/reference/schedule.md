# User-initiated scheduling — agntux-google-calendar

The user asked to **find a time** or **schedule a meeting** conversationally
(e.g. "find a time to meet next week with Yousef and Dana about product
roadmap, ideally Tuesday"). There is no backing action file. This lane
resolves the meeting details, pre-computes candidate slots, and opens the
schedule view **pre-populated** so the user just picks a slot and clicks
Schedule.

This file is an additive lane with no canonical counterpart — the renderer
passes it through verbatim. It is reached two ways: the `schedule` keyword
(`/agntux-google-calendar schedule …`) and the scheduling-intent redirect at
the top of the ask reference.

## Voice & gate rules

- Speak as the Google Calendar surface of AgntUX. Never name internal
  architecture (router, dispatch, reference file, view tool, `$ARGUMENTS`).
- **This lane never writes.** It calls only the read tool `suggest_time`. The
  Google Calendar event is created **only** when the user clicks Schedule in
  the iframe — that click is the single authorisation gate. Do NOT call
  `create_event` from this lane, and do NOT answer in plain chat with raw
  `suggest_time` output: the whole point is to open the pre-populated view.

## Preflight (interactive context)

This lane runs in interactive chat, not a scheduled-task fire. Skip the
orchestrator gate — `<agntux project root>/user.md` may not exist, and that's
fine. If the user appears to be in a scheduled-task context (no chat input),
exit cleanly with no message — scheduling is interactive only.

Before resolving attendees or user context from the knowledge store, run the
access preflight in the data-access reference: resolve the project root and,
if it isn't readable (e.g. Cowork hasn't mounted the folder), connect it via
the `mcp__cowork__request_cowork_directory` grant before reading. Read the
documented knowledge-store paths rather than blind-scanning the filesystem.

## Procedure

### 1. Resolve attendees

Collect attendee email addresses from the request and the knowledge store
(see the data-access reference for the layout and the person→email recipe):

- Match named people ("Yousef and Dana") against person entities under
  `<agntux project root>/entities/person/{slug}.md` (check `name:` and
  `aliases:`). Prefer an email already recorded on the entity.
- If the entity has no email, grep the ~30 most-recent
  `<agntux project root>/actions/*.md` (by date-prefixed filename) for an
  `@`-address near the person's name — calendar-sourced actions in particular
  carry attendee / participant emails.
- If a name still resolves to no email, keep the display name and leave its
  address for the user to fill in the iframe — do NOT invent an address.
- **Exclude the user's own email** (from `user.md` frontmatter) — the
  organiser is implicit.
- Cap the list at **10** attendees.

### 2. Read user context from `user.md`

If `<agntux project root>/user.md` exists, read (do not write) its frontmatter
and body for:

- `timezone` → `user_timezone` (IANA, e.g. `America/Denver`). Default `"UTC"`
  only if absent — never hardcode a guess.
- `# Working hours` → `preferred_hours.start` / `.end` /
  `.exclude_weekends`. Default `{09:00, 17:00, exclude_weekends: true}`.
- The user's primary calendar id if recorded → `user_primary_calendar_id`
  (default `"primary"`).

### 3. Derive the draft

- `draft_summary`: a concise meeting title from the request topic (e.g.
  "Product roadmap" → "Product roadmap sync"). Editable in the iframe.
- `draft_description`: one or two lines of agenda from the request plus any
  relevant AgntUX context (recent threads/events with those attendees). Keep
  under 600 characters.
- `personalization_signals`: one short bullet per source you used to inform
  the draft (e.g. "Last met with Dana 9 days ago about the Q3 roadmap").
  Omit if none apply.
- `include_google_meet`: default `true`.

### 4. Compute the find-a-time window

Translate the request's time language into `search_window_start` /
`search_window_end` (ISO-8601 with the user's offset):

- "next week" → Monday 00:00 to Sunday 23:59 of the following week.
- "ideally Tuesday" → narrow the window to that day (or keep the week and
  let the slot list surface Tuesday options first).
- No timeframe given → tomorrow 00:00 through tomorrow + 7 days 23:59.
- `duration_minutes`: infer from the request ("30-min call" → 30); default 30.

### 5. Pre-compute candidate slots via `suggest_time`

Call the Google Calendar read tool to find free/busy overlap across all
resolved attendees:

```
suggest_time(
  attendeeEmails  = <attendee_emails>,
  startTime       = <search_window_start>,
  endTime         = <search_window_end>,
  durationMinutes = <duration_minutes>,
  timeZone        = <user_timezone>,
)
```

Map each returned slot to `{ start, end, label? }` and collect them into
`candidate_slots`. If `suggest_time` errors (auth, rate limit) or returns no
overlap, proceed with `candidate_slots: []` — the iframe still opens and the
user can click "Find available times" to retry. This is a **read** call, not
the write gate.

### 6. Open the schedule view with every field inline

Call `agntux_google_calendar_schedule_view` with all resolved fields passed
**inline** (the user-initiated trigger shape — no `action_id` needed):

```
agntux_google_calendar_schedule_view(
  draft_summary            = <draft_summary>,
  draft_description        = <draft_description>,
  attendee_emails          = <attendee_emails>,
  duration_minutes         = <duration_minutes>,
  search_window_start      = <search_window_start>,
  search_window_end        = <search_window_end>,
  preferred_hours          = <preferred_hours>,
  candidate_slots          = <candidate_slots>,
  include_google_meet      = <include_google_meet>,
  user_timezone            = <user_timezone>,
  user_primary_calendar_id = <user_primary_calendar_id>,
  personalization_signals  = <personalization_signals>,
)
```

The view opens pre-filled: title, attendee chips, the candidate-slot radios,
and the prep context. The host renders it as an iframe above the next turn —
**do not** add chat commentary, summarise the slots, or call any other tool
afterwards. The user picks a slot and clicks Schedule; that click emits the
`create_event` envelope (the only write).

`source_link` is intentionally omitted for an ad-hoc request — there is no
originating thread to link back to. (A cross-plugin "Schedule a meeting"
handoff from Slack/Gmail *does* pass `source_link` so the view links to the
source thread; the cross-plugin reference documents that inbound shape.)

## Field-name contract

The inline argument names match the handler's on-disk `## Schedule payload`
field names exactly (`draft_summary`, `draft_description`, `attendee_emails`,
`duration_minutes`, `search_window_start`/`_end`, `preferred_hours`,
`candidate_slots`, `include_google_meet`, `user_timezone`,
`user_primary_calendar_id`, `personalization_signals`, `source_link`). The
schedule-payload reference documents the same shape and the Send envelope; the
cross-plugin reference documents the inbound handoff that reuses these names.

## Out of scope

- Writing to the knowledge store — this lane is read-only.
- Calling `create_event` or any source write tool directly — reserved for the
  iframe Send click.
- Scheduled-task creation / edit — a host UI primitive, not this lane.
