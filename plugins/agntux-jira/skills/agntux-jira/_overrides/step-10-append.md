
### Step 10.1c — Action-specific payload sections (jira)

Jira ships five action-modifying view tools, each reading a dedicated payload
section beyond `## Compose payload`. Write the section whenever the action ships
the matching suggested action, or the view renders "… data is unavailable":

- **Conditional body section: `## Comment payload`** — REQUIRED when the action
  ships a comment / "Draft a comment" suggested action; the comment view reads
  it. Schema and YAML quoting rules are defined by the comment-payload reference
  shape.

  > **Cross-source merge note.** When Step 9 ("Draft a jira reply") merges a
  > Jira comment onto a **sibling plugin's** action file, it writes
  > `## Compose payload (jira)` (the namespaced variant) instead of
  > `## Comment payload`. Fill that section with the **`## Comment payload`
  > schema** (`draft_body`, `cloud_id`, `issue_key`, `issue_url`,
  > `issue_title`, `issue_status`, `issue_assignee`, `issue_priority`,
  > `personalization_signals`, `generated_at`) — the comment view reads
  > `## Compose payload (jira)` as a fallback and extracts exactly those
  > fields. Do **not** use the generic compose schema (`drafted_body`,
  > `thread_context`) here — the comment view does not read `drafted_body`
  > and will render blank if the wrong schema is written.
- **Conditional body section: `## Transition payload`** — REQUIRED when the
  action ships a status-transition suggested action; the transition view reads
  it. Schema and YAML quoting rules are defined by the transition-payload
  reference shape.
- **Conditional body section: `## Assign payload`** — REQUIRED when the action
  ships an assign / reassign suggested action; the assign view reads it. Schema
  and YAML quoting rules are defined by the assign-payload reference shape.
- **Conditional body section: `## Edit payload`** — REQUIRED when the action
  ships an edit-fields suggested action; the edit view reads it. Schema and YAML
  quoting rules are defined by the edit-payload reference shape.
- **Conditional body section: `## Log-work payload`** — REQUIRED when the action
  ships a log-work suggested action; the log-work view reads it. Schema and YAML
  quoting rules are defined by the log-work-payload reference shape.
