#!/usr/bin/env node
// agntux-build-test — headless UI test runner for AgntUX plugins.
//
// Spawns the in-plugin host-renderer, POSTs to /__test/render with the
// requested tool + args, and writes the resulting screenshot + console
// log + structuredContent to disk. No MCPJam needed.

import { resolve } from "node:path";
import { parseFlags, required, parseIntFlag } from "../src/parse-flags.mjs";
import { runRender } from "../src/render.mjs";

const HELP = `agntux-build-test — headless UI test runner

USAGE
  agntux-build-test <subcommand> [flags]

SUBCOMMANDS
  render      Spawn the in-plugin host renderer, render the requested
              tool, capture screenshot + console + structuredContent.

RENDER FLAGS
  --plugin <path>      Plugin root (required).
                       Must contain mcp-server/dist/index.js.
  --tool <name>        View tool to invoke (required).
  --args <json>        Tool args as a JSON string. Default: '{}'.
  --out <dir>          Output dir for screenshot + metadata. Default ./test-results.
  --timeout <ms>       Render timeout. Default 60000.
  --host-bin <path>    Override path to host-renderer/bin/host.mjs.
                       Default: resolved relative to the harness location.

EXIT
  0   render succeeded, no console errors
  1   render failed (timeout, errors, tool error)
  2   bad CLI args
`;

async function main(argv) {
  const sub = argv[2];
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return 0;
  }

  if (sub !== "render") {
    console.error(`unknown subcommand: ${sub}\n`);
    console.error(HELP);
    return 2;
  }

  let flags;
  try {
    flags = parseFlags(argv.slice(3));
  } catch (e) {
    console.error(`error: ${e.message}\n`);
    console.error(HELP);
    return 2;
  }

  if (flags.help) {
    console.log(HELP);
    return 0;
  }

  let pluginPath, toolName;
  try {
    pluginPath = resolve(required(flags, "plugin"));
    toolName = required(flags, "tool");
  } catch (e) {
    console.error(`error: ${e.message}\n`);
    console.error(HELP);
    return 2;
  }

  let toolArgs = {};
  if (flags.args) {
    try {
      toolArgs = JSON.parse(flags.args);
    } catch (e) {
      console.error(`error: --args is not valid JSON: ${e.message}`);
      return 2;
    }
  }

  const outDir = flags.out ?? "./test-results";
  const timeoutMs = parseIntFlag(flags.timeout, "timeout", 60_000);
  const hostBin = flags.hostBin;

  try {
    const summary = await runRender({
      pluginRoot: pluginPath,
      toolName,
      args: toolArgs,
      outDir,
      timeoutMs,
      hostBin,
    });

    const status = summary.passed ? "PASS" : "FAIL";
    console.log(
      `[${status}] ${toolName}  state=${summary.renderState}  ` +
        `consoleErrors=${summary.consoleErrorsCount}  ` +
        `→ ${summary.screenshotPath}`,
    );
    if (summary.toolError) {
      console.log(`tool error: ${summary.toolError}`);
    }

    return summary.passed ? 0 : 1;
  } catch (e) {
    console.error(`render failed: ${e.message}`);
    return 1;
  }
}

main(process.argv).then(
  (code) => process.exit(code),
  (e) => {
    console.error("uncaught:", e);
    process.exit(1);
  },
);
