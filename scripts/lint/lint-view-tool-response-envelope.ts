/**
 * lint-view-tool-response-envelope.ts — pass 14: every plugin shipping a
 * `view-tool/` directory MUST emit a `content[].text` block alongside
 * `structuredContent` on every handler return.
 *
 * Why this exists
 * ---------------
 * In production (Claude Cowork, 2026-05-18) we observed a recurring
 * post-render regression: after `/agntux triage` fired its view tool and
 * the host rendered the iframe, the model also (a) built a duplicate
 * HTML widget via the host's `visualize` tool and (b) wrote 5 paragraphs
 * of commentary summarizing the iframe the user could already see. The
 * model's reasoning in the screenshot:
 *
 *   > "The tool returned JSON data rather than a rendered widget, so
 *   >  I'll use the visualize tool to display this triage view properly."
 *
 * Root cause: the handler returned only `structuredContent`, so the
 * model never received an explicit signal that the host had materialized
 * the iframe — the JSON blob looked like raw data awaiting downstream
 * processing.
 *
 * The fix is to add a `content[].text` block to every handler return,
 * authored via `renderConfirmationText(uiLabel)` from
 * `@agntux/plugin-runtime`, that explains the MCP Apps lifecycle
 * (what just happened, where the data went, why the turn is complete).
 * Pass 14 makes that fix structurally hard to back out of: any
 * `view-tool/src/*-view.ts` that compiles without a `renderConfirmationText(`
 * call somewhere in it trips this lint.
 *
 * Findings
 * --------
 *
 *   E29 (warning) — view-tool source is missing the canonical
 *     `renderConfirmationText(` call.
 *
 *     The check is intentionally loose at the "is the envelope wired
 *     up at all" end — we look for the function-call substring in the
 *     `*-view.ts` source. We do not parse the AST and verify every
 *     return statement individually; that's the job of the per-plugin
 *     `__tests__/payload-shape.test.ts` "response envelope" describe
 *     block (which asserts on `content[0].text` containing the frozen
 *     anchor strings `"iframe"`, `"host"`, `"MCP App"`).
 *
 *     Severity is warning (not error) for the initial rollout so
 *     existing plugins ship before the migration. Promote to error
 *     once all three production plugins (agntux-core, agntux-slack,
 *     agntux-gmail) land the fix.
 *
 * Scope
 * -----
 *   - Runs against any plugin with a `view-tool/src/` directory.
 *   - Scans every top-level `*-view.ts` source under `view-tool/src/`
 *     (matches the actual convention — `agntux-core-view.ts`,
 *     `agntux-slack-view.ts`, `agntux-gmail-view.ts`).
 *   - Skips plugins without a `view-tool/src/` entirely.
 *   - The canonical _template under
 *     `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/`
 *     is NOT linted (it's not a real plugin's view-tool; the
 *     placeholder filenames would fail validation anyway).
 *
 * Convention coupling
 * -------------------
 *   This pass and pass 11 (payload-shape) both depend on the
 *   `view-tool/src/` directory shape. If a plugin ever reorganizes the
 *   layout, both passes go silent for that plugin and the regressions
 *   they guard against go un-checked. Keep the two passes' directory
 *   constants aligned and add a third "expected layout" lint pass if
 *   the convention changes.
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
// The literal function-call substring we require to appear in every
// view-tool source file. Match either the bare call or the call after
// an `import { ..., renderConfirmationText, ... }` line — `import`
// statements contain `renderConfirmationText` but not the open paren,
// so the open paren is the differentiator that proves the function is
// actually invoked, not just imported.
const ENVELOPE_CALL_PATTERN = /\brenderConfirmationText\s*\(/;

// Best-effort comment + string-literal scrubber so a call mentioned
// only inside a `// …` line comment, a `/* … */` block comment, or a
// `"…"` / `'…'` / template-literal string doesn't satisfy pass 14.
// Naive on purpose — we're not parsing TypeScript, just stripping the
// commonest false-positive surfaces. Real escape-handling for embedded
// quotes is out of scope; the payload-shape test's anchor-string
// assertions remain the load-bearing guard.
function scrubCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    const next = src[i + 1];
    // Line comment
    if (c === "/" && next === "/") {
      while (i < len && src[i] !== "\n") i++;
      continue;
    }
    // Block comment
    if (c === "/" && next === "*") {
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // String / template literal
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < len) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function pass14ViewToolResponseEnvelope(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const srcDir = path.join(pluginDir, VIEW_TOOL_SRC_REL);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    // No view-tool/src — pass 14 has nothing to check.
    return;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(srcDir);
  } catch (err) {
    findings.push({
      code: "E29",
      severity: "warning",
      plugin: pluginSlug,
      file: VIEW_TOOL_SRC_REL,
      message:
        `Could not read ${VIEW_TOOL_SRC_REL}: ${(err as Error).message}`,
    });
    return;
  }

  const viewFiles = entries.filter(
    (e) => e.endsWith("-view.ts") && !e.endsWith(".d.ts"),
  );
  if (viewFiles.length === 0) {
    // Layout drift — plugin ships view-tool/src/ but no *-view.ts
    // entry. Pass 11 / 13 will surface the more obvious symptoms;
    // staying silent here avoids a duplicate finding.
    return;
  }

  for (const file of viewFiles) {
    const abs = path.join(srcDir, file);
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch (err) {
      findings.push({
        code: "E29",
        severity: "warning",
        plugin: pluginSlug,
        file: path.join(VIEW_TOOL_SRC_REL, file),
        message:
          `Could not read ${file}: ${(err as Error).message}`,
      });
      continue;
    }

    const scrubbed = scrubCommentsAndStrings(body);
    if (!ENVELOPE_CALL_PATTERN.test(scrubbed)) {
      findings.push({
        code: "E29",
        severity: "warning",
        plugin: pluginSlug,
        file: path.join(VIEW_TOOL_SRC_REL, file),
        message:
          `${file} does not call renderConfirmationText(…). Every view-tool ` +
          `handler return — success AND error branches — must ship a ` +
          `content[] block built from renderConfirmationText(uiLabel) ` +
          `imported from @agntux/plugin-runtime. Without it, the model ` +
          `sees only the structuredContent JSON blob, mistakes it for ` +
          `"raw data I need to render somehow", and goes on to build a ` +
          `duplicate widget via the host's visualize tool plus chat ` +
          `commentary summarizing the iframe the user can already see. ` +
          `See the canonical template at ` +
          `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/` +
          `src/__ui-name__-view.ts and the response-envelope rule in ` +
          `plugins/agntux-build/agents/ui-handler-author.md §3.1.`,
      });
    }
  }
}
