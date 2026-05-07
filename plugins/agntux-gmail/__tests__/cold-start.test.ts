/**
 * cold-start.test.ts
 *
 * Structural test: verifies that the agntux-gmail plugin's manifest, listing,
 * sync skill, and MCP server source conform to the canonical shape.
 *
 * The ingest skill is an LLM and cannot be invoked in-process. Instead, the
 * test asserts:
 *   1. plugin.json carries the required fields including a non-empty
 *      free-form recommended_ingest_cadence string.
 *   2. listing.yaml is well-formed with proposed_schema, ui_components,
 *      requires_source_mcp, and required marketplace fields.
 *   3. skills/sync/SKILL.md has no unsubstituted {{placeholder}} tokens,
 *      references Gmail read tools, is read-only re: create_draft, and
 *      runs inline (no `context: fork`, no nested `general-purpose`
 *      agent — forking broke "Allow for all scheduled runs" inheritance).
 *   4. The compose UI handler exists at ui-handlers/compose/component/.
 *   5. mcp-server/src/index.ts wires the @agntux/mcp-license gate around
 *      tools/call (NOT resources/read).
 *   6. The compose-view tool reads the gmail-namespaced compose payload.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// When reading a sync SKILL.md, fold in sibling resources/*.md files (sorted)
// with `<!-- {filename} -->` boundary markers so future Phase-3/4 splits don't
// break grep-style assertions. Pass-through for all other paths.
function readFile(p: string): string {
  const content = readFileSync(p, "utf-8");
  if (basename(p) === "SKILL.md" && basename(dirname(p)) === "sync") {
    const resourcesDir = join(dirname(p), "resources");
    if (existsSync(resourcesDir)) {
      const parts = [content];
      for (const name of readdirSync(resourcesDir).filter((f) => f.endsWith(".md")).sort()) {
        parts.push(`\n<!-- ${name} -->\n`);
        parts.push(readFileSync(join(resourcesDir, name), "utf-8"));
      }
      return parts.join("");
    }
  }
  return content;
}

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

describe("plugin manifest", () => {
  const manifestPath = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");

  it("plugin.json exists", () => {
    expect(existsSync(manifestPath)).toBe(true);
  });

  it("has required fields", () => {
    const manifest = JSON.parse(readFile(manifestPath)) as Record<string, unknown>;
    expect(manifest.name).toBe("agntux-gmail");
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof manifest.description).toBe("string");
    expect(manifest.license).toBe("ELv2");
  });

  it("recommended_ingest_cadence describes hourly cadence", () => {
    const manifest = JSON.parse(readFile(manifestPath)) as Record<string, unknown>;
    expect(manifest.recommended_ingest_cadence).toBeTruthy();
    expect(typeof manifest.recommended_ingest_cadence).toBe("string");
    expect(String(manifest.recommended_ingest_cadence).toLowerCase()).toMatch(/hour/);
  });

  it("plugin.json carries no custom fields beyond host spec + recommended_ingest_cadence", () => {
    const manifest = JSON.parse(readFile(manifestPath)) as Record<string, unknown>;
    const allowed = new Set([
      "name",
      "version",
      "description",
      "author",
      "license",
      "recommended_ingest_cadence",
    ]);
    for (const key of Object.keys(manifest)) {
      expect(allowed.has(key)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

describe("marketplace listing.yaml", () => {
  const listingPath = join(PLUGIN_ROOT, "marketplace", "listing.yaml");

  it("exists and references Gmail Connector", () => {
    expect(existsSync(listingPath)).toBe(true);
    const text = readFile(listingPath);
    expect(text).toContain("connector_slug: gmail");
    expect(text).toContain("requires_plugins:");
    expect(text).toContain("agntux-core");
  });

  it("declares proposed_schema with cursor_semantics + source_id_format", () => {
    const text = readFile(listingPath);
    expect(text).toContain("proposed_schema");
    expect(text).toContain("entity_subtypes");
    expect(text).toContain("action_classes");
    expect(text).toContain("cursor_semantics");
    expect(text).toContain("source_id_format");
  });

  it("declares the compose UI component", () => {
    const text = readFile(listingPath);
    expect(text).toContain("ui_components:");
    expect(text).toMatch(/name:\s*"?compose"?/);
  });

  it("supported_prompts mentions /agntux-gmail:sync", () => {
    const text = readFile(listingPath);
    expect(text).toContain("/agntux-gmail:sync");
  });
});

// ---------------------------------------------------------------------------
// Sync skill
// ---------------------------------------------------------------------------

describe("skills/sync/SKILL.md", () => {
  const skillPath = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");
  const skillText = existsSync(skillPath) ? readFile(skillPath) : "";

  it("exists at the canonical path", () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it("runs inline — no `context: fork`, no nested agent, no `tools:` whitelist", () => {
    expect(skillText).toMatch(/^---/);
    const fmMatch = skillText.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    if (fmMatch) {
      expect(fmMatch[1]).not.toMatch(/^context:/m);
      expect(fmMatch[1]).not.toMatch(/^agent:/m);
      expect(fmMatch[1]).not.toMatch(/^tools:/m);
    }
  });

  it("has no unsubstituted {{placeholder}} tokens", () => {
    expect(skillText).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it("references Gmail read MCP tools", () => {
    expect(skillText).toContain("search_threads");
    expect(skillText).toContain("get_thread");
  });

  it("explicitly forbids calling create_draft from the skill", () => {
    expect(skillText).toMatch(/never call.*create_draft/i);
  });

  it("documents the cross-source merge protocol with a 48h window", () => {
    expect(skillText).toMatch(/cross.source/i);
    expect(skillText).toMatch(/48.{0,5}hour/i);
    expect(skillText).toContain("## Cross-source links");
  });

  it("documents Step 10.2 email-context gathering with token guards", () => {
    expect(skillText).toMatch(/Step 10\.2/);
    expect(skillText).toMatch(/N=3/);
    expect(skillText).toMatch(/MINIMAL/);
    expect(skillText).toMatch(/7.day cache/i);
  });

  it("specifies hourly cadence and 14-day bootstrap window", () => {
    expect(skillText).toMatch(/14 days/);
    expect(skillText).toMatch(/hourly|hour/i);
  });

  it("captures user_email for deep-link construction", () => {
    expect(skillText).toContain("user_email");
    expect(skillText).toContain("authuser=");
  });
});

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

describe("mcp-server", () => {
  const indexPath = join(PLUGIN_ROOT, "mcp-server", "src", "index.ts");
  const indexText = existsSync(indexPath) ? readFile(indexPath) : "";

  it("index.ts exists and wires the license gate around tools/call", () => {
    expect(existsSync(indexPath)).toBe(true);
    expect(indexText).toContain("@agntux/mcp-license");
    expect(indexText).toContain("createLicenseGate");
    expect(indexText).toContain("requireValidLicense");
    expect(indexText).toContain("CallToolRequestSchema");
  });

  it("does NOT gate resources/read", () => {
    // The license gate must not wrap the ReadResource handler — see
    // packages/mcp-license/README.md "Why only tools/call".
    const readHandlerBlock = indexText.match(
      /setRequestHandler\(ReadResourceRequestSchema[\s\S]*?\}\)/,
    );
    expect(readHandlerBlock).toBeTruthy();
    if (readHandlerBlock) {
      expect(readHandlerBlock[0]).not.toContain("requireValidLicense");
    }
  });

  it("registers a single namespaced tool: agntux_gmail_compose_view", () => {
    expect(indexText).toContain("agntux_gmail_compose_view");
  });

  it("compose-view tool reads gmail-namespaced compose payload from disk", () => {
    const parsePath = join(PLUGIN_ROOT, "mcp-server", "src", "parse-action.ts");
    const text = existsSync(parsePath) ? readFile(parsePath) : "";
    expect(text).toContain("Compose payload (gmail)");
    expect(text).toContain("Compose payload");
  });
});

// ---------------------------------------------------------------------------
// Compose UI handler
// ---------------------------------------------------------------------------

describe("compose UI handler", () => {
  const handlerRoot = join(PLUGIN_ROOT, "ui-handlers", "compose", "component");
  it("exists at ui-handlers/compose/component/", () => {
    expect(existsSync(handlerRoot)).toBe(true);
    expect(existsSync(join(handlerRoot, "package.json"))).toBe(true);
    expect(existsSync(join(handlerRoot, "src", "App.tsx"))).toBe(true);
  });

  it("emits a Gmail Connector two-step envelope (no Slack-Connector references)", () => {
    const envelopePath = join(
      handlerRoot,
      "src",
      "lib",
      "build-envelope.ts",
    );
    const text = existsSync(envelopePath) ? readFile(envelopePath) : "";
    expect(text).toContain("Use the Gmail Connector");
    expect(text).toContain("create_draft");
    expect(text).toContain("two steps");
    expect(text).toContain("authuser=");
    expect(text).not.toContain("Use the Slack Connector");
  });
});
