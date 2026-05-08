# AgntUX Core

The AgntUX orchestrator. Triages action items and queries your knowledge store.

## What it does

AgntUX Core is the foundation plugin that all other AgntUX plugins build upon. It maintains
your knowledge store, triages action items according to your preferences, and coordinates
between ingest plugins to keep your data fresh and organized.

## Install

Install AgntUX Core first before installing any other AgntUX plugin. It provides the
shared knowledge store and orchestration layer that other plugins depend on.

After installing, run `/agntux onboard` once to create your `<agntux project root>/user.md` profile
and bootstrap the tenant schema.

## Quickstart

agntux-core ships a single entry-point skill — `/agntux`. Sub-commands route
to the right behaviour by reading the first token of `$ARGUMENTS`; bare
`/agntux` defaults to ask-mode and infers from the natural-language prompt.

| Command | Purpose |
|---|---|
| `/agntux onboard` | First-run interview + schema bootstrap. Run once. Re-runs walk newly-installed plugins. |
| `/agntux profile` | Edit preferences, glossary, identity, sources. |
| `/agntux teach {plugin-slug}` | Capture per-plugin rules ("never raise email from X"). |
| `/agntux schema [review\|edit] [plugin-slug]` | Review or edit the tenant schema. |
| `/agntux sync {plugin-slug}` | Manually trigger an ingest pass for an installed plugin (bare names like `slack` expand). |
| `/agntux ask "..."` | Catch-all for natural-language queries and inline status edits. |
| `/agntux feedback-review` | Background pattern detection over resolved actions (scheduled task target). |
| `/agntux triage-digest` | Daily text-digest fallback when the interactive triage UI doesn't render (scheduled task target). |

You can also speak naturally — Claude auto-dispatches to `/agntux` from
its description, and the router infers the right sub-command from the
prompt (e.g. saying "show triage" or "what's hot" invokes the
interactive triage UI directly via the `agntux_core_triage_view` MCP
tool — no skill in the loop).

## Recommended scheduled tasks

| Task | Prompt body | Cadence |
|---|---|---|
| Daily action-item digest | `/agntux triage-digest` | Daily 08:00 |
| Daily feedback review | `/agntux feedback-review` | Daily 16:00 |

## UI

agntux-core renders one MCP App: `ui://triage`. Saying "what's hot",
"show triage", or "what should I look at" triggers the host's tool
selector to invoke `agntux_core_triage_view` directly — that tool's
description carries the trigger phrases. The UI shows priority-sorted
open action items with inline mutation controls and per-item
suggested-action buttons that route into source plugins via
`sendFollowUpMessage`. The component runs server-side reads against
`<agntux project root>/actions/`; arguments to the view tool are
zero-required so the LLM spends ~no tokens on tool args.

For scheduled-background fires (Daily 08:00 by default), the
`/agntux triage-digest` sub-command emits a text digest via the same
data source — no UI, no audience required.

The previous `entity-browser` UI handler was retired in 5.0.0. Entity
navigation now goes through `/agntux ask` (e.g. "tell me about
person/avery-rivera").

## Configuration

Configure your preferences in `<agntux project root>/user.md`. This
file controls how the orchestrator prioritizes action items and manages
your workflow. Run `/agntux profile` to edit it.

## Limitations

- Requires at least one ingest plugin to populate the knowledge store with real data.
- Knowledge store lives on your local machine; no cloud sync at MVP.

## Hooks

This plugin ships a small set of plugin-specific hooks under `hooks/` for
schema and index validation:

- `hooks/validate-schema.mjs` — PreToolUse, blocks malformed entity writes.
- `hooks/validate-contract.mjs` — PreToolUse, blocks contract violations.
- `hooks/maintain-index.mjs` — PostToolUse, keeps the entity index current.

## License

Apache License 2.0. See the `LICENSE` and `NOTICE` files at the repo
root for full terms.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues
- License: see the LICENSE file at the repo root.
