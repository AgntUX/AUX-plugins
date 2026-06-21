# Compose payload — agntux-imessage (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/compose-payload.md`.

Documents the `## Compose payload` body section written into every
`needs-you` action file by Step 10. The view tool lifts this section
from disk at click time to pre-fill the reply composer without
re-fetching iMessage context.

---

## `## Compose payload` body section shape

Every `needs-you` action file body MUST include a `## Compose payload`
section with these fields:

```markdown
## Compose payload

contact_name: {resolved contact name, or raw sender handle if unresolved}
contact_handle: {sender handle exactly as returned by get_unread_imessages — phone or email}
quoted_messages:
  - date: {ISO-8601 UTC timestamp}
    is_from_me: false
    content: "{verbatim message body, single-line truncated to 500 chars}"
  - date: {ISO-8601 UTC timestamp}
    is_from_me: true
    content: "{most recent outbound message if available from read_imessages, for context}"
draft_body: "{pre-composed reply draft — see drafting rules below}"
personalization_signals:
  - "{signal used to classify as needs-you, e.g. 'contains direct question', 'time-sensitive: meeting tomorrow'}"
```

### Field rules

**`contact_name`**: The name returned by `search_contacts`. If the
contact was unresolved, use the raw sender handle. Never fabricate a
name.

**`contact_handle`**: The exact `sender` string from `get_unread_imessages`.
The view tool passes this directly as the `recipient` arg to `send_imessage`.
Do not normalise or reformat the handle — pass it verbatim to preserve
whatever form the connector expects.

**`quoted_messages`**: Include the triggering inbound message(s) plus
the most recent outbound message if available from `read_imessages`.
List in chronological order (oldest first). Truncate each `content` to
500 characters if longer; append `…` if truncated. Include at most
5 messages total.

**`draft_body`**: A pre-composed reply draft appropriate for the message.
Keep drafts concise and contextually grounded in the message content.
Do NOT address the message as "Hi {name}" — start directly with the
response content. Draft in first person (the user's voice). Mark with
`[DRAFT]` prefix if the content is uncertain or low-confidence:
`draft_body: "[DRAFT] {text}"`. The view tool surfaces this as an
editable field the user reviews before sending.

**`personalization_signals`**: One to three short phrases describing the
signals that drove the `needs-you` classification. These help the user
understand why the item surfaced. Examples:
- `"direct question about the meeting time"`
- `"awaiting reply: request sent 2 days ago"`
- `"time-sensitive: references today"`

### Drafting rules

1. Ground the draft in the actual message content. Do not paraphrase or
   speculate about intent beyond what the message clearly states.
2. For simple questions with an answerable scope (time, date, location
   you might know from context), draft a placeholder: `"[time] works for
   me"` or `"I'll check and let you know"`.
3. For requests you cannot answer without user input, draft a
   holding response: `"Thanks — I'll get back to you on this shortly."`
4. For time-sensitive confirmations (meeting, event), draft a
   confirmation template: `"Confirmed for [time/date]."` or
   `"Running a bit late — be there by [time]."` with placeholders.
5. Never compose content that would be harmful, deceptive, or that
   sends unsolicited information about third parties.

### Example action body

```yaml
---
id: imessage-20260618-mom-081
plugin: agntux-imessage
class: response-needed
priority: high
triage_tier: needs-you
source: imessage
source_id: "+14155550101#1234"
created_at: "2026-06-18T18:15:00Z"
updated_at: "2026-06-18T18:16:00Z"
status: open
title: "Mom asking about Sunday dinner plans"
entities:
  - type: person
    id: mom
suggested_actions:
  - label: "Reply to Mom"
    host_prompt: "open the imessage reply composer for action imessage-20260618-mom-081"
  - label: "Open in Messages"
    url: "imessage://+14155550101"
---

Mom sent: "Are you coming to dinner Sunday? Need to know by tonight!"

## Compose payload

contact_name: Mom
contact_handle: "+14155550101"
quoted_messages:
  - date: "2026-06-18T18:14:30Z"
    is_from_me: false
    content: "Are you coming to dinner Sunday? Need to know by tonight!"
draft_body: "Yes, I'll be there! What time should I arrive?"
personalization_signals:
  - "direct question requiring confirmation"
  - "time-sensitive: deadline today"
```

---

## What the view tool does with this section

The view tool (`imessage_view`) reads the action file body, parses the
`## Compose payload` section, and:

1. Pre-fills the `draft_body` into the reply text field.
2. Shows `quoted_messages` as conversation context (read-only).
3. Displays `contact_name` as the recipient.
4. On user confirmation, calls `send_imessage({ recipient: contact_handle, message: <edited draft> })`.

The `host_prompt` in `suggested_actions` is the natural-language trigger
that routes the host to the view tool. It MUST use the form
`"open the imessage reply composer for action {id}"` — matching the
TRIGGER PHRASES wording in the view tool descriptor verbatim — never a
slash command, and never `"Use the agntux-imessage plugin to …"` (that
is the retired plugin-slug envelope shape).
