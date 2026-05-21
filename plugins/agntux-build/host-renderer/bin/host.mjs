#!/usr/bin/env node
// CLI entry for the agntux-build host renderer.
//
// Default mode is **headed**: the renderer starts the in-process server,
// loads the plugin's view-tool ESM module, then opens a real Chromium
// window via Playwright with the iframe rendered. The user clicks around;
// any `useAppsClient().callTool()` invocation from inside the iframe is
// intercepted and surfaced in the sidebar AND logged to stdout AND
// emitted over `/api/intercepts/stream` for the build skill to pick up.
//
// `--headless` keeps the server running but does NOT launch a browser —
// the test harness (`test-harness/bin/cli.mjs`) uses that mode and drives
// Playwright internally via the `/__test/render` endpoint.

import { startServer } from "../src/server.mjs";

function parseFlags(argv) {
  const out = {
    plugin: null,
    port: 0,
    headless: false,
    tool: null,
    args: null,
    fixturesDir: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plugin") out.plugin = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--headless") out.headless = true;
    else if (a === "--headed") out.headless = false;
    else if (a === "--tool") out.tool = argv[++i];
    else if (a === "--args") out.args = argv[++i];
    else if (a === "--fixtures-dir") out.fixturesDir = argv[++i];
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  return out;
}

function printHelp() {
  console.log(`agntux-build-host — in-plugin view-tool host renderer

USAGE
  node bin/host.mjs --plugin <plugin-root> [flags]

FLAGS
  --plugin <path>        Plugin root (required). Must contain
                         view-tool/dist/<slug>-view.js (build first
                         with \`npm run build\` inside view-tool/).
  --tool <name>          View-tool name to auto-render in headed mode
                         (e.g. \`agntux_slack_compose_view\`). Required
                         unless --headless.
  --args <json>          JSON object to pass to the view-tool handler.
                         Defaults to {}.
  --fixtures-dir <path>  Override where ctx.fs reads from. Defaults to
                         <plugin>/examples/ then <plugin>/__tests__/fixtures/.
  --port <N>             TCP port. 0 = OS-assigned (default).
  --headless             Start the server only; don't launch a browser.
                         The test harness uses this mode.
  --headed               Default. Launch headed Chromium via Playwright.

EXAMPLES
  # Headed (default) — open Chromium with agntux-slack's compose iframe.
  node bin/host.mjs --plugin ../agntux-slack --tool agntux_slack_compose_view

  # Headless — server only, for the test harness.
  node bin/host.mjs --plugin ../agntux-slack --headless

  # Pass fixture args explicitly.
  node bin/host.mjs --plugin ../agntux-slack \\
    --tool agntux_slack_compose_view \\
    --args '{"action_id":"01HXYZ..."}'
`);
}

const flags = parseFlags(process.argv);
if (!flags.plugin) {
  console.error("--plugin <path> is required");
  printHelp();
  process.exit(2);
}
if (!flags.headless && !flags.tool) {
  console.error(
    "--tool <name> is required in headed mode. Pass --headless to start the server without a browser.",
  );
  printHelp();
  process.exit(2);
}

let server;
try {
  server = await startServer({
    pluginRoot: flags.plugin,
    port: flags.port,
    fixturesDir: flags.fixturesDir ?? undefined,
  });
} catch (e) {
  console.error(`[host] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

const baseUrl = `http://localhost:${server.port}`;
console.log(
  JSON.stringify({
    port: server.port,
    pluginSlug: server.pluginSlug,
    fixturesRoot: server.fixturesRoot,
    hostUrl: `${baseUrl}/host.html`,
    interceptsStreamUrl: `${baseUrl}/api/intercepts/stream`,
  }),
);

let browser = null;
let context = null;

// Declared BEFORE the headed branch wires the `browser.on("disconnected")`
// handler — `const` is not hoisted, and the disconnected listener can fire
// synchronously during browser teardown if Chromium dies mid-launch.
async function shutdown(signal) {
  console.error(`\n[host] received ${signal}, shutting down`);
  try {
    if (context) await context.close();
  } catch {
    // ignore
  }
  try {
    if (browser) await browser.close();
  } catch {
    // ignore
  }
  await server.shutdown();
  process.exit(0);
}

if (!flags.headless) {
  // Lazy-import playwright so --headless doesn't pay for Chromium load.
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext({
    viewport: { width: 900, height: 750 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const argsJson = flags.args ?? "{}";
  const url = `${baseUrl}/host.html?tool=${encodeURIComponent(
    flags.tool,
  )}&args=${encodeURIComponent(argsJson)}&argsExplicit=${
    flags.args ? "1" : "0"
  }&autorun=1`;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  console.error(`[host] headed Chromium open at ${url}`);
  console.error(
    `[host] click around the iframe; mutation calls land in /api/intercept-tool-call`,
  );
  console.error(`[host] Ctrl-C to stop the server and close Chromium`);

  // Forward browser console messages to stderr so the user can see them.
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`[chromium ${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.error(`[chromium pageerror] ${err.message}`);
  });

  // If the user closes the Chromium window, shut everything down.
  browser.on("disconnected", () => {
    void shutdown("browser-closed");
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
