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
      __ui-name__-view.ts       # ViewTool descriptor + handler
      __ui-name__-ui.tsx        # React iframe entry (Vite-bundled into HTML)
    __ui-name__.html            # HTML entry Vite resolves to a real
                                # <!doctype html> bundle. See CLAUDE.md
                                # lint pass 10 (E23) for the rationale.
    scripts/
      emit-manifest.mjs         # Emits view-tools.manifest.json
    __tests__/
      payload-shape.test.ts     # Required regression guard — asserts a
                                # byte-budget + frozen key-set on the
                                # structuredContent. Marketplace linter
                                # pass 11 (E24/E25) checks for it.
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
  fixtures/__ui-name__-*.json
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

**`{{view-tool-description}}` shape.** Author the verb-phrase + trigger
list ONLY — do NOT include the stop-after-rendering directive. The
template's `__ui-name__-view.ts` automatically appends the canonical
"Once this UI is rendered, the user sees everything they need in the
iframe — do NOT add any chat commentary after rendering, and do NOT
make any further tool calls; the UI is the response." suffix to every
descriptor, so authors don't double it up. If your view tool dispatches
to a connector that ships its own MCP App UI (Slack, Gmail, Linear,
etc.), additionally extend `{{view-tool-description}}` with a sentence
instructing the host not to re-render this view AND not to render the
connector's native UI after the connector call returns (see the
`agntux_slack_compose_view` description for the canonical phrasing).

**Filename placeholder convention.** File **contents** use `{{ui-name}}`
(and the other `{{…}}` placeholders above). On-disk **filenames** in the
template tree use `__ui-name__` instead — `{` and `}` are rejected by
Claude Desktop's plugin-zip upload validator, so the template ships the
filesystem-safe variant. The scaffolder substitutes BOTH spellings to the
real value when copying templates into a new plugin (e.g.
`__ui-name__-view.ts` → `compose-view.ts`, and `{{ui-name}}` inside the
file → `compose`).

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
