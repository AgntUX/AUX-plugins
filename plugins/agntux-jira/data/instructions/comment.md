---
type: plugin-instructions
plugin: agntux-jira
handler: comment
schema_version: "1.0.0"
updated_at: 2026-06-08T00:00:00Z
authored_by: personalization
status: draft
---

# jira-comment — handler instructions

Read-only contract for `agntux_jira_comment_view`. This file is consumed at
render time by the comment compose iframe. Do NOT write to it; the two write
paths are `personalization` (initial stub) and `user-feedback` (promote to
final).

---

## Action class

`response-needed`

Raised when an issue requires a reply from the user — a new comment @-mentioning
them, a request for review, or a blocking question that has arrived unaddressed
on an issue they own or are watching.

---

## When this handler is suggested

Generate a `comment` suggested action when any of:

- A new comment on a Jira issue @-mentions the user's Atlassian account.
- A comment asks a question directed at the assignee and the user is the assignee.
- A comment marks the issue as Blocked or Needs Review and the user is the
  reporter or a watcher.
- An always-flag person (from `user.md → # People`) comments on any issue
  the user is watching.

Do NOT generate this action for bot-authored comments (`accountType: "app"`,
Automation for Jira, atlassian-addons-admin) — those are status transitions
logged as automated noise, not reply triggers.

---

## structuredContent keys consumed by this handler

The `agntux_jira_comment_view` view tool reads the action file's
`## Comment payload` body section at click time and lifts the following fields
into `structuredContent`. The iframe renders a comment compose form with the
issue context above and an editable body below.

| Key | Type | Source |
|---|---|---|
| `issue_url` | string | Deep link to the issue in Jira Cloud (`{atlassian_site_url}/browse/{issue_key}`) |
| `issue_key` | string | Issue key exactly as returned by the connector (e.g. `OFM-412`) |
| `issue_title` | string | `issue.fields.summary` |
| `issue_status` | string | `issue.fields.status.name` |
| `issue_assignee` | string or null | `issue.fields.assignee.displayName`, or `null` |
| `issue_priority` | string or null | `issue.fields.priority.name`, or `null` |
| `draft_body` | string | Pre-composed comment body (from `## Comment payload` YAML block) |
| `personalization_signals` | string[] | Short bullets describing applied preferences (≤4, ≤120 chars each) |
| `cloud_id` | string | Atlassian Cloud instance ID (from `data/learnings/agntux-jira/sync.md → cursor.cloudIds[0]`) |

These key names match the `CommentViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`. They match exactly what
`parseCommentPayloadYaml()` reads from the `## Comment payload` YAML block
on disk.

---

## Comment payload

The ingest skill's Step 10 appends a `## Comment payload` body section to
every action item that carries a `Draft a comment` suggested action. Shape:

```yaml
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
```

YAML quoting reminder: any string scalar containing `: ` (colon-space) MUST
be wrapped in double quotes.

The draft body is composed at ingest time using the issue's description,
comment thread, and the user's drafting-voice preferences below. The iframe
loads the on-disk draft; the user edits it and clicks Send to commit.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__addCommentToJiraIssue`

The envelope is assembled by `buildCommentEnvelope()` in
`view-tool/src/apps/comment/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `commentBody`: user-edited value of `draft_body` (guillemet-delimited in
  the envelope; the host strips the delimiters before posting)

Envelope shape:

```
Use the Atlassian Connector to add a comment to a Jira issue.
cloudId: {cloud_id}, issueIdOrKey: {issue_key}.
Body: «{edited_body}». (action_id: {action_id})

IMPORTANT: Execute addCommentToJiraIssue programmatically and return the
result as plain text. Do NOT render Atlassian's own MCP App UI for this
call — the user has already composed the comment in the AgntUX iframe and
the payload is final. Do NOT re-render the AgntUX compose UI either; the
action is complete.
```

---

## Post-send mutation (host-side, not view-tool-side)

After `addCommentToJiraIssue` succeeds, the host calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User commented on {issue_key} via Atlassian connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly — that is the host's
responsibility (host-only single-writer rule for non-component-state
frontmatter).

---

## Tone / personalization

- **Voice**: match the user's existing Jira comment style. Before composing, the
  ingest pass re-reads recent comments the user has authored on issues in the same
  project (available in the deep-fetch pass) and mirrors their register, sentence
  length, and capitalization conventions.
- **Internal issues** (OatFi projects): terse, direct, sentence-case. Mirrors
  their Slack voice. Keep it short — Jira comments are not essays.
- **Shared/external-facing issues** (partner or vendor projects): slightly more
  polished but still direct. Full sentences; minimal pleasantry.
- **Sign-off**: none by default for Jira comments. The user does not sign Jira
  comments. Do not append "Thanks, <name>" or any other sign-off unless the
  thread context shows they historically do so for this project.
- Do not add filler phrases ("As discussed", "Per our conversation", "Hope this
  helps"). Get to the point.
- Never insert emoji unless the original thread uses them and the in-instructions
  tone rule for this project is "match thread conventions".
- The compose iframe's **Send** button is the explicit authorization.
  `addCommentToJiraIssue` is NEVER called without a committed envelope from the
  iframe; do not bypass.

---

## Safety notes

- Verify `cloud_id` and `issue_key` match the action item's `source_ref` before
  building the envelope. A mismatch between the on-disk payload and the resolved
  cloud instance must surface as a `compose_payload_missing` structured error,
  not a silent mis-post.
- Do not post empty bodies. If `draft_body` is blank after editing, the Send
  button must remain disabled.
- Discard is local — clicking Discard sets a local banner (`Discarded — no
  comment was posted. The action item is still open.`) and emits no envelope.

# Always raise

# Never raise

# Rewrites

# Notes

- Default comment length: 2–4 sentences unless the issue context calls for more.
- If the trigger was a blocking question, the draft should answer the question
  directly in the first sentence.
- If the trigger was an @-mention requesting a review, the draft should open
  with the review verdict ("LGTM", "Left a few notes", "Needs changes on X")
  before any supporting detail.
