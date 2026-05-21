#!/usr/bin/env tsx
/**
 * regenerate-marketplace-json.ts
 *
 * Regenerates .claude-plugin/marketplace.json from per-plugin sources.
 * Idempotent: produces deterministic output for a given commit.
 * Run by CI after any merge to main; also runnable locally.
 *
 * Exit codes:
 *   0 — success
 *   1 — error reading plugin sources or writing output
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const OUTPUT_PATH = path.join(REPO_ROOT, ".claude-plugin", "marketplace.json");

interface PluginJson {
  name?: string;
}

interface ListingYaml {
  keywords?: string[];
  categories?: string[];
}

interface MarketplacePlugin {
  name: string;
  source: string;
  homepage: string;
  keywords: string[];
  category: string;
  /**
   * Optional plugin-kind discriminator. Present and equal to
   * `"remote-view-only"` for source plugins that ship only a remote view tool
   * (no local MCP server, no `mcp-server/` directory). Signals the host not to
   * attempt launching a local MCP server for these plugins — the remote MCP
   * server in `app/` serves their view tools from S3-backed storage. Absent
   * for local-server plugins (agntux-core, agntux-build, plugin-toolkit) so
   * the host keeps using its existing local-launch path. Hybrid plugins
   * (agntux-core ships both a local mcp-server/ and a view-tool/) intentionally
   * omit `kind`: their local server still serves local tools, and their remote
   * view tool is registered through the same plugin-registry path as a side
   * effect — no host-side discriminator needed. See Phase 7 of the master plan
   * and Shared contract §8.
   */
  kind?: "remote-view-only";
}

interface MarketplaceJson {
  name: string;
  owner: { name: string; url: string };
  metadata: { description: string; version: string };
  plugins: MarketplacePlugin[];
}

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

  const plugins: MarketplacePlugin[] = [];

  for (const slug of slugs) {
    const pluginDir = path.join(PLUGINS_DIR, slug);
    const pluginJsonPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
    const listingYamlPath = path.join(pluginDir, "marketplace", "listing.yaml");

    let pluginJson: PluginJson = {};
    try {
      pluginJson = JSON.parse(
        fs.readFileSync(pluginJsonPath, "utf-8"),
      ) as PluginJson;
    } catch (e) {
      process.stderr.write(
        `Warning: cannot read ${path.relative(REPO_ROOT, pluginJsonPath)}: ${String(e)}\n`,
      );
    }

    let listingYaml: ListingYaml = {};
    try {
      listingYaml = yaml.load(
        fs.readFileSync(listingYamlPath, "utf-8"),
      ) as ListingYaml;
    } catch (e) {
      process.stderr.write(
        `Warning: cannot read ${path.relative(REPO_ROOT, listingYamlPath)}: ${String(e)}\n`,
      );
    }

    // P7 plugin-kind discriminator. A source plugin is one that ships a
    // `view-tool/` (the remote MCP server loads its compiled bundle) and
    // NO local `mcp-server/`. Hybrid plugins (have BOTH mcp-server/ and
    // view-tool/, e.g. agntux-core) and pure local-server plugins
    // (plugin-toolkit) omit `kind` — the host treats them as local.
    // Skill-only plugins (agntux-build — ships slash commands and agents
    // but no view tools and no MCP server after the 0.5.0 cleanup) also
    // omit `kind` so the host doesn't try to fetch a non-existent view
    // bundle. Same predicate as `scripts/build-plugin.mjs`; keep them in
    // sync if you change one.
    const hasMcpServer = isDirectory(path.join(pluginDir, "mcp-server"));
    const hasViewTool = isDirectory(path.join(pluginDir, "view-tool"));

    const entry: MarketplacePlugin = {
      name: pluginJson.name ?? slug,
      source: `./plugins/${slug}`,
      homepage: `https://agntux.ai/plugins/${slug}`,
      keywords: listingYaml.keywords ?? [],
      category: listingYaml.categories?.[0] ?? "meta",
    };
    if (!hasMcpServer && hasViewTool) {
      entry.kind = "remote-view-only";
    }

    plugins.push(entry);
  }

  const marketplace: MarketplaceJson = {
    name: "agntux",
    owner: { name: "AgntUX", url: "https://agntux.ai" },
    metadata: {
      description:
        "AgntUX plugins — Claude Code plugins for action-oriented data ingestion.",
      version: "1.0.0",
    },
    plugins,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(marketplace, null, 2) + "\n");

  const rel = path.relative(REPO_ROOT, OUTPUT_PATH);
  process.stdout.write(
    `Regenerated ${rel} with ${plugins.length} plugin(s).\n`,
  );
}

regenerate();
