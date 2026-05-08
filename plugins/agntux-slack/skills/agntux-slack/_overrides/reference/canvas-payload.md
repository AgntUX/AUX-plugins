# Slack canvas payload schema

Companion to `../SKILL.md` Step 10. The `## Canvas payload` body
section is OPTIONAL — only emitted for thread-summary-worthy items
that also include the `Summarise to canvas` suggested action.

The canvas iframe loads this section at click time via
`mcp__agntux-slack__agntux_slack_canvas_view`.

## ## Canvas payload — required when shipping the Summarise button

```markdown
## Canvas payload

​```yaml
drafted_canvas:
  title: <≤80 chars>
  tldr: <≤500 chars>
  decisions:
    - <≤200 chars; up to 8>
  open_questions:
    - <≤200 chars; up to 8>
  participants: [<≤12 real names>]
channel:
  id: <Cxxxxx>
  name: <slug>
thread:
  parent_ts: <ts>
  total_replies: <int>
  participants: [<≤12>]
proposed_followup_message: <≤200 chars>
generated_at: <RFC 3339 of this run>
​```
```

The same `## Compose payload` quoting rules apply: free-form scalars
that may contain `: `, a leading `-`, or `{` / `[` MUST be
double-quoted. The view tool falls back to a `canvas_payload_missing`
error envelope on normalisation failure.
