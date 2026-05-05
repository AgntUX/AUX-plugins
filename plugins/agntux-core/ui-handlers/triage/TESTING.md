# Triage UI — local E2E testing

End-to-end testing for the triage component runs through
`plugin-toolkit-test`, a Playwright-driven harness that drives a locally
running MCPJam Inspector with the plugin's MCP server in HTTP mode.

## Prerequisites

1. **MCPJam Inspector** running locally. Start it once in a separate
   terminal:
   ```sh
   ENVIRONMENT=dev AGNTUX_MODE=true npm --prefix /path/to/MCPJam-inspector run dev
   ```
   The harness defaults to `http://127.0.0.1:5173`. Override with
   `MCPJAM_URL=...` or `--inspector-url`.

2. **Playwright Chromium**. From the plugin-toolkit checkout:
   ```sh
   cd /path/to/agntux-plugin-dev/plugins/plugin-toolkit/test-harness
   npm install
   npx playwright install chromium
   ```

3. **Build both layers** before every test run:
   ```sh
   # Component → out/index.html
   (cd component && npm install && npm run build) &
   # MCP server → dist/index.js (and re-embeds the bundle)
   (cd ../../mcp-server && npm install && npm run build && npm run check:bundle-sync) &
   wait
   ```

## Run

From `ui-handlers/triage/component/`:

```sh
# Single golden fixture
npm run test:e2e

# All fixtures, one results subdir per fixture
npm run test:e2e:all

# CI-safe — validates inputs without contacting MCPJam
npm run test:e2e:check
```

Outputs land in `test-results/` (or `test-results/{fixture-name}/` for
the `:all` sweep): `render.png` + `results.json`.

## Iterate

```sh
# 1. Render with the session kept alive
plugin-toolkit-test render --plugin ../../.. --tool triage_view \
  --fixture ../fixtures/triage-single-high.json --keep-session

# 2. Discover testids
plugin-toolkit-test interact --action query --selector '[data-testid]'

# 3. Drive the dismiss button
plugin-toolkit-test interact --action click --selector '[data-testid="dismiss-btn"]'

# 4. Capture post-action state
plugin-toolkit-test screenshot --out test-results/after-dismiss.png

# 5. Verify the badge change
plugin-toolkit-test interact --action read_text --selector '[data-testid="status-badge"]'

# 6. Tear down
plugin-toolkit-test cleanup
```

## Fixtures

| File | Scenario |
|---|---|
| `fixtures/triage-empty.json` | No actions — empty-state rendering. |
| `fixtures/triage-single-high.json` | One high-priority action — dismiss flow + status badge update. |
| `fixtures/triage-many.json` | Wide scope, many rows — internal scroll + row-count assertion. |
| `fixtures/triage-error-payload.json` | Invalid `scope` arg — component must render an error/empty state without throwing. |

## Pass/fail rules

- `results.json.success` must be `true` (means `mcpAppRendered: true`
  AND `consoleErrors` is empty).
- `mcpjamErrors` is allowed (HTTP 500/409, hydration warnings — known
  MCPJam infra noise).
- `consoleErrors` is **never** allowed — every entry is a component bug.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not reach MCPJam Inspector` | Start MCPJam (see prerequisites). |
| `MCP server didn't expose /health` | Rebuild `mcp-server/`; the HTTP_MODE branch is in `mcp-server/src/index.ts`. |
| `playwright is not installed` | `cd plugin-toolkit/test-harness && npm install && npx playwright install chromium`. |
| Screenshot looks stale | Re-run both build steps; `npm run check:bundle-sync` from `mcp-server/` flags drift. |
