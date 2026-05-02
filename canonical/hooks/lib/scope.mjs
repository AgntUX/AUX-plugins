// AgntUX-scope filter for the PreToolUse hook. Reads the host's stdin
// envelope ({ tool_name, tool_input, ... }) and decides whether the call
// targets AgntUX-owned data or AgntUX-owned MCP tools. Out-of-scope calls
// pass through with exit 0 — keeps the hook from breaking the user's
// unrelated work in other projects when the AgntUX licence is invalid.

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { AGNTUX_PLUGIN_SLUGS as IMPORTED_SLUGS } from "./agntux-plugins.mjs";
import { resolveAgntuxRoot } from "./agntux-root.mjs";

// Resolved once at module load (P2 §4.11.1 — the hook spawns one process per
// tool call so module-load = invocation start; process.cwd() can't change
// underneath us). Trailing separator ensures `~/agntux2/` does NOT match
// `~/agntux/`. The override mechanism below lets tests redirect this without
// touching the filesystem.
const RESOLVED_ROOT = resolveAgntuxRoot();
const RESOLVED_ROOT_WITH_SEP = RESOLVED_ROOT ? RESOLVED_ROOT + sep : null;

let AGNTUX_ROOT_OVERRIDE = null;
let STDIN_OVERRIDE = null;
let SLUGS_OVERRIDE = null;

export function _setAgntuxRootForTesting(path) {
  AGNTUX_ROOT_OVERRIDE = path === null ? null : (resolve(path) + sep);
}

export function _setStdinForTesting(text) {
  STDIN_OVERRIDE = text;
}

// Lets tests substitute the slug list (the shipped `agntux-plugins.mjs` is
// a T13 placeholder). Pass null to restore the imported value.
export function _setPluginSlugsForTesting(slugs) {
  SLUGS_OVERRIDE = slugs;
}

function agntuxRoot() {
  return AGNTUX_ROOT_OVERRIDE || RESOLVED_ROOT_WITH_SEP;
}

function slugs() {
  return SLUGS_OVERRIDE !== null ? SLUGS_OVERRIDE : IMPORTED_SLUGS;
}

export function readToolContext() {
  if (STDIN_OVERRIDE !== null) {
    if (STDIN_OVERRIDE === "") return { tool_name: null, tool_input: null };
    try { return JSON.parse(STDIN_OVERRIDE); }
    catch { return { tool_name: null, tool_input: null }; }
  }
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    return { tool_name: null, tool_input: null };
  }
  if (!stdin || stdin.length === 0) return { tool_name: null, tool_input: null };
  try {
    return JSON.parse(stdin);
  } catch {
    return { tool_name: null, tool_input: null };
  }
}

// Returns true if the tool call is in AgntUX scope (license check should run),
// false if the call is unrelated to AgntUX (allow without consulting cache).
//
// Three cases:
//   (a) mcp__{slug}__* where slug is in AGNTUX_PLUGIN_SLUGS  -> in-scope
//   (b) Read/Write/Edit/Glob/Grep with a path under the AgntUX project root
//       (the nearest ancestor named `agntux`, falling back to `~/agntux`)
//       -> in-scope
//   (c) Anything else                                         -> out-of-scope
export function isAgntuxScoped(ctx) {
  if (!ctx || typeof ctx !== "object") {
    // No context: be conservative. Treat as in-scope so the license check
    // runs (fail safe rather than fail open).
    return true;
  }
  const name = ctx.tool_name;
  if (typeof name !== "string" || name.length === 0) {
    return true; // conservative
  }

  // RULE 1: Filesystem tools — in-scope only when targeting the AgntUX
  // project root (nearest ancestor named `agntux`, fallback `~/agntux`).
  // Hooks.json matcher restricts to Write|Edit so Read|Glob|Grep is DORMANT
  // under the current bundle (the hook never fires for those tools). Kept
  // here so a future hooks.json matcher widening doesn't require a scope.mjs
  // edit; the byte-frozen-bundle CI in T13 will catch any divergence.
  if (name === "Write" || name === "Edit" || name === "Read" || name === "Glob" || name === "Grep") {
    const fp = ctx.tool_input && typeof ctx.tool_input.file_path === "string"
      ? ctx.tool_input.file_path
      : (ctx.tool_input && typeof ctx.tool_input.path === "string"
        ? ctx.tool_input.path
        : null);
    if (typeof fp !== "string" || fp.length === 0) return false;
    let abs;
    try { abs = resolve(fp); } catch { return false; }
    const root = agntuxRoot();
    if (!root) return false; // no project root resolved → silent passthrough
    return (abs + sep).startsWith(root);
  }

  // RULE 2: MCP tools — in-scope only for AgntUX plugin slugs.
  // Format per master plan: mcp__{plugin-slug}__{tool}.
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const idx = rest.indexOf("__");
    const slug = idx >= 0 ? rest.slice(0, idx) : rest;
    if (slug.length === 0) return false;
    return slugs().includes(slug);
  }

  // RULE 3: Anything else (shouldn't hit the matcher, but defensively).
  return false;
}
