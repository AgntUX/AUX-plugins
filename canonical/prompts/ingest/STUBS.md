# Ingest Prompt Templates — Placeholder Registry

This directory contains the canonical prompt templates for per-source ingest plugins.
P6's plugin generator copies these verbatim (with placeholder substitution) when generating
any ingest plugin (`gmail-ingest`, `slack-ingest`, `notes-ingest`, etc.).

## Delivered by T16/T17/T19/T20

| File | Status |
|---|---|
| `skills/orchestrator.md` | T19 — delivered |
| `agents/ingest.md` | T19 — delivered |
| `agents/ui-handlers/_template.md` | T20 — delivered |

## Placeholder registry

All placeholders use `{{double-curly}}` format. P6 substitutes these from a per-source
spec JSON/YAML at generation time. Single-curly tokens like `{ref}`, `{text}`, `{ids}` are
runtime/host-filled — NOT P6-substituted.

### Shared across all ingest plugin templates

| Placeholder | Example (notes-ingest) | Example (slack-ingest) | Source |
|---|---|---|---|
| `{{plugin-slug}}` | `notes-ingest` | `slack-ingest` | manifest `name` field |
| `{{plugin-version}}` | `1.0.0` | `1.0.0` | manifest `version` field |
| `{{source-display-name}}` | `Apple Notes` | `Slack` | per-source spec |
| `{{source-slug}}` | `notes` | `slack` | per-source spec; matches `# {{source-slug}}` heading in `.state/sync.md` |
| `{{recommended-cadence}}` | `Daily 09:00` | `Hourly` | manifest `recommended_ingest_cadence` field |
| `{{source-cursor-semantics}}` | `local-file modification time (RFC 3339)` | `message timestamp (Unix float, e.g. 1714043640.001200)` | per-source spec |
| `{{source-mcp-tools}}` | `the local filesystem MCP server (read-only access to the notes directory)` | `mcp__slack__list_channels, mcp__slack__get_thread, mcp__slack__list_messages` | per-source spec |
| `{{ui-handler-trigger-list}}` | `(this plugin ships no UI components — Lane B is unused)` | `- "display the slack thread UI for {ref}" → call mcp__slack-ingest-ui__thread_view` | per-source spec; one bullet per view tool, or the literal no-UI string |

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

## Notes on the ui-handlers/_template.md

Per P9 §7 (superseding P5 §7): handler subagent files at `agents/ui-handlers/{name}.md`
are **metadata carriers only**. Their YAML frontmatter carries the operational manifest
(P9 §5 — `verb_phrases`, `view_tool`, `resource_uri`, `structured_content_schema`,
`follow_up_intents`, `degraded_states`). Their body is NOT used as a runtime subagent prompt.

UI rendering is performed by the stateless view tool on the plugin's local stdio MCP server.
The SKILL.md routes directly to the view tool (no intermediate subagent dispatch).

Sources without an actionable surface (e.g., `notes-ingest`) ship zero files in
`agents/ui-handlers/`. The template file `_template.md` is the generator's input; it is
NOT copied verbatim — the generator expands one concrete handler file per UI component.
