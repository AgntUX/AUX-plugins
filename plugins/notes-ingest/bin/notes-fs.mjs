#!/usr/bin/env node
// Wrapper for the @modelcontextprotocol/server-filesystem MCP server.
// Resolves the AgntUX project root at startup and forwards `<root>/notes` as
// the served directory. Cross-platform: no `~`, no `${HOME}` expansion required.
//
// Resolution: nearest ancestor of process.cwd() named `agntux`
// (case-insensitive), falling back to <home>/agntux. If neither resolves to a
// real directory, the wrapper still passes the fallback string path so the
// upstream server emits a clear "directory does not exist" error rather than
// a silent no-op.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { statSync } from "node:fs";

const AGNTUX = "agntux";

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function resolveRoot(cwd) {
  let dir;
  try { dir = resolve(cwd ?? process.cwd()); } catch { return join(homedir(), AGNTUX); }
  while (true) {
    if (basename(dir).toLowerCase() === AGNTUX && isDir(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(homedir(), AGNTUX);
}

const notesDir = join(resolveRoot(), "notes");
const child = spawn(
  "npx",
  ["-y", "@modelcontextprotocol/server-filesystem", notesDir],
  { stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 0));
