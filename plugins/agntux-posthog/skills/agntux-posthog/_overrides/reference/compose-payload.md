# {{source-display-name}} frontmatter metadata — Step 10 reference

Wholesale override for the canonical `compose-payload.md`.

Documents the frontmatter metadata fields written into every
{{source-display-name}} action file at Step 10. All four view tools call
`extractFrontmatterMetadata(actionFile)` at click time — returning the raw
parsed YAML object from the action file's `---` frontmatter block — to
pre-fill each iframe without re-fetching {{source-display-name}} data.

**No `## Compose payload` body section is used.** All fields live in the
action file's top-level frontmatter YAML block.

---

## YAML quoting reminder

Any string scalar containing `: ` (colon-space), a leading `-`, or starting
with `{` / `[` MUST be wrapped in double quotes — otherwise the YAML parser
interprets it as a key/value pair, list item, or flow collection and the
field is silently dropped, leaving the iframe blank.
Example: `issue_title: "TypeError: Cannot read properties of undefined"` not
`issue_title: TypeError: Cannot read properties of undefined`.

---

## Resolve view (`agntux_posthog_resolve`)

For actions whose `suggested_actions` opens the resolve/reassign view (action
class `posthog:error:resolve` or similar). Write these fields into the action
file's frontmatter block at Step 10:

```yaml
issue_url: "{full https://app.posthog.com/... URL of the error issue}"
issue_id: "{PostHog error issue id as returned by the issues list tool}"
issue_title: "{human-readable title / error message of the issue}"
occurrence_summary: |
  {1–3 sentences summarising recent occurrence volume, affected users, and
   first/last seen timestamps; grounded in the issues-list response data;
   ≤400 chars}
current_status: "{current PostHog issue status: active | resolved | suppressed}"
current_assignee: "{display name or email of the current assignee; empty string if unassigned}"
candidate_assignees:
  - "{team member name or email who is a plausible owner — resolved from the project member list}"
  - "{add up to 4 total; omit if no candidates can be resolved}"
target_status: "{suggested resolution status: resolved | suppressed — default resolved}"
```

### Field rules — resolve view

**`issue_url`**: Full URL to the PostHog error issue. Shown as a deep-link in
the iframe header.

**`issue_id`**: PostHog's native issue identifier. Passed verbatim to the
connector's resolve/update call.

**`issue_title`**: Short error message or title. Shown prominently in the
iframe so the user can confirm they are acting on the right issue.

**`occurrence_summary`**: Concise summary of recency and impact — occurrence
count, affected user count, and first/last seen. Grounded in the issues-list
response; do not extrapolate beyond what the connector returned.

**`current_status`**: Current state of the issue in PostHog (e.g., `active`,
`resolved`, `suppressed`). The iframe shows this as the before-state.

**`current_assignee`**: Current assignee display name or email. Empty string
if unassigned. Shown in the assignee field as the current value.

**`candidate_assignees`**: String list of plausible assignees resolved from
the project's member list or recent issue activity. The iframe populates the
assignee picker from this list. Up to 4 entries; omit the field or write `[]`
if no candidates can be resolved.

**`target_status`**: Suggested new status — the value the agent recommends
setting. Defaults to `resolved`. The iframe pre-selects this in the status
picker.

---

## Reply view (`agntux_posthog_reply`)

For actions whose `suggested_actions` opens the comment-reply view (action
class `posthog:comment:reply` or similar). Write these fields into the action
file's frontmatter block at Step 10:

```yaml
thread_url: "{full https://app.posthog.com/... URL of the comment thread}"
source_item_title: "{title of the item (error issue, insight, dashboard) the thread belongs to}"
thread_excerpt: |
  {quoted excerpt from the comment thread — include the triggering comment
   and up to 2 most-recent replies, each attributed to the author name;
   ≤400 chars; truncate with '…' if longer}
author_name: "{display name of the comment author the user is replying to}"
draft_body: |
  {agent-composed reply in the user's voice, ≤4000 chars; grounded in the
   thread context and the user's personalization signals from user.md}
personalization_signals: |
  {≤4 bullet lines, ≤120 chars each; cite the user.md / instructions rule
   that shaped tone or content — e.g. "Tone: direct — per user.md §2"}
```

### Field rules — reply view

**`thread_url`**: Full URL to the PostHog comment thread. Shown as a
deep-link in the iframe header.

**`source_item_title`**: Title of the parent item (error issue, insight,
etc.) the thread belongs to. Shown in the iframe header as context.

**`thread_excerpt`**: Quoted content of the thread — the triggering comment
plus up to 2 replies, each prefixed with the author's name. Truncate at 400
chars with `…`.

**`author_name`**: Display name of the person the user is replying to. The
iframe shows this in the "Replying to" label.

**`draft_body`**: Agent-composed reply text. Write in first person as the
user; ground it in the actual thread content. The iframe pre-seeds the
editable reply field.

**`personalization_signals`**: Tone/style reminders. Up to 4 bullets; cite
the rule from user.md that motivated each one.

---

## Experiment view (`agntux_posthog_experiment`)

For actions whose `suggested_actions` opens the ship-experiment view (action
class `posthog:experiment:ship` or similar). Write these fields into the
action file's frontmatter block at Step 10:

```yaml
experiment_url: "{full https://app.posthog.com/... URL of the experiment}"
experiment_id: "{PostHog experiment id as returned by experiment-list}"
experiment_name: "{human-readable name of the experiment}"
variants:
  - "{variant key name — e.g. control}"
  - "{variant key name — e.g. test}"
recommended_variant: "{variant key the agent recommends shipping based on experiment-results-get data}"
result_summary: |
  {1–3 sentences summarising experiment significance, winning metric, sample
   sizes, and confidence level; grounded in experiment-results-get response;
   ≤400 chars}
```

### Field rules — experiment view

**`experiment_url`**: Full URL to the PostHog experiment. Shown as a
deep-link in the iframe header.

**`experiment_id`**: PostHog's native experiment identifier. Passed to the
connector's ship call.

**`experiment_name`**: Human-readable name of the experiment. Shown
prominently in the iframe.

**`variants`**: String list of variant key names from the experiment (e.g.,
`["control", "test"]`). The iframe populates the variant picker from this
list.

**`recommended_variant`**: The variant key the agent recommends shipping.
Based on `experiment-results-get` significance data. The iframe pre-selects
this in the picker.

**`result_summary`**: Concise summary of the experiment outcome — winning
variant, primary metric lift, sample sizes, and confidence. Grounded in the
connector response; do not extrapolate beyond what was returned.

---

## Report view (`agntux_posthog_report`)

For actions whose `suggested_actions` opens the mark-handled view (action
class `posthog:inbox:handle` or similar). Write these fields into the action
file's frontmatter block at Step 10:

```yaml
report_url: "{full https://app.posthog.com/... URL of the inbox report}"
report_id: "{PostHog inbox report id as returned by inbox-reports-list}"
report_title: "{human-readable title of the flagged inbox report}"
report_summary: |
  {1–3 sentences describing what the report flagged and why it requires
   attention; grounded in inbox-reports-list response data; ≤400 chars}
target_state: "{suggested resolution state: resolved | archived — default resolved}"
```

### Field rules — report view

**`report_url`**: Full URL to the PostHog inbox report. Shown as a deep-link
in the iframe header.

**`report_id`**: PostHog's native report identifier. Passed to the
connector's mark-handled call.

**`report_title`**: Human-readable title. Shown prominently in the iframe.

**`report_summary`**: Concise description of what the report flagged and
why it warrants action. Grounded in the inbox-reports-list response.

**`target_state`**: Suggested new state — `resolved` or `archived`. Defaults
to `resolved`. The iframe pre-selects this in the state picker.

---

## Cross-source-merged actions

When Step 9 finds a sibling open action to merge into, the frontmatter fields
above are written under the same keys — no namespace change is needed for
frontmatter-delivered payloads. Merge dedup writes only the fields for the
view the merged action opens.
