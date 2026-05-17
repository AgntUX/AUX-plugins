/**
 * lint-view-tool-payload-guard.ts — pass 11: every plugin that ships a
 * `view-tool/` directory MUST also ship a payload-shape regression-guard
 * test under `view-tool/__tests__/payload-shape.test.ts`.
 *
 * Why this exists: agntux-core 9.5.2 silently produced ~62 KB JSON-RPC
 * tool-result bodies for `triage_view`. The host rejected the result with
 * "result exceeds maximum allowed tokens" and the iframe failed to
 * render. The bundled MCP server caps and TypeScript types didn't catch
 * it because the bug only appears at full saturation (30 max-loaded rows)
 * and the constants individually look reasonable. The fix in 9.5.3 trims
 * the structuredContent shape to the fields the iframe actually consumes.
 *
 * Pass 11 makes the regression structurally hard to ship again: every
 * `view-tool/` ships a vitest file that:
 *   - Drives the view-tool against an in-memory `ViewToolContext`.
 *   - Synthesises a max-loaded fixture (long strings, max array sizes).
 *   - Asserts `Buffer.byteLength(JSON.stringify(structuredContent))`
 *     stays under a cap the plugin author picks (the canonical scaffold
 *     ships 30 KB; that's a defensible upper bound for a single-row
 *     view, list views should pick lower).
 *   - Asserts row keys exactly match the iframe's expected set so a
 *     future contributor can't silently re-add a dropped field.
 *
 * The check is intentionally structural — it doesn't run the test, it
 * just verifies the file exists and contains a size-assertion pattern.
 * Actual test execution stays with the plugin's `npm test` script and
 * CI's plugin-level vitest pass.
 *
 * Findings:
 *
 *   E24 (warning) — Missing payload-shape regression-guard test
 *     The plugin ships `view-tool/` but no
 *     `view-tool/__tests__/payload-shape.test.ts`. Severity is warning
 *     (not error) because (a) the agntux-core fix landed without
 *     proactively retro-fitting the test to agntux-slack and
 *     agntux-gmail, so promoting this to error would immediately fail
 *     existing-and-shipping plugins; (b) the bug it guards against is
 *     payload-size, which is a runtime symptom not a build-time one —
 *     a warning surfaces the gap on every PR without blocking work.
 *     Promote to error once every plugin under `plugins/` has the
 *     test file.
 *
 *   E25 (warning) — Payload-shape test exists but has no size assertion
 *     The file exists but contains none of the canonical
 *     byte-size-assertion patterns: `Buffer.byteLength(`,
 *     `JSON.stringify(`, or a `.toBeLessThan(` expression. Either the
 *     test was stubbed out and never finished, or the author wrote a
 *     shape-only test and skipped the size guard. Same warning rationale
 *     as E24 — surface, don't block.
 *
 * Scope:
 *   - Runs against any plugin with a `view-tool/` directory.
 *   - Skips plugins without view-tools entirely (e.g. plugin-toolkit
 *     and friends in other repos; this repo's agntux-build has no
 *     `view-tool/` of its own — only the canonical _template/view-tool/
 *     used for scaffolding).
 *   - The canonical _template under
 *     `plugins/agntux-build/canonical/ui-handlers/_template/view-tool/`
 *     is NOT linted (it's not a real plugin's view-tool, the placeholder
 *     filenames would fail validation anyway).
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

const TEST_REL_PATH = "view-tool/__tests__/payload-shape.test.ts";

// Any one of these substrings counts as a size assertion. The patterns
// are loose enough to match either a `Buffer.byteLength(JSON.stringify(...))`
// or a `.length` on a stringified payload, and either `.toBeLessThan(` or
// `.toBeLessThanOrEqual(` for the vitest matcher. Strict enough that a
// shape-only test with no size check (the failure mode we're catching)
// won't match.
const SIZE_ASSERTION_PATTERNS = [
  /Buffer\.byteLength\s*\(/,
  /JSON\.stringify\s*\(/,
];
const SIZE_MATCHER_PATTERNS = [
  /\.toBeLessThan\s*\(/,
  /\.toBeLessThanOrEqual\s*\(/,
];

export function pass11ViewToolPayloadGuard(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const viewToolDir = path.join(pluginDir, "view-tool");
  if (!fs.existsSync(viewToolDir) || !fs.statSync(viewToolDir).isDirectory()) {
    // Plugin doesn't ship a view-tool — nothing to guard.
    return;
  }

  const testPath = path.join(pluginDir, TEST_REL_PATH);
  if (!fs.existsSync(testPath)) {
    findings.push({
      code: "E24",
      severity: "warning",
      plugin: pluginSlug,
      file: TEST_REL_PATH,
      message:
        `Plugin ships view-tool/ but is missing the payload-shape ` +
        `regression-guard test at ${TEST_REL_PATH}. The canonical ` +
        `template at plugins/agntux-build/canonical/ui-handlers/_template/` +
        `view-tool/__tests__/payload-shape.test.ts is the scaffold to copy. ` +
        `See plugins/agntux-core/CHANGELOG.md → 9.5.3 for the bug class ` +
        `this test catches.`,
    });
    return;
  }

  let body: string;
  try {
    body = fs.readFileSync(testPath, "utf8");
  } catch (err) {
    findings.push({
      code: "E24",
      severity: "warning",
      plugin: pluginSlug,
      file: TEST_REL_PATH,
      message: `Could not read ${TEST_REL_PATH}: ${(err as Error).message}`,
    });
    return;
  }

  const hasSizeBuilder = SIZE_ASSERTION_PATTERNS.some((re) => re.test(body));
  const hasSizeMatcher = SIZE_MATCHER_PATTERNS.some((re) => re.test(body));
  if (!hasSizeBuilder || !hasSizeMatcher) {
    findings.push({
      code: "E25",
      severity: "warning",
      plugin: pluginSlug,
      file: TEST_REL_PATH,
      message:
        `${TEST_REL_PATH} exists but lacks a payload-size assertion. ` +
        `Expected to see both a byte-length builder (Buffer.byteLength or ` +
        `JSON.stringify) AND a less-than matcher (.toBeLessThan or ` +
        `.toBeLessThanOrEqual) in the same file. The size guard is the ` +
        `whole point of the test; a key-set assertion alone won't catch ` +
        `the 9.5.2-class regression.`,
    });
  }
}
