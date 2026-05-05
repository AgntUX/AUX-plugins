# AgntUX Core

The AgntUX orchestrator. Triages action items and queries your knowledge store.

## What it does

AgntUX Core is the foundation plugin that all other AgntUX plugins build upon. It maintains
your knowledge store, triages action items according to your preferences, and coordinates
between ingest plugins to keep your data fresh and organized.

## Install

Install AgntUX Core first before installing any other AgntUX plugin. It provides the
shared knowledge store and orchestration layer that other plugins depend on.

After installing, run `/agntux-onboard` once to create your `<agntux project root>/user.md` profile
and bootstrap the tenant schema.

## Quickstart

| Command | Purpose |
|---|---|
| `/agntux-onboard` | First-run interview + schema bootstrap. Run once. |
| `/agntux-profile` | Edit preferences, glossary, identity, sources. |
| `/agntux-teach {plugin-slug}` | Capture per-plugin rules ("never raise email from X"). |
| `/agntux-triage` | Inline triage UI — priority-sorted open actions, snooze/dismiss/done, suggested-action buttons. |
| `/agntux-schema [review\|edit] [plugin-slug]` | Review or edit the tenant schema. |
| `/agntux-sync {plugin-slug}` | Manually trigger an ingest pass for an installed plugin. |
| `/agntux-ask "..."` | Catch-all for natural-language queries and inline status edits. |
| `/agntux-feedback-review` | Background pattern detection over resolved actions (scheduled task target). |

You can also speak naturally — Claude auto-dispatches to the right skill from each
skill's description (e.g. saying "what's hot today" routes to `/agntux-triage`).

## Recommended scheduled tasks

| Task | Prompt body | Cadence |
|---|---|---|
| Daily action-item digest | `/agntux-triage` | Daily 08:00 |
| Daily feedback review | `/agntux-feedback-review` | Daily 16:00 |

## UI

agntux-core renders one MCP App: `ui://triage`. Type `/agntux-triage` (or
say "what's hot", "show triage", etc.) to render priority-sorted open
action items with inline mutation controls and per-item suggested-action
buttons that route into source plugins via `sendFollowUpMessage`. The
component runs server-side reads against `<agntux project root>/actions/`;
arguments to the underlying `triage_view` tool are zero-required so the
LLM spends ~no tokens on tool args.

For scheduled-background fires (Daily 08:00 by default), the same
`/agntux-triage` skill emits a text digest via the retrieval subagent —
no UI, no audience required.

The previous `entity-browser` UI handler was retired in 5.0.0. Entity
navigation now goes through `/agntux-ask` (e.g. "tell me about
person/avery-rivera").

## Configuration

Configure your preferences in `<agntux project root>/user.md`. This file controls how the orchestrator
prioritizes action items and manages your workflow. Run `/agntux-profile` to edit it.

## Limitations

- Requires at least one ingest plugin to populate the knowledge store with real data.
- Knowledge store lives on your local machine; no cloud sync at MVP.

## Known canonical-hook diffs

Three files in `hooks/` differ from `canonical/hooks/` by design — every
diff is a documented placeholder substitution per P2 §8 (or an additive
plugin-specific extension). Verifiers running
`shasum -c canonical/hooks/checksums.txt` will see these three diverge:

| File | Reason for divergence |
|---|---|
| `hooks/lib/public-key.mjs` | `{{PUBLIC_KEY_KID}}` → `agntux-license-v1`; `{{PUBLIC_KEY_SPKI_PEM}}` → real Ed25519 PEM from `canonical/kms-public-keys.json`. Substitution per P2 §8. |
| `hooks/lib/agntux-plugins.mjs` | `{{AGNTUX_PLUGIN_SLUGS}}` → `["agntux-core"]`. Substitution per P2 §8. |
| `hooks/hooks.json` | Extends the canonical SessionStart + PreToolUse lanes with the additive PostToolUse `maintain-index.mjs` lane (T17 / P4 §6.1) — the orchestrator plugin owns the index hook; ingest plugins do NOT. |

All other hook files (`license-check.mjs`, `license-validate.mjs`,
`lib/{cache,device,jwt-verify,refresh,scope,ui}.mjs`,
`lib/{frontmatter,summary}.mjs`) are byte-identical to canonical and
pass `shasum -c` cleanly.

The Connector Directory URL embedded in `agents/personalization.md`
(`https://app.agntux.ai/connectors`) is the MVP value; finalise before
public launch if the production URL differs.

## License

Elastic License v2 (ELv2). See LICENSE for details.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues
- License: see the LICENSE file at the repo root.
