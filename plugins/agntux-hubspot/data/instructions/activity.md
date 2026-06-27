---
type: plugin-instructions
plugin: agntux-hubspot
handler: activity
schema_version: "1.0.0"
updated_at: 2026-06-26T00:00:00Z
authored_by: personalization
status: draft
---

# hubspot-activity — handler instructions

Read-only contract for `agntux_hubspot_activity_view`. This file is consumed at
render time by the log-activity note composer iframe. Do NOT write to it; the two
write paths are `personalization` (initial stub) and `user-feedback` (promote to
final).

---

## Action class

`response-needed`

Raised when a HubSpot CRM record (deal, contact, company, or ticket) has recent
activity — a call logged, a meeting completed, an email thread — that warrants a
follow-up note to capture next steps, decisions made, or action commitments.

---

## When this handler is suggested

Generate an `activity` suggested action when any of:

- An engagement of type CALL on a record owned by the user has
  `hs_call_disposition` indicating follow-up is needed (e.g. left voicemail,
  call connected with interested outcome, called back request).
- An engagement of type MEETING with `hs_meeting_outcome: COMPLETED` is logged
  on a record the user owns, and the engagement's body contains next-step language
  ("action item", "follow up", "we agreed", "next steps", "I will").
- An outgoing email engagement on a record the user owns has no reply engagement
  within 3 days.
- A contact or company record newly created in the last 24 hours that has no
  associated engagements yet (prompt the user to log an introductory note).

Do NOT generate an `activity` action for engagement types created by automation
(HubSpot Sequences) unless the body explicitly contains open-ended language
requiring human follow-up.

---

## structuredContent keys consumed by this handler

The `agntux_hubspot_activity_view` view tool reads the action file's
`## Activity payload` body section at click time and lifts the following fields
into `structuredContent`. The iframe renders a note composer pre-filled with
`draft_body`, with the record context shown above the text area.

| Key | Type | Source |
|---|---|---|
| `record_url` | string | Deep link: `https://app.hubspot.com/contacts/{portal_id}/{object_type}/{record_id}` |
| `record_id` | string | HubSpot `hs_object_id` of the associated record |
| `record_type` | string | Object type in uppercase: `CONTACT`, `COMPANY`, `DEAL`, or `TICKET` |
| `record_name` | string | Display name of the record (contact full name, company name, deal name, or ticket subject) |
| `draft_body` | string | Pre-composed note body (≤2000 chars), authored at ingest time |
| `personalization_signals` | string[] | Short bullets (≤4, ≤120 chars each) explaining applied preferences |

These key names match the `ActivityPayloadOk` interface in
`view-tool/src/agntux-hubspot-view.ts`.

---

## Activity payload

The ingest skill's Step 10 appends an `## Activity payload` body section to every
action item that carries a `Log activity` or `Log note` suggested action. Shape:

```yaml
record_id: "<hs_object_id of the associated record>"
record_url: "https://app.hubspot.com/contacts/{portal_id}/{object_type_lower}/{hs_object_id}"
record_type: "<CONTACT | COMPANY | DEAL | TICKET>"
record_name: "<display name of the record>"
draft_body: |
  <agent-composed note body, ≤2000 chars, informed by engagement context and next-step signals>
personalization_signals:
  - "<≤120 chars; cite which engagement or signal motivated this note>"
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes.

The `record_url` path segment uses the lowercase singular object type:
`deal` → `deal`, `contact` → `contact`, `company` → `company`, `ticket` →
`ticket`. Note: the URL uses `contact` (singular) not `contacts` (plural) as
the path segment for contact records.

The `draft_body` is authored at ingest time using the engagement body, the
record's recent activity context, and the tone preferences below. The iframe
loads the on-disk draft; the user edits and clicks "Log note" to commit.

---

## Send envelope target

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildLogNoteEnvelope()` in
`view-tool/src/apps/activity/lib/build-envelope.ts`.

Args:

- `objectType`: `"NOTE"` (constant — creates a NOTE engagement)
- `operation`: `"create"` (constant)
- `properties.hs_note_body`: user-edited value of `draft_body`
- `properties.hs_timestamp`: Unix epoch milliseconds of "now" at send time
  (a string representation of the integer)
- `associations[0].to.id`: `structuredContent.record_id`
- `associations[0].toObjectType`: `structuredContent.record_type` (uppercase)
- `associations[0].types[0]`: `{associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1}`

Envelope shape:

```
Use the HubSpot Connector to create a NOTE engagement associated with a HubSpot {RECORD_TYPE} record.
objectType: NOTE, operation: create, associations[0].toObjectType: {RECORD_TYPE}, associations[0].to.id: {record_id}.
Body: «{edited_body}».

IMPORTANT: Execute manage_crm_objects programmatically and return the result as
plain text. Do NOT render HubSpot's own MCP App UI for this call — the user has
already authored the note in the AgntUX iframe and the payload is final. Do NOT
re-render the AgntUX activity UI either; the action is complete.
```

The `draft_body` value in the envelope is guillemet-delimited. Literal `«` or `»`
characters in the user-edited body are escaped by doubling (`««`, `»»`).

---

## Post-send mutation (host-side, not view-tool-side)

After `manage_crm_objects` succeeds, the host calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User logged a note on {record_type} '{record_name}' via HubSpot Connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly.

---

## Tone / personalization

- **Voice**: concise, factual, first-person. HubSpot notes are internal CRM records
  — they should read like a quick memo to a future self, not a formal email.
- **Default length**: 2–4 sentences. Notes should capture decisions, next steps, and
  any key facts from the engagement — not restate what happened at length.
- **Structure**: lead with the most actionable item. If there is a committed next
  step ("I will send the proposal by Friday"), that is the first sentence.
- **No sign-off**: do not append a signature or sign-off. HubSpot notes are
  attributed to the logged-in user automatically.
- **No filler**: omit phrases like "As discussed", "Per our conversation", "Just
  wanted to follow up". Get to the substance.
- **Engagement-specific framing**:
  - Call: note the outcome (connected/voicemail), the key topic discussed, and the
    committed next step.
  - Meeting: note the decision reached and the action commitments made.
  - Email follow-up: note that the email went unanswered and flag the next action.

---

## Safety notes

- Do not allow empty note bodies. The "Log note" button must remain disabled when
  `draft_body` is blank after editing.
- The note is created at the moment of Send using `Date.now()` for `hs_timestamp`
  — the note's timestamp in HubSpot reflects when the user submitted, not when the
  original engagement occurred.
- Discard is local — no envelope emitted; banner: `Discarded. No note was logged.`
- The `record_type` passed to the connector MUST be in uppercase (`CONTACT`,
  `COMPANY`, `DEAL`, `TICKET`). The build-envelope normalises via
  `recordType.toUpperCase()` — confirm the on-disk `record_type` is a valid
  HubSpot object type string.

# Always raise

# Never raise

# Rewrites

# Notes

- Notes created via this flow appear in the "Notes" tab of the associated record's
  activity timeline in HubSpot. They are visible to all users in the portal.
- For call engagements with `hs_call_disposition` values: `CONNECTED` (call
  answered), `LEFT_VOICEMAIL`, `NO_ANSWER`, `BUSY`, `WRONG_NUMBER` —
  tailor the draft body to reflect the actual disposition. Do not draft a
  "we discussed X" note if the call was a voicemail or no answer.
- Default note for a voicemail: "Left voicemail — following up on [topic].
  Will call again [timeframe]."
- Default note for a no-answer: "Called — no answer. Will try again
  [timeframe] or send an email."
