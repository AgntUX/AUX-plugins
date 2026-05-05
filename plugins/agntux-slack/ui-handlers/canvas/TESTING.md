# Testing the canvas UI handler

## Prerequisites

Same as compose: MCPJam Inspector, plugin-toolkit-test, Playwright Chromium.

```sh
cd plugins/agntux-slack/mcp-server
HTTP_MODE=1 PORT=5180 node dist/index.js
```

## Build

```sh
cd plugins/agntux-slack/ui-handlers/canvas/component
npm install && npm run build
cd ../../mcp-server && npm run build
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
