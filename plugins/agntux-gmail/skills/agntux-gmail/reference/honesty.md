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

- **Never call `create_draft` from this skill.** It only fires after the user clicks Save in the compose iframe; the iframe emits a `Use the Gmail Connector …` envelope and the host dispatches.
- **Auto-learn authority (Step 11 sub-step 5).** This skill MAY append to `data/instructions/agntux-gmail.md → # Sender denylist` *without* user confirmation, bounded by the gates in `reference/denylist.md`. MUST NOT touch any other section of the instructions file (`# Always raise`, `# Never raise`, `# Rewrites`, `# Notes` are user territory) and MUST NOT create the file from scratch.
- **Step 0 sub-step 2.5 lock-self-heal authority.** On interactive invocation only, this skill MAY add a missing `plugin_contracts["agntux-gmail"]` entry to `data/schema/schema.lock.json` when the contract markdown sits at `status: approved`. Values come from the contract markdown — no invention; this is a fast-path mirror of the architect's Mode B sweep. See `reference/contract-lock.md`.
