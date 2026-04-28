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
  version?: string;
  description?: string;
  author?: { name?: string; url?: string } | string;
}

interface ListingYaml {
  keywords?: string[];
  categories?: string[];
  developer?: { name?: string; url?: string };
}

interface MarketplacePlugin {
  name: string;
  source: string;
  description: string;
  version: string;
  author: { name: string; url?: string };
  homepage: string;
  license: string;
  keywords: string[];
  category: string;
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

function resolveAuthor(
  pluginJson: PluginJson,
  listingYaml: ListingYaml,
): { name: string; url?: string } {
  if (pluginJson.author) {
    if (typeof pluginJson.author === "string") {
      return { name: pluginJson.author };
    }
    return {
      name: pluginJson.author.name ?? "Unknown",
      url: pluginJson.author.url,
    };
  }
  if (listingYaml.developer) {
    return {
      name: listingYaml.developer.name ?? "Unknown",
      url: listingYaml.developer.url,
    };
  }
  return { name: "Unknown" };
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

    const author = resolveAuthor(pluginJson, listingYaml);

    const entry: MarketplacePlugin = {
      name: pluginJson.name ?? slug,
      source: `./plugins/${slug}`,
      description: pluginJson.description ?? "",
      version: pluginJson.version ?? "1.0.0",
      author,
      homepage: `https://agntux.ai/plugins/${slug}`,
      license: "Elastic-2.0",
      keywords: listingYaml.keywords ?? [],
      category: listingYaml.categories?.[0] ?? "meta",
    };

    // Strip undefined fields from author
    if (!entry.author.url) {
      const { url: _url, ...rest } = entry.author;
      void _url;
      entry.author = rest;
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
