# Log-work payload schema — Step 10 reference (agntux-jira)

Companion to `reference/sync.md` Step 10. Describes the `## Log-work payload`
body section the ingest skill writes to every action item that carries a
`Log work` suggested action. The `agntux_jira_log_work_view` view tool reads
this section at click time via `parseLogWorkPayloadYaml()`.

Source: `data/instructions/log-work.md` — `## Log-work payload`.

---

## Conditional body section: `## Log-work payload`

REQUIRED for every action item whose `suggested_actions` list contains a
`Log work` entry (handler: `log-work`). The iframe renders a worklog form
with a time-spent field, a date picker, and an optional comment.

Frequency cap: at most one `log-work` action per issue per ingest run. If an
open `log-work` action already exists for the issue, update the existing
item's body rather than creating a second one.

### structuredContent keys

| Key | Type | Source |
|---|---|---|
| `cloud_id` | string | Atlassian Cloud instance ID — from `data/learnings/agntux-jira/sync.md → cursor.cloudIds[0]` |
| `issue_key` | string | Issue key (e.g. `OFM-412`) — `issue.key` |
| `issue_url` | string | `{atlassian_site_url}/browse/{issue_key}` |
| `issue_title` | string | `issue.fields.summary` |
| `suggested_time_spent` | string | Pre-computed time estimate in Jira shorthand (e.g. `"1h 30m"`, `"45m"`, `"2h"`) |
| `suggested_started` | string | ISO 8601 UTC datetime for when the work started |
| `draft_comment` | string or null | Optional pre-composed one-sentence worklog comment, or `null` |
| `personalization_signals` | string[] | ≤4 bullets, ≤120 chars each |
| `generated_at` | string | RFC 3339 timestamp of this ingest run |

These names match the `LogWorkViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`.

### On-disk shape

```markdown
## Log-work payload

​```yaml
cloud_id: "<atlassian cloud id>"
issue_key: "<PROJECT-NNN>"
issue_url: "https://<site>.atlassian.net/browse/<PROJECT-NNN>"
issue_title: "<summary>"
suggested_time_spent: "<Jira shorthand, e.g. '1h 30m'>"
suggested_started: "<ISO 8601 UTC, e.g. '2026-06-08T09:00:00Z'>"
draft_comment: null
personalization_signals:
  - "<≤120 chars; basis for the time estimate>"
generated_at: "<RFC 3339 of this run>"
​```
```

YAML quoting reminder: `suggested_time_spent` contains spaces — wrap it in
double quotes (e.g. `"1h 30m"`). `issue_title` may contain `: ` — wrap it.

**Time format (required).** `suggested_time_spent` MUST use Jira shorthand:

| Value | Meaning |
|---|---|
| `"30m"` | 30 minutes |
| `"1h"` | 1 hour |
| `"1h 30m"` | 1 hour 30 minutes |
| `"1d"` | 1 day (= 8 hours in standard Jira config) |

Do NOT use ISO 8601 duration format (`PT1H30M`) — the Atlassian MCP tool
`addWorklogToJiraIssue` expects the Jira shorthand string directly.

**Estimating `suggested_time_spent`:** use time elapsed between the issue's
last status-to-in-progress transition and the current ingest run, capped at
`"4h"`. When no transition timestamp is available, default to `"1h"`. Round
to the nearest 15 minutes.

**Estimating `suggested_started`:** use the timestamp of the issue's most
recent transition to `In Progress`, `In Review`, or `Code Review`. When
unavailable, use the timestamp of the user's most recent comment on the issue.
When neither is available, use today at `09:00:00` in the user's local
timezone (from `user.md → frontmatter.timezone`, default `America/Denver`),
converted to UTC.

If `suggested_started` resolves to a future timestamp, clamp to `now()` and
note the clamp in a `personalization_signals` bullet.

`draft_comment` defaults to `null`. Populate with one sentence only when there
is substantive context worth capturing. Never add meta-commentary or sign-offs.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__addWorklogToJiraIssue`

The envelope is assembled by `buildLogWorkEnvelope()` in
`view-tool/src/apps/log-work/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `timeSpent`: user-confirmed or edited value of `suggested_time_spent`
  (Jira shorthand string — validated against `^(\d+w\s*)?(\d+d\s*)?(\d+h\s*)?(\d+m)?$`
  before envelope build; surface a validation error inline if malformed)
- `started`: user-confirmed or edited value of `suggested_started` (ISO 8601
  with offset — convert local-timezone picker values to UTC before build)
- `commentBody` (optional): value of `draft_comment` if non-empty; omitted
  from the envelope entirely when blank

Worklogs cannot be posted in the future. The `started` timestamp must be ≤
`now()` at Send time. Discard emits no envelope; a local banner confirms no
worklog was posted.
