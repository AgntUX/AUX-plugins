# Ingest Prompt Templates — Placeholder Registry

This directory contains the canonical prompt templates for per-source ingest plugins.
P6's plugin generator copies these verbatim (with placeholder substitution) when generating
any ingest plugin (`agntux-slack`, `agntux-gmail`, `agntux-jira`, etc. — every AgntUX plugin slug starts with `agntux-`).

## Delivered by T16/T17/T19/T20

| File | Status |
|---|---|
| `skills/sync/SKILL.md` | T19 — delivered. Lineage: `agents/ingest.md` + `skills/orchestrator.md` pair → top-level skill with `context: fork` + `agent: general-purpose` → top-level skill that runs **inline** (no fork, no nested agent). Each iteration removed one context boundary; the inline shape is what lets one host-level "Allow for all scheduled runs" click hold across every subsequent fire. |
| `agents/ui-handlers/_template.md` | T20 — delivered (UI handlers stay as metadata-carrier files per P9 §7) |

## Placeholder registry

All placeholders use `{{double-curly}}` format. P6 substitutes these from a per-source
spec JSON/YAML at generation time. Single-curly tokens like `{ref}`, `{text}`, `{ids}` are
runtime/host-filled — NOT P6-substituted.

### Shared across all ingest plugin templates

| Placeholder | Example (agntux-gmail) | Example (agntux-slack) | Source |
|---|---|---|---|
| `{{plugin-slug}}` | `agntux-gmail` | `agntux-slack` | manifest `name` field; every AgntUX plugin slug starts with `agntux-` |
| `{{plugin-version}}` | `1.0.0` | `0.2.0` | manifest `version` field |
| `{{source-display-name}}` | `Gmail` | `Slack` | per-source spec |
| `{{source-slug}}` | `gmail` | `slack` | per-source spec; the bare source name (substring after `agntux-`); appears in entity source maps, action-item `source:` fields, and the `# {{source-slug}}` heading inside `data/learnings/{{plugin-slug}}/sync.md` |
| `{{recommended-cadence}}` | `Every 60 min, 7am–7pm weekdays local` | `Every 30 min, 7am–7pm weekdays local` | manifest `recommended_ingest_cadence` field — free-form descriptive string (friendly cadence, cron expression, or natural-language description); personalization reads it verbatim and hands it to the host's scheduled-task tool. Default for new plugins: `Every 60 min, 7am–7pm weekdays local` (normal working hours in user's local timezone, weekdays only) — tighten/loosen per source as needed but stay within working hours unless the source genuinely needs out-of-hours coverage. |
| `{{source-cursor-semantics}}` | `Gmail historyId (opaque integer string)` | `message timestamp (Unix float, e.g. 1714043640.001200)` | per-source spec |
| `{{source-mcp-tools}}` | `gmail_list_messages, gmail_get_message` | `slack_read_channel, slack_read_thread, slack_search_public_and_private` (Cowork: prefixed with a per-instance UUID at runtime; the inline-running skill inherits whatever the host exposes — no `tools:` whitelist needed) | per-source spec; comma list of tool root names |
| `{{ui-handler-trigger-list}}` | `(this plugin ships no UI components)` | `- "display the slack thread UI for {ref}" → call mcp__agntux-slack-ui__thread_view` | per-source spec; one bullet per view tool, or the literal no-UI string. Used by UI-handler metadata files (P9 §7), not by the sync skill. |
| `{{thread-unit-name}}` | `thread` | `thread` | per-source spec; the per-source name for the cursor-keyed unit ("thread", "channel", "issue", "row"). Singular form; appears in prose ("once per {{thread-unit-name}}, not once per reply"). |
| `{{bootstrap-window-default-days}}` | `14` | `7` | per-source spec; default value for `bootstrap_window_days` when `user.md` doesn't override. Slack=7 (high volume), Gmail=14 (moderate), generic=30. |
| `{{example-channel}}` | `Inbox` | `general` | per-source spec; one plausible source-native scope name used in the SKILL `description`'s trigger-phrase examples (e.g. "what's happening in #{{example-channel}}"). Slack uses a real channel name (`general`); sources without channel-shaped scopes (Gmail, Drive) use a benign label like `Inbox`. Cold-start matching surface only — the value never reaches user-facing prose. |
| `{{extra-skill-triggers}}` | `""` (empty) | `""` (empty) | per-source spec; **optional, defaults to empty**. Extra skill-dispatch trigger phrases spliced verbatim into the SKILL `description`'s trigger list, right before "or any {{source-display-name}}-scoped question". Empty for read-only plugins (renders byte-identically to no value); set for plugins with a user-initiated view lane (e.g. agntux-google-calendar: `"find a time to meet", "schedule a meeting with {person}", … `). **Keep a trailing `", "`** so the surrounding phrasing reads cleanly. Every ingest plugin's `_overrides/frontmatter.yaml` MUST define this key (the renderer fails on surviving placeholders); read-only plugins set `extra-skill-triggers: ""`. |

### UI-handler subagent template only (`agents/ui-handlers/_template.md`)

| Placeholder | Example (slack-thread handler) | Source |
|---|---|---|
| `{{ui-handler-name}}` | `slack-thread` | per-source spec; kebab-case |
| `{{ui-handler-display-name}}` | `Slack thread` | per-source spec; human-readable |
| `{{ui-name}}` | `thread` | per-source spec; view-tool root name (no source prefix) |
| `{{primary-verb-phrase}}` | `display the slack thread UI for {ref}` | per-source spec; lower-case prose, must include `{ref}` |
| `{{structured-content-field-1}}` | `thread_messages` | per-source spec; first top-level field in structuredContent |
| `{{structured-content-field-2}}` | `thread_members` | per-source spec; second field |
| `{{structured-content-field-3}}` | `proposed_reply` | per-source spec; third field (often the orchestrator-authored slot) |
| `{{primary-intent-key}}` | `send-thread-reply` | per-source spec; must match a `## intent-key:{name}` heading in SKILL.md |

### MCP server templates only (`mcp-server-templates/ingest/`)

See `mcp-server-templates/ingest/STUBS.md` for the MCP server placeholder registry.

## Placeholder conventions

- `{{double-curly}}` — P6 build-time substitution from per-source spec.
- `{single-curly}` — runtime/host-filled token; NOT substituted by P6. Appears in verb phrases, intent templates, and freshness check output.
- Placeholders are always kebab-case for slugs and display-name for human labels.
- The generator rejects any output file containing unsubstituted `{{...}}` tokens (the SKILL.md stale-placeholder guard catches them at runtime too).

### Subtype and action_class lists are NOT placeholders

`entity_subtypes` and `action_classes` are vocabulary the plugin claims at install
time — they live exclusively inside `marketplace/listing.yaml`'s `proposed_schema`
block (per P3a §6.2). They are NOT `{{...}}` placeholders that get inlined into
agent prompts.

At run-start, the sync skill reads the contract at
`<agntux project root>/data/schema/contracts/{{plugin-slug}}.md` (Step 0 of `skills/sync/SKILL.md`)
and uses the contract's allowed subtypes + action classes as its writable
vocabulary. The validator hook (`agntux-core/hooks/validate-schema.mjs`) blocks
any write that diverges. **Never inline subtype or action_class lists into
canonical prompt templates** — doing so creates two sources of truth and the
runtime contract becomes ignored.

## Override mechanism (per-plugin specialisation)

The sync SKILL.md template at `canonical/prompts/ingest/skills/sync/`
ships with a `reference/` siblings directory and a sprinkling of
`<!-- append:{section-id} -->` markers (in SKILL.md AND every
`reference/*.md` file). Per-plugin specialisation lives in
`plugins/{slug}/skills/{slug}/_overrides/` and is applied at build time
by `scripts/render-skill.mjs`. (The canonical parent directory is still
named `sync/` because it's internal-only; rendered output is named after
the plugin slug so the host exposes it as `/{slug}` and the skill's
`name:` matches the slug.)

Three override mechanisms compose together:

1. **Placeholder substitution.** `_overrides/frontmatter.yaml` carries
   the per-plugin substitution map (one key per `{{...}}` placeholder
   used by canonical, plus any plugin-specific extras). The renderer
   walks every `*.md` under canonical and applies `{{key}}` →
   `substitutionMap[key]`. Surviving placeholders fail the build.

2. **Section-targeted append.** Canonical SKILL.md and every
   `reference/*.md` carry `<!-- append:{section-id} -->` markers at the
   end of step bodies (e.g., `<!-- append:step-2 -->`). When
   `_overrides/{section-id}-append.md` exists (e.g.,
   `_overrides/step-2-append.md`), its body is spliced in immediately
   before the marker line; the marker is then stripped. If no override
   file exists for a marker, the marker is stripped silently.

3. **Reference wholesale-replace.** Canonical
   `reference/{name}.md` is the baseline; if
   `_overrides/reference/{name}.md` exists, the renderer copies the
   override (with substitution applied) instead of the canonical. Use
   this for source-specific files that share zero prose with canonical
   (Step 5 fetch logic, runbook taxonomy, deep-link URL families).

Per-plugin extra references (slack's `canvas-payload.md`, gmail's
`email-context.md` / `denylist.md`) are written directly under
`_overrides/reference/` and copied through verbatim — the renderer
treats them additively.

### Optional user-initiated view lane (opt-in, default off)

The canonical router is binary by default — `sync` (ingest) and `ask`
(read-only live query). A plugin that ships a **user-initiated view**
(one the user opens conversationally, not from an action item — e.g.
agntux-google-calendar's "find a time to meet") opts into a third lane
**purely additively**, with zero impact on read-only plugins. Three
append markers in the canonical surfaces are the opt-in points; a
read-only plugin ships no override files for them, so the markers strip
to empty and its rendered tree is byte-identical:

| Marker (in canonical) | Surface | Override file a plugin ships to opt in |
|---|---|---|
| `<!-- append:sub-commands -->` | `SKILL.md` Sub-commands table | `_overrides/sub-commands-append.md` — a router row for the lane |
| `<!-- append:argument-parsing -->` | `SKILL.md` Argument parsing | `_overrides/argument-parsing-append.md` — the keyword/intent branch |
| `<!-- append:ask-intent-redirect -->` | `reference/ask.md` (top) | `_overrides/ask-intent-redirect-append.md` — redirect when the live query is actually an action intent (read-only answer stays the default otherwise) |

The lane's procedural body is an **additive per-plugin reference**
(`_overrides/reference/{verb}.md`, e.g. `schedule.md`) with no canonical
counterpart — there is deliberately no canonical `act.md`/lane skeleton,
because every canonical `reference/*.md` renders into EVERY ingest plugin
(forcing a re-render of the read-only plugins). Keeping the lane body
per-plugin keeps the opt-in truly zero-collateral. The reference must
obey the one-level-deep rule (no markdown link to a sibling reference;
mention siblings by prose). The worked example is agntux-google-calendar
(`reference/schedule.md`); the authoring guidance is in agntux-build's
`draft-flow-author.md` §2b and `ui-handler-author.md` §2/§3.

The lint pass `pass8SkillRender` (in
`scripts/lint/lint-skill-render.ts`) enforces four invariants per
plugin: (1) no surviving `{{...}}` placeholders, (2) byte-identical
re-render reproducibility, (3) `SKILL.md` ≤500 lines / sibling `*.md`
under `reference/` ≤500 lines, (4) one-level-deep references (no
reference file links to another reference file — siblings are reached
by prose name, not by markdown link).

## Notes on the ui-handlers/_template.md

Per P9 §7 (superseding P5 §7): handler subagent files at `agents/ui-handlers/{name}.md`
are **metadata carriers only**. Their YAML frontmatter carries the operational manifest
(P9 §5 — `verb_phrases`, `view_tool`, `resource_uri`, `structured_content_schema`,
`follow_up_intents`, `degraded_states`). Their body is NOT used as a runtime subagent prompt.

UI rendering is performed by the stateless view tool on the plugin's local stdio MCP server.
The SKILL.md routes directly to the view tool (no intermediate subagent dispatch).

Sources without an actionable surface (e.g., a hypothetical `agntux-notes`) ship zero files in
`agents/ui-handlers/`. The template file `_template.md` is the generator's input; it is
NOT copied verbatim — the generator expands one concrete handler file per UI component.
