/**
 * lint-view-tool-connector-calls.ts — pass 17: a view-tool component must not
 * call a host / connector tool by a hard-coded name via `client.callTool(…)`.
 * Connector writes go through `client.sendFollowUpMessage(envelope)` so the
 * host's LLM resolves the connector tool itself.
 *
 * Why this exists
 * ---------------
 * Connector tool names are HOST-SPECIFIC: in local agent mode they are
 * UUID-prefixed (`mcp__6c79477b-…__create_event`), on claude.ai they are
 * `mcp__claude_ai_Google_Calendar__create_event`. A component that hard-codes
 * any single form (the agntux-google-calendar 2026-06 bug shipped
 * `mcp__claude_ai_GoogleCalendar__create_event`) throws at click time:
 *
 *   MCP error -32602: Tool not found: mcp__claude_ai_GoogleCalendar__create_event
 *
 * The canonical write-back path (connector-envelopes.md; agntux-slack /
 * agntux-gmail) is to build a natural-language connector-targeted envelope and
 * dispatch it via `client.sendFollowUpMessage(envelope)` — the host's LLM reads
 * it and runs the connector tool, resolving whatever name that host uses. The
 * only tools a component may call directly are the plugin's OWN action-mutation
 * server tools, namespaced `mcp__agntux…` (e.g. `mcp__agntux-core__agntux_core_set_status`).
 *
 * Findings
 * --------
 *   E32 (error) — a view-tool component calls `callTool("mcp__…")` with a
 *     hard-coded non-`agntux` (connector) tool name. Replace with
 *     `client.sendFollowUpMessage(envelope)`.
 *
 * Scope
 * -----
 *   - Any plugin with a `view-tool/src/` directory; recurses components,
 *     excluding `lib/`, `__tests__/`, test utilities, `*.d.ts`.
 *   - Comment-scrubbed, string-preserving (the tool name we match is a string
 *     literal), newline-preserving (for exact line numbers). So a tool name
 *     mentioned only in a `//` comment does not trip the lint.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  plugin: string;
  file: string;
  line?: number;
  col?: number;
  message: string;
}

const VIEW_TOOL_SRC_REL = "view-tool/src";

// `client.callTool("mcp__<ns>__…")` where <ns> is NOT `agntux…`. The plugin's
// own action-mutation server tools (`mcp__agntux-core__…`) are allowed; every
// other hard-coded `mcp__…` literal is a host-specific connector name.
const CONNECTOR_CALLTOOL = /\.callTool\s*\(\s*(['"`])mcp__(?!agntux)/;

/** Strip comments, preserve string contents + newlines (see pass 16). */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  let inStr: string | null = null;
  while (i < len) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (c === "\\") {
        out += c + (next ?? "");
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < len && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function isExcluded(relFromSrc: string): boolean {
  const parts = relFromSrc.split(path.sep);
  if (parts.includes("lib")) return true;
  if (parts.includes("__tests__")) return true;
  if (parts.some((p) => p === "test-utils")) return true;
  const base = parts[parts.length - 1];
  if (base.endsWith(".d.ts")) return true;
  if (base === "setup.ts") return true;
  return false;
}

function collectSources(dir: string, srcRoot: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectSources(abs, srcRoot, acc);
      continue;
    }
    if (!e.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const relFromSrc = path.relative(srcRoot, abs);
    if (isExcluded(relFromSrc)) continue;
    acc.push(abs);
  }
}

export function pass17ViewToolConnectorCalls(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const srcDir = path.join(pluginDir, VIEW_TOOL_SRC_REL);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return;

  const files: string[] = [];
  collectSources(srcDir, srcDir, files);
  files.sort();

  for (const abs of files) {
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = stripComments(body).split("\n");
    const relFile = path.join(VIEW_TOOL_SRC_REL, path.relative(srcDir, abs));
    for (let li = 0; li < lines.length; li++) {
      const m = CONNECTOR_CALLTOOL.exec(lines[li]);
      if (m) {
        findings.push({
          code: "E32",
          severity: "error",
          plugin: pluginSlug,
          file: relFile,
          line: li + 1,
          col: (m.index ?? 0) + 1,
          message:
            `Direct client.callTool("mcp__…") to a host/connector tool by a ` +
            `hard-coded name. Connector tool names are host-specific ` +
            `(UUID-prefixed in local agent mode, mcp__claude_ai_<Connector>__… ` +
            `on claude.ai), so a literal name throws "Tool not found" at click ` +
            `time. Dispatch connector writes via ` +
            `client.sendFollowUpMessage(envelope) — the host's LLM resolves the ` +
            `connector tool itself (see ` +
            `plugins/agntux-build/canonical/prompts/ui/connector-envelopes.md and ` +
            `plugins/agntux-build/agents/draft-flow-author.md). Only the plugin's ` +
            `own action-mutation server tools (mcp__agntux…) may be called directly.`,
        });
      }
    }
  }
}
