# Comment payload schema — Step 10 reference (agntux-jira)

Companion to `reference/sync.md` Step 10. Describes the `## Comment payload`
body section the ingest skill writes to every action item that carries a
`Draft a comment` suggested action. The `agntux_jira_comment_view` view tool
reads this section at click time via `parseCommentPayloadYaml()`.

Source: `data/instructions/comment.md` — `## Comment payload`.

---

## Conditional body section: `## Comment payload`

REQUIRED for every action item whose `suggested_actions` list contains a
`Draft a comment` entry (handler: `comment`). The block is a fenced ```yaml
inside an H2 body section.

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `cloud_id` | string | Atlassian Cloud instance ID — from `data/learnings/agntux-jira/sync.md → cursor.cloudIds[0]` |
| `issue_key` | string | Issue key exactly as returned by the connector (e.g. `OFM-412`) — `issue.key` |
| `issue_url` | string | `{atlassian_site_url}/browse/{issue_key}` |
| `issue_title` | string | `issue.fields.summary` |
| `issue_status` | string | `issue.fields.status.name` |
| `issue_assignee` | string or null | `issue.fields.assignee.displayName`, or `null` |
| `issue_priority` | string or null | `issue.fields.priority.name`, or `null` |
| `draft_body` | string | Pre-composed comment body (≤2000 chars) |
| `personalization_signals` | string[] | ≤4 bullets, ≤120 chars each |
| `generated_at` | string | RFC 3339 timestamp of this ingest run |

These names match the `CommentViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`.

### On-disk shape

```markdown
## Comment payload

​```yaml
cloud_id: "<atlassian cloud id>"
issue_key: "<PROJECT-NNN>"
issue_url: "https://<site>.atlassian.net/browse/<PROJECT-NNN>"
issue_title: "<summary>"
issue_status: "<status name>"
issue_assignee: "<display name or null>"
issue_priority: "<priority name or null>"
draft_body: |
  <agent-composed comment, ≤2000 chars, informed by issue context and thread>
personalization_signals:
  - "<≤120 chars; cite which user.md / instructions rule motivated this>"
generated_at: "<RFC 3339 of this run>"
​```
```

YAML quoting reminder: any string scalar containing `: ` (colon-space) MUST
be wrapped in double quotes. `issue_title` and `draft_body` are common sources
of bare colons; wrap both.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__addCommentToJiraIssue`

The envelope is assembled by `buildCommentEnvelope()` in
`view-tool/src/apps/comment/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `commentBody`: user-edited value of `draft_body` (guillemet-delimited in the
  envelope; the host strips the delimiters before posting)

The Send button must remain disabled when `draft_body` is blank after editing.
Discard emits no envelope; a local banner confirms no comment was posted.
