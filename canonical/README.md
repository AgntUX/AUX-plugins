# canonical/ — Source of Truth for Plugin Templates

This directory is the **single source of truth** for the bytes that the plugin
generator copies into every generated plugin. Nothing in here is runtime code
for this repo — it is template material that flows downstream into
`plugins/*/`.

---

## Directory map

```
canonical/
├── hooks/                     # Optional schema/index hooks (NOT byte-frozen)
│   ├── hooks.json             # Empty by default
│   └── lib/
│       └── agntux-root.mjs    # AgntUX project-root resolver (shared)
├── prompts/
│   ├── orchestrator/          # agntux-core prompt templates
│   └── ingest/                # Per-source ingest prompt templates
└── mcp-server-templates/
    ├── orchestrator/          # agntux-core MCP server TS source
    └── ingest/                # Per-source ingest MCP server TS template
```

License enforcement now lives in `packages/mcp-license/` and is wrapped around
each plugin's MCP server `tools/call` handler. `resources/read` passes through
ungated — see `packages/mcp-license/README.md` for the rationale (concurrency
race on first-pair creation + ReadResourceResult / CallToolResult envelope
shape mismatch). Hooks are plugin-author-defined and only do schema/index
validation.

---

## Ownership table

| Subdirectory | Change process |
|---|---|
| `hooks/` | PR + reviewer (no byte-freeze) |
| `prompts/orchestrator/` | PR + linter must pass |
| `prompts/ingest/` | PR + linter must pass |
| `mcp-server-templates/` | PR + manual review (MCP protocol surface) |

---

## prompts/ — Change process

Prompt templates in `prompts/orchestrator/` and `prompts/ingest/` are copied
verbatim (with placeholder substitution) by the generator. Changes affect every
plugin generated after the change.

Placeholders use `{{double-curly}}` format. See each subdirectory's `STUBS.md`
for the full placeholder inventory.

---

## mcp-server-templates/ — Change process

MCP server TypeScript templates in `mcp-server-templates/` are copied and
compiled by the generator. Manual review required because MCP server changes
can break the tool-call protocol between the UI and the host.
