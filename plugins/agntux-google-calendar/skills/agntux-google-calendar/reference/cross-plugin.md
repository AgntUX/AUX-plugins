# Cross-plugin handoff — agntux-google-calendar
#
# This file documents the inbound and outbound cross-plugin protocols for
# agntux-google-calendar. It is an additive reference with no canonical
# counterpart; the renderer passes it through verbatim.

---

## Inbound: schedule handoff from agntux-slack or agntux-gmail

When agntux-slack or agntux-gmail detects a "this calls for a meeting"
signal (e.g. a thread where multiple parties agree to schedule a call, or
a Gmail thread where a follow-up meeting is proposed), the plugin routes
the user to the Google Calendar schedule view by emitting a
`suggested_actions` entry:

```yaml
suggested_actions:
  - label: "Schedule a meeting"
    host_prompt: "/agntux-google-calendar schedule a meeting about this"
```

The host dispatches the prompt to the agntux-google-calendar skill, which
opens `ui://agntux-google-calendar/schedule` and passes the calling
plugin's pre-built `trigger_context` payload.

### Expected trigger_context payload shape

The calling plugin (agntux-slack or agntux-gmail) constructs this payload
when it raises the suggested-action entry. The schedule view's MCP handler
(`agntux_google_calendar_schedule_view`) reads it at render time.

```yaml
trigger_context:
  source_plugin: agntux-slack          # or agntux-gmail, agntux-linear, etc.
  source_path: "sources/slack/threads/2026-05-28-acme-kickoff.md"
  quoted_text: |
    "Let's find a time to sync on the tier-2 pricing. Maya and I are both
     free Thursday afternoon."
draft_title: "Sync: Acme tier-2 pricing"
draft_description: |
  Follow-up from the Slack thread in #acme-partner (May 28).
  Agenda: tier-2 pricing ceiling; contract draft sign-off.
draft_duration_minutes: 30         # default; user can change in the UI
draft_attendees:
  - maya.chen@acme.com
  - john@agntux.ai
search_window_start: "2026-06-05T00:00:00Z"   # suggested start of find-a-time window
search_window_end: "2026-06-12T23:59:59Z"     # suggested end of find-a-time window
suggested_slots: []                # empty on initial load; suggest_time populates at render
calendar_id: primary               # user's primary calendar ID from list_calendars
user_timezone: "America/Denver"    # from user.md frontmatter
personalization_signals:
  user_role: "CTO"                 # from user.md
  glossary_hits: ["Acme", "tier-2 pricing"]
```

### Payload construction responsibility

**The calling plugin constructs this payload** at the time it raises the
suggested-action entry, using context already in memory from its own
ingest pass (thread content, attendee emails, inferred meeting duration
from conversational signals). The Google Calendar ingest pass does NOT
generate schedule payloads — only the calling plugin does.

The `suggested_slots` list is always empty in the initial payload and is
populated by the `suggest_time` tool at view render time, using
`search_window_start`/`search_window_end` and the attendee list to find
free/busy overlap.

### Minimum required fields

A calling plugin MUST include at minimum:
- `trigger_context.source_plugin`
- `trigger_context.source_path`
- `draft_title`
- `draft_attendees` (at least one external attendee)
- `calendar_id`
- `user_timezone`

All other fields are optional; the schedule view falls back to defaults
when they are absent.

---

### At-render-time suggested_slots population via suggest_time

`suggested_slots` is always `[]` in the initial cross-plugin payload. At render
time the schedule view component calls `suggest_time` automatically when
`attendeeEmails` and `search_window_start`/`search_window_end` are non-empty:

```
mcp__claude_ai_GoogleCalendar__suggest_time(
  attendeeEmails  = <draft_attendees>,
  startTime       = <search_window_start>,
  endTime         = <search_window_end>,
  durationMinutes = <draft_duration_minutes>,
  timeZone        = <user_timezone>
)
```

The returned slots are written into `candidate_slots` (component state) and the
slot-picker re-renders. If `suggest_time` returns an error (auth, rate limit,
no-free-slots), the component shows an empty state with a "Find times" button
the user can click manually to retry.

**`suggest_time` is a pre-Send read call, NOT the authorisation gate.** It is
called directly via `useAppsClient().callTool()` without Send-gate ceremony.
Do NOT gate it behind the Send button.

---

### Send-envelope shape after cross-plugin schedule

When the user clicks "Schedule" in the iframe after a cross-plugin handoff, the
Send envelope is identical to the ingest-originated schedule envelope. The
connector args are assembled from the current form state (which reflects both
the original cross-plugin payload and any user edits in the iframe):

```
Use the Google Calendar Connector to create a new Google Calendar event.
summary: {draft_title (edited)}, startTime: {selectedSlot.start}, endTime: {selectedSlot.end},
attendeeEmails: [{draft_attendees (edited, comma-joined)}], addGoogleMeetUrl: {include_google_meet},
timeZone: {user_timezone}, calendarId: {calendar_id},
notificationLevel: EXTERNAL_ONLY.
Description: «{draft_description — guillemet-escaped}».
(action_id: {action_id})
Execute this tool call programmatically and return its success or error to chat
as plain text. Do NOT render Google Calendar's native MCP App UI for this call —
the user has already provided all required inputs via the AgntUX iframe and the
data is final. Do NOT re-render the AgntUX schedule UI after this call; the
action is complete.
```

The `buildScheduleEnvelope()` function in
`view-tool/src/apps/schedule/lib/build-envelope.ts` constructs this string.
No separate envelope builder is needed for cross-plugin callers — the form
state is the same regardless of whether the schedule view was opened from an
ingest-side action or a cross-plugin suggested_action.

Post-Send mutation is the same as for ingest-originated schedule actions:
```
mcp__agntux-core__agntux_core_set_status(
  action_id    = <action_id from the originating suggested_action>,
  status       = "done",
  outcome      = "completed-externally",
  outcome_note = "User scheduled event '<summary>' via Google Calendar connector on <ISO date>."
)
```

---

## Outbound: no cross-plugin signals emitted by this ingest pass

The agntux-google-calendar ingest pass does not emit cross-plugin signals
or suggested actions that route to other plugins. All action items it
raises are self-contained (routes to `respond` or no handler).

Future versions may emit a cross-plugin signal to agntux-slack or
agntux-gmail when a meeting has relevant unread threads — that design is
deferred to v0.2.
