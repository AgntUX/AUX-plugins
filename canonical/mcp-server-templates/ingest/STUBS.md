# TODO: Ingest MCP Server Template Stubs

**TO BE FILLED BY T19 / T20 (P5 ingest plugin template — MCP server source)**

This directory will contain the TypeScript source template for per-source ingest
plugins' local stdio MCP server. Only plugins that ship UI components include this
server; sources without an actionable surface (e.g., `notes-ingest`) omit it entirely
(P5 §7.5).

## Files T19/T20 will deliver

Per P5 §7.4 (local MCP server mirrors ux's pattern) and §6 (.mcp.json shape):

```
canonical/mcp-server-templates/ingest/
├── package.json           # devDependencies: @modelcontextprotocol/sdk, typescript
│                          # engines.node: >= 18
├── tsconfig.json          # ESM target, strict, outDir: dist/
├── src/
│   ├── index.ts           # MCP server entrypoint — Server, StdioServerTransport
│   │                      # Registers ui:// resources + view tools + send-action tools
│   │                      # (one view tool per UI component per P9 §4)
│   ├── ui-resources.ts    # Maps ui://{ui-name} → {ui-name}/index.html
│   │                      # attaches _meta.license (render_token) per P2a / P5.AMEND.1
│   │                      # (mirrors P4 §6.6; keyed on plugin slug not agntux-core)
│   ├── s3-fetch.ts        # Same pattern as orchestrator s3-fetch.ts (P4 §6.7)
│   │                      # reads per-plugin entry from signed_ui_base_urls map
│   │                      # exports readRenderTokenFromLicense() per P5.AMEND.1
│   ├── csp.ts             # CSP _meta builder — same constraints as orchestrator
│   └── tools/
│       └── _readme.md     # Placeholder: one {ui-name}_view.ts file per UI component
│                          # (view-tool architecture per P9 §4–§6, shipped by T19/T20)
│                          # send-action tools (send_thread_reply, send_email, etc.)
│                          # also live here — one file per source-side action
└── dist/                  # Built JS — committed to marketplace repo (not pre-committed here)
```

## Placeholder variables

| Placeholder | Example (slack-ingest) | Where |
|---|---|---|
| `{{plugin-slug}}` | `slack-ingest` | MCP server name in `.mcp.json`, S3 cache subdir |
| `{{AGNTUX_APP_ID}}` | Per-plugin app ID from AgntUX backend | `.mcp.json` env block |
| `{{ui-name}}` | `thread`, `channel-summary` | Per view tool file, per ui:// resource mapping |

The `{{ui-name}}` placeholder expands to one file per UI component the plugin ships.
Sources with no UI components omit this entire `mcp-server-templates/ingest/` tree.

## Relationship to P9

The view-tool protocol (tool naming convention `mcp__{{plugin-slug}}__{ui-name}_view`,
`structuredContent` schema, `_meta.ui.resourceUri` semantics, iframe gate) is
specified in P9 §4–§6. T19/T20 implement the protocol defined there.

## Do not add content here

Do not add source content to this directory until T19/T20 land. P6's generator
reads from this directory; placeholder content would be copied into production plugins.
