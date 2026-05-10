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

## Where the protocol layer lives

| Layer | Implementation | Why |
|---|---|---|
| **Component side** (inside the production iframe) | hand-rolled `SimpleMcpApp` (~250 LoC, no Zod) | Production hosts (Cowork, Claude Desktop, MCPJam) ship strict CSP that forbids `unsafe-eval`. The canonical SDK's Zod runtime JIT-compiles via `eval`. The component bundle has to load on those hosts. |
| **Host side of this dev harness** (the page Playwright drives) | canonical `AppBridge` + `PostMessageTransport` from `@modelcontextprotocol/ext-apps@1.7.x`, bundled into `public/host-bridge.mjs` by `scripts/bundle-host-bridge.mjs` at install time | This page only runs locally under Playwright. There is no CSP constraint on it, and ext-apps@1.7.x ships in jitless Zod mode anyway. Hand-rolling here is the way protocol drift sneaks in — the previous attempt had five separate divergences (method-name namespacing, missing `jsonrpc` field, missing `ui/initialize` handshake, wrong tool-result method, sandbox.html one-way pipe) that all silently stalled the inner React app. |

`public/host-bridge.mjs` is a build artifact. The source is
`src/host-bridge-entry.mjs`; `npm install` (via `prepare`) regenerates
the bundle. Don't hand-edit `public/host-bridge.mjs` — your edit will
be overwritten on the next install.

### Critical ordering invariant

`src/host-bridge-entry.mjs` must call `bridge.connect(transport)`
BEFORE setting `iframe.src` on the sandbox-proxy iframe. If the
ordering is reversed, `sandbox.html` boots and sends
`ui/notifications/sandbox-proxy-ready` before the bridge has attached
its `window.message` listener, the bridge never sees it, the inner
React app's `ui/initialize` request hits a deaf host, and the protocol
stalls forever (the symptom is `state` never advancing past `loading`).
This is the same hazard the canonical `AppBridge` documents under
"connect-before-srcdoc" — see the entry-file's header comment for the
full ordering checklist.

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
│   └── host-bridge.mjs        BUILD ARTIFACT — bundled from src/host-bridge-entry.mjs
│                              by scripts/bundle-host-bridge.mjs (do not hand-edit)
├── scripts/
│   └── bundle-host-bridge.mjs esbuild driver that produces public/host-bridge.mjs
└── src/
    ├── server.mjs             Express setup — host page, sandbox page, /__test/render
    ├── mcp-bridge.mjs         spawn plugin MCP server, list tools, call tool
    ├── playwright-driver.mjs  Chromium → load host page → wait for tool-result → screenshot+logs
    ├── csp.mjs                CSP header builder (lifted verbatim from basic-host)
    └── host-bridge-entry.mjs  source for public/host-bridge.mjs — instantiates the
                               canonical AppBridge + PostMessageTransport
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
