# `test-harness/` — agntux-build-test CLI

Headless UI test runner for AgntUX plugins. Drives the in-plugin
[`host-renderer`](../host-renderer/) under Playwright; returns
screenshot + console errors + structuredContent. **No MCPJam
Inspector required** — that's the whole point.

Used by stage 8 (headless test) of the `/agntux-build:build` flow.

## How it differs from the legacy `plugin-toolkit-test`

The previous harness (in `agntux-plugin-dev/plugins/plugin-toolkit/
test-harness/`) drove a locally-running MCPJam Inspector instance.
That worked great for plugin developers but was a non-starter for
knowledge workers — "open another terminal, run MCPJam, navigate to
:5173" was friction the contributor flow couldn't carry.

This harness replaces MCPJam with the lightweight in-plugin
host-renderer. The shape of the output is the same so the rest of
the flow (CI scripts, vitest assertions) doesn't change.

## Usage

```
agntux-build-test render \
  --plugin /path/to/agntux-{slug} \
  --tool {tool-name}_view \
  --args '{"action_id":"foo"}' \
  --out test-results/
```

What happens:

1. Spawns `node host-renderer/bin/host.mjs --plugin <plugin> --headless`.
2. Reads the host's listening port from its stdout JSON line.
3. POSTs to `http://localhost:{port}/__test/render` with
   `{ toolName, args }`.
4. Receives `{ passed, screenshot, consoleErrors, structuredContent }`.
5. Writes the screenshot to `out/{tool-name}.png` and the metadata
   to `out/{tool-name}.json`.
6. Prints a one-line summary.
7. Tears the host down.

Exit codes:
- `0` — render succeeded, no console errors.
- `1` — render failed (timeout, console errors, tool error).
- `2` — bad CLI args.

## Flags

```
--plugin <path>     Plugin root containing view-tool/dist/<slug>-view.js (required)
--tool <name>       Tool name to render (required)
--args <json>       Tool args as JSON string. Default: {}
--out <dir>         Result dir. Default: ./test-results
--timeout <ms>      Render timeout. Default: 60000
```

## Smoke test

```
agntux-build-test render --plugin ../agntux-slack --tool agntux_slack_compose_view
```

Should produce `test-results/agntux_slack_compose_view.png` with the
inline reply composer rendered against an empty fixture.
