# Assign payload schema — Step 10 reference (agntux-jira)

Companion to `reference/sync.md` Step 10. Describes the `## Assign payload`
body section the ingest skill writes to every action item that carries a
`Re-assign issue` or `Assign issue` suggested action. The
`agntux_jira_assign_view` view tool reads this section at click time via
`parseAssignPayloadYaml()`.

Source: `data/instructions/assign.md` — `## Assign payload`.

---

## Conditional body section: `## Assign payload`

REQUIRED for every action item whose `suggested_actions` list contains an
`Assign issue` or `Re-assign issue` entry (handler: `assign`). Candidate
assignees MUST be resolved at ingest time via `lookupJiraAccountId` (Step 5h)
and cross-referenced against `user.md → # People`. Account IDs must NOT be
stored as raw email addresses — `editJiraIssue` requires an accountId.

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `cloud_id` | string | Atlassian Cloud instance ID — from `data/learnings/agntux-jira/sync.md → cursor.cloudIds[0]` |
| `issue_key` | string | Issue key (e.g. `OFM-412`) — `issue.key` |
| `issue_url` | string | `{atlassian_site_url}/browse/{issue_key}` |
| `issue_title` | string | `issue.fields.summary` |
| `current_assignee` | object or null | `{account_id: string, display_name: string}`, or `null` if unassigned |
| `candidate_assignees` | object[] | Each: `{account_id: string, display_name: string}` — ordered by suggestion strength, cap 6 |
| `suggested_assignee_account_id` | string or null | The account_id the ingest agent recommends, or `null` if no strong candidate |
| `personalization_signals` | string[] | ≤4 bullets, ≤120 chars each |
| `generated_at` | string | RFC 3339 timestamp of this ingest run |

These names match the `AssignViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`.

### On-disk shape

```markdown
## Assign payload

​```yaml
cloud_id: "<atlassian cloud id>"
issue_key: "<PROJECT-NNN>"
issue_url: "https://<site>.atlassian.net/browse/<PROJECT-NNN>"
issue_title: "<summary>"
current_assignee:
  account_id: "<accountId or null>"
  display_name: "<display name or null>"
candidate_assignees:
  - account_id: "<accountId>"
    display_name: "<display name>"
  - account_id: "<accountId>"
    display_name: "<display name>"
suggested_assignee_account_id: "<accountId of top candidate, or null>"
personalization_signals:
  - "<≤120 chars; reason for the suggested assignee>"
generated_at: "<RFC 3339 of this run>"
​```
```

When `current_assignee` is null (unassigned issue), write:

```yaml
current_assignee: null
```

YAML quoting reminder: account IDs are opaque strings (e.g.
`"5e7b3c1d2f4e1a0012345678"`); quote them. Any string scalar containing `: `
or starting with `{` MUST be wrapped in double quotes.

Candidate list ordering: place the `suggested_assignee_account_id` first, then
additional plausible candidates in descending priority. Cap at 6. Include an
"Unassigned" entry (`account_id: null, display_name: "Unassigned"`) when
clearing the assignee is a valid outcome.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__editJiraIssue`

The envelope is assembled by `buildAssignEnvelope()` in
`view-tool/src/apps/assign/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `fields.assignee.accountId`: the `account_id` John selected in the picker
  (may differ from `suggested_assignee_account_id` if he overrides)

When John selects the "Unassigned" entry, send `fields.assignee: null` rather
than `fields.assignee.accountId: null` — Jira interprets `null` on the
`assignee` object as an unassign. Do not write an accountId that is not present
in `candidate_assignees`. Discard emits no envelope; a local banner confirms
the assignee is unchanged.
