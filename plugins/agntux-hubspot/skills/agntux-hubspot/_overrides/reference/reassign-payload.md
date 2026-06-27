# Reassign payload schema — Step 10 reference (agntux-hubspot)

Companion to `reference/sync.md` Step 10. Describes the `## Reassign payload`
body section the ingest skill writes to every action item that carries a
`Reassign record` suggested action. The `agntux_hubspot_reassign_view` view tool
reads this section at click time via
`parseYamlSection(body, "Reassign payload")`.

Source: `data/instructions/reassign.md` — `## Reassign payload`.

---

## Conditional body section: `## Reassign payload`

REQUIRED for every action item whose `suggested_actions` list contains a
`Reassign record` entry (handler: `reassign`). Candidate owners MUST be resolved
at ingest time via `search_owners` and cross-referenced against the user's
`# People` mapping — the iframe renders the candidate list as a radio group, and
the user picks from this pre-loaded set.

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `record_id` | string | HubSpot `hs_object_id` of the record to reassign |
| `record_url` | string | `https://app.hubspot.com/contacts/{portal_id}/{object_type_lower}/{hs_object_id}` |
| `record_type` | string | Uppercase object type: `DEAL`, `TICKET`, or `CONTACT` |
| `record_name` | string | Display name of the record |
| `current_owner` | string | Display name of the current `hubspot_owner_id` holder; `"Unknown"` if unresolvable |
| `candidate_owners` | object[] | Each: `{ownerId: string, name: string}` — ordered by suggestion strength, cap 6 |

These names match the `ReassignPayloadOk` interface in
`view-tool/src/agntux-hubspot-view.ts`.

### On-disk shape

```markdown
## Reassign payload

​```yaml
record_id: "<hs_object_id as quoted string>"
record_url: "https://app.hubspot.com/contacts/{portal_id}/{object_type_lower}/{hs_object_id}"
record_type: "<DEAL | TICKET | CONTACT>"
record_name: "<display name>"
current_owner: "<display name of current owner, or 'Unknown'>"
candidate_owners:
  - ownerId: "<hubspot owner id as quoted string>"
    name: "<display name>"
  - ownerId: "<hubspot owner id as quoted string>"
    name: "<display name>"
​```
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. Owner IDs and record IDs are numeric strings; quote them
(e.g. `ownerId: "12345678"`, `record_id: "99999"`).

`candidate_owners` must be pre-populated at ingest time. Do NOT leave the list
empty — if no candidates can be resolved, do not emit a `Reassign record`
suggested action. Raise a `needs-decision` action and direct the user to open the
record in HubSpot instead.

Candidate list ordering: place the most strongly recommended candidate first (by
owner fit: industry match, team routing pattern from action history, associated
company ownership). Cap at 6 entries. Exclude the current owner and the
authenticated user from the list.

`record_url` uses the lowercase singular object type as the URL path segment:
`DEAL` → `deal`, `TICKET` → `ticket`, `CONTACT` → `contact`.

---

## Send envelope target

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildReassignEnvelope()` in
`view-tool/src/apps/reassign/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `objectType`: from `structuredContent.record_type` (uppercase — `DEAL`,
  `TICKET`, or `CONTACT`)
- `operation`: `"update"` (constant)
- `objectId`: from `structuredContent.record_id`
- `properties.hubspot_owner_id`: the `ownerId` of the candidate the user selected

The `ownerId` written to `properties.hubspot_owner_id` MUST be one of the
`ownerId` values present in `candidate_owners`. The build-envelope normalises
`recordType` to uppercase via `recordType.toUpperCase()`.

Discard emits no envelope; a local banner confirms the owner is unchanged.
