# PostHog fetch — Step 5 orchestration

Wholesale override for `canonical/prompts/ingest/skills/sync/reference/fetch.md`.
PostHog uses a multi-resource fan-out shape: five resource types are fetched
independently (error issues, alerts, experiments, comments, inbox reports), each
advancing its own cursor key. Parent-object resolution (insights, dashboards)
is a secondary lookup performed only to supply display titles; those tools are
never used as primary action sources.

## Step 5 — Fetch from PostHog

Call the tools listed below using the host-resolved names (the host UUID-prefixes
them at runtime; use whatever name the host exposes). All PostHog read tools
require a `context` string parameter: a 15–25 word third-person description of
why the agent is calling the tool (e.g. "The agent is listing active error
tracking issues to identify those that require triage or investigation."). Most
tools also require `project_id`; read this from `user.md → posthog_project_id`
(or the equivalent field the user has configured). If `project_id` is absent
from `user.md`, log `posthog-project-not-found` (kind: `source`) and exit.

All cursors are read from `data/learnings/agntux-posthog/sync.md → cursor`
(a JSON object with per-resource keys) at Step 2. Bootstrap state: all keys
null. At Step 5 time, `cursor` is in scope from Step 2.

Run all five resource fetches sequentially. A failure in one resource type is
logged and that type is skipped; the remaining types continue and advance their
own cursor keys independently.

---

### Step 5a — Error tracking issues

**Primary signal.** Fetch active error issues, prioritising those assigned to
the user and those with rising occurrence counts.

```
query-error-tracking-issues-list({
  project_id: <from user.md>,
  status: "active",
  context: "The agent is listing active error tracking issues to identify those assigned to the user or spiking in occurrence rate."
})
```

Page until all active issues are enumerated or 50 issues have been collected
(whichever comes first). If the tool exposes a `cursor`/`offset` pagination
parameter, use it to advance through pages.

**Incremental filter.** Keep only issues where `last_seen` (ISO-8601 UTC) is
strictly greater than `cursor.errors`. If `cursor.errors` is null (bootstrap),
keep issues where `last_seen` is within `(now − bootstrap_window_days days, now]`.

**Action-worthiness.** An error issue is action-worthy when ANY of these hold:

- `status` is `"active"` AND the issue is assigned to the user
  (`assignee.email` matches `user.md → email`).
- `status` is `"active"` AND occurrence count is rising: `occurrence_count`
  this fetch is materially higher than what was last seen (use a >20% increase
  threshold, or any non-zero count if this is the first time the issue appears
  AND the issue clears the bootstrap floor below).
- `status` is `"active"` AND `last_seen` is within the last 2 hours (hot issue).

**Bootstrap floor (first-encounter only).** When the issue is being seen for
the first time (no prior cursor record AND not assigned to the user AND not
hot within the last 2 hours), it must additionally satisfy
`occurrences >= 10 OR users >= 2 OR last_seen within last 24h`. This applies
universally on the bootstrap pass and on any subsequent run that encounters
a brand-new source_id. Without this floor, a project with a long error
history would raise hundreds of low-impact actions on day 1. Assigned issues
and issues spiking >20% from a prior count bypass the floor — they're real
signal regardless of absolute volume.

**Stale-chunk noise (universal deprioritization, not skip).** Errors of the
shape `library === "web"` AND `description` matches the regex
`/^[A-Za-z_$][\w$]* is not defined$/` AND `source` matches `/webpack(\.js)?$/`
are almost always stale-chunk-after-deploy artifacts in Next.js and other
code-split SPAs — not product regressions. When all three conditions hold,
still raise the action (don't silently drop), but cap priority at p3 and
append "Likely a stale chunk after deploy — verify before triaging" to the
action body's `## Why this matters` section. This keeps real critical errors
from competing with build artifacts in the user's inbox. Bypass this rule
when the issue is assigned to the user or has `users >= 5` (real-user impact
overrides the heuristic).

For each action-worthy issue, fetch detail via:

```
query-error-tracking-issue({
  project_id: <from user.md>,
  issue_id: <issue.id>,
  context: "The agent is fetching full detail for an active error tracking issue to record its stack trace and affected user count."
})
```

**Entity mapping.** Each error issue maps to an entity of subtype `error-issue`.
Source ID: `posthog:{project_id}:error:{issue.id}`.
Display name: the issue's `name` or `exception_type` field (whichever is more
descriptive). Key fields to preserve in entity frontmatter: `status`,
`occurrence_count`, `affected_users`, `last_seen`, `assignee` (if any).
Translate "occurrence_count" → "occurrences", "affected_users" → "users affected"
in plain-language summaries.

**Cursor advance.** Advance `cursor.errors` to `max(last_seen)` across all
error issues fetched-and-evaluated this run, regardless of whether any of
them raised an action. Filter decisions (bootstrap floor, dedup, action-
worthiness, stale-chunk deprioritization) are NOT errors — they evaluate
the issue and the cursor must move past it so the next run doesn't re-
process the same already-evaluated batch. Roll back to the pre-run value
ONLY when a connector read errors (auth, rate-limit, network, validation)
or an action write that *was* attempted errors. Quiet projects (zero
actions raised) advance the cursor normally.

---

### Step 5b — Alerts

**Fetch fired alerts.**

```
alerts-list({
  project_id: <from user.md>,
  context: "The agent is listing fired alerts on insights and metrics to surface those requiring acknowledgement."
})
```

Page until all alerts are enumerated (cap at 30 per run). Keep only alerts where
`fired_at` (ISO-8601 UTC) is strictly greater than `cursor.alerts`
(bootstrap: within `bootstrap_window_days`).

**Action-worthiness.** An alert is action-worthy when:

- It has fired (i.e., it is returned by `alerts-list` with a non-null `fired_at`).
- It has not already been acknowledged in this run's existing action items
  (dedup by source_id at Step 9).

For each action-worthy alert, fetch detail via:

```
alert-get({
  project_id: <from user.md>,
  alert_id: <alert.id>,
  context: "The agent is fetching full detail for a fired alert to record the triggering threshold and the insight it monitors."
})
```

Resolve the parent insight name: if `insight_id` is present, call
`insights-list` once (with a filter on that insight id if the tool supports it,
otherwise use the list and match client-side) to retrieve the insight's title
for the entity display name. This is a title-resolution lookup only — do not
raise a separate action for the insight.

**Entity mapping.** Each fired alert maps to an entity of subtype `alert`.
Source ID: `posthog:{project_id}:alert:{alert.id}`.
Display name: alert `name` or `"{insight_name} alert"` if alert lacks a name.
Key fields: `fired_at`, `threshold`, `current_value`, parent insight name.
Translate "threshold" → "trigger value", "current_value" → "value when fired"
in plain-language summaries.

**Cursor advance.** Advance `cursor.alerts` to `max(fired_at)` across all
alerts fetched-and-evaluated this run, regardless of whether any of them
raised an action. Filter decisions (dedup, acknowledgement state) are NOT
errors. Roll back to the pre-run value ONLY when a connector read errors
(auth, rate-limit, network, validation) or an action write that *was*
attempted errors.

---

### Step 5c — Experiments

**Fetch experiments awaiting a decision.**

```
experiment-list({
  project_id: <from user.md>,
  context: "The agent is listing experiments to identify those that have reached statistical significance or are awaiting a ship or rollback decision."
})
```

Page until all experiments are enumerated (cap at 20 per run). Keep only
experiments where `updated_at` (ISO-8601 UTC) is strictly greater than
`cursor.experiments` (bootstrap: within `bootstrap_window_days`).

**Action-worthiness.** An experiment is action-worthy when ANY of these hold:

- `status` is `"running"` AND significance has been reached (determined in the
  detail fetch below — `significant: true` in the results).
- `status` is `"draft"` AND `updated_at` is recent (within the ingest window)
  AND the experiment has been updated but not yet launched — signals it may
  be awaiting review.
- `status` is `"running"` AND the experiment's end date is within 48 hours.

For each candidate, fetch results:

```
experiment-results-get({
  project_id: <from user.md>,
  experiment_id: <experiment.id>,
  context: "The agent is fetching experiment results to determine if statistical significance has been reached and which variant is leading."
})
```

If `experiment-results-get` returns no data (experiment too new), log
`posthog-experiment-no-results` (kind: `source`) with the experiment id, skip
this experiment, and continue. Do NOT raise an action for an experiment with
no result data.

**Entity mapping.** Each action-worthy experiment maps to an entity of subtype
`experiment`. Source ID: `posthog:{project_id}:experiment:{experiment.id}`.
Display name: experiment `name`. Key fields: `status`, `variants` (control +
test variant names), `significant`, `winning_variant` (if known), `start_date`,
`end_date`. Translate PostHog-internal "feature_flag_key" → "feature flag" in
plain-language summaries.

**Cursor advance.** Advance `cursor.experiments` to `max(updated_at)` across
all experiments fetched-and-evaluated this run, regardless of whether any of
them raised an action. Filter decisions (no-results skip, non-significant
running experiments, dedup) are NOT errors. Roll back to the pre-run value
ONLY when a connector read errors (auth, rate-limit, network, validation)
or an action write that *was* attempted errors.

---

### Step 5d — Comments and mentions

**Fetch recent comments.**

```
comments-list({
  project_id: <from user.md>,
  context: "The agent is listing comments on insights and dashboards to surface those mentioning the user or requiring a response."
})
```

Page until all comments are enumerated (cap at 40 per run). Keep only comments
where `created_at` (ISO-8601 UTC) is strictly greater than `cursor.comments`
(bootstrap: within `bootstrap_window_days`).

**Action-worthiness.** A comment is action-worthy when:

- The comment body mentions the user (contains `@{user.email}` or
  `@{user.display_name}` — resolve display name from `user.md → name`).
- OR the comment has no reply from the user yet AND it was posted on an
  insight or dashboard owned by the user (`created_by.email` on the parent
  object matches `user.md → email`).

For each action-worthy comment, fetch the full thread:

```
comment-thread({
  project_id: <from user.md>,
  comment_id: <comment.id>,
  context: "The agent is fetching the full comment thread to provide context for a mention or reply-needed comment."
})
```

Resolve the parent object name (insight or dashboard): use `insights-list` or
`dashboards-get-all` as a title lookup only — pass the referenced id and extract
the name field. Never raise a separate action for the parent object.

**Entity mapping.** Each action-worthy comment thread maps to an entity of
subtype `comment-thread`. Source ID: `posthog:{project_id}:comment:{comment.id}`
(use the root comment's id even when the thread spans multiple replies).
Display name: `"Comment on {parent_object_name}"`. Key fields: `created_by`,
`created_at`, parent object name, first ~200 characters of the comment body,
whether the user was @-mentioned.

**Cursor advance.** Advance `cursor.comments` to `max(created_at)` across
all comments fetched-and-evaluated this run, regardless of whether any of
them raised an action. Filter decisions (no @-mention, already replied,
dedup) are NOT errors. Roll back to the pre-run value ONLY when a connector
read errors (auth, rate-limit, network, validation) or an action write that
*was* attempted errors.

---

### Step 5e — Inbox reports

**Fetch flagged inbox reports.**

```
inbox-reports-list({
  project_id: <from user.md>,
  context: "The agent is listing inbox reports flagged for review to surface anomalies and data quality issues requiring a decision."
})
```

Page until all reports are enumerated (cap at 20 per run). Keep only reports
where `created_at` (ISO-8601 UTC) is strictly greater than `cursor.inbox`
(bootstrap: within `bootstrap_window_days`).

**Action-worthiness.** An inbox report is action-worthy when:

- It is flagged for review (returned by `inbox-reports-list` implies it is
  actionable, but confirm the report has a non-dismissed status).
- It has not already been resolved or dismissed (check `status` field if
  present; skip reports with `status: "dismissed"` or `status: "resolved"`).

**Entity mapping.** Each action-worthy inbox report maps to an entity of subtype
`inbox-report`. Source ID: `posthog:{project_id}:inbox:{report.id}`.
Display name: report `name` or `title` field. Key fields: `created_at`,
`report_type` (anomaly / data quality / etc.), `flag_reason`, `severity` (if any).
Translate "inbox report" → "flagged report" in plain-language summaries to
avoid PostHog-internal jargon.

**Cursor advance.** Advance `cursor.inbox` to `max(created_at)` across all
inbox reports fetched-and-evaluated this run, regardless of whether any of
them raised an action. Filter decisions (already resolved or dismissed,
dedup) are NOT errors. Roll back to the pre-run value ONLY when a connector
read errors (auth, rate-limit, network, validation) or an action write that
*was* attempted errors.

---

## Cursor shape for PostHog

The cursor is a JSON object stored on the `sync.md → cursor` line. Each key
corresponds to a resource type and holds the most recent timestamp seen for
that type in the last successful run.

```yaml
# data/learnings/agntux-posthog/sync.md — bootstrap state
cursor: null
```

```yaml
# After the first successful run across all resource types
cursor: '{"errors":"2026-06-19T10:00:00Z","alerts":"2026-06-19T09:45:00Z","experiments":"2026-06-18T14:30:00Z","comments":"2026-06-19T10:00:00Z","inbox":"2026-06-19T08:00:00Z"}'
```

Each key advances independently. If `cursor` is null (bootstrap or first run),
treat all keys as null individually. If `cursor` is a valid JSON object but a
specific key is absent, treat that key as null for this run and initialise it
on the next successful write for that resource type.

Parse the cursor JSON at Step 2; write the updated JSON at Step 11. Do NOT
advance any key unless every action write for that resource type succeeded
this run (transactional rule per resource type).

If the cursor JSON is malformed (not parseable), log `posthog-cursor-evicted`
(kind: `source`) and treat all keys as null (fall back to bootstrap window).

---

## Annotations (informational only — no action items)

Fetch recent annotations as supporting context:

```
annotations-list({
  project_id: <from user.md>,
  context: "The agent is listing recent annotations to provide context for error spikes and experiment periods."
})
```

Annotations are informational signals that provide context for interpreting error
spikes or experiment periods. They are NOT primary action sources and do NOT
produce action items or entities on their own. They MAY be referenced in the
body of an error-issue or experiment action item when a contemporaneous
annotation explains the context (e.g., "a deployment annotation at this time
may explain the spike").

---

## Deduplication

Before raising any action item at Step 8–9, look up the candidate source_id
(`posthog:{project_id}:{resource_type}:{resource_id}`) in `_sources.json` and
in `actions/_index.md`. An existing open action with the same source_id is
treated as the same item; update the entity body if the upstream state has
changed (e.g., occurrence count increased, experiment significance changed),
but do NOT raise a new action item. Raise a new action only when:

- The source_id has no open action (first encounter), OR
- The source_id had a previously-closed or dismissed action AND the upstream
  item is now in a new actionable state (e.g., an error issue was resolved then
  regressed to active with a higher occurrence count).

This prevents duplicate actions for the same fired alert or same error issue
across consecutive 60-minute runs.

---

## Entity subtype mapping table

| PostHog resource | Entity subtype | Plain-language label |
|---|---|---|
| Error tracking issue | `error-issue` | "error issue" |
| Fired alert | `alert` | "alert" |
| Experiment (significant or decision-pending) | `experiment` | "experiment" |
| Comment thread with mention or reply-needed | `comment-thread` | "comment thread" |
| Inbox flagged report | `inbox-report` | "flagged report" |

PostHog also uses the term "insight" internally. Insights are referenced as
parent objects for alerts and comments but never produce their own entities
or action items during ingest. Translate "insight" → "chart" or "metric view"
when presenting to the user only when the term appears in a user-visible
summary; in entity frontmatter fields keep the verbatim upstream name.

---

## Suggested actions per entity subtype

### error-issue

```yaml
suggested_actions:
  - label: "Investigate error"
    host_prompt: "Use the agntux-posthog plugin to open the error detail for action {id}"
  - label: "Mark as resolved"
    host_prompt: "Use the agntux-posthog plugin to mark error action {id} as resolved"
  - label: "Open in PostHog"
    url: "https://app.posthog.com/project/{project_id}/error_tracking/{issue_id}"
```

### alert

```yaml
suggested_actions:
  - label: "Acknowledge alert"
    host_prompt: "Use the agntux-posthog plugin to acknowledge the alert for action {id}"
  - label: "Open in PostHog"
    url: "https://app.posthog.com/project/{project_id}/alerts/{alert_id}"
```

### experiment

```yaml
suggested_actions:
  - label: "Review experiment results"
    host_prompt: "Use the agntux-posthog plugin to review experiment results for action {id}"
  - label: "Open in PostHog"
    url: "https://app.posthog.com/project/{project_id}/experiments/{experiment_id}"
```

### comment-thread

```yaml
suggested_actions:
  - label: "Reply to comment"
    host_prompt: "Use the agntux-posthog plugin to open the reply composer for action {id}"
  - label: "Open in PostHog"
    url: "https://app.posthog.com/project/{project_id}/insights/{insight_id}"
```

### inbox-report

```yaml
suggested_actions:
  - label: "Review flagged report"
    host_prompt: "Use the agntux-posthog plugin to review the flagged report for action {id}"
  - label: "Dismiss report"
    host_prompt: "Use the agntux-posthog plugin to dismiss the flagged report for action {id}"
  - label: "Open in PostHog"
    url: "https://app.posthog.com/project/{project_id}/inbox"
```

Note: URL fields in `suggested_actions` use values interpolated at write time
from the entity's `source_id` fields. The `project_id` and resource-specific id
are extracted from `source_id` format `posthog:{project_id}:{resource_type}:{resource_id}`.

---

## Failure modes

| Symptom | kind | Action |
|---|---|---|
| Any read tool auth failure | `auth` | exit all resource types, release lock, retry next run |
| `project_id` missing from `user.md` | `source` + `posthog-project-not-found` | exit, log, release lock |
| Rate limit (HTTP 429) from connector | `source` + `posthog-rate-limited` | skip that resource type this run; continue others |
| `experiment-results-get` returns no data | `source` + `posthog-experiment-no-results` | skip this experiment, continue |
| `context` parameter rejected (too long/short) | `parse` + `posthog-context-too-long` | skip this fetch call, log, continue |
| Any network-level failure | `network` | exit remaining resource types, release lock, retry next run |
| Cursor JSON malformed | `source` + `posthog-cursor-evicted` | fall back to bootstrap window for all keys |
| Resource deleted upstream (id no longer found) | `source` + `posthog-cursor-evicted` | log, evict from cursor map if applicable, continue |
