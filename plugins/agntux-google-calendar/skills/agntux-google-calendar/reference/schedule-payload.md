# Schedule payload — agntux-google-calendar

Schema for the `## Schedule payload` body section written into action files
that surface the `schedule` UI handler (`ui://agntux-google-calendar/schedule`).

This file is an additive per-verb override — there is no canonical counterpart.
The renderer passes it through verbatim. Derivation rule: header `## Schedule
payload` → filename `schedule-payload.md`.

---

## When this section is written

A `## Schedule payload` section is written at ingest time (Step 10) for every
action item where a scheduling follow-up is warranted — e.g. a `meeting-prep`
item where the prep context signals a follow-up meeting is needed. It is also
constructed by calling plugins (agntux-slack, agntux-gmail) when they route the
user to the schedule view. See `reference/cross-plugin.md` for the calling-plugin
payload construction rules.

The view tool (`agntux_google_calendar_schedule_view`) reads this section from
disk at click time via `extractFencedYaml(content, "Schedule payload")`.

---

## On-disk schema (what ingest writes and the view tool reads)

Field names are snake_case in the YAML block. They are stable contracts between
ingest and the view-tool renderer — do not rename them.

```yaml
## Schedule payload

draft_summary: "<event title — pre-filled from context, editable>"
draft_description: |
  <event description — pre-filled from prep context, editable>
attendee_emails:
  - "<email1>"
  - "<email2>"
duration_minutes: 30
search_window_start: "<tomorrow 00:00 local ISO 8601, e.g. 2026-06-03T00:00:00-06:00>"
search_window_end: "<tomorrow + 7 days 23:59 local ISO 8601>"
preferred_hours:
  start: "09:00"
  end: "17:00"
  exclude_weekends: true
candidate_slots: []            # always empty at ingest; suggest_time populates at render
include_google_meet: true
user_timezone: "<IANA tz from user.md, e.g. America/Denver>"
user_primary_calendar_id: "primary"
personalization_signals:
  - "<short bullet e.g. 'draft body informed by prior Slack thread context'>"
source_link:
  label: "<action item title or triggering event title>"
  url: "https://calendar.google.com/calendar/event?eid=<event_id>"
```

### Composition rules (applied at ingest time)

- `draft_summary`: derive from the triggering thread subject, meeting title, or
  the `proposed_meeting_title` field in a cross-plugin trigger_context. Prefix
  with `"Follow-up: "` for explicit follow-up action items.
- `draft_description`: compose from prep bullets and thread context. Include
  agenda hints extracted from the triggering signal. Keep under 600 characters.
- `attendee_emails`: populate from the triggering signal (thread participants,
  attendee list, cc'd recipients). Exclude the user's own email. Cap at 10.
- `duration_minutes`: infer from the triggering signal when possible (e.g. "30
  min call" → 30). Default 30 when not specified.
- `preferred_hours`: read from `user.md → # Working hours` if present. Default
  to `{09:00, 17:00, exclude_weekends: true}`.
- `user_timezone`: read from `user.md` frontmatter `timezone` field. Default
  `"UTC"` when absent (but do NOT hardcode in skill — read at runtime).
- `candidate_slots`: always write as `[]` at ingest time. The `suggest_time`
  helper populates this at render time (see below).
- `personalization_signals`: one bullet per source used to compose
  `draft_description`. Omit key if no personalization signals apply.
- `source_link.url`: use `event.htmlLink` from the connector response for
  calendar-originated items; for cross-plugin items use the source thread URL.

---

## suggest_time pre-Send helper (NOT the authorisation gate)

The schedule handler calls `mcp__claude_ai_GoogleCalendar__suggest_time` at
render time (or on user click of the in-iframe "Find available times" button) to
populate `candidate_slots`. This is a **read call**, not the authorisation gate.

```
mcp__claude_ai_GoogleCalendar__suggest_time(
  attendeeEmails  = <attendee_emails>,
  startTime       = <search_window_start>,
  endTime         = <search_window_end>,
  durationMinutes = <duration_minutes>,
  timeZone        = <user_timezone>
)
```

The returned slots populate `candidate_slots` and the iframe re-renders.
The user must still click "Schedule" to commit. **Do NOT gate `suggest_time`
behind the Send button** — it is a read tool that the component calls directly
via `useAppsClient().callTool()` without the Send-gate ceremony.

---

## Send-envelope shape (emitted by iframe "Schedule" button)

The `buildScheduleEnvelope()` function in
`view-tool/src/apps/schedule/lib/build-envelope.ts` constructs this string from
current form state on the Send button's onClick handler. The view-tool builder
copies this shape into the Send handler code verbatim.

**Connector:** Google Calendar Connector (addressed by display name — NOT the
plugin slug).

**Connector tool called by host:** `mcp__claude_ai_GoogleCalendar__create_event`

```
Use the Google Calendar Connector to create a new Google Calendar event.
summary: {draft_summary}, startTime: {selectedSlot.start}, endTime: {selectedSlot.end},
attendeeEmails: [{attendee_emails joined with ", "}], addGoogleMeetUrl: {include_google_meet},
timeZone: {user_timezone}, calendarId: {user_primary_calendar_id},
notificationLevel: EXTERNAL_ONLY.
Description: «{draft_description — guillemet-escaped}».
(action_id: {action_id})
Execute this tool call programmatically and return its success or error to chat
as plain text. Do NOT render Google Calendar's native MCP App UI for this call —
the user has already provided all required inputs via the AgntUX iframe and the
data is final. Do NOT re-render the AgntUX schedule UI after this call; the
action is complete.
```

### Argument mapping (form state → connector args)

| Form field | Connector arg | Type | Notes |
|---|---|---|---|
| `draft_summary` (edited) | `summary` | string | Required. User-editable. |
| `selectedSlot.start` | `startTime` | string (ISO 8601) | Required. Must be set before Send is enabled. |
| `selectedSlot.end` | `endTime` | string (ISO 8601) | Required. Derived from slot. |
| `attendee_emails[]` (edited) | `attendeeEmails` | string[] | Optional. Comma-joined in envelope. |
| `include_google_meet` (toggle) | `addGoogleMeetUrl` | boolean | Default true. |
| `user_timezone` | `timeZone` | string | IANA tz. |
| `user_primary_calendar_id` | `calendarId` | string | Default "primary". |
| `draft_description` (edited) | `description` (guillemet-delimited) | string | Optional. Guillemet-escaped. |
| — | `notificationLevel` | string | Fixed: `"EXTERNAL_ONLY"` (canonical AgntUX default — avoids spamming internal calendar attendees). |

### notificationLevel rule

Default is `"EXTERNAL_ONLY"` — this is the canonical AgntUX standard for new
meeting invitations. It notifies external attendees (who need the invite) without
spamming internal colleagues who see the event in their own shared calendar view.

If the schedule handler exposes a "Notify all attendees" checkbox, toggle
`notificationLevel` to `"ALL"` only when that checkbox is checked.

### Send-enable guard

The Send button MUST be disabled until `selectedSlot` is non-null (a slot has
been picked). An empty `candidate_slots` array → "Find available times" button
shown; Send disabled.

### Guillemet escaping

The `description` value is the only guillemet-escaped field. Literal `«` → `««`;
literal `»` → `»»`. See `connector-envelopes.md` § "Guillemet escaping".

---

## Native-UI suppression directive

Every emitted envelope appends the `NO_NATIVE_UI_DIRECTIVE` constant (see
`view-tool/src/apps/schedule/lib/build-envelope.ts`). This prevents the host
from rendering Google Calendar's native MCP App UI or re-rendering the AgntUX
iframe after Send.

---

## Post-Send action mutation

After `create_event` succeeds, the host (NOT the view tool) calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id    = <action_id>,
  status       = "done",
  outcome      = "completed-externally",
  outcome_note = "User scheduled event '<summary>' via Google Calendar connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly — host-only single-writer
rule for non-component-state frontmatter.

---

## Connector intent key

`connector_intent: "google-calendar-connector-create-event"` — written into
`structuredContent` by `agntux_google_calendar_schedule_view` and validated by
the iframe's Send handler before building the envelope.
