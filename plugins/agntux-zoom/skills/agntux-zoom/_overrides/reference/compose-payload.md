# Compose payload schema — agntux-zoom (wholesale override)

Wholesale override for
`canonical/prompts/ingest/skills/sync/reference/compose-payload.md`.

The Zoom save-doc handler uses `## Compose payload` as the body-section
header (the canonical name). Its key set is entirely different from the
canonical chat-reply shape — it carries meeting metadata, a drafted doc
title, and a drafted markdown body rather than `drafted_body` /
`thread_context` / `recipients`. This override replaces the canonical
file for Zoom so the ingest agent (Step 10) emits the correct fields.

---

## Conditional body section: `## Compose payload`

REQUIRED for every action item that ships a `Save to Zoom Doc`
suggested action (meeting next-steps actions and recording-available
actions). Omit for action types that have no save-doc button (upcoming
deadlines, chat mentions, doc-review items).

The block is a fenced ```yaml inside an H2 body section.

**YAML quoting reminder.** Any string scalar containing `: ` (colon-
space), a leading `-`, or starting with `{` / `[` MUST be wrapped in
double quotes — see the canonical `compose-payload.md` quoting rules.

### Zoom save-doc payload shape

```markdown
## Compose payload

​```yaml
meeting_uuid: "<stable Zoom meeting UUID, double-encoded for API calls>"
meeting_topic: "<meeting topic string>"
meeting_date: "<human-readable local date-time, e.g. 'June 24, 2026 at 2:00 PM EDT'>"
participants:
  - "<display name>"
  - "<display name>"
meeting_summary: "<first ≤400 chars of meeting_summary.summary_overview>"
action_items:
  - "<next-steps item text>"
  - "<next-steps item text>"
draft_doc_title: "<proposed Zoom Doc title, e.g. 'Meeting summary — {meeting_topic} — {date}'>"
draft_doc_body: |
  # {meeting_topic}

  **Date:** {meeting_date}
  **Participants:** {participants joined by ", "}

  ## Summary

  {meeting_summary.summary_details or summary_overview, ≤2000 chars}

  ## Action items

  {bulleted list of next_steps items}

  ## Recording

  {recording_play_url if available, else omit this section}
open_in_zoom_url: "<https://zoom.us/rec/play/{meeting_uuid} or https://zoom.us/j/{meeting_number}>"
personalization_signals:
  - "<≤120 chars; cite which user.md / instructions rule motivated this>"
generated_at: "<RFC 3339 of this run>"
​```
```

### Key descriptions

| Key | Type | Required | Description |
|---|---|---|---|
| `meeting_uuid` | string | yes | Stable Zoom meeting UUID from `search_meetings` or `recordings_list`. Used for dedup and the `open_in_zoom_url`. |
| `meeting_topic` | string | yes | Meeting topic string from the Zoom API. |
| `meeting_date` | string | yes | Human-readable local date and time (user's resolved timezone). E.g. `"June 24, 2026 at 2:00 PM EDT"`. |
| `participants` | string[] | yes | Display names of meeting participants (from `get_meeting_assets`). Cap at 10 names. |
| `meeting_summary` | string | yes | First ≤400 chars of `meeting_summary.summary_overview` from `get_meeting_assets`. |
| `action_items` | string[] | yes | Union of `meeting_summary.next_steps[].text` and `get_recording_resource` `next_steps.items[].text`, deduplicated. |
| `draft_doc_title` | string | yes | Proposed Zoom Doc title. Suggested pattern: `"Meeting summary — {meeting_topic} — {date}"`. The user may edit this in the iframe before saving. |
| `draft_doc_body` | string | yes | Full markdown body for the Zoom Doc. Include meeting topic as H1, date, participants, full AI summary, bulleted action items, and recording URL section (if available). The user may edit this in the iframe. Must be non-empty — the connector rejects empty `content`. |
| `open_in_zoom_url` | string | yes | Deep link to the Zoom recording or meeting. Use `https://zoom.us/rec/play/{meeting_uuid}` for completed meetings with recordings, `https://zoom.us/j/{meeting_number}` for scheduled meetings. |
| `personalization_signals` | string[] | no | Up to 4 short bullets citing which tone or preference rule from `user.md` or `data/instructions/agntux-zoom.md` shaped the draft. |
| `generated_at` | string | yes | RFC 3339 timestamp of the ingest run that authored this payload. |

### Connector args mapping

The save-doc iframe's Send handler (`build-envelope.ts`) maps these
payload keys to the Zoom Connector's `create_new_file_with_markdown`
args as follows:

| Payload key | Connector arg | Notes |
|---|---|---|
| `draft_doc_body` | `content` | Required non-empty. The full markdown body the user reviewed and optionally edited in the iframe. |
| `draft_doc_title` | `file_name` | The document title the user reviewed and optionally edited. |
| *(optional)* | `parent_id` | Not sourced from the payload; the user or the host may supply a folder target. Omitted when absent. |

### Worked example

```yaml
meeting_uuid: "abc123XYZdef/ghi=="
meeting_topic: "Q3 roadmap planning"
meeting_date: "June 24, 2026 at 2:00 PM EDT"
participants:
  - "Alice Chen"
  - "Bob Martinez"
  - "Trish Jordan"
meeting_summary: "Team reviewed the Q3 feature slate. Three items were cut to Q4; the mobile redesign milestone moved to July 31."
action_items:
  - "Trish: update the roadmap doc with July 31 milestone"
  - "Trish: share revised scope with stakeholders by EOD Thursday"
draft_doc_title: "Meeting summary — Q3 roadmap planning — June 24, 2026"
draft_doc_body: |
  # Q3 roadmap planning

  **Date:** June 24, 2026 at 2:00 PM EDT
  **Participants:** Alice Chen, Bob Martinez, Trish Jordan

  ## Summary

  Team reviewed the Q3 feature slate. Three items were cut to Q4; the
  mobile redesign milestone moved to July 31.

  ## Action items

  - Trish: update the roadmap doc with July 31 milestone
  - Trish: share revised scope with stakeholders by EOD Thursday

  ## Recording

  https://zoom.us/rec/play/abc123XYZdef%2Fghi%3D%3D
open_in_zoom_url: "https://zoom.us/rec/play/abc123XYZdef%2Fghi%3D%3D"
personalization_signals:
  - "Terse register — per user.md"
generated_at: "2026-06-24T18:30:00Z"
```

### Which action types get a `## Compose payload` section

| Action signal | Include `## Compose payload`? |
|---|---|
| User-assigned next steps (`zoom:next-steps:{uuid}`) | Yes |
| New recording available (`zoom:recording:{uuid}`) | Yes — if next-steps action already exists for the same meeting, merge recording URL into that action's payload instead |
| Upcoming meeting within 2 hours (`zoom:upcoming:{uuid}`) | No — no save-doc button on deadline actions |
| Unread Team Chat mention/DM (`zoom:chat:…`) | No — chat actions use Open in Zoom only |
| Zoom Doc shared/updated (`zoom:doc:{file_id}`) | No — doc-review actions use Open document only |
