#!/usr/bin/env tsx
/**
 * regenerate-aggregate-index.ts
 *
 * Walks plugins/* and emits marketplace/index.json.
 * Output is validated against AggregateIndexSchema from lib/marketplace-schema.ts.
 * Exits non-zero on validation failure.
 *
 * Exit codes:
 *   0 — success
 *   1 — validation failure or I/O error
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { AggregateIndexSchema } from "../lib/marketplace-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const OUTPUT_PATH = path.join(REPO_ROOT, "marketplace", "index.json");

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function regenerate(): void {
  if (!isDirectory(PLUGINS_DIR)) {
    process.stderr.write(
      `Error: plugins directory not found: ${path.relative(REPO_ROOT, PLUGINS_DIR)}\n`,
    );
    process.exit(1);
  }

  const slugs = fs
    .readdirSync(PLUGINS_DIR)
    .filter((n) => !n.startsWith("."))
    .filter((n) => isDirectory(path.join(PLUGINS_DIR, n)))
    .sort();

  const pluginsMap: Record<string, unknown> = {};

  for (const slug of slugs) {
    const pluginDir = path.join(PLUGINS_DIR, slug);
    const pluginJsonPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
    const listingYamlPath = path.join(pluginDir, "marketplace", "listing.yaml");

    // Skip plugin stubs that lack both marketplace/listing.yaml AND
    // .claude-plugin/plugin.json — these are placeholder directories not yet
    // ready for the marketplace (e.g. in-progress agntux-* scaffold).
    const hasListingYaml = fs.existsSync(listingYamlPath);
    const hasPluginJson = fs.existsSync(pluginJsonPath);
    if (!hasListingYaml && !hasPluginJson) {
      process.stderr.write(
        `Skipping ${slug}: missing both marketplace/listing.yaml and .claude-plugin/plugin.json\n`,
      );
      continue;
    }

    // Read plugin.json — only used for the cadence-field migration warning
    let pluginJson: Record<string, unknown> = {};
    try {
      pluginJson = JSON.parse(
        fs.readFileSync(pluginJsonPath, "utf-8"),
      ) as Record<string, unknown>;
    } catch (e) {
      process.stderr.write(
        `Warning: cannot read ${path.relative(REPO_ROOT, pluginJsonPath)}: ${String(e)}\n`,
      );
    }

    // Read listing.yaml
    let listingYaml: Record<string, unknown> = {};
    try {
      const raw = yaml.load(
        fs.readFileSync(listingYamlPath, "utf-8"),
      ) as Record<string, unknown>;
      if (raw && typeof raw === "object") listingYaml = raw;
    } catch (e) {
      process.stderr.write(
        `Warning: cannot read ${path.relative(REPO_ROOT, listingYamlPath)}: ${String(e)}\n`,
      );
    }

    // Warn if recommended_ingest_cadence appears in listing.yaml (migration error).
    // Also warn if it is absent from plugin.json for ingest plugins (advisory).
    if (
      Object.prototype.hasOwnProperty.call(
        listingYaml,
        "recommended_ingest_cadence",
      )
    ) {
      process.stderr.write(
        `Warning: ${slug}/marketplace/listing.yaml contains 'recommended_ingest_cadence' — this field must live in plugin.json (P15 §2.5.1)\n`,
      );
    }

    // The AggregateIndexSchema validates each plugin entry against ListingSchema.
    // ListingSchema rejects reserved fields (version, featured, etc.) and unknown
    // fields. Only the listing.yaml fields (validated by ListingSchema) go here.
    // Per-plugin metadata resolved from other sources (version, icon_path,
    // screenshot_paths, last_changelog_entry) is intentionally omitted from the
    // schema-validated map; a future AggregateIndexSchema revision will extend
    // ListingSchema with these fields.
    void pluginJson; // read for migration warning only; not used in output
    pluginsMap[slug] = listingYaml;
  }

  // Determinism: keep `generated_at` stable when the `plugins` map content is
  // unchanged. Without this, every regenerator run produces a diff (timestamp
  // churn) which causes regenerate-indexes.yml to commit on every push to main
  // even when no plugin metadata changed.
  let generatedAt = new Date().toISOString();
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8")) as {
        generated_at?: string;
        plugins?: unknown;
      };
      if (
        typeof prev.generated_at === "string" &&
        JSON.stringify(prev.plugins) === JSON.stringify(pluginsMap)
      ) {
        generatedAt = prev.generated_at;
      }
    } catch {
      // Malformed prior index — fall through to fresh timestamp.
    }
  }

  const index = {
    generated_at: generatedAt,
    plugins: pluginsMap,
  };

  // Validate against AggregateIndexSchema
  const result = AggregateIndexSchema.safeParse(index);
  if (!result.success) {
    process.stderr.write("Error: generated index.json failed schema validation:\n");
    for (const issue of result.error.issues) {
      const p = issue.path.join(".");
      process.stderr.write(`  ${p ? p + ": " : ""}${issue.message}\n`);
    }
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2) + "\n");

  const rel = path.relative(REPO_ROOT, OUTPUT_PATH);
  process.stdout.write(
    `Regenerated ${rel} with ${slugs.length} plugin(s).\n`,
  );
}

regenerate();
