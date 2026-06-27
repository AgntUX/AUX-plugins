# Move-deal payload schema — Step 10 reference (agntux-hubspot)

Companion to `reference/sync.md` Step 10. Describes the `## Move-deal payload`
body section the ingest skill writes to every action item that carries a
`Move deal stage` suggested action. The `agntux_hubspot_move_deal_view` view tool
reads this section at click time via `parseYamlSection(body, "Move-deal payload")`.

Source: `data/instructions/move-deal.md` — `## Move-deal payload`.

---

## Conditional body section: `## Move-deal payload`

REQUIRED for every action item whose `suggested_actions` list contains a
`Move deal stage` entry (handler: `move-deal`). Available pipeline stages MUST be
fetched at ingest time via `search_properties` (objectType: deals, query:
dealstage) and embedded in full — the iframe renders the complete list as a radio
group.

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `deal_id` | string | HubSpot `hs_object_id` of the deal |
| `deal_url` | string | `https://app.hubspot.com/contacts/{portal_id}/deal/{hs_object_id}` |
| `deal_name` | string | `dealname` property |
| `pipeline_label` | string | Human-readable pipeline name (resolved via `search_properties` at ingest) |
| `current_stage` | string | Human-readable label for the current `dealstage` value |
| `available_stages` | object[] | Each: `{id: string, label: string}` — full pipeline stage list in order |
| `amount` | string | `amount` property (numeric string in deal currency) |
| `currency_code` | string | `deal_currency_code` property |
| `close_date` | string | `closedate` as ISO 8601 date string, or empty string if not set |

These names match the `MoveDealPayloadOk` interface in
`view-tool/src/agntux-hubspot-view.ts`.

### On-disk shape

```markdown
## Move-deal payload

​```yaml
deal_id: "<hs_object_id as quoted string>"
deal_url: "https://app.hubspot.com/contacts/{portal_id}/deal/{hs_object_id}"
deal_name: "<dealname>"
pipeline_label: "<human-readable pipeline name>"
current_stage: "<human-readable label for current dealstage>"
available_stages:
  - id: "<internal stage id>"
    label: "<human-readable stage label>"
  - id: "<internal stage id>"
    label: "<human-readable stage label>"
amount: "<amount as numeric string, or empty string>"
currency_code: "<deal_currency_code, e.g. 'USD'>"
close_date: "<ISO 8601 date string, e.g. '2026-07-15', or empty string>"
​```
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. Stage IDs and deal IDs are strings that may look numeric; quote
them (e.g. `deal_id: "12345"`).

`available_stages` MUST list ALL pipeline stages in pipeline order. Do not
filter to only forward stages. The user may move a deal backward.

`close_date` is the raw `closedate` property value from HubSpot as an ISO 8601
date string. If the property is null or missing from the response, write
`close_date: ""`.

---

## Send envelope target

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildMoveDealEnvelope()` in
`view-tool/src/apps/move-deal/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `objectType`: `"DEAL"` (constant)
- `operation`: `"update"` (constant)
- `objectId`: from `structuredContent.deal_id`
- `properties.dealstage`: the stage `id` the user selected in the picker

The `available_stages` list is the authorised set. The envelope must use the
stage `id` (the internal HubSpot stage identifier), not the human-readable
`label`. Discard emits no envelope; a local banner confirms the deal stage is
unchanged.
