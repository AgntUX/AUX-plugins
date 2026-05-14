# Testing the {{ui-display-name}} view-tool

This template ships under the **view-only plugin shape** (master plan Phase 5):
source plugins ship one compiled view-tool ESM module
(`view-tool/dist/{{plugin-slug-kebab}}-view.js`) loaded server-side by the
remote MCP server. There is no local `mcp-server/` and no `.mcp.json`.

## Local iteration loop

The Phase 7 harness `plugin-toolkit-test render-view-tool` is the canonical
loop once it ships. Until then, the manual loop is:

```bash
# 1. Build the view-tool subtree.
cd plugins/{{plugin-slug-kebab}}/view-tool && npm run build

# 2. Inspect the emitted manifest.
cat dist/view-tools.manifest.json | jq

# 3. Open the rendered iframe HTML directly.
open dist/ui-resources/{{ui-name}}.html
```

## Component tests

Component unit tests live under `component/src/__tests__/`. Run them with:

```bash
npm run test -w plugins/{{plugin-slug-kebab}}
```

## Fixtures

`fixtures.json` and `fixtures/{{ui-name}}-*.json` carry inputs the Phase 7
render-view-tool harness consumes. Author them so the harness can render
every interesting payload shape (single, multi, empty, error envelope).
