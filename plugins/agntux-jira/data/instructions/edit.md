---
type: plugin-instructions
plugin: agntux-jira
handler: edit
schema_version: "1.0.0"
updated_at: 2026-06-08T00:00:00Z
authored_by: personalization
status: draft
---

# jira-edit — handler instructions

Read-only contract for `agntux_jira_edit_view`. This file is consumed at
render time by the metadata edit iframe. Do NOT write to it; the two write
paths are `personalization` (initial stub) and `user-feedback` (promote to
final).

---

## Action class

`knowledge-update`

Raised when a Jira issue's metadata is stale or incorrect and needs a quick
field correction — wrong priority, missing labels, or a summary that no longer
matches what the issue is about.

---

## When this handler is suggested

Generate an `edit` suggested action when any of:

- An issue's priority is `Highest` or `High` but has sat unchanged for more
  than 5 business days with no activity — possibly an inflated priority that
  should be downgraded.
- A comment on the issue explicitly requests a metadata change ("can you
  re-title this?", "this should be labelled `infra`", "bump this to High").
- The issue summary contains placeholder text (`TBD`, `[PLACEHOLDER]`, `TODO`,
  `Draft`) and the issue has been active for more than 3 days.
- A label known from `user.md → jira.label_taxonomy` (if present) is missing
  from an issue that clearly belongs to that category (e.g. an issue in the
  `PLAT` project about infrastructure that is missing the `infra` label).
- The issue priority has been auto-set to `Medium` by Jira automation but a
  higher-priority signal is present in the issue content or linked context.

Do NOT generate an `edit` action for single-field changes that are better
handled by a more specific action class (e.g. assignee changes → `assign`,
status changes → `transition`).

---

## structuredContent keys consumed by this handler

The `agntux_jira_edit_view` view tool reads the action file's
`## Edit payload` body section at click time and lifts the following fields
into `structuredContent`. The iframe renders an edit form showing current
values with editable fields for summary, priority, and labels. Only the
fields the user actually changes are included in the Send envelope.

| Key | Type | Source |
|---|---|---|
| `issue_url` | string | Deep link to the issue (`{atlassian_site_url}/browse/{issue_key}`) |
| `issue_key` | string | Issue key (e.g. `OFM-412`) |
| `current_summary` | string | `issue.fields.summary` at ingest time |
| `current_priority` | string or null | `issue.fields.priority.name`, or `null` |
| `current_labels` | string[] | `issue.fields.labels` (may be empty array) |
| `available_priorities` | string[] | Ordered list of valid Jira priority names for this project (e.g. `["Highest","High","Medium","Low","Lowest"]`) |
| `available_labels` | string[] | Known labels for this project (from recent issues in the same project, capped at 20) |
| `draft_summary` | string or null | Suggested replacement summary, or `null` if summary is fine |
| `draft_priority` | string or null | Suggested replacement priority name, or `null` if priority is fine |
| `draft_labels` | string[] or null | Suggested replacement labels array, or `null` if labels are fine |
| `personalization_signals` | string[] | Short bullets (≤4, ≤120 chars each) |
| `cloud_id` | string | Atlassian Cloud instance ID |

These key names match the `EditViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`. They match exactly what
`parseEditPayloadYaml()` reads from the `## Edit payload` YAML block on disk.

---

## Edit payload

The ingest skill's Step 10 appends an `## Edit payload` body section to every
action item that carries an `Edit issue` suggested action. Shape:

```yaml
cloud_id: "<atlassian cloud id>"
issue_key: "<PROJECT-NNN>"
issue_url: "https://<site>.atlassian.net/browse/<PROJECT-NNN>"
current_summary: "<existing summary verbatim>"
current_priority: "<priority name or null>"
current_labels: []
available_priorities:
  - Highest
  - High
  - Medium
  - Low
  - Lowest
available_labels:
  - "<label>"
  - "<label>"
draft_summary: null
draft_priority: null
draft_labels: null
personalization_signals:
  - "<≤120 chars; reason for the suggested edit>"
generated_at: "<RFC 3339 of this run>"
```

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. `current_summary` and `draft_summary` may contain colons; wrap
them.

When an edit is suggested, populate the relevant draft field:
- `draft_summary`: a revised summary if the current one is stale/placeholder.
  Keep the same format and sentence case as the existing summary — do not
  rewrite style, only fix accuracy.
- `draft_priority`: the suggested priority name (must be one of
  `available_priorities`).
- `draft_labels`: the full replacement label set (not a diff — Jira's
  `editJiraIssue` replaces the entire labels array). Include unchanged labels
  that should be preserved.

Fields with no suggested change remain `null`.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__editJiraIssue`

The envelope is assembled by `buildEditEnvelope()` in
`view-tool/src/apps/edit/lib/build-envelope.ts`.

The envelope includes ONLY the fields the user actually changed in the form.
Fields unchanged from their `current_*` values are omitted from the envelope.
This avoids unintentional overwrites on fields the iframe did not surface.

Args derived from the form at Send time (only changed fields):

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `fields.summary` (only if changed): user-edited value
- `fields.priority.name` (only if changed): selected priority name
- `fields.labels` (only if changed): current full label array after edits

Envelope shape (all three fields changed, as illustration):

```
Use the Atlassian Connector to edit a Jira issue's metadata.
cloudId: {cloud_id}, issueIdOrKey: {issue_key}.
Changed fields: summary «{new_summary}», priority: {new_priority}, labels: [{label_csv}].
(action_id: {action_id})

IMPORTANT: Execute editJiraIssue programmatically and return the result as
plain text. Do NOT render Atlassian's own MCP App UI for this call — the user
has already made their edits in the AgntUX iframe and the payload is final.
Do NOT re-render the AgntUX edit UI either; the action is complete.
```

When only a subset of fields changed, omit the unchanged fields from the
"Changed fields" line. A `summary`-only change would read:

```
Changed fields: summary «{new_summary}».
```

The summary value is guillemet-delimited (same escaping rules as comment
bodies: literal `«` → `««`, literal `»` → `»»`).

---

## Post-send mutation (host-side, not view-tool-side)

After `editJiraIssue` succeeds, the host calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User edited {issue_key} metadata via Atlassian connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly — that is the host's
responsibility (host-only single-writer rule for non-component-state
frontmatter).

---

## Tone / personalization

This handler carries no draft body — the payload is structured field values
with no free text. Tone rules apply to the `personalization_signals` bullets
and to any suggested `draft_summary` rewrites:

- **Summary rewrites**: preserve the issue's original sentence-case and
  phrasing style. If the original reads like a user-story ("As a user, I
  want…"), keep that format; if it reads like a task title ("Fix login
  redirect"), keep that format. Do not impose a new style.
- **Priority suggestions**: when suggesting a priority change, the signal
  must be clear and citable. Note the reason in `personalization_signals`
  (e.g. "High — due date is tomorrow and no activity in 3 days"). Do not
  suggest priority upgrades based on keyword matching alone.
- **Label suggestions**: use labels already in `available_labels` — do not
  invent new label strings. If the right label does not exist, leave
  `draft_labels: null` and note the gap in a `personalization_signals` bullet.

---

## Safety notes

- The form must display `current_summary`, `current_priority`, and
  `current_labels` as a read-only baseline before showing the draft values.
  The user should be able to see exactly what is changing.
- If no changes are made in the form (all draft values left as-is or
  matching current), the Send button must remain disabled. There is no
  zero-diff send.
- The `fields.labels` value in the envelope is a full replacement array.
  If the user adds one label in the form, the envelope must include all existing
  labels plus the new one — not just the new one.
- Discard is local — no envelope emitted; banner: `Discarded — no changes
  applied. The action item is still open.`
- `available_priorities` should be populated from the project's actual
  priority scheme via the connector response. When unavailable, fall back to
  the standard Jira priority list: `["Highest","High","Medium","Low","Lowest"]`.

# Always raise

# Never raise

# Rewrites

# Notes

- Only suggest editing `draft_summary` when the current summary is
  demonstrably stale, placeholder, or inaccurate. Do not rewrite summaries
  for stylistic preference.
- When suggesting a label addition, include the full label set including
  existing labels in `draft_labels` — Jira replaces the array wholesale.
- `available_labels` is populated by the ingest agent from labels seen on
  recent issues in the same project (last 30 days). It is a convenience set,
  not an exhaustive list — labels not in `available_labels` can still be
  typed in manually in the form.
