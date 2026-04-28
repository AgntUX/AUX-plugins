#!/usr/bin/env tsx
/**
 * changelog-bump-heuristic.ts
 *
 * Per P7 §5.1 rubric, surfaces obvious bump-kind mismatches
 * (e.g. removed field but PATCH bump). Warning-only — never fails CI on its own.
 *
 * Heuristic: the most-recent CHANGELOG.md entry's subsections are inspected
 * against the version bump delta (X.Y.Z compared to the previous entry).
 *
 * Output is human-readable by default; --json flag for NDJSON (one JSON object
 * per finding).
 *
 * Exit codes:
 *   0 — always (warnings do not fail CI)
 *
 * Usage:
 *   tsx scripts/changelog-bump-heuristic.ts [--plugin <slug>] [--json]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");

const VERSION_SECTION_RE =
  /^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2})$/m;

/** Bump kind as determined by semver delta. */
type BumpKind = "MAJOR" | "MINOR" | "PATCH" | "UNKNOWN";

/** A heuristic warning finding. */
interface HeuristicFinding {
  plugin: string;
  bump_kind: BumpKind;
  subsections: string[];
  warning: string;
  rationale: string;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse all versioned sections from a CHANGELOG.md.
 * Returns entries in changelog order (most-recent first).
 */
interface ChangelogEntry {
  version: string;
  date: string;
  subsections: string[];  // subsection headings present (e.g. "Removed", "Added")
}

function parseChangelogEntries(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const lines = content.split("\n");
  let currentEntry: ChangelogEntry | null = null;

  for (const line of lines) {
    if (line.startsWith("## [") && !line.startsWith("## [Unreleased]")) {
      const m = VERSION_SECTION_RE.exec(line);
      if (m) {
        if (currentEntry) entries.push(currentEntry);
        currentEntry = { version: m[1], date: m[2], subsections: [] };
      }
    } else if (currentEntry && /^### (.+)$/.test(line)) {
      const heading = /^### (.+)$/.exec(line)![1];
      currentEntry.subsections.push(heading);
    }
  }
  if (currentEntry) entries.push(currentEntry);

  return entries;
}

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function determineBumpKind(
  current: string,
  previous: string,
): BumpKind {
  const cur = parseSemver(current);
  const prev = parseSemver(previous);
  if (!cur || !prev) return "UNKNOWN";

  const [curMaj, curMin, curPat] = cur;
  const [prevMaj, prevMin, prevPat] = prev;

  if (curMaj > prevMaj) return "MAJOR";
  if (curMaj === prevMaj && curMin > prevMin) return "MINOR";
  if (curMaj === prevMaj && curMin === prevMin && curPat > prevPat) return "PATCH";
  return "UNKNOWN";
}

/**
 * P7 §5.1 heuristic rules.
 *
 * Returns a warning string if a mismatch is detected, null otherwise.
 */
function applyHeuristics(
  bumpKind: BumpKind,
  subsections: string[],
): { warning: string; rationale: string } | null {
  const has = (s: string): boolean => subsections.includes(s);

  // PATCH bump but contains Removed or Added — likely MINOR or MAJOR
  if (bumpKind === "PATCH" && has("Removed")) {
    return {
      warning:
        "PATCH bump with a 'Removed' subsection — removing a field/entry is typically MINOR or MAJOR.",
      rationale:
        "P7 §5.1: removing a supported_prompts/ui_components entry or schema field = MAJOR; removing non-breaking items = MINOR.",
    };
  }

  if (bumpKind === "PATCH" && has("Added")) {
    return {
      warning:
        "PATCH bump with an 'Added' subsection — adding new capabilities is typically MINOR.",
      rationale:
        "P7 §5.1: adding a supported_prompts/ui_components entry or new listing.yaml field = MINOR.",
    };
  }

  // MINOR bump but contains Removed — likely MAJOR
  if (bumpKind === "MINOR" && has("Removed")) {
    return {
      warning:
        "MINOR bump with a 'Removed' subsection — if a public surface was removed (supported_prompts, ui_components, connector_slug), this should be MAJOR.",
      rationale:
        "P7 §5.1: removing any entry from a plugin's public surface is a breaking change (MAJOR).",
    };
  }

  // MAJOR bump but only has Fixed/Changed and nothing that sounds breaking
  if (
    bumpKind === "MAJOR" &&
    !has("Removed") &&
    !has("Deprecated") &&
    (has("Fixed") || has("Changed")) &&
    !has("Added")
  ) {
    return {
      warning:
        "MAJOR bump with only Fixed/Changed subsections — verify this is truly a breaking change.",
      rationale:
        "P7 §5.1: MAJOR is for removing/renaming public surfaces or schema breakage. Non-breaking changes are MINOR or PATCH.",
    };
  }

  return null;
}

function checkPlugin(slug: string): HeuristicFinding[] {
  const changelogPath = path.join(PLUGINS_DIR, slug, "CHANGELOG.md");
  if (!fileExists(changelogPath)) return [];

  let content: string;
  try {
    content = fs.readFileSync(changelogPath, "utf-8");
  } catch {
    return [];
  }

  const entries = parseChangelogEntries(content);
  if (entries.length < 2) return [];  // Need at least 2 entries to compute a delta

  const [latest, previous] = entries;
  const bumpKind = determineBumpKind(latest.version, previous.version);

  const finding = applyHeuristics(bumpKind, latest.subsections);
  if (!finding) return [];

  return [
    {
      plugin: slug,
      bump_kind: bumpKind,
      subsections: latest.subsections,
      warning: finding.warning,
      rationale: finding.rationale,
    },
  ];
}

function main(): void {
  const cliArgs = process.argv.slice(2);

  function getFlag(name: string): string | undefined {
    const idx = cliArgs.indexOf(name);
    if (idx === -1) return undefined;
    return cliArgs[idx + 1];
  }

  const pluginFilter = getFlag("--plugin");
  const jsonMode = cliArgs.includes("--json");

  if (!isDirectory(PLUGINS_DIR)) {
    // Empty repo — nothing to check
    if (!jsonMode) {
      process.stdout.write("No plugins found — nothing to check.\n");
    }
    process.exit(0);
  }

  let slugs: string[];
  if (pluginFilter) {
    const pluginDir = path.join(PLUGINS_DIR, pluginFilter);
    if (!isDirectory(pluginDir)) {
      process.stderr.write(
        `Error: plugin "${pluginFilter}" not found in plugins/\n`,
      );
      process.exit(0); // still exits 0 — warning-only
    }
    slugs = [pluginFilter];
  } else {
    slugs = fs
      .readdirSync(PLUGINS_DIR)
      .filter((n) => !n.startsWith("."))
      .filter((n) => isDirectory(path.join(PLUGINS_DIR, n)))
      .sort();
  }

  const allFindings: HeuristicFinding[] = [];

  for (const slug of slugs) {
    const findings = checkPlugin(slug);
    allFindings.push(...findings);
  }

  if (allFindings.length === 0) {
    if (!jsonMode) {
      process.stdout.write(
        `changelog-bump-heuristic: no obvious bump-rule mismatches in ${slugs.length} plugin(s).\n`,
      );
    }
    process.exit(0);
  }

  for (const f of allFindings) {
    if (jsonMode) {
      process.stdout.write(JSON.stringify(f) + "\n");
    } else {
      process.stdout.write(
        `\nWARNING [${f.plugin}] ${f.bump_kind} bump\n` +
          `  ${f.warning}\n` +
          `  Rationale: ${f.rationale}\n` +
          `  Subsections in latest entry: ${f.subsections.join(", ") || "(none)"}\n`,
      );
    }
  }

  if (!jsonMode) {
    process.stdout.write(
      `\nchangelog-bump-heuristic: ${allFindings.length} warning(s). This check is advisory — CI does not fail on warnings.\n`,
    );
  }

  // Always exit 0 — warning-only, never fails CI
  process.exit(0);
}

main();
