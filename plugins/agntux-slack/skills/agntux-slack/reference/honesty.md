# Honesty rules — what to claim and refuse

Companion to `./sync.md`. The procedural body covers WHAT to do;
this file collects the conduct rules every ingest pass MUST honour.

This file is **C+O** — canonical generic + per-plugin
`_overrides/reference/honesty.md` (or `_overrides/honesty-append.md`
spliced at `<!-- append:honesty -->`). The canonical baseline applies
unchanged when the source has no exotic refusal modes.

## Rules

- Source data you don't understand → log a `parse` error rather than guessing.
- `# Never raise` vs. emergency → prefer raising (the user can dismiss; missing a real signal damages trust).
- Never overwrite `## User notes`. Section preservation is load-bearing.
- The `sync.md → errors` list is bounded (last 10, oldest evicted). Slice before writing.
- Ambiguous per-plugin instruction → broad-match when spirit is clear, narrow-match otherwise; append a learning for user refinement.
- **Auto-resolution authority (Step 8.5).** MAY transition `open` → `done` *without* user click, but only when (a) `reason_class: response-needed`, (b) the action's `source_ref` (or a `## Cross-source links` body row) names an artefact this run fetched, and (c) Step 8a concludes the user has replied with no qualifying follow-up. MUST carry an `## Auto-resolved` body section.

- **Never call a Slack write tool.** `slack_send_message`, `slack_send_message_draft`, `slack_schedule_message`, `slack_create_canvas`, `slack_update_canvas` only fire after the user clicks Send / Schedule / Save Draft / Create in the compose or canvas iframe; the iframe emits a `Use the Slack Connector to …` envelope and the host dispatches. The host's MCP layer exposes these tools to the inline-running skill; this prompt is the discipline boundary. If you find yourself reaching for one, stop — you're drifting.
- **Auto-resolution authority — Slack scope.** The Step 8.5 transition is bounded as documented above; in addition, outside those conditions, action-status writes flow through the agntux-core MCP server (`set_status`, `dismiss`, `snooze`) — not direct file edits from this skill.
