# Edit payload schema — Step 10 reference (agntux-jira)

Companion to `reference/sync.md` Step 10. Describes the `## Edit payload`
body section the ingest skill writes to every action item that carries an
`Edit issue` suggested action. The `agntux_jira_edit_view` view tool reads this
section at click time via `parseEditPayloadYaml()`.

Source: `data/instructions/edit.md` — `## Edit payload`.

---

## Conditional body section: `## Edit payload`

REQUIRED for every action item whose `suggested_actions` list contains an
`Edit issue` entry (handler: `edit`). The iframe shows current values alongside
draft suggestions; Send includes ONLY the fields the user actually changed. The
Send button is disabled on zero-diff (no changes made).

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `cloud_id` | string | Atlassian Cloud instance ID — from `data/learnings/agntux-jira/sync.md → cursor.cloudIds[0]` |
| `issue_key` | string | Issue key (e.g. `OFM-412`) — `issue.key` |
| `issue_url` | string | `{atlassian_site_url}/browse/{issue_key}` |
| `current_summary` | string | `issue.fields.summary` at ingest time (verbatim) |
| `current_priority` | string or null | `issue.fields.priority.name`, or `null` |
| `current_labels` | string[] | `issue.fields.labels` (may be empty array) |
| `available_priorities` | string[] | Ordered list of valid priority names for this project |
| `available_labels` | string[] | Known labels for this project (from recent issues, cap 20) |
| `draft_summary` | string or null | Suggested replacement summary, or `null` if summary is fine |
| `draft_priority` | string or null | Suggested replacement priority name, or `null` if priority is fine |
| `draft_labels` | string[] or null | Suggested full replacement label set, or `null` if labels are fine |
| `personalization_signals` | string[] | ≤4 bullets, ≤120 chars each |
| `generated_at` | string | RFC 3339 timestamp of this ingest run |

These names match the `EditViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`.

### On-disk shape

```markdown
## Edit payload

​```yaml
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
​```
```

YAML quoting reminder: `current_summary` and `draft_summary` commonly contain
`: ` — wrap them in double quotes. Any string scalar containing `: ` or
starting with `{` MUST be wrapped in double quotes.

When an edit is suggested, populate the relevant draft field:

- `draft_summary`: revised summary when the current one is stale, placeholder,
  or inaccurate. Match the existing format and sentence case — fix accuracy only.
- `draft_priority`: a priority name from `available_priorities`.
- `draft_labels`: the **full replacement** label set (not a diff). Jira's
  `editJiraIssue` replaces the entire `labels` array; include unchanged labels
  that should be preserved alongside any additions.

Fields with no suggested change stay `null`. `available_priorities` should come
from the project's actual priority scheme returned by the connector; fall back to
the standard five-value list shown above when unavailable.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__editJiraIssue`

The envelope is assembled by `buildEditEnvelope()` in
`view-tool/src/apps/edit/lib/build-envelope.ts`.

The envelope includes ONLY the fields the user actually changed in the form.
Fields unchanged from their `current_*` values are omitted entirely — this
avoids unintentional overwrites on fields the iframe did not surface.

Args derived from the form at Send time (only changed fields):

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `fields.summary` (only if changed): user-edited value
- `fields.priority.name` (only if changed): selected priority name
- `fields.labels` (only if changed): the full label array after edits

The `fields.labels` value is always a full replacement array — if the user adds one
label, the envelope must carry all existing labels plus the new one, not just the
new one. The Send button must remain disabled when no fields differ from current
values. Discard emits no envelope; a local banner confirms no changes were
applied.
