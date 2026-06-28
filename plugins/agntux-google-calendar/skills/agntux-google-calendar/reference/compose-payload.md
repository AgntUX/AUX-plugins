# Compose payload schema — agntux-google-calendar
# Wholesale replacement of canonical reference/compose-payload.md.
#
# The `## Compose payload` body section in each action file pre-composes the
# structured content the view tool lifts from disk at click time.
# The view tool reads this section as YAML. Field names are stable contracts
# between ingest and the view-tool renderer — do not rename them.

---

## For `response-needed` and `meeting-prep` (respond view)

Both classes route to `ui://agntux-google-calendar/respond`. The payload
schema is identical; the view tool uses `current_response_status` to
determine its default mode (needsAction → accept/decline tab; accepted/
tentative → change-response mode).

> **Section header:** For this plugin's OWN ingest, write the section as
> `## Respond payload` (NOT a bare `## Compose payload`). The view tool
> (`agntux_google_calendar_respond_view`) reads `## Respond payload` first and
> falls back to the namespaced `## Compose payload (google-calendar)` header —
> both strings are hard-coded in the handler. A *bare* `## Compose payload`
> section (a sibling plugin's reply draft, different schema) is NOT read by the
> respond view → "Untitled event".
> **Cross-source merge (Step 9):** when editing a sibling plugin's action file
> (a calendar invite agntux-gmail/agntux-slack already raised), write the
> namespaced `## Compose payload (google-calendar)` header and fill it with the
> FULL Respond-payload schema below (`event_summary`, `event_start`,
> `event_end`, `current_response_status`, plus `organizer_*`/`attendees` when
> known) — NOT a sparse `event_id`/`proposed_response`/`optional_note` block, or
> the view shows "Untitled event".
> For the full field-by-field schema and Send-envelope shape, see
> `reference/respond-payload.md`.

```markdown
## Respond payload

event_id: {event.id}
calendar_id: {calendarId}
event_summary: {event.summary}
event_start: {event.start.dateTime}       # RFC3339
event_end: {event.end.dateTime}           # RFC3339
event_timezone: {event.start.timeZone}
event_location: {event.location | null}
event_meet_url: {event.hangoutLink | null}
event_description_excerpt: {first 280 chars of description, HTML-stripped | null}
organizer_name: {organizer.displayName}
organizer_email: {organizer.email}
attendees:
  - name: {attendee.displayName}
    email: {attendee.email}
    response_status: {needsAction|accepted|tentative|declined}
  # … one entry per attendee excluding the user; cap at 25
current_response_status: {needsAction|accepted|tentative|declined}
conflicts:
  # populated only for risk class; empty list [] otherwise
  - event_id: {other.id}
    summary: {other.summary}
    start: {other.start.dateTime}
    end: {other.end.dateTime}
prep_bullets:
  # 0–6 items; empty list [] is valid (especially for fresh response-needed)
  - text: "Last pricing thread w/ Maya — May 28, Acme pushing back on tier 2 ceiling."
    source:
      type: "slack-thread"
      path: "sources/slack/threads/2026-05-28-acme-tier2.md"
      display: "View Slack thread"
  - text: "Q2 review deck: 3 slides still outstanding per Linear ENG-882."
    source:
      type: "linear-issue"
      path: "sources/linear/issues/ENG-882.md"
      display: "Open Linear issue"
personalization_signals:
  user_role: {from user.md `role` or `title` frontmatter field}
  user_timezone: {from user.md `timezone` frontmatter field}
  glossary_hits: [{list of project/entity codenames matched in Step 5f.2}]
```

### Field notes

- `event_id` — the raw Google Calendar event ID (`event.id`). Used by
  `respond_to_event` as the `eventId` argument. Do not substitute
  `event.iCalUID`.
- `event_summary` — maps to `event.summary` (the event title). Canonical
  field name in the `## Respond payload` section; the view tool reads this
  as `event_summary` (snake_case on disk, passed through to the form).
- `event_meet_url` — the Google Meet link (`event.hangoutLink` or null).
  Write `null` when no Meet link is present on the event.
- `source_link.url` — always `event.htmlLink` from the connector response.
  Used by the respond view for the "Open in Google Calendar" link. Never
  substitute a different URL scheme.
- `conflicts` — present only in the `## Compose payload` section of risk-class
  items (see below). Not a field in `## Respond payload` — conflict data is
  surfaced via the action file's `## Why this is here` section.
- `prep_bullets.source.type` — one of `slack-thread`, `gmail-thread`,
  `linear-issue`, `people`, `project`. The view tool uses this to render
  the appropriate icon.
- `personalization_signals.glossary_hits` — the raw list of matched
  codenames from `user.md → # Glossary`; the view tool may use these to
  highlight relevant terms in the prep bullets.
- `current_response_status` — taken from the user's own attendee entry
  (`attendee.self == true`). This field drives the view's default mode
  tab (e.g. the "Accept" tab is pre-selected when status is `needsAction`).

---

## For `risk` (respond view)

`risk` items use the same schema as above with two differences:
1. `conflicts` list is populated (≥ 1 entry).
2. `current_response_status` reflects the user's actual status on the
   conflicting event (may be `accepted` or `tentative` — this is what
   makes it a conflict).

No additional schema changes are needed; the respond view renders the
conflict panel when `conflicts` is non-empty.

---

## For `deadline` (no write handler)

`deadline` items are informational only. They do NOT include a
`## Compose payload` section. The action file body contains only
`## Why this is here`, `## Event context`, `## Suggested actions`
(url-only), and `## User notes`.

---

## Schedule handler payload (constructed by calling plugin)

The `schedule` view (`ui://agntux-google-calendar/schedule`) is NOT
pre-populated by this ingest pass. The on-disk section header is
`## Schedule payload` (read by `agntux_google_calendar_schedule_view` via
`extractFencedYaml(content, "Schedule payload")`). For the full field schema,
`suggest_time` helper wiring, and Send-envelope shape, see
`reference/schedule-payload.md`. For the payload calling plugins must
construct when routing to the schedule view, see `reference/cross-plugin.md`.

---

## What the compose payload must NOT include

- The `suggested_actions[].host_prompt` string — that stays as
  `"Use the agntux-google-calendar plugin to open the respond view for action {id}"`.
  The host substitutes `{id}` at click time; ingest does not know the
  final action ID until the file is written.
- Any hardcoded calendar URL hostname — always read `event.htmlLink`
  from the connector response.
- Content that cannot be reconstructed from the action file alone without
  re-fetching Google Calendar. The view tool must be able to render the
  payload entirely from the on-disk action file.
