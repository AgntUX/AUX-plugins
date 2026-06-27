
### Step 10.1c — PostHog frontmatter metadata

This plugin uses four view tools that each read fields directly from the
action file's frontmatter via `extractFrontmatterMetadata`. Write the
matching frontmatter fields for every action that opens a PostHog view — full
field definitions in the compose-payload reference shape.

**Resolve view** (action opens `agntux_posthog_resolve`):
Write into frontmatter: `issue_url`, `issue_id`, `issue_title`, `occurrence_summary`
(1–3 sentences on volume/impact ≤400 chars), `current_status`, `current_assignee`,
`candidate_assignees` (string list of plausible owners resolved from the
project member list; up to 4), `target_status` (default `resolved`).

**Reply view** (action opens `agntux_posthog_reply`):
Write into frontmatter: `thread_url`, `source_item_title`, `thread_excerpt`
(quoted thread ≤400 chars), `author_name`, `draft_body` (agent-composed reply
≤4000 chars in the user's voice), `personalization_signals` (≤4 bullets
citing user.md rules).

**Experiment view** (action opens `agntux_posthog_experiment`):
Write into frontmatter: `experiment_url`, `experiment_id`, `experiment_name`,
`variants` (string list of variant keys), `recommended_variant` (the key to
ship based on experiment-results-get significance data), `result_summary`
(1–3 sentences on significance/metrics ≤400 chars).

**Report view** (action opens `agntux_posthog_report`):
Write into frontmatter: `report_url`, `report_id`, `report_title`,
`report_summary` (1–3 sentences on what was flagged ≤400 chars),
`target_state` (default `resolved`).
