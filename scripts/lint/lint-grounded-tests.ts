/**
 * lint-grounded-tests.ts — pass 15: flag brittle "phantom-contract" plugin
 * tests that grep another author's per-plugin reference PROSE for a literal
 * string.
 *
 * Why this exists
 * ---------------
 * In production (Claude Cowork google-calendar build, 2026-06-01) a single
 * `agntux_validate` run took FIVE rounds. Rounds 2–4 were consumed entirely by
 * the tests stage: the model had authored `__tests__/*.test.ts` that did
 *
 *     const text = readFileSync(resolve(ROOT,
 *       'skills/<slug>/_overrides/reference/fetch.md'), 'utf8');
 *     expect(text).toContain('forbidden by this skill');
 *
 * i.e. assertions that grep the WORDING of a markdown file authored by a
 * DIFFERENT specialist (`ingest-prompt-author`) for a phrase the model invented.
 * `draft-flow.test.ts` and `thread-association.test.ts` both grepped the SAME
 * `fetch.md` for different strings, so editing the prose to satisfy one test
 * broke the next — a multi-round whack-a-mole that validates nothing real (the
 * strings are arbitrary tokens, not a behavioural contract).
 *
 * `tests-author.md`'s "golden rule" already tells the model NOT to do this
 * (assert the handler's actual output, a declared machine-readable field, or a
 * phrase from the CANONICAL `sync.md` template instead). Pass 15 makes that rule
 * mechanical: the gate flags the pattern so the steer doesn't depend on prompt
 * adherence.
 *
 * Findings
 * --------
 *   E30 (warning) — a test file both reads a PER-PLUGIN override-source `.md` file
 *     (under `_overrides/`, or an `*-append.md` splice — prose owned by another
 *     author and reworded freely) AND calls `.toContain(...)`. Routed to
 *     `tests-author`. **Severity stays `warning` so repo-level marketplace CI
 *     doesn't break existing plugins** — but `agntux_validate` escalates E30 to
 *     BLOCKING in the build flow (see `BLOCKING_WARNING_CODES` in
 *     validate-plugin.mjs), because a phantom test would otherwise pass lint and
 *     burn multiple rounds in the tests stage. A literal naming a `canonical/`
 *     path is exempt (the one allowed anchor). The message points at the golden
 *     rule's three grounded sources of truth.
 *
 * Scope
 * -----
 *   - Scans `__tests__/**` and `view-tool/__tests__/**` for `*.test.{ts,mts,mjs}`.
 *   - Whole-file match (the `readFileSync(...)` call and its path literal are
 *     routinely split across lines), so the two signals need only co-occur in
 *     the same file. Reports the line of the first per-plugin-prose path literal.
 *   - Skips plugins with no test directories.
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

const TEST_DIRS_REL = ["__tests__", "view-tool/__tests__"];
const TEST_FILE_RE = /\.test\.(?:ts|mts|mjs)$/;
// A string literal that points at a PER-PLUGIN OVERRIDE-SOURCE markdown file —
// the brittle phantom-contract target. This is the prose ANOTHER specialist
// (`ingest-prompt-author`) authors and rewords freely. Two shapes, because the
// override source isn't all under one dir:
//   • anything under an `_overrides/` dir — covers `_overrides/reference/fetch.md`
//     (the 2026-06-01 cold-start.test.ts read) AND `_overrides/compose-payload.md`
//   • an override append splice `*-append.md` — these live at the `_overrides/`
//     ROOT, NOT under `reference/`, so the old `/reference/`-only regex MISSED
//     `step-11-append.md` (the 2026-06-01 idempotent.test.ts read).
// Deliberately NOT matched: a read of the RENDERED tree (`skills/<slug>/SKILL.md`,
// `skills/<slug>/reference/*.md`) or the marketplace CANONICAL template
// (`canonical/.../sync.md`). Those are the golden rule's grounded sources #3 — a
// test may legitimately assert a short STABLE token (`lookup-before-write`,
// `_sources.json`) from the rendered/canonical body, and `tests-author.md` even
// documents a verbatim-with-provenance read of `reference/sync.md`. Since E30 now
// BLOCKS the build flow, flagging only the override SOURCE keeps those legit
// patterns working while killing the churn. (`canonical/` is excluded via the
// negative lookahead too, belt-and-suspenders.)
const PLUGIN_PROSE_MD_RE =
  /['"`](?![^'"`\n]*canonical\/)[^'"`\n]*(?:_overrides\/[^'"`\n]*\.md|-append\.md)['"`]/;
const TOCONTAIN_RE = /\.toContain\s*\(/;

/** Collect *.test.* files under a directory, recursively. Never throws. */
function collectTestFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      collectTestFiles(abs, out);
    } else if (e.isFile() && TEST_FILE_RE.test(e.name)) {
      out.push(abs);
    }
  }
}

export function pass15GroundedTests(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const testFiles: string[] = [];
  for (const rel of TEST_DIRS_REL) {
    collectTestFiles(path.join(pluginDir, rel), testFiles);
  }
  if (testFiles.length === 0) return;

  for (const abs of testFiles) {
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!TOCONTAIN_RE.test(body) || !PLUGIN_PROSE_MD_RE.test(body)) continue;
    // Anchor the finding on the first per-plugin-prose path literal.
    let line: number | undefined;
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (PLUGIN_PROSE_MD_RE.test(lines[i])) {
        line = i + 1;
        break;
      }
    }
    findings.push({
      code: "E30",
      severity: "warning",
      plugin: pluginSlug,
      file: path.relative(pluginDir, abs),
      line,
      message:
        `${path.basename(abs)} asserts \`.toContain(...)\` against a ` +
        `per-plugin override-source markdown file (an \`_overrides/**.md\` or ` +
        `\`*-append.md\` read — prose a different author owns and rewords). ` +
        `This is a phantom-contract test: it greps another author's prose for ` +
        `an invented string, so it fails the gate on wording — not behaviour — ` +
        `and editing the prose to satisfy one such test breaks the next. ` +
        `Ground assertions in one of the three stable sources instead: (1) the ` +
        `handler's actual output (call viewTool.handle(args, ctx) and assert ` +
        `the real structuredContent keyset/byte size), (2) a declared ` +
        `machine-readable field (inputSchema/outputSchema/data_paths, or a ` +
        `value in plugin.json / listing.yaml), or (3) a phrase that lives in ` +
        `the CANONICAL sync.md template (never a per-plugin override phrasing). ` +
        `See plugins/agntux-build/agents/tests-author.md → the golden rule.`,
    });
  }
}
