---
type: plugin-instructions
plugin: agntux-hubspot
handler: reassign
schema_version: "1.0.0"
updated_at: 2026-06-26T00:00:00Z
authored_by: personalization
status: draft
---

# hubspot-reassign — handler instructions

Read-only contract for `agntux_hubspot_reassign_view`. This file is consumed at
render time by the owner-picker iframe. Do NOT write to it; the two write paths
are `personalization` (initial stub) and `user-feedback` (promote to final).

---

## Action class

`needs-routing`

Raised when a HubSpot CRM record (deal, ticket, or contact) belongs to the user
but the work clearly belongs to another team member, or when a record is unowned
and needs routing.

---

## When this handler is suggested

Generate a `reassign` suggested action when any of:

- A deal, ticket, or contact is assigned to the user but the record's industry,
  company size, or associated team mapping (from `user.md → # People`) indicates
  the work belongs to a specific team member.
- A deal or ticket is marked as stale (no notes updated in 14 days) and the user
  is no longer the account owner for the associated company.
- A comment or engagement on the record explicitly asks the user to re-route it
  ("can you pass this to…", "this should go to…", "I think {name} owns this").
- A ticket is escalated to a tier the user's role does not cover (e.g. a
  technical issue requiring a solutions engineer when the user is a sales rep).

Do NOT generate a `reassign` action when no candidate owner can be suggested with
reasonable confidence — raise a `needs-decision` action instead and direct the
user to open the record in HubSpot to assign manually.

---

## structuredContent keys consumed by this handler

The `agntux_hubspot_reassign_view` view tool reads the action file's
`## Reassign payload` body section at click time and lifts the following fields
into `structuredContent`. The iframe renders a candidate owner list as a radio
group with the current owner labelled.

| Key | Type | Source |
|---|---|---|
| `record_url` | string | Deep link: `https://app.hubspot.com/contacts/{portal_id}/{object_type}/{record_id}` |
| `record_id` | string | HubSpot `hs_object_id` of the record to reassign |
| `record_type` | string | Object type in uppercase: `DEAL`, `TICKET`, or `CONTACT` |
| `record_name` | string | Display name of the record (deal name, ticket subject, or contact full name) |
| `current_owner` | string | Display name of the current owner (resolved via `search_owners` at ingest) |
| `candidate_owners` | object[] | Each: `{ownerId: string, name: string}` — ordered by suggestion strength, cap 6 |

These key names match the `ReassignPayloadOk` interface in
`view-tool/src/agntux-hubspot-view.ts`.

---

## Reassign payload

The ingest skill's Step 10 appends a `## Reassign payload` body section to every
action item that carries a `Reassign record` suggested action. Candidate owners
MUST be resolved at ingest time via `search_owners` and cross-referenced against
the user's `# People` mapping. Shape:

```yaml
record_id: "<hs_object_id>"
record_url: "https://app.hubspot.com/contacts/{portal_id}/{object_type_lower}/{hs_object_id}"
record_type: "<DEAL | TICKET | CONTACT>"
record_name: "<display name>"
current_owner: "<display name of current hubspot_owner_id holder>"
candidate_owners:
  - ownerId: "<hubspot owner id string>"
    name: "<display name>"
  - ownerId: "<hubspot owner id string>"
    name: "<display name>"
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. Owner IDs and record IDs are numeric strings (e.g. `"12345678"`);
quote them.

Candidate list ordering: place the most strongly recommended candidate first, then
list additional plausible candidates in descending priority. Cap at 6 candidates.

`record_url` path segment: use the lowercase singular object type as the URL
segment — `deal` → `deal`, `ticket` → `ticket`, `contact` → `contact`.

When `current_owner` cannot be resolved at ingest time (the `hubspot_owner_id` on
the record maps to no owner in the portal), write `current_owner: "Unknown"`.

---

## Send envelope target

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildReassignEnvelope()` in
`view-tool/src/apps/reassign/lib/build-envelope.ts`.

Args:

- `objectType`: from `structuredContent.record_type` (uppercase)
- `operation`: `"update"` (constant)
- `objectId`: from `structuredContent.record_id`
- `properties.hubspot_owner_id`: the `ownerId` of the candidate the user selected

Envelope shape:

```
Use the HubSpot Connector to update the owner of a HubSpot {RECORD_TYPE} record.
objectType: {RECORD_TYPE}, operation: update, objectId: {record_id}, properties.hubspot_owner_id: {selected_owner_id}.

IMPORTANT: Execute manage_crm_objects programmatically and return the result as
plain text. Do NOT render HubSpot's own MCP App UI for this call — the user has
already selected the new owner in the AgntUX iframe and the payload is final. Do
NOT re-render the AgntUX reassign UI either; the action is complete.
```

---

## Post-send mutation (host-side, not view-tool-side)

After `manage_crm_objects` succeeds, the host calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User reassigned {record_type} '{record_name}' to '{selected_owner_name}' via HubSpot Connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly.

---

## Tone / personalization

This handler has no drafted body. Personalization applies to candidate ranking:

- Read recent `reassign` events in the knowledge store (`## Activity` sections on
  resolved action items) to learn which team members the user has routed which
  types of records to before.
- For deals: prefer team members known to own accounts in the same industry or
  company-size bracket (from `user.md → # People`).
- For tickets: prefer team members known to handle the ticket category or
  escalation tier.
- For contacts: prefer team members already associated with the same company
  (if the contact's associated company has an owner in HubSpot, that owner is the
  top candidate).
- Never suggest reassigning to the current owner (exclude `current_owner`'s id
  from the candidate list).
- Never suggest reassigning to the authenticated user (the user would not be
  reassigning to themselves via this flow).

---

## Safety notes

- `hubspot_owner_id` written to the record must match a valid HubSpot owner id
  present in `candidate_owners`. Do not allow free-text owner entry.
- If `candidate_owners` is empty (owner lookup failed at ingest time), surface a
  structured `reassign_payload_missing` error and direct the user to open the
  record in HubSpot to assign manually.
- Discard is local — no envelope emitted; banner: `Discarded. Owner is unchanged.`
- The reassign updates `hubspot_owner_id` only. It does NOT transfer associated
  tasks, deals, or engagements to the new owner. If a full ownership transfer is
  needed, direct the user to HubSpot's bulk reassign tool.

# Always raise

# Never raise

# Rewrites

# Notes

- HubSpot owner IDs are numeric strings (e.g. `"12345678"`). They differ from
  user IDs in HubSpot's user management system. Use `search_owners` at ingest
  time to resolve owner records; pass `email` or `name` as the query parameter.
- When the portal has a large team and many potential candidates match, limit to
  the 6 most plausible. Include "Unassigned" as an option only when the record
  type and action suggest removing ownership is appropriate (rare for deals).
- `CONTACT` reassignment is less common than deal or ticket routing. Flag a
  contact reassign action only when there is a clear routing signal; do not raise
  it for every newly assigned contact.
