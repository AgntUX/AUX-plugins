# `host-renderer/` — in-plugin headless MCP App host

Lightweight host that renders a plugin's UI handler under Playwright
without requiring MCPJam Inspector to be running. Used by stage 8
(headless test) of the `/agntux-build:build` flow.

## Why this exists

The original AgntUX plugin testing flow assumed a developer had MCPJam
Inspector running locally on `:5173`. That's a non-starter for
knowledge workers — "open this terminal, install this app, run this
thing" is a five-step request before the user has even seen their
plugin work. The strategy doc explicitly names "frictionless submit
flow" as the toolkit's load-bearing investment.

This host is **forked from
[`modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps)
`examples/basic-host`** (MIT-licensed). The fork keeps the
spec-canonical UI initialization, sandbox-proxy CSP builder, and
AppBridge wiring; it adds:

1. **Headless mode (`--headless`)** — skips serving the host page on
   port 8080; instead exposes an internal Playwright-driven endpoint
   `POST /__test/render`.
2. **Plugin-aware MCP bridge** (`src/mcp-bridge.mjs`) — spawns the
   plugin's MCP server in HTTP mode (`HTTP_MODE=1 PORT=…`) and routes
   tool calls through it. Reuses the spawn pattern from the legacy
   `plugin-toolkit/test-harness`.
3. **AgntUX `hostContext` defaults** — light theme, inline display
   mode, 600px maxHeight, AgntUX timezone/locale defaults. Matches
   what the production AgntUX host advertises so widgets render the
   same in the test loop as in production.

## Why a fork (not a wrapper)

`basic-host`'s protocol implementation IS the spec. Wrapping it as a
dependency would couple us to its ESM/CJS layout and version pace.
Forking with attribution keeps us spec-compliant by construction and
lets us add headless mode + AgntUX hostContext without upstream
churn. See `NOTICE` for the MIT attribution.

## Why client-side stays hand-rolled

The `App` class in `@modelcontextprotocol/ext-apps` ships Zod, which
JIT-compiles via `eval` and breaks strict CSP. Continue the existing
AUX pattern: hand-rolled `SimpleMcpApp` (~250 LoC, no Zod) for
component-side communication. Server-side helpers from `ext-apps` are
eval-free and we use them as-is via the plugin's MCP server.

## Layout

```
host-renderer/
├── README.md                  this file
├── NOTICE                     MIT attribution to basic-host
├── package.json               express + cors + playwright + sdk
├── bin/
│   └── host.mjs               CLI entry — spawns the host (with or without --headless)
├── public/
│   ├── host.html              host shell — loads sandbox iframe, drives one render
│   ├── sandbox.html           sandbox-proxy that injects the inner iframe with CSP
│   └── host-bridge.mjs        client-side bridge (no Zod) speaking the AppBridge protocol
└── src/
    ├── server.mjs             Express setup — host page, sandbox page, /__test/render
    ├── mcp-bridge.mjs         spawn plugin MCP server, list tools, call tool
    ├── playwright-driver.mjs  Chromium → load host page → wait for tool-result → screenshot+logs
    └── csp.mjs                CSP header builder (lifted verbatim from basic-host)
```

## Usage

### Foreground / dev mode (developer-facing)

```
node bin/host.mjs --plugin /path/to/agntux-{slug} --port 8080
```

Then open `http://localhost:8080/host.html?tool={tool-name}&args={url-encoded-json}`.

### Headless mode (used by the test harness)

```
node bin/host.mjs --plugin /path/to/agntux-{slug} --headless
```

Listens on a random port. The CLI prints the port. The test harness
calls `POST http://localhost:{port}/__test/render` with
`{ toolName, args }` and gets back
`{ screenshot, logs, consoleErrors, structuredContent }`.

The headless flow is what stage 8 uses. The dev mode is rarely needed
in the contributor flow but is useful for debugging during plugin
authoring.
