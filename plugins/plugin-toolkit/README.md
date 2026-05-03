# Plugin Toolkit

Authoring and maintainer toolkit for the AgntUX plugin marketplace. One
plugin, two namespaced skills, seven specialist agents — everything you
need to build and operate plugins under `plugins/{slug}/`.

## What it ships

- **`/plugin-toolkit:author`** — slim orchestrator (~200 lines) that
  auto-triggers when you open any of `plugins/*/marketplace/listing.yaml`,
  `plugins/*/.claude-plugin/plugin.json`, `plugins/*/CHANGELOG.md`,
  `plugins/*/README.md`, `plugins/*/agents/*.md`, or
  `plugins/*/skills/**/SKILL.md`. Carries the authority table,
  schema-as-runtime rule, and chat-confirm-then-write rule inline;
  delegates section work to the seven specialist agents below.
- **`/plugin-toolkit:maintain`** — maintainer runbooks. Auto-triggers on
  `.github/**`, root `CHANGELOG.md`, root `README.md`, and on issues
  labelled `regression`, `kill-switch`, or `canonical-hook-rollout`.
  Inlines the PR review checklist, rollback runbook, kill-switch,
  canonical-hook update procedure, secret rotation, and CI workflow map.

The two skills are independent. The seven authoring agents are also
callable from `maintain` if a maintainer wants to use, e.g.,
`release-checker` while shepherding a PR.

## The seven specialist agents

| Agent | Owns |
|---|---|
| `manifest-author` | `listing.yaml` schema, `proposed_schema` for `-ingest` slugs, minimum `plugin.json`, icon / screenshots / categories. |
| `ingest-prompt-author` | `agents/ingest.md` substitution from `canonical/prompts/ingest/`; `skills/{name}/SKILL.md` directory-shape trap. |
| `source-semantics-advisor` | Cursor strategies, threads / parent-child handling, volume caps & onboarding mode, `_sources.json` lookup-before-write. |
| `draft-flow-author` | Chat-confirm-then-write contract, drafting subagent (reads `templates/draft-subagent.md`), `data/instructions/{slug}.md` read-only contract, action-mutation MCP tools. |
| `tests-author` | vitest skeletons — cold-start, cursor-map, thread-association, draft-flow, idempotent. |
| `invariant-checker` | Hard pre-flight gates: hook byte-freeze (`shasum` vs `canonical/hooks/`), agntux-core coordination (`plugin-suggestions.json`, `AGNTUX_PLUGIN_SLUGS`, agntux-core `CHANGELOG`). |
| `release-checker` | README / CHANGELOG, version-bump rubric (delegates to `/bump-version`), lint runbook (delegates to `/lint-plugin`), 19-point PR self-review checklist (delegates to `/review-pr`). |

## Install

1. Install **AgntUX Core** if you haven't already.
2. Install **Plugin Toolkit** from the marketplace.
3. Both skills surface immediately — open any file matching the trigger
   globs and the relevant skill auto-loads. There is no `/agntux-onboard`
   step for this plugin (it ingests no data).

## Slash-command pointers

The seven agents delegate to existing maintainer commands at
`.claude/commands/` rather than duplicating logic. Pointer table:

| Command | Used by |
|---|---|
| `/scaffold-plugin {slug} {source}` | author orchestrator → `manifest-author` (Quickstart). |
| `/lint-plugin {slug}` | `release-checker`, `maintain`. |
| `/bump-version {slug} {kind}` | `release-checker`. |
| `/review-pr [PR#]` | `release-checker`, `maintain`. |
| `/rollback {slug}` | `maintain`. |
| `/update-canonical-hooks` | `maintain`, `invariant-checker`. |
| `/add-plugin {slug}` | `maintain`. |

## Limitations

- Ships no UI components and no MCP server. The plugin is an authoring
  bundle; the only runtime surface is Claude Code's skills and agents.
- Ingests no data, so it is not in the architect's plugin-suggestions
  list and does not appear during `/agntux-onboard`. It is installed
  directly by plugin authors and maintainers.
- The `proposed_schema` block is intentionally absent — non-ingest
  plugins do not declare entity vocabulary.

## Known canonical-hook diffs

Two files in `hooks/lib/` differ from `canonical/hooks/lib/` by design — every
diff is a documented placeholder substitution per P2 §8. Verifiers running
`shasum -c canonical/hooks/checksums.txt` from this plugin's `hooks/` directory
see these two diverge:

| File | Reason for divergence |
|---|---|
| `hooks/lib/public-key.mjs` | `{{PUBLIC_KEY_KID}}` → `agntux-license-v1`; `{{PUBLIC_KEY_SPKI_PEM}}` → real Ed25519 PEM from `canonical/kms-public-keys.json`. Substitution per P2 §8. |
| `hooks/lib/agntux-plugins.mjs` | `{{AGNTUX_PLUGIN_SLUGS}}` → `["agntux-core", "plugin-toolkit"]`. Substitution per P2 §8. |

All other hook files (`hooks.json`, `license-check.mjs`, `license-validate.mjs`,
`lib/{cache,device,jwt-verify,refresh,scope,ui,agntux-root}.mjs`) are byte-identical
to canonical and pass `shasum -c` cleanly.

## License

Elastic License v2 (ELv2). See the `LICENSE` file for details.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues?q=label%3Aplugin-toolkit
- Email: support@agntux.ai
