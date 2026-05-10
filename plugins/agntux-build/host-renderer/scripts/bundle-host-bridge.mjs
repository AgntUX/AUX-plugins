#!/usr/bin/env node
// Bundle src/host-bridge-entry.mjs into public/host-bridge.mjs.
//
// host-bridge.mjs runs inside the host-page Chromium tab Playwright drives.
// It needs `@modelcontextprotocol/ext-apps`'s AppBridge + PostMessageTransport
// inlined because browsers can't resolve bare module specifiers without an
// import map, and we don't want to ship one. esbuild is the lightest tool
// that produces a single ESM file with everything resolved.
//
// Output is gitignored; the prepare/postinstall script regenerates it.
//
// Why bundle at install time rather than at server-start: the harness runs
// the host-renderer as a CLI (`bin/host.mjs`), and bundling at server-start
// would add a 200–400ms delay to every test run. Bundling once on install
// is free at runtime.

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

await build({
  entryPoints: [join(ROOT, "src/host-bridge-entry.mjs")],
  bundle: true,
  format: "esm",
  outfile: join(ROOT, "public/host-bridge.mjs"),
  platform: "browser",
  target: "es2022",
  minify: false,
  sourcemap: false,
  // Keep license headers from upstream (`@modelcontextprotocol/ext-apps`).
  legalComments: "inline",
  logLevel: "info",
});
