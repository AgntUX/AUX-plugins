
### Step 10.1c — Action-specific payload sections (jira)

Jira ships five action-modifying view tools, each reading a dedicated payload
section beyond `## Compose payload`. Write the section whenever the action ships
the matching suggested action, or the view renders "… data is unavailable":

- **Conditional body section: `## Comment payload`** — REQUIRED when the action
  ships a comment / "Draft a comment" suggested action; the comment view reads
  it. Schema and YAML quoting rules are defined by the comment-payload reference
  shape.
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
