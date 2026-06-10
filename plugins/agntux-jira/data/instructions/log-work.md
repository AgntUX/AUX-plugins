---
type: plugin-instructions
plugin: agntux-jira
handler: log-work
schema_version: "1.0.0"
updated_at: 2026-06-08T00:00:00Z
authored_by: personalization
status: draft
---

# jira-log-work — handler instructions

Read-only contract for `agntux_jira_log_work_view`. This file is consumed at
render time by the worklog entry iframe. Do NOT write to it; the two write
paths are `personalization` (initial stub) and `user-feedback` (promote to
final).

---

## Action class

`knowledge-update`

Raised when John has worked on a Jira issue but no worklog entry has been
logged — a gap that degrades "what did I work on?" recall and makes sprint
reporting inaccurate.

---

## When this handler is suggested

Generate a `log-work` suggested action when any of:

- An issue assigned to John has been moved to `In Progress` or `In Review`
  status and no worklog entry for John exists for the current sprint (inferred
  from last 2 weeks; no sprint API required).
- An issue assigned to John has been transitioned to `Done` or `Closed` within
  the last 24 hours and has no worklog entries at all.
- John has commented on an issue in the last sync window and the issue has no
  worklog for the current period — participation without logging is a common
  gap.
- The issue has a `duedate` within the next 3 days and no recent worklog for
  John.

Do NOT generate a `log-work` action for issues where John is only a watcher
(not assignee, reporter, or recent commenter). Do NOT generate for issues in
`Backlog` or `To Do` status unless there is an explicit signal of work started.

Frequency cap: raise at most one `log-work` action per issue per ingest run.
If a `log-work` action already exists for an issue with `status: open`, do not
create a second one — update the existing item's body instead.

---

## structuredContent keys consumed by this handler

The `agntux_jira_log_work_view` view tool reads the action file's
`## Log-work payload` body section at click time and lifts the following
fields into `structuredContent`. The iframe renders a worklog form with a
time-spent field, date picker, and optional comment.

| Key | Type | Source |
|---|---|---|
| `issue_url` | string | Deep link to the issue (`{atlassian_site_url}/browse/{issue_key}`) |
| `issue_key` | string | Issue key (e.g. `OFM-412`) |
| `issue_title` | string | `issue.fields.summary` |
| `suggested_time_spent` | string | Pre-computed time estimate in Jira shorthand (e.g. `1h 30m`, `45m`, `2h`) |
| `suggested_started` | string | ISO 8601 UTC datetime suggesting when the work started (e.g. the issue's last transition-to-in-progress timestamp, or the most recent comment timestamp) |
| `draft_comment` | string or null | Optional pre-composed worklog comment, or `null` |
| `personalization_signals` | string[] | Short bullets (≤4, ≤120 chars each) |
| `cloud_id` | string | Atlassian Cloud instance ID |

These key names match the `LogWorkViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`. They match exactly what
`parseLogWorkPayloadYaml()` reads from the `## Log-work payload` YAML block
on disk.

---

## Log-work payload

The ingest skill's Step 10 appends a `## Log-work payload` body section to
every action item that carries a `Log work` suggested action. Shape:

```yaml
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
```

YAML quoting reminder: `suggested_time_spent` contains spaces — wrap it in
double quotes (e.g. `"1h 30m"`). `issue_title` may contain `: ` — wrap it.

**Time format (required).** `suggested_time_spent` MUST use Jira's shorthand
format:

| Value | Meaning |
|---|---|
| `"30m"` | 30 minutes |
| `"1h"` | 1 hour |
| `"1h 30m"` | 1 hour 30 minutes |
| `"2h 15m"` | 2 hours 15 minutes |
| `"1d"` | 1 day (= 8 hours in standard Jira config) |

Do NOT use ISO 8601 duration format (`PT1H30M`) — the Atlassian MCP tool
expects the Jira shorthand string directly.

**Estimating `suggested_time_spent`** at ingest time: use the time elapsed
between the issue's last status-to-in-progress transition and the current
ingest run time as a proxy, capped at 4 hours (`4h`) unless explicit signals
suggest more. If no status transition timestamp is available, default to `1h`.
Round to the nearest 15 minutes. Do not attempt to read calendar or Slack data
to infer work time — that cross-source inference is out of scope for ingest
Step 10.

**Estimating `suggested_started`**: use the timestamp of the issue's most
recent transition to `In Progress`, `In Review`, or `Code Review` status.
When unavailable, use the timestamp of John's most recent comment on the issue.
When neither is available, use `today at 09:00:00` in the user's local timezone
(from `user.md → frontmatter.timezone`, default `America/Denver`).

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
  (Jira shorthand string)
- `started`: user-confirmed or edited value of `suggested_started` (ISO 8601)
- `commentBody` (optional): value of `draft_comment` if non-empty; omitted
  when blank

Envelope shape (no comment):

```
Use the Atlassian Connector to add a worklog entry to a Jira issue.
cloudId: {cloud_id}, issueIdOrKey: {issue_key},
timeSpent: {time_spent}, started: {started}.
(action_id: {action_id})

IMPORTANT: Execute addWorklogToJiraIssue programmatically and return the
result as plain text. Do NOT render Atlassian's own MCP App UI for this
call — the user has already confirmed the worklog in the AgntUX iframe and
the payload is final. Do NOT re-render the AgntUX log-work UI either; the
action is complete.
```

Envelope shape (with comment):

```
Use the Atlassian Connector to add a worklog entry to a Jira issue.
cloudId: {cloud_id}, issueIdOrKey: {issue_key},
timeSpent: {time_spent}, started: {started}.
Worklog comment: «{draft_comment}».
(action_id: {action_id})

IMPORTANT: Execute addWorklogToJiraIssue programmatically and return the
result as plain text. Do NOT render Atlassian's own MCP App UI for this
call — the user has already confirmed the worklog in the AgntUX iframe and
the payload is final. Do NOT re-render the AgntUX log-work UI either; the
action is complete.
```

---

## Post-send mutation (host-side, not view-tool-side)

After `addWorklogToJiraIssue` succeeds, the host calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User logged {time_spent} on {issue_key} starting {started} via Atlassian connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly — that is the host's
responsibility (host-only single-writer rule for non-component-state
frontmatter).

---

## Tone / personalization

This handler's primary payload is structured (time + date), not free text.
Tone rules apply to `draft_comment` only:

- `draft_comment` is optional. Default to `null` — most worklog entries on
  Jira issues need no comment. Populate it only when there is meaningful
  context worth capturing (e.g. "Investigated the auth regression; root cause
  identified — see inline code comment.").
- When populated, keep the comment to one sentence. It should say what was
  accomplished, not what was attempted.
- Do not add meta-commentary ("logging work for sprint accounting purposes").
  If the comment has no substantive content, leave it null.
- Never add a sign-off to worklog comments.

---

## Safety notes

- The `timeSpent` field sent to the connector MUST be in Jira shorthand
  format. If the form allows free-text entry, validate against the pattern
  `^(\d+w\s*)?(\d+d\s*)?(\d+h\s*)?(\d+m)?$` before building the envelope.
  Surface a validation error inline if the input is malformed — do not
  silently send an invalid value.
- The `started` timestamp must be in ISO 8601 UTC. If the date picker returns
  a local-timezone value, convert to UTC before building the envelope.
- Worklogs cannot be posted in the future. If `suggested_started` is in the
  future (clock skew, bad ingest estimate), clamp to `now()` and surface a
  `personalization_signals` note: `"Started time clamped to now — original
  estimate was in the future."`.
- Discard is local — no envelope emitted; banner: `Discarded — no worklog
  posted. The action item is still open.`
- The iframe must clearly display the issue key and title alongside the time
  entry fields so John can verify he is logging to the correct issue.

# Always raise

# Never raise

# Rewrites

# Notes

- Default `suggested_time_spent` to `"1h"` when no better signal is
  available. Err toward underestimation rather than overestimation — John
  can adjust up; it is harder to explain a logged time that looks inflated.
- The `suggested_started` timestamp is a hint, not a mandate. The date picker
  should default to it but leave it fully editable.
- Log-work actions feed AgntUX's `recall` feature ("what did I work on this
  week?"). Even minimal worklogs (`30m`, no comment) improve recall quality
  because they anchor the issue to a time window. Encourage logging even when
  the estimate is rough.
