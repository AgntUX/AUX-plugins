# Ingest MCP Server Template — Placeholder Registry

This directory contains the TypeScript source template for per-source ingest plugins'
local stdio MCP server. Only plugins that ship UI components include this server; sources
without an actionable surface (e.g., `agntux-notes`) omit it entirely (P5 §7.5).

## Delivered by T20

| File | Status |
|---|---|
| `package.json` | T20 — delivered |
| `tsconfig.json` | T20 — delivered |
| `vitest.config.ts` | T20 — delivered |
| `src/index.ts` | T20 — delivered |
| `src/ui-resources.ts` | T20 — delivered |
| `src/s3-fetch.ts` | T20 — delivered |
| `src/csp.ts` | T20 — delivered |
| `src/tools/_view-tool-template.ts` | T20 — delivered |
| `skill-fragments/send-actions.template.md` | T20 — delivered |
| `__tests__/csp.test.ts` | T20 — delivered |
| `__tests__/s3-fetch.test.ts` | T20 — delivered |
| `__tests__/ui-resources.test.ts` | T20 — delivered |
| `__tests__/view-tool-guard.test.ts` | T20 — delivered |

## Placeholder registry

All placeholders use `{{double-curly}}` format. P6 substitutes these from a per-source
spec JSON/YAML at generation time.

### Shared across all MCP server template files

| Placeholder | Example (agntux-slack) | Source |
|---|---|---|
| `{{plugin-slug}}` | `agntux-slack` | manifest `name` field; used in Server name ("{{plugin-slug}}-ui"), CACHE_DIR sub-path, and SKILL.md routing |
| `{{plugin-version}}` | `1.0.0` | manifest `version` field; used in Server version |
| `{{source-display-name}}` | `Slack` | per-source spec; used in tool descriptions |
| `{{source-slug}}` | `slack` | per-source spec; used in s3-fetch PLUGIN_SLUG default |
| `{{AGNTUX_APP_ID}}` | Per-plugin app ID from AgntUX backend | `.mcp.json` env block; used as S3 path segment in dev fallback |

### Per UI component (expanded once per component by P6)

| Placeholder | Example (slack thread component) | Source |
|---|---|---|
| `{{ui-name}}` | `thread` | per-source spec; used in view-tool name (`thread_view`), resource URI (`ui://thread`), and S3 path (`thread/index.html`) |
| `{{ui-resource-entries}}` | `"ui://thread": "thread/index.html",` | one entry per UI component; generator expands the `UI_PATHS` map in `ui-resources.ts` |
| `{{structured-content-field-1}}` | `thread_messages` | per-source spec; top-level field in structuredContent |
| `{{structured-content-field-2}}` | `thread_members` | per-source spec; secondary field |
| `{{structured-content-field-3}}` | `proposed_reply` | per-source spec; orchestrator-authored slot |

## Architecture notes

### s3-fetch.ts — per-plugin URL resolution

The ingest MCP server prefers the per-plugin entry in `signed_ui_base_urls` (map keyed by
plugin slug) over the flat `signed_ui_base_url` (orchestrator-only MVP shape). Both fields
live in the same `~/.agntux/.license` cache (P5 §6.3 / P5.AMEND.1). Source plugins do NOT
maintain their own license file.

### ui-resources.ts — license attachment

Every `resources/read` response attaches `_meta.license` from `readRenderTokenFromLicense()`
per P2a §4 / P5.AMEND.1. Missing or malformed license → `license` key omitted → iframe gate
fails closed with reason "missing". Never throws.

### tools/_view-tool-template.ts — constraints

View tools are stateless. The T23 linter (and `view-tool-guard.test.ts`) enforce:
- NO `mcp__<third-party>__*` references (only `mcp__{{plugin-slug}}__*` allowed).
- NO `fs.writeFile` / `fs.appendFile`.
- NO `fetch()` / `https.request` / network calls.

### LRU cache params

Identical to the orchestrator template (P5 §7.4 / P4 §6.7):
- `CACHE_MAX = 100`
- `CACHE_TTL_MS = 5 * 60 * 1000` (5 minutes)
- Cache directory: `~/.agntux/.ui-cache/{{plugin-slug}}/` (keyed per plugin slug)

### skill-fragments/send-actions.template.md

Generic "Send actions" prose for SKILL.md inclusion. Uses Slack reply-to-thread as the
canonical worked example (P9 §8.3). Copy into the plugin's `skills/orchestrator.md` under
a `## Send actions` section; substitute `{{plugin-slug}}`, `{{source-display-name}}`, etc.

The send-actions pattern applies to any plugin that ships UI components with state-mutating
buttons. Plugins with no UI components (no Send buttons) omit this section.
