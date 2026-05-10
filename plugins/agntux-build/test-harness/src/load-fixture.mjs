// Resolve the args object the harness should pass to the view tool when the
// caller didn't supply --args.
//
// Precedence:
//   1. explicit --args JSON   (handled by the CLI; not this module)
//   2. explicit --fixture <path|name>   (handled here, branch A)
//   3. nearest fixtures.json next to the handler dir   (branch B)
//   4. fall back to {} and let the view tool's not_found branch fire
//
// Why this exists: empty args trip the view tool's required-id validation,
// which returns structuredContent.error === "not_found". The component
// then renders its DegradedState — useful for testing that branch on
// purpose, but a noisy false negative when the harness is just trying to
// confirm the bundle renders. A per-handler `fixtures.json` gives the
// harness a known-passing args shape to default to.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export function loadFixtureFile(absPath) {
  if (!existsSync(absPath)) {
    throw new Error(`fixture file not found: ${absPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absPath, "utf-8"));
  } catch (e) {
    throw new Error(`fixture file is not valid JSON: ${absPath} (${e.message})`);
  }
  if (!parsed || typeof parsed !== "object" || !parsed.args) {
    throw new Error(
      `fixture file ${absPath} must have an "args" object at the root (got ${JSON.stringify(Object.keys(parsed ?? {}))})`,
    );
  }
  return { args: parsed.args, source: absPath };
}

// Tool names follow the canonical convention `<handler>_view`. Strip a
// trailing `_view` (or `-view`) to recover the handler dir name. If neither
// suffix is present, fall back to the tool name itself.
export function handlerFromToolName(toolName) {
  if (!toolName) return null;
  return toolName.replace(/[-_]view$/i, "");
}

// Resolve a fixture argument that may be either an absolute path, a path
// relative to cwd, or a bare name (e.g. "single-high"). For bare names we
// look in the handler's fixtures/ subdirectory.
export function resolveFixturePath({ pluginRoot, toolName, fixtureArg }) {
  if (!fixtureArg) return null;
  if (isAbsolute(fixtureArg)) return fixtureArg;
  if (fixtureArg.includes("/") || fixtureArg.endsWith(".json")) {
    return resolve(fixtureArg);
  }
  // Bare name. Try `<plugin>/ui-handlers/<handler>/fixtures/<handler>-<name>.json`
  // (canonical template shape) then plain `<name>.json`. Bare names depend on
  // both `pluginRoot` and a handler-shaped `toolName` to resolve; if either is
  // missing the lookup is ambiguous and we fail loudly rather than silently
  // resolve against cwd.
  const handler = handlerFromToolName(toolName);
  if (!pluginRoot || !handler) {
    throw new Error(
      `--fixture "${fixtureArg}" is a bare name but ${
        !pluginRoot ? "pluginRoot" : "toolName"
      } is missing — use a path with a slash or a .json suffix, or pass --plugin/--tool.`,
    );
  }
  const handlerDir = join(pluginRoot, "ui-handlers", handler, "fixtures");
  const stamped = join(handlerDir, `${handler}-${fixtureArg}.json`);
  if (existsSync(stamped)) return stamped;
  const plain = join(handlerDir, `${fixtureArg}.json`);
  if (existsSync(plain)) return plain;
  throw new Error(
    `--fixture "${fixtureArg}" not found under ${handlerDir} (looked for ${handler}-${fixtureArg}.json and ${fixtureArg}.json)`,
  );
}

// Auto-discover a fixtures.json next to the handler dir. Returns the
// absolute path or null if nothing matches.
export function discoverDefaultFixture({ pluginRoot, toolName }) {
  if (!pluginRoot || !toolName) return null;
  const handler = handlerFromToolName(toolName);
  if (!handler) return null;
  const candidate = join(pluginRoot, "ui-handlers", handler, "fixtures.json");
  return existsSync(candidate) ? candidate : null;
}

// Top-level resolver used by cli.mjs. Returns { args, source, warning? }
// or null when no fixture was applied (caller should default to {}).
//
// Failure-mode policy:
//   - Explicit --args / --fixture failures throw — the caller asked for
//     something specific and we can't silently substitute.
//   - Auto-discovery failures (malformed nearest fixtures.json) fall back
//     to "no fixture" with a warning attached, because the contributor
//     didn't ask for it. A broken on-disk fixture must not block a render.
export function resolveHarnessArgs({
  pluginRoot,
  toolName,
  fixtureArg,
  argsJson,
}) {
  if (argsJson !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(argsJson);
    } catch (e) {
      throw new Error(`--args is not valid JSON: ${e.message}`);
    }
    return { args: parsed, source: "--args" };
  }
  if (fixtureArg) {
    const path = resolveFixturePath({ pluginRoot, toolName, fixtureArg });
    return loadFixtureFile(path);
  }
  const auto = discoverDefaultFixture({ pluginRoot, toolName });
  if (auto) {
    try {
      return loadFixtureFile(auto);
    } catch (e) {
      // Auto-discovered fixture is broken. Fall back rather than crash —
      // the contributor never asked for this file. Surface the reason as
      // a warning the CLI prints next to the args-source line.
      return {
        args: {},
        source: "default ({} — auto fixture invalid)",
        warning: `auto-discovered fixture ${auto} is invalid: ${e.message}`,
      };
    }
  }
  return null;
}
