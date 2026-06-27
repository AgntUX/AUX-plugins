
### Step 10.1c — Action-specific payload sections (hubspot)

HubSpot ships four action-modifying view tools, each reading a dedicated payload
section beyond `## Compose payload`. Write the section whenever the action ships
the matching suggested action, or the view renders "… data is unavailable":

- **Conditional body section: `## Move-deal payload`** — REQUIRED when the
  action ships a "move to a new stage" suggested action; the move-deal view reads
  it. Schema and YAML quoting rules are defined by the move-deal-payload reference
  shape.
- **Conditional body section: `## Task payload`** — REQUIRED when the action
  ships a "complete or reschedule" suggested action; the task view reads it.
  Schema and YAML quoting rules are defined by the task-payload reference shape.
- **Conditional body section: `## Activity payload`** — REQUIRED when the action
  ships a "log a note/activity" suggested action; the activity view reads it.
  Schema and YAML quoting rules are defined by the activity-payload reference
  shape.
- **Conditional body section: `## Reassign payload`** — REQUIRED when the action
  ships a "reassign to another owner" suggested action; the reassign view reads
  it. Schema and YAML quoting rules are defined by the reassign-payload reference
  shape.
