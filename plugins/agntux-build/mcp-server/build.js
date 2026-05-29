#!/usr/bin/env node
// build.js — produce mcp-server/dist/ (the shipped, host-launched artifact).
//
// The server is zero-dependency ESM, so "building" is a verbatim copy of
// src/*.js → dist/*.js (same .js extension in both trees, so the sibling
// import `./bootstrap-worker.js` and the runtime import `../../bin/
// validate-plugin.mjs` resolve identically whether run from src/ (dev) or
// dist/ (.mcp.json launches dist/index.js). No bundler: bundling
// validate-plugin.mjs would rebind its import.meta.url and break
// resolveToolchain(__dirname), and shipping a single file with the SDK inlined
// would add an eval-using dependency for no benefit (the server speaks JSON-RPC
// directly). dist/ is a TRACKED artifact — CI rebuilds it on push to main.

import { rmSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "src");
const distDir = join(__dirname, "dist");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

let n = 0;
for (const f of readdirSync(srcDir)) {
  if (!f.endsWith(".js")) continue;
  copyFileSync(join(srcDir, f), join(distDir, f));
  n++;
}

console.log(`agntux-build-mcp-server: built dist/ (${n} file(s)).`);
