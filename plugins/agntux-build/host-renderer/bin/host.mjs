#!/usr/bin/env node
// CLI entry for the agntux-build host renderer.

import { startServer } from "../src/server.mjs";

function parseFlags(argv) {
  const out = { plugin: null, port: 0, headless: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plugin") out.plugin = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--headless") out.headless = true;
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
  console.log(`agntux-build-host — in-plugin MCP App host renderer

USAGE
  node bin/host.mjs --plugin <plugin-root> [--port N] [--headless]

FLAGS
  --plugin <path>   Plugin root (required). Must contain mcp-server/dist/index.js.
  --port <N>        TCP port. 0 = OS-assigned (default).
  --headless        Skip serving host.html in the browser; only expose
                    the /__test/render endpoint for the test harness.

EXAMPLES
  # Foreground / dev — open http://localhost:8080/host.html?tool=...&args=...
  node bin/host.mjs --plugin ../agntux-linear --port 8080

  # Headless — print port for the harness to call /__test/render
  node bin/host.mjs --plugin ../agntux-linear --headless
`);
}

const flags = parseFlags(process.argv);
if (!flags.plugin) {
  console.error("--plugin <path> is required");
  printHelp();
  process.exit(2);
}

const server = await startServer({
  pluginRoot: flags.plugin,
  port: flags.port,
  headless: flags.headless,
});

console.log(JSON.stringify({ port: server.port, pluginMcpUrl: server.pluginMcpUrl }));

const shutdown = async (signal) => {
  console.error(`\n[host] received ${signal}, shutting down`);
  await server.shutdown();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
