# Testing the canvas UI handler

## Prerequisites

Same as compose: MCPJam Inspector, plugin-toolkit-test, Playwright Chromium.

Start the agntux-slack MCP server in HTTP_MODE from the repo root:

```sh
node scripts/build-plugin.mjs agntux-slack --serve
# …or `cd plugins/agntux-slack && npm run dev`, or `/dev-plugin agntux-slack`.
```

That single command builds both UI handler components (compose and
canvas), embeds them into the mcp-server, runs `check:bundle-sync`, and
launches HTTP_MODE on `127.0.0.1:5180`. Open MCPJam Inspector and connect
to `http://127.0.0.1:5180/mcp`.

## Build (without launching the server)

```sh
npm --prefix plugins/agntux-slack run build
```

## Run

```sh
cd plugins/agntux-slack/ui-handlers/canvas/component
npm run test:e2e
# Runs against fixtures/canvas-with-thread.json
```

## Fixtures

| File | Scenario |
|---|---|
| `canvas-with-thread.json` | Full happy path — 3 decisions, 2 open questions, 4 participants |
| `canvas-error-action-not-found.json` | action_not_found structured error branch |

## Pass/fail criteria

- `success: true` in all results.json
- `consoleErrors: []`
- Canvas card visible in edit mode for happy-path fixture
- Preview tab switches to canvas-preview
- Error state testid present for error fixture
