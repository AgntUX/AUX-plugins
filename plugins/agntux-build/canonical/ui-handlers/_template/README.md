# UI handler template (view-only shape)

This is the canonical scaffold for an AgntUX plugin UI handler under the
view-only shape (master plan Phase 5). Source plugins ship one compiled
view-tool ESM module loaded server-side by the remote MCP server — they
do NOT ship a local `mcp-server/` or `.mcp.json`.

## Layout

```
_template/
  view-tool/                    # NEW — compiled into the library module
    src/
      {{ui-name}}-view.ts       # ViewTool descriptor + handler
      ui-resource.tsx           # React iframe entry
    scripts/
      emit-manifest.mjs         # Emits view-tools.manifest.json
    package.json
    tsconfig.json
    vite.config.ts
  component/                    # Iframe bundle scaffold (apps-client/apps-react)
    src/
      App.tsx
      main.tsx
      components/
      lib/
        apps-client/            # MIT-inlined hooks (DO NOT MOVE)
        apps-react/             # MIT-inlined hooks (DO NOT MOVE)
    ...
  fixtures.json                 # Phase 7 render-view-tool harness inputs
  fixtures/{{ui-name}}-*.json
  TESTING.md
  README.md (this file)
```

## Placeholders the scaffolder substitutes

| Placeholder                    | Example                              |
|--------------------------------|--------------------------------------|
| `{{plugin-slug-kebab}}`        | `agntux-slack`                       |
| `{{plugin-slug-snake}}`        | `agntux_slack`                       |
| `{{ui-name}}`                  | `compose`                            |
| `{{ui-name-pascal}}`           | `Compose`                            |
| `{{ui-display-name}}`          | `Slack Compose`                      |
| `{{view-tool-name}}`           | `agntux_slack_compose_view`          |
| `{{view-tool-description}}`    | `Open the Slack compose modal…`      |

## Build pipeline

`npm run build` inside `view-tool/` chains:

1. `vite build` — emits `dist/ui-resources/{{ui-name}}.html` per entry in
   `vite.config.ts` (`vite-plugin-singlefile`, mandated by
   AUX-plugins/CLAUDE.md).
2. `tsc -p tsconfig.json` — emits `dist/*.d.ts` (no runtime JS).
3. `esbuild … --external:@agntux/plugin-runtime` — emits the single ESM
   handler module. `@agntux/plugin-runtime` is the ONLY externalized
   package.
4. `node scripts/emit-manifest.mjs` — emits and validates
   `dist/view-tools.manifest.json` against the Zod schema from
   `@agntux/plugin-runtime`.

## Multi-view plugins

Add additional `ViewTool` objects to the `viewTools` array in the SAME
`{{ui-name}}-view.ts` file and add additional entries to `vite.config.ts`'s
`rollupOptions.input`. The emitted module stays one file per plugin.
