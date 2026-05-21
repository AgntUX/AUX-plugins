#!/usr/bin/env node
// agntux-build-test — headless UI test runner for AgntUX plugins.
//
// Spawns the in-plugin host-renderer, POSTs to /__test/render with the
// requested tool + args, and writes the resulting screenshot + console
// log + structuredContent to disk. No MCPJam needed.

import { resolve } from "node:path";
import { parseFlags, required, parseIntFlag } from "../src/parse-flags.mjs";
import { runRender } from "../src/render.mjs";
import { probeChromium } from "../src/probe-chromium.mjs";
import { resolveHarnessArgs } from "../src/load-fixture.mjs";

const HELP = `agntux-build-test — headless UI test runner

USAGE
  agntux-build-test <subcommand> [flags]

SUBCOMMANDS
  render            Spawn the in-plugin host renderer, render the requested
                    tool, capture screenshot + console + structuredContent.
  probe-chromium    Report whether Playwright's Chromium binary is installed.
                    Prints a JSON object: { installed, executablePath?,
                    reason? }. Exits 0 if installed, 1 otherwise.

RENDER FLAGS
  --plugin <path>      Plugin root (required).
                       Must contain view-tool/dist/<slug>-view.js.
  --tool <name>        View tool to invoke (required).
  --args <json>        Tool args as a JSON string. Wins over --fixture.
  --fixture <ref>      Path or bare name of a fixture JSON file. Bare names
                       resolve under <plugin>/ui-handlers/<handler>/fixtures/,
                       where <handler> is the tool name with a trailing
                       _view or -view suffix stripped (e.g. tool
                       compose_view -> handler compose). Tools without
                       that suffix use the tool name verbatim. The file
                       must have an "args" object at the root.
  --out <dir>          Output dir for screenshot + metadata. Default ./test-results.
  --timeout <ms>       Render timeout. Default 60000.
  --host-bin <path>    Override path to host-renderer/bin/host.mjs.
                       Default: resolved relative to the harness location.

  Args precedence: --args > --fixture > nearest fixtures.json next to the
  handler dir > {}. With no override the harness auto-loads
  <plugin>/ui-handlers/<handler>/fixtures.json (if it exists), so empty-args
  runs render the component DOM rather than the not_found DegradedState.

EXIT
  0   render succeeded, no console errors
        OR  probe-chromium found the binary
  1   render failed (timeout, errors, tool error)
        OR  probe-chromium did not find the binary
  2   bad CLI args
`;

async function main(argv) {
  const sub = argv[2];
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return 0;
  }

  if (sub === "probe-chromium") {
    const result = await probeChromium();
    console.log(JSON.stringify(result));
    return result.installed ? 0 : 1;
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
  let argsSource = "default ({})";
  let argsExplicit = false;
  try {
    const resolved = resolveHarnessArgs({
      pluginRoot: pluginPath,
      toolName,
      fixtureArg: flags.fixture,
      argsJson: flags.args,
    });
    if (resolved) {
      toolArgs = resolved.args;
      argsSource = resolved.source;
      // A successfully-applied fixture / --args sets argsExplicit so the
      // empty-args hint doesn't fire. A fallback from a broken
      // auto-discovered fixture (warning present, source labelled
      // "default (...)") leaves argsExplicit=false so the hint can still
      // alert the operator that no real args reached the tool.
      if (resolved.warning) {
        console.warn(`warning: ${resolved.warning}`);
      } else {
        argsExplicit = true;
      }
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }

  const outDir = flags.out ?? "./test-results";
  const timeoutMs = parseIntFlag(flags.timeout, "timeout", 60_000);
  const hostBin = flags.hostBin;

  try {
    const summary = await runRender({
      pluginRoot: pluginPath,
      toolName,
      args: toolArgs,
      argsExplicit,
      outDir,
      timeoutMs,
      hostBin,
    });

    const cc = summary.contentChecks;
    const ccPassed = cc?.passed?.length ?? 0;
    const ccFailed = cc?.failed?.length ?? 0;
    const ccSkipped = cc?.skipped?.length ?? 0;
    const status = summary.passed ? "PASS" : "FAIL";
    console.log(
      `[${status}] ${toolName}  state=${summary.renderState}  ` +
        `consoleErrors=${summary.consoleErrorsCount}  ` +
        `content=${ccPassed}p/${ccFailed}f/${ccSkipped}s  ` +
        `args=${argsSource}  ` +
        `→ ${summary.screenshotPath}`,
    );
    if (summary.toolError) {
      console.log(`tool error: ${summary.toolError}`);
    }
    if (summary.emptyArgsHint) {
      console.log(`hint: ${summary.emptyArgsHint}`);
    }
    if (ccFailed > 0) {
      for (const f of cc.failed) {
        const rule = f.rule ?? {};
        const desc = rule.source ?? (rule.verb ? `verb:${rule.verb}` : "structural");
        const locator = rule.locator ?? "n/a";
        const reason = f.reason ?? "expected " + JSON.stringify(f.expected ?? null);
        console.log(`  content FAIL [${desc} via ${locator}]: ${reason}`);
      }
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
