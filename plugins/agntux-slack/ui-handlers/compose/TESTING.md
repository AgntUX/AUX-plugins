# Testing the compose UI handler

## Prerequisites

1. **MCPJam Inspector** running locally. Start the agntux-slack MCP server
   in HTTP_MODE from the repo root:
   ```sh
   node scripts/build-plugin.mjs agntux-slack --serve
   # …or equivalently:
   #   cd plugins/agntux-slack && npm run dev
   #   /dev-plugin agntux-slack
   ```
   The script builds both UI handler components, embeds them into the
   mcp-server, runs `check:bundle-sync`, then launches HTTP_MODE on port
   `5180`. Open MCPJam Inspector and connect to `http://127.0.0.1:5180/mcp`.

2. **plugin-toolkit-test harness** installed:
   ```sh
   # From the agntux-plugin-dev root
   npm install
   # Verify
   plugin-toolkit-test --version
   ```

3. **Playwright Chromium** installed (used by the harness):
   ```sh
   npx playwright install chromium
   ```

4. **Component built** — a fresh `out/index.html` must exist before running
   e2e tests. The build orchestrator (`scripts/build-plugin.mjs agntux-slack`,
   per step 1) handles this for you. If you only want to rebuild without
   launching the server, use:
   ```sh
   npm --prefix plugins/agntux-slack run build
   ```

## Run

### Single fixture (interactive):
```sh
cd plugins/agntux-slack/ui-handlers/compose/component
npm run test:e2e
# Runs against fixtures/compose-draft-happy.json
```

### All fixtures:
```sh
for f in ../fixtures/*.json; do
  name=$(basename "$f" .json)
  plugin-toolkit-test render --plugin ../../.. --tool compose_view \
    --fixture "$f" --out "test-results/$name/"
done
```

### CI gate (no MCPJam required):
```sh
npm run test:e2e:check
```

## Iterate

After each screenshot:
1. Check `test-results/*/render.png` for visual regressions.
2. Check `test-results/*/results.json` for `success: true` and empty `consoleErrors`.
3. If stuck on loading spinner: rebuild component + rebuild mcp-server, retry.
4. If `consoleErrors` non-empty: inspect the error, fix the component, rebuild.

## Pass/fail criteria

- `success: true` in all results.json
- `consoleErrors: []` (no console errors during render)
- Primary action button visible and clickable for all happy-path fixtures
- Error state testids present for `compose-error-action-not-found.json`
- No `min-h-screen`, `h-screen`, `100vh`, or `100dvh` in the rendered HTML

## Fixtures

| File | Scenario |
|---|---|
| `compose-draft-happy.json` | Full happy path — draft mode, thread context, personalization signals |
| `compose-schedule-happy.json` | Schedule mode with proposed_send_time pre-filled |
| `compose-save-draft-happy.json` | Save as Slack draft mode, single message |
| `compose-dm-no-replies.json` | DM channel, no replies — lock icon in header |
| `compose-error-action-not-found.json` | action_not_found structured error branch |
