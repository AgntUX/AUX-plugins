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
- **Auto-resolution authority (Step 8.5).** MAY transition `open` → `done` *without* user click — and MAY refresh an open action's content in place — when the freshly-fetched data (or a bounded read-only re-check of the artefact by `source_ref`) shows the action is handled: a **positive terminal state** from the source (closed / done / cancelled / declined / deleted / archived, per the plugin's declared signals) or, for `response-needed`, the user has replied with no qualifying follow-up (Step 8a). Applies to **all** `reason_class` values, not only `response-needed`. Be conservative: an ambiguous signal, or a re-check that **errored** (auth / permission / network / rate-limit), → leave the item open, never guess `done`. For cross-source-merged actions, **only** the user-reply signal may auto-close (a terminal state in your source does not resolve a need owned by another source). Every auto-close MUST carry an `## Auto-resolved` body section naming the signal.

- **Never call a Slack write tool.** `slack_send_message`, `slack_send_message_draft`, `slack_schedule_message`, `slack_create_canvas`, `slack_update_canvas` only fire after the user clicks Send / Schedule / Save Draft / Create in the compose or canvas iframe; the iframe emits a `Use the Slack Connector to …` envelope and the host dispatches. The host's MCP layer exposes these tools to the inline-running skill; this prompt is the discipline boundary. If you find yourself reaching for one, stop — you're drifting.
- **Auto-resolution authority — Slack scope.** The Step 8.5 transition is bounded as documented above; in addition, outside those conditions, action-status writes flow through the agntux-core MCP server (`set_status`, `dismiss`, `snooze`) — not direct file edits from this skill.
