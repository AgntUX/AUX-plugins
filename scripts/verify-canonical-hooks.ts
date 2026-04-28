#!/usr/bin/env tsx
/**
 * verify-canonical-hooks.ts
 *
 * SHA-256 walk of canonical/hooks/ compared against canonical/hooks/checksums.txt.
 *
 * Uses the SAME find/sort/sed pipeline canonical/README.md documents:
 *   find . -type f ( -name '*.mjs' -o -name '*.json' ) \
 *     -not -path './test/*' -not -name 'checksums.txt' \
 *   | sort | xargs shasum -a 256 | sed 's| \./| |'
 *
 * Exit 0 if equal; non-zero with a diff if not.
 *
 * Exit codes:
 *   0 — checksums match
 *   1 — mismatch or error
 */

import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const HOOKS_DIR = path.join(REPO_ROOT, "canonical", "hooks");
const CHECKSUMS_FILE = path.join(HOOKS_DIR, "checksums.txt");

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runCommand(cmd: string, cwd: string): string {
  const result = child_process.execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result;
}

/**
 * Normalise a checksums block:
 * - trim trailing whitespace on each line
 * - remove blank lines
 * - sort lines (the pipeline already sorts, but be defensive)
 */
function normalise(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .sort();
}

function diff(expected: string[], actual: string[]): string {
  const expSet = new Map(expected.map((l) => [l.split("  ")[1], l]));
  const actSet = new Map(actual.map((l) => [l.split("  ")[1], l]));

  const lines: string[] = [];

  for (const [file, expLine] of expSet) {
    const actLine = actSet.get(file);
    if (actLine === undefined) {
      lines.push(`- missing in actual:   ${expLine}`);
    } else if (actLine !== expLine) {
      lines.push(`- expected: ${expLine}`);
      lines.push(`+ actual:   ${actLine}`);
    }
  }

  for (const [file, actLine] of actSet) {
    if (!expSet.has(file)) {
      lines.push(`+ unexpected in actual: ${actLine}`);
    }
  }

  return lines.join("\n");
}

function verify(): void {
  if (!fileExists(CHECKSUMS_FILE)) {
    process.stderr.write(
      `Error: checksums file not found: ${path.relative(REPO_ROOT, CHECKSUMS_FILE)}\n`,
    );
    process.exit(1);
  }

  const expected = fs.readFileSync(CHECKSUMS_FILE, "utf-8");

  // Run the canonical pipeline from canonical/hooks/
  let actual: string;
  try {
    actual = runCommand(
      `find . -type f \\( -name '*.mjs' -o -name '*.json' \\) -not -path './test/*' -not -name 'checksums.txt' | sort | xargs shasum -a 256 | sed 's| \\./| |'`,
      HOOKS_DIR,
    );
  } catch (e) {
    process.stderr.write(
      `Error: failed to compute checksums: ${String(e)}\n`,
    );
    process.exit(1);
  }

  const expectedLines = normalise(expected);
  const actualLines = normalise(actual);

  if (JSON.stringify(expectedLines) === JSON.stringify(actualLines)) {
    process.stdout.write(
      `canonical/hooks/ checksums match (${actualLines.length} file(s)).\n`,
    );
    process.exit(0);
  }

  process.stderr.write("Error: canonical/hooks/ checksums do not match.\n\n");
  process.stderr.write(diff(expectedLines, actualLines));
  process.stderr.write("\n\nRun the following to recompute checksums:\n");
  process.stderr.write(
    `  cd canonical/hooks && find . -type f \\( -name '*.mjs' -o -name '*.json' \\) -not -path './test/*' -not -name 'checksums.txt' | sort | xargs shasum -a 256 | sed 's| \\./| |' > checksums.txt\n`,
  );
  process.exit(1);
}

verify();
