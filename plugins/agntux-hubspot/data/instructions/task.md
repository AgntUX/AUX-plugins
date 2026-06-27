---
type: plugin-instructions
plugin: agntux-hubspot
handler: task
schema_version: "1.0.0"
updated_at: 2026-06-26T00:00:00Z
authored_by: personalization
status: draft
---

# hubspot-task — handler instructions

Read-only contract for `agntux_hubspot_task_view`. This file is consumed at render
time by the task action iframe. Do NOT write to it; the two write paths are
`personalization` (initial stub) and `user-feedback` (promote to final).

---

## Action class

`deadline`

Raised when a HubSpot task assigned to the user is overdue or due within 48 hours
and has not yet been completed.

---

## When this handler is suggested

Generate a `task` suggested action when any of:

- A task's `hs_timestamp` (due date, epoch ms) is in the past and
  `hs_task_status` is not `COMPLETED`.
- A task's `hs_timestamp` is within 48 hours of now and `hs_task_status` is not
  `COMPLETED`.
- A task's `hs_task_body` contains language indicating it is blocking other work
  ("must do before", "prerequisite", "blocker").

Generate a `task` action with mode `complete` when the task appears straightforward
to close (the task body describes a concrete completed step the user can confirm).
Generate a `task` action with mode `reschedule` as an alternative when the task
is overdue but there is no indication the underlying work is done (overdue tasks
with no associated call or meeting logged in the last 48 hours are good reschedule
candidates).

Do NOT generate a `task` action for tasks with `hs_task_status: COMPLETED`.

---

## structuredContent keys consumed by this handler

The `agntux_hubspot_task_view` view tool reads the action file's `## Task payload`
body section at click time and lifts the following fields into `structuredContent`.
The iframe renders a two-tab card: Complete tab and Reschedule tab.

| Key | Type | Source |
|---|---|---|
| `task_url` | string | Deep link: `https://app.hubspot.com/contacts/{portal_id}/task/{task_id}` |
| `task_id` | string | HubSpot `hs_object_id` of the task |
| `task_title` | string | `hs_task_subject` property |
| `due_date` | string | `hs_timestamp` property converted to a human-readable date string (e.g. `"2026-06-28"`) |
| `status` | string | `hs_task_status` property (e.g. `"NOT_STARTED"`, `"IN_PROGRESS"`) |
| `associated_record_name` | string | Display name of the CRM record the task is associated with (contact name, company name, or deal name); empty string if unresolved |
| `modes` | string[] | Always `["complete", "reschedule"]` for this plugin release |

These key names match the `TaskPayloadOk` interface in
`view-tool/src/agntux-hubspot-view.ts`.

---

## Task payload

The ingest skill's Step 10 appends a `## Task payload` body section to every
action item that carries a task-related suggested action. Shape:

```yaml
task_id: "<hs_object_id>"
task_url: "https://app.hubspot.com/contacts/{portal_id}/task/{hs_object_id}"
task_title: "<hs_task_subject>"
due_date: "<hs_timestamp as ISO date string, e.g. '2026-06-28'>"
status: "<hs_task_status, e.g. 'NOT_STARTED'>"
associated_record_name: "<display name of associated contact/company/deal, or empty string>"
modes:
  - complete
  - reschedule
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. Task IDs are numeric strings; quote them.

`due_date` is the `hs_timestamp` value converted from epoch milliseconds to an
ISO 8601 date string (`YYYY-MM-DD`). Store only the date portion — the time of
day is not surfaced in the iframe.

`associated_record_name` is resolved at ingest time from the task's associated
objects. If the task has multiple associations, prefer: deal name > company name >
contact name. If the association cannot be resolved in the available fetch budget,
use an empty string.

---

## Send envelope targets

This handler produces two distinct envelope shapes depending on the user's tab
selection in the iframe.

### Complete — mark task done

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildCompleteTaskEnvelope()` in
`view-tool/src/apps/task/lib/build-envelope.ts`.

Args:

- `objectType`: `"TASK"` (constant)
- `operation`: `"update"` (constant)
- `objectId`: from `structuredContent.task_id`
- `properties.hs_task_status`: `"COMPLETED"` (constant)

Envelope shape:

```
Use the HubSpot Connector to mark a HubSpot task as complete.
objectType: TASK, operation: update, objectId: {task_id}, properties.hs_task_status: COMPLETED.

IMPORTANT: Execute manage_crm_objects programmatically and return the result as
plain text. Do NOT render HubSpot's own MCP App UI for this call — the user has
already confirmed the action in the AgntUX iframe and the payload is final. Do NOT
re-render the AgntUX task UI either; the action is complete.
```

### Reschedule — set a new due date

Connector: HubSpot Connector
Tool: `mcp__hubspot__manage_crm_objects`

The envelope is assembled by `buildRescheduleTaskEnvelope()` in
`view-tool/src/apps/task/lib/build-envelope.ts`.

Args:

- `objectType`: `"TASK"` (constant)
- `operation`: `"update"` (constant)
- `objectId`: from `structuredContent.task_id`
- `properties.hs_timestamp`: new due date as Unix epoch milliseconds (integer string)

Envelope shape:

```
Use the HubSpot Connector to reschedule a HubSpot task to a new due date.
objectType: TASK, operation: update, objectId: {task_id}, properties.hs_timestamp: {epoch_ms} (epoch ms for {new_due_date}).

IMPORTANT: Execute manage_crm_objects programmatically and return the result as
plain text. Do NOT render HubSpot's own MCP App UI for this call — the user has
already selected the new due date in the AgntUX iframe and the payload is final.
Do NOT re-render the AgntUX task UI either; the action is complete.
```

---

## Post-send mutation (host-side, not view-tool-side)

After `manage_crm_objects` succeeds, the host calls:

For Complete:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User marked task '{task_title}' complete via HubSpot Connector on <ISO date>."
)
```

For Reschedule:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User rescheduled task '{task_title}' to {new_due_date} via HubSpot Connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly.

---

## Tone / personalization

This handler has no drafted body. Personalization applies to which tab is shown
as the default:

- Default to Complete tab when the task's associated record shows a recent
  engagement (call, email, or meeting) that implies the task work was done.
- Default to Reschedule tab when the task is more than 7 days overdue with no
  recent engagement, suggesting the work has not happened yet.
- For tasks with `hs_task_priority: HIGH`, surface in the action title that
  rescheduling may affect pipeline health.

---

## Safety notes

- The Complete action sets `hs_task_status: "COMPLETED"` unconditionally. This
  is irreversible via this flow — direct the user to HubSpot if they need to
  reopen a completed task.
- The Reschedule action sets `hs_timestamp` to the new date at midnight UTC
  (start of day). The user's date picker input is treated as a local date;
  convert to epoch ms using `new Date(dateString).getTime()` (midnight UTC for
  a YYYY-MM-DD string is acceptable for HubSpot's date-only task fields).
- Do not allow the user to reschedule to a date in the past. The date input in
  the iframe should have `min` set to today's ISO date. If the API rejects the
  date, surface the error message from the connector response.
- Discard is local — no envelope emitted; banner: `Discarded. Task is unchanged.`

# Always raise

# Never raise

# Rewrites

# Notes

- `hs_task_status` values: `NOT_STARTED`, `IN_PROGRESS`, `WAITING`, `COMPLETED`,
  `DEFERRED`. Only `COMPLETED` tasks are excluded from the filter. All other
  statuses may generate an action item.
- Tasks with `hs_task_type: EMAIL` or `hs_task_type: CALL` are sequence-driven
  tasks created by HubSpot Sequences. These often complete automatically when the
  associated action is logged; suppress action items for sequence tasks unless the
  `hs_task_status` has been `NOT_STARTED` for more than 3 business days past the
  due date (suggesting the sequence step was skipped).
