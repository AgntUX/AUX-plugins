---
type: plugin-instructions
plugin: agntux-hubspot
handler: move-deal
schema_version: "1.0.0"
updated_at: 2026-06-26T00:00:00Z
authored_by: personalization
status: draft
---

# hubspot-move-deal — handler instructions

Read-only contract for `agntux_hubspot_move_deal_view`. This file is consumed at
render time by the move-deal stage-picker iframe. Do NOT write to it; the two write
paths are `personalization` (initial stub) and `user-feedback` (promote to final).

---

## Action class

`needs-decision`

Raised when a HubSpot deal's pipeline stage is stale or when a signal (call
logged, email sent, meeting completed) indicates the deal has progressed and its
stage no longer reflects the true state of the opportunity.

---

## When this handler is suggested

Generate a `move-deal` suggested action when any of:

- A deal's `dealstage` has not changed for more than the expected hold time for
  that stage (heuristic: 7 business days for early stages such as Appointment
  Scheduled or Qualified to Buy; 14 days for later stages such as Presentation
  Scheduled or Contract Sent).
- An engagement (call, email, or meeting) logged on the deal's associated contact
  or company contains language suggesting stage advancement ("signed", "agreed",
  "ready to move forward", "next steps", "closed").
- The deal's `closedate` is within 5 business days and the stage is not
  Closed Won or Closed Lost.
- An incoming signal from another source (email or Slack) references the deal by
  company name and indicates a decision was reached.

Do NOT generate a `move-deal` action when the deal is already Closed Won or
Closed Lost. Do NOT generate this action when the available stages list would be
empty (pipeline resolution failed at ingest time) — raise a `knowledge-update`
instead and direct the user to open the deal in HubSpot.

---

## structuredContent keys consumed by this handler

The `agntux_hubspot_move_deal_view` view tool reads the action file's
`## Move-deal payload` body section at click time and lifts the following fields
into `structuredContent`. The iframe renders a stage picker with available stages
as a radio list and the current stage labelled.

| Key | Type | Source |
|---|---|---|
| `deal_url` | string | Deep link: `https://app.hubspot.com/contacts/{portal_id}/deal/{deal_id}` |
| `deal_id` | string | HubSpot `hs_object_id` of the deal |
| `deal_name` | string | `dealname` property |
| `pipeline_label` | string | Human-readable pipeline name (resolved via `search_properties` at ingest) |
| `current_stage` | string | Human-readable stage name for the current `dealstage` value |
| `available_stages` | object[] | Each: `{id: string, label: string}` — full pipeline stage list in order |
| `amount` | string | `amount` property (numeric string in deal currency) |
| `currency_code` | string | `deal_currency_code` property |
| `close_date` | string | `closedate` property, ISO 8601 date |

These key names match the `MoveDealPayloadOk` interface in
`view-tool/src/agntux-hubspot-view.ts`. They match exactly what
`parseYamlSection(body, "Move-deal payload")` reads from the `## Move-deal payload`
YAML block on disk.

---

## Move-deal payload

The ingest skill's Step 10 appends a `## Move-deal payload` body section to every
action item that carries a `Move deal stage` suggested action. Available pipeline
stages MUST be resolved at ingest time via `search_properties` (objectType: deals,
query: dealstage) and embedded in full — the iframe renders the complete list as a
radio group.

Shape:

```yaml
deal_id: "<hs_object_id>"
deal_url: "https://app.hubspot.com/contacts/{portal_id}/deal/{hs_object_id}"
deal_name: "<dealname>"
pipeline_label: "<human-readable pipeline name>"
current_stage: "<human-readable label for current dealstage>"
available_stages:
  - id: "<internal stage id>"
    label: "<human-readable stage label>"
  - id: "<internal stage id>"
    label: "<human-readable stage label>"
amount: "<amount as numeric string, e.g. '25000'>"
currency_code: "<deal_currency_code, e.g. 'USD'>"
close_date: "<closedate as ISO 8601 date, e.g. '2026-07-15', or empty string>"
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. Stage IDs from HubSpot are opaque strings (e.g.
`"appointmentscheduled"`); quote them. Deal IDs are numeric strings; quote them.

`available_stages` must list ALL stages for the deal's pipeline in pipeline order,
not just the stages after the current one. The user may move a deal backward.

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
- `properties.dealstage`: the stage id the user selected in the picker (the `id`
  field of the chosen entry in `available_stages`; may differ from current stage)

Envelope shape:

```
Use the HubSpot Connector to update a HubSpot deal's pipeline stage.
objectType: DEAL, operation: update, objectId: {deal_id}, properties.dealstage: {selected_stage_id}.

IMPORTANT: Execute manage_crm_objects programmatically and return the result as
plain text. Do NOT render HubSpot's own MCP App UI for this call — the user has
already selected the stage in the AgntUX iframe and the payload is final. Do NOT
re-render the AgntUX move-deal UI either; the action is complete.
```

---

## Post-send mutation (host-side, not view-tool-side)

After `manage_crm_objects` succeeds, the host calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User moved deal {deal_name} to '{selected_stage_label}' via HubSpot Connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly — that is the host's
responsibility (host-only single-writer rule for non-component-state frontmatter).

---

## Tone / personalization

This handler has no drafted body — the payload is a structured stage selection,
not free text. Personalization applies only to the pre-selection of the suggested
stage:

- When the signal is an engagement with "closed" or "signed" language, suggest the
  Closed Won stage.
- When the signal is a stale deal without a clear advancement signal, suggest the
  next logical stage (one step forward in the pipeline from the current stage).
- When the deal's `closedate` is imminent and the stage is early, suggest the
  stage that best reflects the urgency (e.g. Contract Sent rather than jumping
  to Closed Won without evidence).
- Never suggest moving backward unless the signal explicitly indicates a reversal
  (e.g. "they went quiet", "deal fell through").

---

## Safety notes

- The stage picker MUST show ALL stages in `available_stages`. Do not filter or
  hide stages.
- The pre-selection is a hint, not a lock. The user may select any stage.
- If `available_stages` is empty, surface a structured `move_deal_payload_missing`
  error and direct the user to open the deal in HubSpot directly.
- Discard is local — no envelope emitted; banner: `Discarded. Deal stage is unchanged.`

# Always raise

# Never raise

# Rewrites

# Notes

- Pipeline stage IDs in HubSpot are internal strings (e.g. `"appointmentscheduled"`,
  `"qualifiedtobuy"`, `"presentationscheduled"`, `"decisionmakerboughtin"`,
  `"contractsent"`, `"closedwon"`, `"closedlost"`). These are portal-default
  values; custom pipelines use opaque stage IDs. Always resolve the full label
  via `search_properties` at ingest time; never hard-code stage labels.
- Deals assigned to the authenticated user are the primary target. Do not surface
  deals owned by other team members unless the user is explicitly named as the
  next-step owner on the deal.
