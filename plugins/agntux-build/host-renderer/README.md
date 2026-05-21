# `host-renderer/` — in-plugin MCP App host

Lightweight host that renders a plugin's view-tool ESM module under
Playwright. Used by stages 6 (interactive preview) and 8 (regression
screenshot) of the `/agntux-build:build` flow.

## Why this exists

The original AgntUX plugin testing flow assumed a developer had MCPJam
Inspector running locally on `:5173`. That's a non-starter for
knowledge workers — "open this terminal, install this app, run this
thing" is a five-step request before the user has even seen their
plugin work. The strategy doc names "frictionless submit flow" as the
toolkit's load-bearing investment.

This host is **forked from
[`modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps)
`examples/basic-host`** (MIT-licensed). The fork keeps the
spec-canonical UI initialization, sandbox-proxy CSP builder, and
AppBridge wiring; it adds:

1. **In-process view-tool loading.** Source plugins are
   remote-view-only — they ship no local MCP server. The bridge
   dynamic-imports `view-tool/dist/<slug>-view.js`, builds a
   `ViewToolContext` via `@agntux/plugin-runtime`'s local-fs factory,
   and invokes handler functions directly. No child process; no HTTP
   listen on the plugin's behalf.
2. **Mutation tool interception (`POST /api/intercept-tool-call`).**
   Every iframe-originated `useAppsClient().callTool()` call lands
   here. The endpoint logs the payload to stdout, pushes it to an
   in-memory ring buffer, emits it on the SSE stream
   `GET /api/intercepts/stream`, and returns a stubbed success
   envelope. Mutation tools never execute against a real connector
   during iteration. (Source plugins can't be installed locally in
   Claude Cowork either — its local-stdio path is broken for view
   tools — so this is the only place mutation iteration happens.)
3. **Headed Playwright by default.** `bin/host.mjs --plugin <path>
   --tool <name>` launches a real Chromium window the user clicks in.
   `--headless` keeps the server running but skips the browser launch
   for the test harness (`test-harness/bin/cli.mjs`).
4. **AgntUX `hostContext` defaults** — light theme, inline display
   mode, 600px maxHeight, AgntUX timezone/locale defaults. Matches
   what the production AgntUX host advertises so widgets render the
   same in the test loop as in production.

## Why a fork (not a wrapper)

`basic-host`'s protocol implementation IS the spec. Wrapping it as a
dependency would couple us to its ESM/CJS layout and version pace.
Forking with attribution keeps us spec-compliant by construction and
lets us add the in-process loader + intercept layer without upstream
churn. See `NOTICE` for the MIT attribution.

## Where the protocol layer lives

| Layer | Implementation | Why |
|---|---|---|
| **Component side** (inside the production iframe) | hand-rolled `SimpleMcpApp` (~250 LoC, no Zod) | Production hosts (Cowork, Claude Desktop, MCPJam) ship strict CSP that forbids `unsafe-eval`. The canonical SDK's Zod runtime JIT-compiles via `eval`. The component bundle has to load on those hosts. |
| **Host side of this dev harness** (the page Playwright drives) | canonical `AppBridge` + `PostMessageTransport` from `@modelcontextprotocol/ext-apps@1.7.x`, bundled into `public/host-bridge.mjs` by `scripts/bundle-host-bridge.mjs` at install time | This page only runs locally under Playwright. There is no CSP constraint on it, and ext-apps@1.7.x ships in jitless Zod mode anyway. Hand-rolling here is the way protocol drift sneaks in. |

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

## Routes

| Route | Purpose |
|---|---|
| `GET /host.html` | The host shell with the iframe container and the intercept sidebar. |
| `GET /host-bridge.mjs` | The compiled host-bridge module loaded by `host.html`. |
| `GET /sandbox.html` | Sandbox-proxy frame with CSP built from the `?csp=` query param. |
| `POST /api/tool-call` | **Initial view render only.** Calls the read-only view-tool handler in-process via the loader, returns `{ toolResult, uiResource }`. |
| `POST /api/intercept-tool-call` | **Mutation tools.** Logs the payload, returns a stubbed success envelope. Does not execute. |
| `GET /api/intercepts/stream` | Server-sent-events stream of intercepted calls (used by the host page's sidebar AND the build skill). |
| `POST /__test/render` | Headless Playwright render with screenshot + console-error capture. The test harness uses this. |

## Layout

```
host-renderer/
├── README.md                  this file
├── NOTICE                     MIT attribution to basic-host
├── package.json               express + cors + playwright + plugin-runtime
├── bin/
│   └── host.mjs               CLI entry — starts the server, optionally
│                               launches headed Chromium
├── public/
│   ├── host.html              host shell — iframe + intercept sidebar
│   ├── sandbox.html           sandbox-proxy that injects the inner iframe with CSP
│   └── host-bridge.mjs        BUILD ARTIFACT — bundled from src/host-bridge-entry.mjs
│                              by scripts/bundle-host-bridge.mjs (do not hand-edit)
├── scripts/
│   └── bundle-host-bridge.mjs esbuild driver that produces public/host-bridge.mjs
└── src/
    ├── server.mjs             Express setup — initial-render endpoint,
    │                          intercept endpoint, SSE stream, /__test/render
    ├── mcp-bridge.mjs         loadViewToolModule — dynamic-imports the plugin's
    │                          compiled handler, builds a ctx, exposes
    │                          listTools/readResource/callTool
    ├── playwright-driver.mjs  Chromium → load host page → wait for tool-result → screenshot+logs
    ├── csp.mjs                CSP header builder (lifted verbatim from basic-host)
    └── host-bridge-entry.mjs  source for public/host-bridge.mjs — instantiates the
                               canonical AppBridge + PostMessageTransport
```

## Usage

### Headed mode (default — used by stage 6 interactive preview)

```
node bin/host.mjs --plugin /path/to/agntux-{slug} --tool {view-tool-name}
```

Starts the server and opens a Chromium window with the iframe
auto-rendered. Click around; mutation tool calls land in
`/api/intercept-tool-call` and surface in the sidebar.

`--args '<json>'` passes specific arguments to the view-tool handler.
`--fixtures-dir <path>` overrides where `ctx.fs` reads from (defaults
to `<plugin>/examples/` then `<plugin>/__tests__/fixtures/`).

### Headless mode (used by the test harness)

```
node bin/host.mjs --plugin /path/to/agntux-{slug} --headless
```

Listens on a random port. The CLI prints the port. The test harness
calls `POST http://localhost:{port}/__test/render` with
`{ toolName, args }` and gets back
`{ screenshot, logs, consoleErrors, structuredContent }`.

The headless flow is what stage 8's regression screenshot uses. Stage
6 uses headed mode for the interactive iteration loop.
