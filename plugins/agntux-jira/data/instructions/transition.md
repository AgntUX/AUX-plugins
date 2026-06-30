---
type: plugin-instructions
plugin: agntux-jira
handler: transition
schema_version: "1.0.0"
updated_at: 2026-06-08T00:00:00Z
authored_by: personalization
status: draft
---

# jira-transition — handler instructions

Read-only contract for `agntux_jira_transition_view`. This file is consumed at
render time by the transition picker iframe. Do NOT write to it; the two write
paths are `personalization` (initial stub) and `user-feedback` (promote to
final).

---

## Action class

`needs-decision`

Raised when a Jira issue requires a status transition that only the user can
authorise — a PR is approved and the issue needs to move to In Review, a
deploy is confirmed and the issue should close, or a blocker is resolved and
the issue should resume In Progress.

---

## When this handler is suggested

Generate a `transition` suggested action when any of:

- An issue assigned to the user has been in the same status for more than the
  expected cycle time for that status (heuristic: 3 business days for In
  Progress, 2 business days for In Review / Code Review, 1 business day for
  Needs Review).
- A comment on the issue explicitly requests a status change ("can you move
  this to Done?", "mark as blocked", "this is ready for review").
- An issue linked via `issuelinks` as "blocks" has been resolved, suggesting
  the blocked issue can now move forward.
- The issue's current status is `Blocked` or `On Hold` and the user is the
  reporter or assignee, and the blocking condition no longer appears to hold
  (inferred from linked issue status or recent comments).

Do NOT generate a `transition` action for issues where the required transition
requires a third party (e.g. QA sign-off, release manager approval) unless
the user is explicitly named as the next-step owner.

---

## structuredContent keys consumed by this handler

The `agntux_jira_transition_view` view tool reads the action file's
`## Transition payload` body section at click time and lifts the following
fields into `structuredContent`. The iframe renders a transition picker with
the current state labelled, available transitions as a radio group, and an
optional comment field.

| Key | Type | Source |
|---|---|---|
| `issue_url` | string | Deep link to the issue (`{atlassian_site_url}/browse/{issue_key}`) |
| `issue_key` | string | Issue key (e.g. `OFM-412`) |
| `issue_title` | string | `issue.fields.summary` |
| `current_state` | string | `issue.fields.status.name` at ingest time |
| `available_transitions` | object[] | Each: `{id: string, name: string}` — from `getTransitionsForJiraIssue` |
| `suggested_transition_id` | string | The transition id the ingest agent recommends |
| `optional_comment` | string or null | Pre-composed comment to accompany the transition, or `null` |
| `personalization_signals` | string[] | Short bullets (≤4, ≤120 chars each) |
| `cloud_id` | string | Atlassian Cloud instance ID |

These key names match the `TransitionViewStructuredContent` interface in
`view-tool/src/agntux-jira-view.ts`. They match exactly what
`parseTransitionPayloadYaml()` reads from the `## Transition payload` YAML
block on disk.

---

## Transition payload

The ingest skill's Step 10 appends a `## Transition payload` body section to
every action item that carries a `Transition issue` suggested action. The
available transitions are fetched at ingest time via Step 5g
(`getTransitionsForJiraIssue`). Shape:

```yaml
cloud_id: "<atlassian cloud id>"
issue_key: "<PROJECT-NNN>"
issue_url: "https://<site>.atlassian.net/browse/<PROJECT-NNN>"
issue_title: "<summary>"
current_state: "<status name>"
available_transitions:
  - id: "<transition id>"
    name: "<transition name>"
  - id: "<transition id>"
    name: "<transition name>"
suggested_transition_id: "<id of recommended transition>"
optional_comment: null
personalization_signals:
  - "<≤120 chars; reason for the suggested transition>"
generated_at: "<RFC 3339 of this run>"
```

The `optional_comment` field is null by default. The ingest agent may populate
it with a brief rationale when the transition requires context (e.g. "Resolving
— PR #42 was merged and deployed to staging."). The user can edit or clear it in
the iframe.

YAML quoting reminder: any string scalar containing `: ` MUST be wrapped in
double quotes. Transition IDs from Jira are typically short numeric strings
(e.g. `"31"`); quote them to prevent YAML integer coercion.

---

## Send envelope target

Connector: Atlassian Connector
Tool: `mcp__claude_ai_Atlassian__transitionJiraIssue`

The envelope is assembled by `buildTransitionEnvelope()` in
`view-tool/src/apps/transition/lib/build-envelope.ts`.

Args derived from the form at Send time:

- `cloudId`: from `structuredContent.cloud_id`
- `issueIdOrKey`: from `structuredContent.issue_key`
- `transition.id`: the transition id selected by the user in the picker (may
  differ from `suggested_transition_id` if they override)
- `update.comment` (optional): the value of `optional_comment` if non-empty;
  omitted from the envelope when blank

Envelope shape (no comment):

```
Use the Atlassian Connector to transition a Jira issue.
cloudId: {cloud_id}, issueIdOrKey: {issue_key}, transitionId: {transition_id}.
(action_id: {action_id})

IMPORTANT: Execute transitionJiraIssue programmatically and return the result
as plain text. Do NOT render Atlassian's own MCP App UI for this call — the
user has already selected the transition in the AgntUX iframe and the payload
is final. Do NOT re-render the AgntUX transition UI either; the action is
complete.
```

Envelope shape (with comment):

```
Use the Atlassian Connector to transition a Jira issue and add a comment.
cloudId: {cloud_id}, issueIdOrKey: {issue_key}, transitionId: {transition_id}.
Include comment: «{optional_comment}».
(action_id: {action_id})

IMPORTANT: Execute transitionJiraIssue programmatically and return the result
as plain text. Do NOT render Atlassian's own MCP App UI for this call — the
user has already selected the transition in the AgntUX iframe and the payload
is final. Do NOT re-render the AgntUX transition UI either; the action is
complete.
```

---

## Post-send mutation (host-side, not view-tool-side)

After `transitionJiraIssue` succeeds, the host calls:

```
mcp__agntux-core__agntux_core_set_status(
  action_id,
  status = "done",
  outcome = "completed-externally",
  outcome_note = "User transitioned {issue_key} to '{transition_name}' via Atlassian connector on <ISO date>."
)
```

The view tool does NOT call `set_status` directly — that is the host's
responsibility (host-only single-writer rule for non-component-state
frontmatter).

---

## Tone / personalization

This handler has no drafted body — the payload is a structured transition
selection, not free text. Tone rules apply only to `optional_comment`:

- If `optional_comment` is populated at ingest time, keep it brief (one
  sentence). It should document the rationale for the transition, not
  reassert facts already visible in the issue history.
- Do not add filler ("As per our discussion", "Hope that helps"). State the
  fact directly.
- If the trigger was a linked issue resolving a blocker, the comment should
  name the linked issue: "Unblocked — OFM-411 resolved."
- Never populate `optional_comment` with a question. If the transition is
  ambiguous, the `suggested_transition_id` should reflect the lower-commitment
  state (e.g. prefer "In Progress" over "Done" when completion is uncertain).

---

## Safety notes

- The transition picker must show ALL transitions returned in
  `available_transitions`. Do not filter or hide transitions the ingest agent
  did not suggest — the user may know context the agent does not.
- The `suggested_transition_id` is a pre-selection hint, not a lock. The form
  must allow the user to select any available transition.
- If `available_transitions` is empty (ingest-time fetch failed or the issue
  is in a terminal state with no outgoing transitions), surface a structured
  error and direct the user to open the issue in Jira directly.
- Discard is local — no envelope emitted; banner: `Discarded — issue status
  unchanged. The action item is still open.`
- Do not allow transitioning to a state that requires a mandatory field
  (screen transition) without surfacing a warning. If `getTransitionsForJiraIssue`
  indicates a screen is required for a transition, mark that transition with a
  warning label in the picker and, when selected, direct the user to complete it in
  Jira directly (`Open in Jira` deep link).

# Always raise

# Never raise

# Rewrites

# Notes

- Suggest the transition that requires the least ambiguity when the context
  supports multiple plausible next states. Prefer moving forward over backward
  (In Progress > Reopened unless there is a strong signal the issue regressed).
- For issues in terminal states (`Done`, `Closed`, `Won't Fix`, `Duplicate`),
  do not suggest a `transition` action — raise a `knowledge-update` instead if
  there is a noteworthy comment on the closed issue.
