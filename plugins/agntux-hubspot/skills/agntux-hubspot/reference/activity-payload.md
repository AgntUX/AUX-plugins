# Activity payload schema — Step 10 reference (agntux-hubspot)

Companion to `reference/sync.md` Step 10. Describes the `## Activity payload`
body section the ingest skill writes to every action item that carries a
`Log activity` or `Log note` suggested action. The `agntux_hubspot_activity_view`
view tool reads this section at click time via
`parseYamlSection(body, "Activity payload")`.

Source: `data/instructions/activity.md` — `## Activity payload`.

---

## Conditional body section: `## Activity payload`

REQUIRED for every action item whose `suggested_actions` list contains a
`Log activity` or `Log note` entry (handler: `activity`). The draft note body is
authored at ingest time using engagement context and tone preferences; the iframe
loads the on-disk draft for the user to edit before logging.

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `record_id` | string | HubSpot `hs_object_id` of the associated CRM record |
| `record_url` | string | `https://app.hubspot.com/contacts/{portal_id}/{object_type_lower}/{hs_object_id}` |
| `record_type` | string | Uppercase object type: `CONTACT`, `COMPANY`, `DEAL`, or `TICKET` |
| `record_name` | string | Display name of the record (contact full name, company name, deal name, or ticket subject) |
| `draft_body` | string | Pre-composed note body (≤2000 chars) |
| `personalization_signals` | string[] | Short bullets (≤4, ≤120 chars each) explaining applied preferences |

These names match the `ActivityPayloadOk` interface in
`view-tool/src/agntux-hubspot-view.ts`.

### On-disk shape

```markdown
## Activity payload

​```yaml
record_id: "<hs_object_id as quoted string>"
record_url: "https://app.hubspot.com/contacts/{portal_id}/{object_type_lower}/{hs_object_id}"
record_type: "<CONTACT | COMPANY | DEAL | TICKET>"
record_name: "<display name>"
draft_body: |
  <agent-composed note body, ≤2000 chars, based on engagement and next-step context>
personalization_signals:
  - "<≤120 chars; cite the engagement or signal that triggered this note>"
​```
```

YAML quoting reminder: any string scalar containing `: ` (colon-space) MUST be
wrapped in double quotes. Record IDs are numeric strings; quote them
(e.g. `record_id: "22222"`).

`record_url` uses the lowercase singular object type as the URL path segment:
`CONTACT` → `contact`, `COMPANY` → `company`, `DEAL` → `deal`, `TICKET` →
`ticket`. Note: HubSpot's URL uses `contact` (not `contacts`) for individual
contact records.

`record_type` MUST be one of `CONTACT`, `COMPANY`, `DEAL`, or `TICKET`. The
build-envelope normalises to uppercase via `recordType.toUpperCase()`; storing
uppercase in the payload prevents unnecessary normalisation at send time.

`draft_body` is composed at ingest time. The iframe displays it pre-filled in a
text area; the user may edit or replace it entirely before clicking "Log note".
Cap at 2000 characters at ingest time; the view tool truncates to 2000 if the
stored value is longer. Do NOT store the draft body in the `host_prompt` field
of `suggested_actions`; it belongs only in this payload section.

---

## Send envelope target

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildLogNoteEnvelope()` in
`view-tool/src/apps/activity/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `objectType`: `"NOTE"` (constant — creates a NOTE engagement)
- `operation`: `"create"` (constant)
- `properties.hs_note_body`: the user-edited note body from the iframe
- `properties.hs_timestamp`: Unix epoch milliseconds of send time (string)
- `associations[0].to.id`: `structuredContent.record_id`
- `associations[0].toObjectType`: `structuredContent.record_type` (uppercase)
- `associations[0].types[0]`: `{associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1}`

The body is guillemet-delimited in the envelope text (`«body»`). Literal `«`
and `»` in the user-edited body are doubled (`««`, `»»`). The host strips the
delimiters before passing to `hs_note_body`.

Discard emits no envelope; a local banner confirms no note was logged.
