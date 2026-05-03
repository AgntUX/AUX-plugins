# Changelog

All notable changes to agntux-core are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.2.0] — 2026-05-02

### Changed
- `data/plugin-suggestions.json` flips `slack-ingest` from `coming-soon`
  to `available`, surfacing it during `/agntux-onboard`'s Plugin
  Suggestions block. Coordinated change with the slack-ingest 0.1.0
  release.
- `hooks/lib/agntux-plugins.mjs` substituted slug list grows from
  `["agntux-core"]` to `["agntux-core", "slack-ingest"]` so license
  enforcement covers Slack-namespaced MCP calls. Coordinated change
  with the slack-ingest 0.1.0 release.

### Added
- `resolveAgntuxRoot()` shared resolver in `hooks/lib/agntux-root.mjs`
  + TS twin in `mcp-server/src/agntux-root.ts`. Hooks and MCP servers now
  agree on the AgntUX project root (any directory named `agntux`,
  case-insensitive, falling back to `~/agntux`). 8 unit tests pass.
- `personalization` Stage 0 rewritten as a 5-step discover/Glob/mkdir
  flow with a one-time `~/agntux-code/` → `~/agntux/` migration aid.

### Changed
- Hook libraries (`scope.mjs`, `schema-lock.mjs`) and ingest hooks
  (`maintain-index.mjs`, `validate-schema.mjs`) route path resolution
  through `resolveAgntuxRoot()` so they reach data the user has,
  regardless of which `agntux/` directory they cwd from.
- MCP tools (`dismiss`, `pivot`, `snooze`, `set-status`) use the new
  `expectedAgntuxRoot()` for path-traversal guards (string-only, no FS).
- ~140 prompt/doc/test references swept from literal `~/agntux/` to the
  `<agntux project root>/` placeholder for consistency with the resolver.

### Fixed
- Onboarding opener no longer narrates internal architecture
  ("subagent", "Mode A", "dispatch"). Replaced with a single AgntUX
  voice and a brief welcome.
- Project-root precondition no longer short-circuits before Stage 0.
  Stage 0 owns folder discovery, mkdir-prompt, and the picker
  instruction — and now leads with the explicit "AgntUX uses a folder
  named `agntux`" framing instead of the generic "select a folder"
  copy.
- Plugin suggestions are fenced to the AgntUX marketplace. Slugs are
  validated against `${CLAUDE_PLUGIN_ROOT}/../{slug}/marketplace/listing.yaml`;
  Anthropic / built-in / third-party plugins are never recommended.
  Discovery-surfaced needs without AgntUX coverage are stated honestly
  ("there isn't an AgntUX plugin for {source} yet — it's on the
  roadmap").
- Scheduled-task creation now uses the host's scheduled-task tool
  directly (Cowork supports this). Task bodies are bare slash commands
  with no preamble or source-pull instructions. Copy/paste fallback
  retained for hosts that don't expose the tool.
- Mode B cadence-change is now a direct edit through the host's
  scheduled-task tool, no longer a "you have to do it yourself" deflect.
- `agents/retrieval.md` no longer claims scheduled tasks are
  host-UI-only — it routes management to personalization Mode B.
- Onboarding wrap-up State A fires one immediate `/agntux-sync` per
  installed plugin so the user's first triage call has data, then
  points the user at the AgntUX Triage UI and suggests clicking an
  action item to surface the source-specific plugin UI.
- `skills/agntux-triage/SKILL.md` carries a defensive note: triage
  reads only the ingested store at `<root>/actions/_index.md`; any
  prompt-body instruction to "pull from {source}" is ignored.

## [4.1.0] — 2026-05-02

### Added
- `data/schema-design-rubric.md` §1a — canonical banned-words list
  (`subtype`, `schema`, `frontmatter`, `action_class`, `contract`,
  `lock file`) plus plain-language replacement table. Single source
  of truth for the no-jargon rule; `data-architect.md` and
  `personalization.md` reference it instead of duplicating.
- `skills/_preflight.md` — shared schema-drift preflight (the one-line
  nudge for pending `.proposed` contracts and queued schema-requests).
  Six user-facing skills now reference it instead of inlining.
- Stage 0.5 explicit `discovery_summary` confirmation step.
  Personalization shows the LLM-composed summary back to the user
  ("Here's how I'm reading your situation: …") and waits for approval
  before saving. Resolves the user-authority gap on a paraphrased
  frontmatter field.
- Stage 5.5 (architect Mode A — schema bootstrap) wired explicitly
  into the `/agntux-onboard` first-run dispatch. Closes the gap where
  Mode B was being dispatched before any schema existed.
- Mode A-bis re-entry now scans a third disjunct: instructions files
  with `status: draft` (interrupted onboarding). Without this, an
  interrupted per-plugin interview left the plugin in limbo with no
  recovery short of `/agntux-teach`.
- `(needs-clarification)` handling in architect Mode A: when
  discovery is too sparse even after the fallback question, write a
  minimal generic baseline plus an invitation to refine via
  `/agntux-schema edit` later. No flow blocking.
- Malformed `marketplace/listing.yaml` handling in personalization's
  per-plugin onboarding (missing / YAML-garbage / partial-fields all
  handled with explicit fallbacks).
- `recommended_ingest_cadence` value space documented (5 valid
  shapes; malformed values fall back to `Daily 09:00` with a user
  note).
- `agents/ui-handlers/{triage,entity-browser}.md` gain real
  `operational:` manifests (verb_phrases, view_tool, resource_uri,
  structured_content_schema, follow_up_intents, degraded_states).
  Clears the W03 stub-handler warnings.

### Changed
- `data-architect` tool surface: `+ Bash` (needed for `rm -f` to
  delete `.proposed` files after Mode B; Edit alone can't unlink),
  `+ WebSearch` and `+ WebFetch` (synthesis aid during Mode A).
- `data-architect` Mode B Stage 5: explicit `rm -f` of the
  `.proposed` file plus a re-Glob verification step. Without
  deletion, the schema-drift nudge fires forever.
- `_preconditions.md` check #3 (pending `.proposed` contracts) now
  case-splits: missing or `status: draft` instructions →
  personalization Mode A-bis (per-plugin onboarding); `status: final`
  instructions → architect Mode B directly. Prevents bypassing the
  per-plugin interview.
- `_preconditions.md` documents that `/agntux-onboard` opts out of
  checks 2/3/4 (handles them inline via the new flow).
- `data-architect` Mode A Stage 4 / Mode C Stage 4: migration warning
  is unconditional on required-field adds — no `entities/` scan
  needed (architect doesn't have read authority there).
- `user-feedback` Mode B reframed as on-demand refresh only;
  install-time onboarding is owned by personalization Mode A's
  per-plugin interview.

### Fixed
- `mcp-server` is now installable and buildable (`@modelcontextprotocol/sdk`
  was missing from runtime deps); 4 pre-existing e2e smoke-test
  failures resolved.

## [4.0.0] — 2026-05-01

### Changed (BREAKING)
- Every named skill is renamed with the `agntux-` prefix to avoid
  slash-command collisions with other plugins on hosts that don't
  auto-namespace by plugin slug:
  - `/agntux-core:onboard` → `/agntux-onboard`
  - `/agntux-core:profile` → `/agntux-profile`
  - `/agntux-core:teach {plugin-slug}` → `/agntux-teach {plugin-slug}`
  - `/agntux-core:triage` → `/agntux-triage`
  - `/agntux-core:schema [review|edit] [plugin-slug]` → `/agntux-schema [review|edit] [plugin-slug]`
  - `/agntux-core:sync {plugin-slug}` → `/agntux-sync {plugin-slug}`
  - `/agntux-core:ask` → `/agntux-ask`
  - `/agntux-core:feedback-review` → `/agntux-feedback-review`
- Scheduled-task bodies must be migrated again — replace every
  `/agntux-core:*` reference in your existing scheduled tasks with
  the matching `/agntux-*` form.

### Added
- **Open-ended discovery interview.** `personalization` Mode A now
  opens with a single anchor question ("What do you want AgntUX to
  help you with?") and runs 3–6 adaptive follow-ups guided by
  `data/schema-design-rubric.md`. The first-run flow no longer
  assumes the user is a knowledge worker with an employer.
- `data/schema-design-rubric.md` — the architect's design playbook.
  Replaces the old role-preset library with shape-based guidance and
  illustrative patterns (knowledge-worker, marketing/community,
  healthcare, research, founder).
- **Schema synthesis in the user's vocabulary.** The data-architect
  presents what it'll keep track of in plain language ("your care
  team", "your campaigns", "people you work with") rather than
  technical subtype names. Internal canonical files are unchanged.
- **Connect-your-connectors gate.** After schema bootstrap, the
  personalization agent prompts the user to authorize connectors in
  Customize → Connectors, then enumerates what's connected and runs
  per-plugin onboarding for each.
- **Per-plugin onboarding interview** at install. ≤5 plain-language
  questions per plugin, captured to
  `~/agntux/data/instructions/{plugin-slug}.md` (status `draft` →
  `final` lifecycle).
- **Re-entrant `/agntux-onboard`.** Running it again after first-run
  detects new `.proposed` contracts (or instructions stubs missing)
  and walks the per-plugin onboarding only — no destructive rewrite
  unless the user explicitly says "redo from scratch".
- **Deterministic wrap-up.** State machine emits one of four
  end-of-onboarding messages with an actionable next step.
- **Stage 1.5 People.** Conditional capture of important people
  decided from discovery context. Subsection names are
  vocabulary-driven, not enum-fixed.
- **Schema-drift preflight.** Every entry-point skill emits a
  one-line nudge when there are pending `.proposed` contracts or
  queued schema-requests. Informational; doesn't block.
- **More signal channels into `data/schema-requests.md`.**
  Personalization Mode D, retrieval (failure-to-bind),
  pattern-feedback (graduation), and per-plugin onboarding interviews
  can now append schema-change requests in addition to user-feedback
  Mode C.
- **Timezone moved into Stage 1** (Identity) with system-clock
  auto-detect — it was previously bundled into Stage 5.

### Removed
- `data/role-presets/{default,pm,swe,sales}.md`. The architect no
  longer matches role-strings against a preset library; it
  synthesises a custom starter schema from discovery answers using
  the rubric. Illustrative content from the four presets has been
  folded into `data/schema-design-rubric.md` §4.

### Migration

| Old prompt body | New prompt body |
|---|---|
| `/agntux-core:onboard` | `/agntux-onboard` |
| `/agntux-core:profile` | `/agntux-profile` |
| `/agntux-core:teach {slug}` | `/agntux-teach {slug}` |
| `/agntux-core:triage` | `/agntux-triage` |
| `/agntux-core:schema review` | `/agntux-schema review` |
| `/agntux-core:schema edit` | `/agntux-schema edit` |
| `/agntux-core:sync {slug}` | `/agntux-sync {slug}` |
| `/agntux-core:ask` | `/agntux-ask` |
| `/agntux-core:feedback-review` | `/agntux-feedback-review` |

## [3.0.0] — 2026-04-30

### Changed (BREAKING)
- The flat `skills/orchestrator.md` (`/ux`) is **removed**. The Claude Code plugin spec requires skills under `skills/` to be directories shaped as `skills/{name}/SKILL.md`; flat files were silently dropped, so `/ux` never registered.
- The orchestrator's logic is now distributed across eight named skills under `skills/`:
  - `/agntux-onboard` — first-run interview + schema bootstrap chain
  - `/agntux-profile` — personalization edits (Modes B/C/D)
  - `/agntux-teach {plugin-slug}` — per-plugin instruction capture (user-feedback)
  - `/agntux-triage` — daily action-item digest (retrieval Pattern A)
  - `/agntux-schema [review|edit] [plugin-slug]` — data-architect Modes B/C
  - `/agntux-sync {plugin-slug}` — cross-plugin sync alias (re-dispatches to per-plugin sync)
  - `/agntux-ask` — catch-all classifier (retrieval Patterns B–E, inline status edits, click-time `ux:` slot drafting)
  - `/agntux-feedback-review` — daily pattern detection (background; `disable-model-invocation: true`)
- Scheduled-task bodies must be migrated:
  - `ux: triage today` → `/agntux-triage`
  - `ux: feedback review` → `/agntux-feedback-review`
- Description-driven auto-dispatch: each new skill front-loads its trigger phrases in
  `description:` so Claude's built-in skill auto-invocation routes natural-language prompts
  ("what's hot", "edit my profile") to the right skill without the user typing the slash
  command. `/agntux-ask` is the residual classifier for ambiguous prompts.

### Added
- `skills/_preconditions.md` — shared, non-invocable preconditions block referenced by every entry-point skill (project-root check, `user.md` exists, schema bootstrap state, `.proposed` contracts queue, schema-requests queue, trial-status banner).

### Migration

| Old prompt body | New prompt body |
|---|---|
| `/ux` | `/agntux-ask` (or speak naturally — auto-dispatches) |
| `/ux schema review` | `/agntux-schema review` |
| `/ux schema edit` | `/agntux-schema edit` |
| `/ux teach {slug}` | `/agntux-teach {slug}` |
| `ux: triage today` | `/agntux-triage` |
| `ux: feedback review` | `/agntux-feedback-review` |

The `ux:` prefix is **retained** for click-time drafting (`host_prompt` payloads with
`{propose_reply}`, `{summary}`, etc.) — that is a host-protocol detail, not a user
command, and it routes through `/agntux-ask`.

## [2.0.0] — 2026-04-29

### Added
- `agents/data-architect.md` — owns `~/agntux/data/schema/`. Modes A (bootstrap from `user.md`), B (plugin install review of `.proposed` contracts), C (schema edit). (P3a §1.1)
- `agents/user-feedback.md` — owns `~/agntux/data/instructions/`. Modes A (capture imperatives), B (teach interview), C (structural escalation to `data/schema-requests.md`). (P3a §1.2)
- `hooks/validate-schema.mjs` — PreToolUse blocking validator for entity/action writes against the tenant `schema.lock.json`. Helper at `hooks/lib/schema-lock.mjs`. (P3a §3)
- `data/schema-template/` — seed master contract + four default subtypes (person, company, project, topic) + actions index. (P3a §4)
- `data/role-presets/{pm,swe,sales,default}.md` — baseline schema proposals for the architect's Mode A. (P3a §4)
- Three new prompts in `marketplace/listing.yaml`: `/ux schema review`, `/ux schema edit`, `/ux teach`.
- Personalization Mode A interview adds Stage 2.5 (Day-to-Day, Aspirations, Goals with horizon tags) and Stage 4.5 (Sources). (P3a §2)

### Changed
- `agents/feedback.md` renamed to `agents/pattern-feedback.md`. Behaviour unchanged; rename disambiguates from the new `user-feedback` subagent. (P3a §1.3)
- `skills/orchestrator.md` adds Pre-classification stage (schema-bootstrap, `.proposed` review, schema-requests queue) and Lanes E (schema-review), F (schema-edit), G (teach).
- `agents/retrieval.md` gains read-only access to `data/schema/`, `data/instructions/`, `data/learnings/`. Per-plugin sync moves to `data/learnings/{plugin-slug}/sync.md`.

### Removed
- The `~/agntux/state/` directory. All persistent files now live under `~/agntux/data/`. Earlier P3a drafts proposed renaming `.state/` → `state/`; that intermediate step was retired per user direction.
- Source-plugin-generated learnings files (the per-plugin `*.state/notes/{source}/{source}.md`). The concept is gone from the data structure and the prompts. Anything an ingest plugin would have written there now goes either into `sync.md → errors` (transient signals; bounded last-10) or escalates to user-feedback Mode C.

### Schema
- Reverses P3 D6 ("plugins own contracts"). Vocabulary authority is now central (architect owns `~/agntux/data/schema/`); plugins read their permits from `data/schema/contracts/{plugin-slug}.md` at run-start. (P3.AMEND.4 / P4.AMEND.3 / P5.AMEND.1)
- Migration is **deferred** to P3b. The architect logs one-line warnings to `data/schema-warnings.md` for any change that would require a backfill.

### Path layout (final P3a)

```
~/agntux/
  user.md                                         personalization
  entities/                                       validated; ingest plugins write
  actions/                                        validated; ingest plugins write
  data/
    schema/                                       architect's surface
      schema.md, schema.lock.json
      entities/_index.md + {subtype}.md
      actions/_index.md
      contracts/{plugin-slug}.md (+ .proposed)
    instructions/{plugin-slug}.md                 user-feedback's surface
    learnings/{plugin-slug}/sync.md               ingest plugins' sync state
    schema-warnings.md                            architect-emitted log
    schema-requests.md                            user-feedback escalation queue
    onboarding.md                                 personalization Mode A progress (transient)
```

## [1.0.0] — 2026-04-01

### Added
- Initial release.
