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
    host_prompt: "Use the agntux-google-calendar plugin to schedule a meeting about this"
```

The host dispatches the prompt to the agntux-google-calendar skill, which
follows its user-initiated scheduling lane and opens
`ui://agntux-google-calendar/schedule` with the calling plugin's pre-built
fields passed **inline**.

### Expected inline payload shape

The calling plugin (agntux-slack or agntux-gmail) constructs these values
when it raises the suggested-action entry. **The field names match the
schedule view handler's inline args exactly** (`agntux_google_calendar_schedule_view`)
— so the handoff uses the same inline-args path as a user-initiated request.
The `trigger_context` block is calling-plugin provenance the lane reads for
context; the remaining keys are passed verbatim as the view's inline args.

```yaml
trigger_context:                     # calling-plugin provenance (context only)
  source_plugin: agntux-slack        # or agntux-gmail, agntux-linear, etc.
  source_path: "sources/slack/threads/2026-05-28-acme-kickoff.md"
  quoted_text: |
    "Let's find a time to sync on the tier-2 pricing. Maya and I are both
     free Thursday afternoon."

# ── inline args for agntux_google_calendar_schedule_view ──
draft_summary: "Sync: Acme tier-2 pricing"
draft_description: |
  Follow-up from the Slack thread in #acme-partner (May 28).
  Agenda: tier-2 pricing ceiling; contract draft sign-off.
duration_minutes: 30                 # default; user can change in the UI
attendee_emails:                     # exclude the user's own email
  - maya.chen@acme.com
search_window_start: "2026-06-05T00:00:00Z"   # suggested start of find-a-time window
search_window_end: "2026-06-12T23:59:59Z"     # suggested end of find-a-time window
candidate_slots: []                  # empty on initial load; suggest_time populates at render
user_primary_calendar_id: primary    # user's primary calendar ID from list_calendars
user_timezone: "America/Denver"      # from user.md frontmatter
include_google_meet: true            # default true
personalization_signals:             # string bullets shown as prep context in the view
  - "Raised from a Slack thread in #acme-partner (May 28)."
  - "Glossary hits: Acme, tier-2 pricing."
source_link:
  label: "Slack: #acme-partner tier-2 pricing"
  url: "https://acme.slack.com/archives/C0123/p1714400000000200"
```

### Payload construction responsibility

**The calling plugin constructs these values** at the time it raises the
suggested-action entry, using context already in memory from its own
ingest pass (thread content, attendee emails, inferred meeting duration
from conversational signals). The Google Calendar ingest pass does NOT
generate schedule payloads — only the calling plugin does.

`candidate_slots` may be empty in the initial payload, or the caller may
pre-compute it via `suggest_time` (as the user-initiated schedule lane does)
so the slots render immediately. When it is empty, the user fills it with the
in-iframe "Find available times" button (see below).

### Minimum required fields

A calling plugin MUST include at minimum:
- `trigger_context.source_plugin`
- `trigger_context.source_path`
- `draft_summary`
- `attendee_emails` (at least one external attendee, user's own excluded)
- `user_primary_calendar_id`
- `user_timezone`

All other fields are optional; the schedule view falls back to defaults
when they are absent. (This is the minimum **caller-supplied** set, not the
handler's output `required[]` — the handler additionally emits
`connector_intent`, defaults for `duration_minutes` / `candidate_slots` /
`include_google_meet`, and an empty `action_id` for an inline call.)

---

### candidate_slots population — pre-computed inline, or via the "Find available times" button

There are two ways `candidate_slots` gets filled; a cross-plugin caller can use
either:

1. **Pre-computed (recommended).** The calling plugin — or, for an ad-hoc
   request, the user-initiated schedule lane — calls `suggest_time` itself
   **before** opening the view and passes the resulting slots inline. They
   render immediately: on mount the component seeds its slot list from the
   inbound `candidate_slots`. This is the same inline path the handler uses for
   a user-initiated request.
2. **On demand in the iframe.** If `candidate_slots` arrives `[]`, the user
   clicks the "Find available times" button, whose handler calls `suggest_time`
   **on click** (component-side — NOT automatically at render) using the form's
   current `attendee_emails` + `search_window_start`/`search_window_end`:

   ```
   mcp__claude_ai_GoogleCalendar__suggest_time(
     attendeeEmails  = <attendee_emails>,
     startTime       = <search_window_start>,
     endTime         = <search_window_end>,
     durationMinutes = <duration_minutes>,
     timeZone        = <user_timezone>
   )
   ```

   The returned slots replace the slot list and the picker re-renders. On error
   (auth, rate limit, no overlap) the component shows an empty state with the
   same button to retry.

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
summary: {draft_summary (edited)}, startTime: {selectedSlot.start}, endTime: {selectedSlot.end},
attendeeEmails: [{attendee_emails (edited, comma-joined)}], addGoogleMeetUrl: {include_google_meet},
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

The schedule view's Send handler constructs this string from current form
state. No separate envelope builder is needed for cross-plugin callers — the
form state is the same regardless of whether the schedule view was opened from
an ingest-side action, a user-initiated request, or a cross-plugin
suggested_action.

For a cross-plugin handoff there may be no `action_id` (the request originated
from another plugin's thread, not a Google Calendar action file). The
`(action_id: …)` line is omitted when empty; post-Send status mutation only
applies when the originating plugin supplied an `action_id`:

```
mcp__agntux-core__agntux_core_set_status(
  action_id    = <action_id from the originating suggested_action, if any>,
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
deferred to a later release.
