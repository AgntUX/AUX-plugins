---
type: plugin-instructions
plugin: agntux-jira
handler: assign
schema_version: "1.0.0"
updated_at: 2026-06-08T00:00:00Z
authored_by: personalization
status: draft
---

# jira-assign — handler instructions

Read-only contract for `agntux_jira_assign_view`. This file is consumed at
render time by the assignee picker iframe. Do NOT write to it; the two write
paths are `personalization` (initial stub) and `user-feedback` (promote to
final).

---

## Action class

`needs-routing`

Raised when a Jira issue lacks an assignee or has landed in John's queue but
belongs to someone else — a triage candidate that needs to be routed to the
right person.

---

## When this handler is suggested

Generate an `assign` suggested action when any of:

- An issue is unassigned and is in a project where John is expected to triage
  (typically his own team's projects: OFM, PLAT, ENG, and any project where
  he is the default component owner or lead).
- An issue is assigned to John but the work clearly belongs to another team
  member (e.g. the issue is in a domain he has explicitly routed to a direct
  report before, or the issue type/component maps to a known owner per
  `user.md → # People`).
- A comment on the issue explicitly asks John to re-assign it.
- The current assignee has left the team or is out of office (inferred from
  Jira account status or OOO signals from Slack/Gmail if cross-source data
  is available in the knowledge store).

Do NOT generate an `assign` action for issues where the correct owner is
genuinely ambiguous and no candidate can be suggested — raise a
`needs-decision` action instead, with a `host_prompt` directing John to
pick manually.

---

## structuredContent keys consumed by this handler

The `agntux_jira_assign_view` view tool reads the action file's
`## Assign payload` body section at click time and lifts the following fields
into `structuredContent`. The iframe renders an assignee picker with the
current assignee labelled and candidates as a radio list.

| Key | Type | Source |
|---|---|---|
| `issue_url` | string | Deep link to the issue (`{atlassian_site_url}/browse/{issue_key}`) |
| `issue_key` | string | Issue key (e.g. `OFM-412`) |
| `issue_title` | string | `issue.fields.summary` |
| `current_assignee` | object or null | `{account_id: string, display_name: string}`, or `null` if unassigned |
| `candidate_assignees` | object[] | Each: `{account_id: string, display_name: string}` — ordered by suggestion strength |
| `suggested_assignee_account_id` | string or null | The account_id the ingest agent recommends, or `null` if no strong candidate |
| `personalization_signals` | string[] | Short bullets (≤4, ≤120 chars each) |
| `cloud_id` | string | Atlassian Cloud instance ID |

These key names match the `AssignViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`. They match exactly what
`parseAssignPayloadYaml()` reads from the `## Assign payload` YAML block
on disk.

---

## Assign payload

The ingest skill's Step 10 appends an `## Assign payload` body section to
every action item that carries a `Re-assign issue` or `Assign issue` suggested
action. Candidate assignees are resolved at ingest time via
`lookupJiraAccountId` (Step 5h) and cross-referenced against the user's `#
People` mapping. Shape:

```yaml
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
```

YAML quoting reminder: any string scalar containing `: ` or starting with `{`
MUST be wrapped in double quotes. Account IDs from Jira are opaque strings
(e.g. `"5e7b3c1d2f4e1a0012345678"`); quote them.

When `current_assignee` is null (unassigned issue), write:

```yaml
current_assignee: null
```

Candidate list ordering: place the `suggested_assignee_account_id` first,
then list additional plausible candidates in descending priority. Cap at
6 candidates to keep the picker scannable.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__editJiraIssue`

The envelope is assembled by `buildAssignEnvelope()` in
`view-tool/src/apps/assign/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `fields.assignee.accountId`: the account_id John selected in the picker
  (may differ from `suggested_assignee_account_id` if he overrides)

Envelope shape:

```
Use the Atlassian Connector to update the assignee of a Jira issue.
cloudId: {cloud_id}, issueIdOrKey: {issue_key},
fields.assignee.accountId: {selected_account_id}.
(action_id: {action_id})

IMPORTANT: Execute editJiraIssue programmatically and return the result as
plain text. Do NOT render Atlassian's own MCP App UI for this call — the user
has already selected the assignee in the AgntUX iframe and the payload is
final. Do NOT re-render the AgntUX assign UI either; the action is complete.
```

---

## Post-send mutation (host-side, not view-tool-side)

After `editJiraIssue` succeeds, the host calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User assigned {issue_key} to '{selected_display_name}' via Atlassian connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly — that is the host's
responsibility (host-only single-writer rule for non-component-state
frontmatter).

---

## Tone / personalization

This handler carries no draft body — the payload is a structured assignee
selection with no free text. Personalization applies to candidate ranking only:

- Rank candidates based on John's known routing patterns. Read recent
  `assign` events in the knowledge store (`## Activity` sections on resolved
  action items) to learn which team members John has assigned to which issue
  types / components before.
- For OFM issues: prefer Josue or Jonathan (Eng Leads) for implementation
  issues; prefer Dana or Pao (PMs) for product/requirements issues.
- For PLAT issues: prefer Alonso for architecture or eng-process issues;
  prefer Alex for technical deep-dives.
- For issues where no `user.md → # People` mapping applies, surface the most
  recent commenter (excluding bots) as the first candidate after any
  `suggested_assignee_account_id`.
- Never suggest assigning to John himself when the action trigger was "reassign
  away from John". Exclude his own account from the candidate list in that case.

---

## Safety notes

- Do not write `fields.assignee.accountId` with an accountId that is not
  present in `candidate_assignees`. The list is the authorised set for this
  action item. If John wants to assign to someone outside the list, direct him
  to open the issue in Jira directly (`Open in Jira` deep link).
- An "unassign" (clearing the assignee) is a valid outcome — include a
  "Unassigned" entry in the picker with `account_id: null`. The envelope in
  this case should omit `fields.assignee.accountId` entirely (Jira accepts a
  `null` accountId to unassign, but the envelope should explicitly note this
  to avoid ambiguity: `fields.assignee: null`).
- Discard is local — no envelope emitted; banner: `Discarded — assignee
  unchanged. The action item is still open.`

# Always raise

# Never raise

# Rewrites

# Notes

- Candidate list should include a maximum of 6 entries. If more candidates
  are plausible, include the top 5 plus the "Unassigned" option.
- When `current_assignee` is non-null and the action is a re-assign, the
  current assignee should NOT appear in `candidate_assignees` unless there is
  a reason to offer them as an option (e.g. "re-confirm assignment").
- Account IDs must be looked up at ingest time via `lookupJiraAccountId` —
  do not store raw email addresses in the payload; Jira's `editJiraIssue`
  tool requires an accountId.
