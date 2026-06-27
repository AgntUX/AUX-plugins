# Task payload schema — Step 10 reference (agntux-hubspot)

Companion to `reference/sync.md` Step 10. Describes the `## Task payload`
body section the ingest skill writes to every action item that carries a task
suggested action (`Mark task complete` or `Reschedule task`). The
`agntux_hubspot_task_view` view tool reads this section at click time via
`parseYamlSection(body, "Task payload")`.

Source: `data/instructions/task.md` — `## Task payload`.

---

## Conditional body section: `## Task payload`

REQUIRED for every action item whose `suggested_actions` list contains a
`Mark task complete` or `Reschedule task` entry (handler: `task`). The iframe
renders a two-tab card — Complete and Reschedule — for the user to pick an action.

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `task_id` | string | HubSpot `hs_object_id` of the task |
| `task_url` | string | `https://app.hubspot.com/contacts/{portal_id}/task/{hs_object_id}` |
| `task_title` | string | `hs_task_subject` property |
| `due_date` | string | `hs_timestamp` converted to ISO 8601 date (e.g. `"2026-06-28"`) |
| `status` | string | `hs_task_status` (e.g. `"NOT_STARTED"`, `"IN_PROGRESS"`) |
| `associated_record_name` | string | Display name of the associated CRM record; empty string if unresolved |
| `modes` | string[] | Always `["complete", "reschedule"]` for this plugin release |

These names match the `TaskPayloadOk` interface in
`view-tool/src/agntux-hubspot-view.ts`.

### On-disk shape

```markdown
## Task payload

​```yaml
task_id: "<hs_object_id as quoted string>"
task_url: "https://app.hubspot.com/contacts/{portal_id}/task/{hs_object_id}"
task_title: "<hs_task_subject>"
due_date: "<hs_timestamp as ISO 8601 date, e.g. '2026-06-28'>"
status: "<hs_task_status, e.g. 'NOT_STARTED'>"
associated_record_name: "<display name of associated record, or empty string>"
modes:
  - complete
  - reschedule
​```
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. Task IDs are numeric strings; quote them (e.g. `task_id: "67890"`).

`due_date` is derived from `hs_timestamp` (epoch ms integer) by converting to
ISO 8601 date format (`YYYY-MM-DD`). Store only the date; do not include a time
component. If `hs_timestamp` is missing or unparseable, write `due_date: ""`.

`associated_record_name` is resolved at ingest time from the task's HubSpot
association list. Preference order: deal name > company name > contact full name.
If the association list is empty or cannot be resolved, write
`associated_record_name: ""`.

`modes` is always `["complete", "reschedule"]`. The field exists to allow future
per-action-item mode restriction (e.g. surfacing only the Complete tab when the
task's subject implies it is trivially done). In this release, always include both.

---

## Send envelope targets

### Complete (mark hs_task_status = COMPLETED)

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildCompleteTaskEnvelope()` in
`view-tool/src/apps/task/lib/build-envelope.ts`.

Args:

- `objectType`: `"TASK"` (constant)
- `operation`: `"update"` (constant)
- `objectId`: from `structuredContent.task_id`
- `properties.hs_task_status`: `"COMPLETED"` (constant)

### Reschedule (set new hs_timestamp)

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildRescheduleTaskEnvelope()` in
`view-tool/src/apps/task/lib/build-envelope.ts`.

Args:

- `objectType`: `"TASK"` (constant)
- `operation`: `"update"` (constant)
- `objectId`: from `structuredContent.task_id`
- `properties.hs_timestamp`: new due date as Unix epoch milliseconds (integer
  string), derived from the date the user picks in the iframe

The component converts the user's ISO date string to epoch ms using
`new Date(dateString).getTime()`. Discard emits no envelope; a local banner
confirms the task is unchanged.
