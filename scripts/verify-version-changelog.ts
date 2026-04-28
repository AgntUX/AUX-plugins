#!/usr/bin/env tsx
/**
 * verify-version-changelog.ts
 *
 * For every plugin in plugins/{slug}/, confirms:
 *   .claude-plugin/plugin.json `version` === latest CHANGELOG.md section header ## [X.Y.Z] — YYYY-MM-DD
 *
 * Edge cases handled:
 *   - No CHANGELOG.md         → error
 *   - Malformed version header → error
 *   - plugin.json missing      → error
 *   - plugin.json has no version field → error
 *   - Version not in CHANGELOG → error (latest CHANGELOG version ≠ plugin.json version)
 *
 * Exit 0 if all plugins pass; exit 1 on any mismatch.
 *
 * Usage:
 *   tsx scripts/verify-version-changelog.ts [--plugin <slug>]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");

/** Matches a versioned CHANGELOG section: ## [X.Y.Z] — YYYY-MM-DD (P15 §2.4) */
const VERSION_SECTION_RE =
  /^## \[(\d+\.\d+\.\d+)\] — (\d{4}-\d{2}-\d{2})$/m;

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

interface CheckResult {
  slug: string;
  ok: boolean;
  message: string;
}

function checkPlugin(slug: string): CheckResult {
  const pluginDir = path.join(PLUGINS_DIR, slug);
  const pluginJsonPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
  const changelogPath = path.join(pluginDir, "CHANGELOG.md");

  // Check plugin.json exists
  if (!fileExists(pluginJsonPath)) {
    return {
      slug,
      ok: false,
      message: `${slug}/.claude-plugin/plugin.json is missing`,
    };
  }

  // Parse plugin.json
  let pluginVersion: string | undefined;
  try {
    const raw = JSON.parse(
      fs.readFileSync(pluginJsonPath, "utf-8"),
    ) as { version?: string };
    pluginVersion = raw.version;
  } catch (e) {
    return {
      slug,
      ok: false,
      message: `${slug}/.claude-plugin/plugin.json parse error: ${String(e)}`,
    };
  }

  if (!pluginVersion) {
    return {
      slug,
      ok: false,
      message: `${slug}/.claude-plugin/plugin.json has no 'version' field`,
    };
  }

  // Check CHANGELOG.md exists
  if (!fileExists(changelogPath)) {
    return {
      slug,
      ok: false,
      message: `${slug}/CHANGELOG.md is missing`,
    };
  }

  // Read CHANGELOG.md
  let changelog: string;
  try {
    changelog = fs.readFileSync(changelogPath, "utf-8");
  } catch (e) {
    return {
      slug,
      ok: false,
      message: `${slug}/CHANGELOG.md read error: ${String(e)}`,
    };
  }

  // Validate top-level H1
  if (!changelog.trimStart().startsWith("# Changelog")) {
    return {
      slug,
      ok: false,
      message: `${slug}/CHANGELOG.md must start with "# Changelog"`,
    };
  }

  // Validate all versioned section headers have the correct format
  const lines = changelog.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## [") && !line.startsWith("## [Unreleased]")) {
      if (!VERSION_SECTION_RE.test(line)) {
        return {
          slug,
          ok: false,
          message: `${slug}/CHANGELOG.md line ${i + 1}: malformed version header "${line}" — expected format ## [X.Y.Z] — YYYY-MM-DD`,
        };
      }
    }
  }

  // Find the most-recent versioned entry (skip [Unreleased])
  const match = VERSION_SECTION_RE.exec(changelog);
  if (!match) {
    return {
      slug,
      ok: false,
      message: `${slug}/CHANGELOG.md has no versioned release section (## [X.Y.Z] — YYYY-MM-DD)`,
    };
  }

  const changelogVersion = match[1];

  if (changelogVersion !== pluginVersion) {
    return {
      slug,
      ok: false,
      message:
        `${slug}: plugin.json version ${pluginVersion} does not match ` +
        `CHANGELOG.md most-recent version ${changelogVersion}`,
    };
  }

  return {
    slug,
    ok: true,
    message: `${slug}: OK (${pluginVersion})`,
  };
}

function main(): void {
  const cliArgs = process.argv.slice(2);

  function getFlag(name: string): string | undefined {
    const idx = cliArgs.indexOf(name);
    if (idx === -1) return undefined;
    return cliArgs[idx + 1];
  }

  const pluginFilter = getFlag("--plugin");

  if (!isDirectory(PLUGINS_DIR)) {
    process.stderr.write(
      `Error: plugins directory not found: ${path.relative(REPO_ROOT, PLUGINS_DIR)}\n`,
    );
    process.exit(1);
  }

  let slugs: string[];
  if (pluginFilter) {
    const pluginDir = path.join(PLUGINS_DIR, pluginFilter);
    if (!isDirectory(pluginDir)) {
      process.stderr.write(
        `Error: plugin "${pluginFilter}" not found in plugins/\n`,
      );
      process.exit(1);
    }
    slugs = [pluginFilter];
  } else {
    slugs = fs
      .readdirSync(PLUGINS_DIR)
      .filter((n) => !n.startsWith("."))
      .filter((n) => isDirectory(path.join(PLUGINS_DIR, n)))
      .sort();
  }

  if (slugs.length === 0) {
    process.stdout.write("No plugins found — nothing to verify.\n");
    process.exit(0);
  }

  let hasErrors = false;
  for (const slug of slugs) {
    const result = checkPlugin(slug);
    if (result.ok) {
      process.stdout.write(`  PASS  ${result.message}\n`);
    } else {
      process.stderr.write(`  FAIL  ${result.message}\n`);
      hasErrors = true;
    }
  }

  process.stdout.write("\n");
  if (hasErrors) {
    process.stderr.write(
      `version-changelog check FAILED for one or more plugins.\n`,
    );
    process.exit(1);
  } else {
    process.stdout.write(
      `All ${slugs.length} plugin(s) passed version-changelog check.\n`,
    );
    process.exit(0);
  }
}

main();
