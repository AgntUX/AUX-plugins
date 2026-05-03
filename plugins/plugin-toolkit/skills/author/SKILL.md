---
name: author
description: Authoring orchestrator for AgntUX ingest plugins. Carries the contract with agntux-core, schema-as-runtime rule, and chat-confirm-then-write rule inline; delegates section work to seven specialist agents (manifest-author, ingest-prompt-author, source-semantics-advisor, draft-flow-author, tests-author, invariant-checker, release-checker). Use when working inside plugins/{slug}/ or authoring a new plugin.
triggers:
  - file:plugins/*/marketplace/listing.yaml
  - file:plugins/*/.claude-plugin/plugin.json
  - file:plugins/*/CHANGELOG.md
  - file:plugins/*/README.md
  - file:plugins/*/agents/*.md
  - file:plugins/*/skills/**/SKILL.md
---

# AgntUX Plugin Author — Orchestrator

This skill is the entry point for authoring an AgntUX ingest plugin. It
carries the load-bearing rules every specialist agent inherits, then
delegates section work to seven specialists. Read sections 1–4 once
before doing anything; the rest is a routing table.

For maintainer runbooks (PR review, rollback, kill-switch,
canonical-hook updates) use the sibling skill `/plugin-toolkit:maintain`.

---

## 1. Scope and audience

This skill is for plugin **authors** — the person scaffolding a new
`agntux-{source}` ingest plugin or maintaining an existing one (every
AgntUX plugin slug starts with `agntux-`; the legacy `-ingest` suffix
is retired — see `manifest-author` for the naming convention).
Authoring a plugin means:

- Filling in `marketplace/listing.yaml` so the website renders correctly
  and the architect can review the schema you propose.
- Substituting the canonical sync-skill template at
  `canonical/prompts/ingest/skills/sync/SKILL.md` (a top-level skill
  with `context: fork` + `agent: general-purpose`, not a sub-agent)
  with your source's specifics.
- If your source has write tools, also authoring the sibling
  `skills/draft/SKILL.md` (chat-confirm-then-write flow).
- Copying the byte-frozen hook bundle from `canonical/hooks/`.
- Authoring the README, CHANGELOG, screenshots, icon.
- Writing tests that prove the plugin's shape conforms to the contract.

You do **not** author: the host install hook (Cowork's responsibility),
the schema (`agntux-core`'s `data-architect` agent's responsibility),
the per-plugin instructions file (`agntux-core`'s `user-feedback`
agent's responsibility), or the canonical templates themselves.

This is a **teach-then-do reference**, not an automation — every
mutating action confirms with the user first.

---

## 2. The contract — what you own vs. what others own

This is the load-bearing mental model. Every agent below references it.

### What your plugin owns

| Path | Lifecycle | Who writes |
|---|---|---|
| `plugins/{slug}/.claude-plugin/plugin.json` | author-time | you |
| `plugins/{slug}/marketplace/listing.yaml` | author-time | you |
| `plugins/{slug}/marketplace/icon.png`, `screenshots/` | author-time | you |
| `plugins/{slug}/README.md`, `CHANGELOG.md`, `LICENSE` | author-time | you (LICENSE is a stub — never replace) |
| `plugins/{slug}/skills/{name}/SKILL.md` | author-time | you (substituted from `canonical/prompts/ingest/skills/`) — top-level skills with `context: fork` + `agent: general-purpose`; sub-agents under `agents/` are retired for ingest plugins |
| `plugins/{slug}/hooks/` | author-time | you (byte-frozen copy from `canonical/hooks/` with two substitutions) |
| `plugins/{slug}/__tests__/*.ts` | author-time | you |
| `plugins/{slug}/bin/` | author-time | you (only when needed for cross-platform path resolution) |
| `<root>/entities/{subtype}/{slug}.md` | runtime | your ingest agent |
| `<root>/actions/{YYYY-MM-DD}-{slug}.md` | runtime | your ingest agent (mutations via `agntux-core` MCP) |
| `<root>/data/learnings/{plugin-slug}/sync.md` | runtime | your ingest agent (cursor, last_run, lock, errors) |

### What `agntux-core` owns (you read, never write)

| Path | Owner |
|---|---|
| `<root>/user.md` | `personalization` agent |
| `<root>/data/schema/schema.md` and everything under `data/schema/` | `data-architect` agent |
| `<root>/data/instructions/{plugin-slug}.md` | `user-feedback` agent (writes); `personalization` (initial stub during onboarding interview) |
| `<root>/entities/_sources.json` | `agntux-core/hooks/maintain-index.mjs` PostToolUse hook (auto-emits after every entity Write) |
| `<root>/entities/{subtype}/_index.md`, `<root>/entities/_index.md`, `<root>/actions/_index.md` | same hook |
| `<root>/data/onboarding.md` | `personalization` agent |
| `<root>/data/schema-warnings.md`, `<root>/data/schema-requests.md` | `data-architect` (warnings) and `user-feedback`/`personalization`/`retrieval`/`pattern-feedback` (requests) |

### What the host owns (you depend on, don't ship)

| Surface | Provider |
|---|---|
| Connector authentication (OAuth, scopes) | host's Connectors UI |
| Scheduled tasks (creation, edit, run-now) | host's scheduled-task tool |
| Source MCP availability (`mcp__slack__*`, `mcp__gmail__*`, etc.) | host's MCP layer + the connector |

If you find yourself authoring code in any path on the second or third
table, **stop** — you are drifting outside your authority. The validator
hook blocks runtime writes outside your authority; lint and review block
author-time drift.

---

## 3. The schema-as-runtime rule

The single most-misunderstood thing about ingest plugins: **the user's
tenant schema is owned by `agntux-core`, customised per user during
onboarding, and your plugin conforms to it at runtime.**

You do not own subtype names. The `data-architect` agent synthesises them
from the user's discovery answers using the schema-design rubric. What
this means:

1. **At install time**, your `listing.yaml.proposed_schema` block is the
   *hint* the architect uses. Whenever an installed plugin has no
   approved contract on disk yet, the architect's Mode B reads the
   proposal directly from `<plugin-root>/marketplace/listing.yaml →
   proposed_schema`, decides **approve / rename / merge / refuse** per
   entry, and writes the approved contract to
   `<root>/data/schema/contracts/{plugin-slug}.md`. There is no install
   hook, no `.proposed` file, and no host-side side-channel — the
   `listing.yaml` block is the source of truth, and personalization /
   `_preconditions.md` enumerate missing-contract plugins by walking
   `user.md → # AgntUX plugins → ## Installed` against the
   `data/schema/contracts/` directory.
2. **At runtime**, your ingest agent reads the **approved contract** at
   Step 0 of the canonical 12-step template. The validator hook
   (`plugins/agntux-core/hooks/validate-schema.mjs`) **blocks any write
   that diverges from the contract**.
3. **Your agent prompt does NOT inline subtype names.** Don't write
   `Look up the entity in entities/person/`; write `Look up the entity
   under the subtype the contract approved`.
4. **If a candidate entity has no home in the contract**, log a
   `subtype-out-of-contract` entry to `sync.md → errors` and skip the
   write.

The architect handles cross-source identity. Don't shadow the schema by
inventing subtype hierarchies inside your plugin.

---

## 4. The chat-confirm-then-write rule (cross-cutting)

For sources where the plugin can take action back into the source —
reply to a Slack thread, draft a Gmail response, transition a Linear
issue — every write call from your `skills/draft/SKILL.md` (or any
write-capable skill) MUST be preceded by an explicit "yes" turn from
the user in the immediately preceding turn.

Hard rules:

- **No write call without an immediately preceding "yes" turn.** Never
  assume confirmation from prior context.
- **Show the exact payload** — channel/recipient, body verbatim. No "I
  sent a polite reply" hand-waves.
- **Quote the original message above the draft** so the user can verify
  context before approving.
- **Never auto-pivot.** If the user says "actually, summarise instead",
  confirm the new verb, draft a new payload, ask again.
- **Tone discipline.** The draft respects `user.md → # Preferences` and
  per-plugin `# Notes`. No injected signature lines, "as discussed"
  phrases, or padding.
- **Never pre-fill the draft body in the ingest agent's `host_prompt`.**
  The ingest writes the suggested-action button; the drafting subagent
  fills the body at click-time with fresh context.

The drafting-subagent skeleton implementing this contract lives in
`templates/draft-subagent.md`; `draft-flow-author` reads it.

---

## 5. Agent routing table

The seven specialists. Claude auto-delegates from each agent's
description; this table is the human-readable map. Each agent fixes in
place (`tools: Read, Edit, Grep, Bash`); none has Write.

| Agent | Owns | Triggers |
|---|---|---|
| `manifest-author` | `listing.yaml` schema, `proposed_schema` (entities + action_classes), `plugin.json` minimum, icon / screenshots / categories. | Editing `marketplace/listing.yaml`, `.claude-plugin/plugin.json`, marketplace assets. |
| `ingest-prompt-author` | `skills/sync/SKILL.md` substitution from `canonical/prompts/ingest/skills/sync/SKILL.md`, top-level-skill (`context: fork`) frontmatter shape, `skills/{name}/SKILL.md` directory-shape trap. | Editing `plugins/*/skills/**/SKILL.md`. |
| `source-semantics-advisor` | Cursor strategies, threads / parent-child handling, volume caps & onboarding mode, `_sources.json` lookup-before-write. | Debugging duplicate entities, choosing cursor strategy, designing thread handling. |
| `draft-flow-author` | Chat-confirm-then-write contract, drafting subagent (reads `templates/draft-subagent.md`), action-mutation MCP tools, `data/instructions/{slug}.md` read-only contract. | Sources with write tools (Slack send, Gmail send, Linear comment, etc.). |
| `tests-author` | vitest skeletons (cold-start, cursor-map, thread-association, draft-flow, idempotent). | Editing `__tests__/*.ts`, pre-commit test pass. |
| `invariant-checker` | Hard pre-flight gates: hooks byte-freeze (`shasum` against `canonical/hooks/`) + agntux-core coordination (plugin-suggestions.json, AGNTUX_PLUGIN_SLUGS, agntux-core CHANGELOG, optional cursor-strategies.md). | Any change under `plugins/*/hooks/`; pre-PR. |
| `release-checker` | README/CHANGELOG, version-bump rubric (delegates to `/bump-version`), lint runbook (delegates to `/lint-plugin`), 19-point PR self-review checklist (delegates to `/review-pr`). | Pre-PR. |

The agents do not need explicit dispatch — Claude auto-routes from the
description on each agent file. To force a specific delegation, mention
the agent by name (e.g., "ask `release-checker` to walk the PR
checklist").

---

## 6. Pointers

### Bundled artefacts

- `references/quickstart.md` — 10-step scaffold walk-through. Defers to
  `/scaffold-plugin` for the automatable steps.
- `references/anti-patterns.md` — tight list of bounce-causing mistakes.
  Read before opening a PR.
- `references/examples.md` — pointers to the in-repo reference plugins.
- `templates/draft-subagent.md` — 168-line drafting subagent skeleton
  (copy-paste artefact for §4-compliant write flows).

### Slash commands (already exist; agents delegate to these)

| Command | Use |
|---|---|
| `/scaffold-plugin {slug} {source}` | Scaffold a new plugin from canonical templates. |
| `/lint-plugin {slug}` | Run the marketplace linter and explain results. |
| `/bump-version {slug} {major\|minor\|patch}` | Apply the version-bump rubric. |
| `/review-pr [PR#]` | Apply the 19-point PR review checklist. |
| `/rollback {slug}` | Walk the rollback runbook (maintainer skill). |
| `/update-canonical-hooks` | Walk the canonical-hook update runbook (maintainer skill). |

Each agent that overlaps with one of these commands delegates by saying
**"For X, invoke `/<command>`; if unavailable, here's the fallback"** —
the slash command is the source of truth, the agent's inline fallback is
the contingency.

### Sibling skill

- `/plugin-toolkit:maintain` — maintainer runbooks (PR review,
  rollback, kill-switch, canonical-hook update, secret rotation, CI
  workflow map).

---

## What NOT to do (skill-level reminders)

- Don't edit `canonical/`. Owned by `@agntux/security` and
  `@agntux/marketplace-maintainers`. Coordinate any change.
- Don't edit `plugins/<other-slug>/`. One PR = one plugin (rare
  exceptions per P7 §11.3 for tightly-coupled cross-plugin changes).
- Don't replace `LICENSE`. The ELv2 stub is intentional.
- Don't manually regenerate `.claude-plugin/marketplace.json` or
  `marketplace/index.json` — `regenerate-indexes.yml` owns those
  post-merge.
- Don't push without running the local lint, byte-freeze check, and
  version-match check (delegated to `release-checker`).
