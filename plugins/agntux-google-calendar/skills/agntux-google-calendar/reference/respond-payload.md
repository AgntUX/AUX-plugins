# Respond payload — agntux-google-calendar

Schema for the `## Respond payload` body section written into action files of
class `response-needed`, `risk`, and tentative `meeting-prep`. This is the
structured block the `respond` UI handler reads at click time to pre-fill the
RSVP form (`ui://agntux-google-calendar/respond`).

This file is an additive per-verb override — there is no canonical counterpart.
The renderer passes it through verbatim. Derivation rule: header `## Respond
payload` → filename `respond-payload.md`.

---

## When this section is written

A `## Respond payload` section is written at ingest time (Step 10) for every
action item of class:
- `response-needed` — user's RSVP status is `needsAction`.
- `risk` — double-booking conflict; user may want to decline one event.
- `meeting-prep` where `current_response_status` is `tentative` — user may want
  to confirm or change their response.

It is NOT written for `deadline` or fully-accepted `meeting-prep` items.

The view tool (`agntux_google_calendar_respond_view`) reads this section from
disk at click time via `extractFencedYaml(content, "Respond payload")`.

> NOTE: `compose-payload.md` (the ingest reference) refers to this on-disk
> section as `## Compose payload` in some places. The canonical section header
> the view tool actually reads is `## Respond payload`. When writing action
> files, use `## Respond payload` as the section header — the view tool
> hard-codes this string in its `extractFencedYaml` call.

### Cross-source merge case (e.g. an emailed invite already raised by agntux-gmail)

When the Step 9 cross-source merge edits a **sibling plugin's** action file
(`source != google-calendar` — a calendar invite that agntux-gmail or
agntux-slack already raised), it appends a namespaced
`## Compose payload (google-calendar)` section rather than `## Respond payload`.
The respond view reads BOTH headers (`## Respond payload` first, then
`## Compose payload (google-calendar)`), so either works — **but the namespaced
section MUST carry the full Respond-payload schema below** (at minimum
`event_summary`, `event_start`, `event_end`, `current_response_status`, plus
`organizer_*`/`attendees` when known). A sparse block of only `event_id` /
`proposed_response` (the gmail-era ad-hoc shape) leaves `event_summary` empty
and the view renders "Untitled event". Use the snake_case field names below —
NOT `proposed_response` / `optional_note`.

---

## On-disk schema (what ingest writes and the view tool reads)

Field names are snake_case in the YAML block. They are stable contracts between
ingest and the view-tool renderer — do not rename them.

```yaml
## Respond payload

event_id: "<Google Calendar event ID — event.id>"
calendar_id: "primary"
event_summary: "<event.summary>"
event_start: "<ISO 8601, e.g. 2026-06-05T10:00:00-06:00>"
event_end: "<ISO 8601>"
event_timezone: "<IANA tz, e.g. America/Denver>"
event_location: "<event.location or null>"
event_meet_url: "<event.hangoutLink or null>"
event_description_excerpt: "<first ~280 chars of description, HTML-stripped, or null>"
organizer_name: "<event.organizer.displayName>"
organizer_email: "<event.organizer.email>"
attendees:
  - name: "<displayName>"
    email: "<email>"
    response_status: "accepted | declined | tentative | needsAction"
  # ... one entry per attendee excluding the user; cap at 25
current_response_status: "needsAction"    # from user's own attendee entry (self == true)
prep_summary: |
  <verbatim copy of ## Meeting prep section markdown, or empty string>
prep_signals:
  - label: "<person name or thread title>"
    href: "<openable external URL — https/http/mailto; empty string if none>"
personalization_signals:
  - "<short bullet e.g. 'Alice is in your Important people list'>"
source_link:
  label: "<event_summary>"
  url: "<event.htmlLink — from connector response>"
```

### Composition rules (applied at ingest time)

- `event_id`: write the raw `event.id` value from the connector. This is the
  canonical identifier for `respond_to_event`. Do not use `event.iCalUID`.
- `calendar_id`: the calendar ID from which the event was fetched. Write
  `"primary"` for the user's primary calendar, or the literal ID for shared
  calendars.
- `event_description_excerpt`: strip HTML tags, collapse whitespace, truncate
  to 280 characters. Write `null` if the event has no description.
- `attendees`: include all attendees from `event.attendees` where
  `attendee.self != true`. Cap at 25. Write `[]` if no other attendees.
- `current_response_status`: taken from the attendee entry where
  `attendee.self == true`. This field drives the view's default mode tab (Accept
  pre-selected when status is `needsAction`; the tab matching the current status
  pre-selected when status is `accepted`/`tentative` — "change response" mode).
- `prep_summary`: copy verbatim from the `## Meeting prep` section when present.
  Write empty string when no prep was composed.
- `prep_signals`: one `{label, href}` entry per source cited in prep bullets.
  Cap at 5. `href` MUST be an openable external deep link — an `https://`,
  `http://`, or `mailto:` URL (e.g. the Slack message permalink, the Gmail
  thread URL, or the source event's `htmlLink`). The respond view opens these
  via the host's `openLink()`, which only works for web/mail URLs. A filesystem
  path relative to the project root is NOT openable from the sandboxed iframe —
  never emit one as `href`. When no openable URL exists, still write the entry
  with its best label and an empty `href`; the view renders it as plain text
  instead of a dead link.
- `personalization_signals`: one bullet per `user.md` signal that shaped the
  prep (e.g. "Alice is in your Important people list", "working hours applied").
- `source_link.url`: always use `event.htmlLink` from the connector response.
  Never construct the URL from `event.id` — `htmlLink` is the canonical deep
  link.

---

## Send-envelope shape (emitted by iframe "Send response" button)

The `buildRespondEnvelope()` function in
`view-tool/src/apps/respond/lib/build-envelope.ts` constructs this string from
current form state on the Send button's onClick handler. There is exactly ONE
"Send response" button; the active mode tab at click time determines
`responseStatus`. The view-tool builder copies this shape into the Send handler
code verbatim.

**Connector:** Google Calendar Connector (addressed by display name — NOT the
plugin slug).

**Connector tool called by host:** `mcp__claude_ai_GoogleCalendar__respond_to_event`

```
Use the Google Calendar Connector to {verbLabel} a Google Calendar event invitation.
eventId: {event_id}, calendarId: {calendar_id},
responseStatus: {responseStatus}, notificationLevel: EXTERNAL_ONLY.
responseComment: «{responseComment}».           ← only when responseComment is non-empty
Event: "{event_summary}".
(action_id: {action_id})
Execute this tool call programmatically and return its success or error to chat
as plain text. Do NOT render Google Calendar's native MCP App UI for this call —
the user has already chosen their RSVP response via the AgntUX iframe and the
data is final. Do NOT re-render the AgntUX respond UI after this call; the
action is complete.
```

where `{verbLabel}` is derived from `responseStatus`:

| Active tab | responseStatus | verbLabel |
|---|---|---|
| Accept | `accepted` | `accept` |
| Tentative | `tentative` | `tentatively accept` |
| Decline | `declined` | `decline` |

### Argument mapping (form state → connector args)

| Form element | Connector arg | Type | Notes |
|---|---|---|---|
| `event_id` (from disk) | `eventId` | string | Required. Case-sensitive. |
| `calendar_id` (from disk) | `calendarId` | string | Optional (defaults to primary on API side). |
| Active mode tab | `responseStatus` | `"accepted"` \| `"tentative"` \| `"declined"` | Required. Set at Send time. |
| Optional note textarea | `responseComment` | string | Optional. Omit line from envelope when empty. |
| — | `notificationLevel` | string | Default `"EXTERNAL_ONLY"`. See note below. |

### notificationLevel rule

Default is `"EXTERNAL_ONLY"` — notifies the event organizer and external
attendees without blasting internal calendar teammates. If the respond handler
exposes a "Notify all attendees" checkbox, toggle `notificationLevel` to `"ALL"`
only when that checkbox is checked.

### responseComment guillemet escaping

The `responseComment` field is guillemet-escaped when non-empty. Literal `«` →
`««`; literal `»` → `»»`. The line is omitted from the envelope entirely when
`responseComment.trim()` is empty — do not emit `responseComment: «».`.

---

## Native-UI suppression directive

Every emitted envelope appends the `NO_NATIVE_UI_DIRECTIVE` constant (see
`view-tool/src/apps/respond/lib/build-envelope.ts`). This prevents the host
from rendering Google Calendar's native MCP App UI or re-rendering the AgntUX
iframe after Send.

---

## Post-Send action mutation

After `respond_to_event` succeeds, the host (NOT the view tool) calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id    = <action_id>,
  status       = "done",
  outcome      = "completed-externally",
  outcome_note = "User responded <accepted|tentative|declined> via Google Calendar connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly — host-only single-writer
rule for non-component-state frontmatter.

---

## Connector intent key

`connector_intent: "google-calendar-connector-respond"` — written into
`structuredContent` by `agntux_google_calendar_respond_view` and validated by
the iframe's Send handler before building the envelope.

The mode-tab → responseStatus mapping is encoded as a comment in
`structuredContent` for test-phase grep:

```
//   tab "Accept"     → responseStatus: "accepted"   (google-calendar-connector-respond-accepted)
//   tab "Tentative"  → responseStatus: "tentative"  (google-calendar-connector-respond-tentative)
//   tab "Decline"    → responseStatus: "declined"   (google-calendar-connector-respond-declined)
```
