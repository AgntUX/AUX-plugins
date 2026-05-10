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
 *   5. mcp-server/src/index.ts registers the agntux_gmail_compose_view
 *      tool on CallToolRequestSchema.
 *   6. The compose-view tool reads the gmail-namespaced compose payload.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Slug from plugin.json — the skill directory and frontmatter `name:` both
// match the plugin slug after the 3.0.0 slash-command unification refactor.
const PLUGIN_SLUG = (
  JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
  ) as { name: string }
).name;

// When reading the slug-named SKILL.md, fold in sibling reference/*.md files
// (sorted) with `<!-- {filename} -->` boundary markers so grep-style
// assertions on procedural body content keep working post-router-split.
// Pass-through for all other paths.
function readFile(p: string): string {
  const content = readFileSync(p, "utf-8");
  if (basename(p) === "SKILL.md" && basename(dirname(p)) === PLUGIN_SLUG) {
    const referenceDir = join(dirname(p), "reference");
    if (existsSync(referenceDir)) {
      const parts = [content];
      for (const name of readdirSync(referenceDir).filter((f) => f.endsWith(".md")).sort()) {
        parts.push(`\n<!-- ${name} -->\n`);
        parts.push(readFileSync(join(referenceDir, name), "utf-8"));
      }
      return parts.join("");
    }
  }
  return content;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fm[key] = value;
  }
  return fm;
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
    expect(manifest.license).toBe("Apache-2.0");
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

  it("supported_prompts uses the `/agntux-gmail` form", () => {
    const text = readFile(listingPath);
    expect(text).toMatch(/prompt:\s*"\/agntux-gmail"/);
  });
});

// ---------------------------------------------------------------------------
// Sync skill
// ---------------------------------------------------------------------------

describe(`skills/${PLUGIN_SLUG}/SKILL.md`, () => {
  const skillPath = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const skillText = existsSync(skillPath) ? readFile(skillPath) : "";

  it("exists at the slug-named path", () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it("frontmatter `name` matches the plugin slug", () => {
    const raw = readFileSync(skillPath, "utf-8");
    const fm = parseFrontmatter(raw);
    expect(fm["name"]).toBe(PLUGIN_SLUG);
  });

  it("SKILL.md is a slim router (≤ 100 lines)", () => {
    const raw = readFileSync(skillPath, "utf-8");
    expect(raw.split("\n").length).toBeLessThanOrEqual(100);
  });

  it("SKILL.md routing-table heading `## Sub-commands` is present", () => {
    const raw = readFileSync(skillPath, "utf-8");
    expect(raw).toMatch(/^##\s+Sub-commands\s*$/m);
  });

  it("reference/ask.md exists and is linked from SKILL.md", () => {
    const askRef = join(dirname(skillPath), "reference", "ask.md");
    expect(existsSync(askRef)).toBe(true);
    const raw = readFileSync(skillPath, "utf-8");
    expect(raw).toMatch(/reference\/ask\.md/);
  });

  it("reference/sync.md carries a `## Contents` TOC at the top", () => {
    const syncRef = join(dirname(skillPath), "reference", "sync.md");
    expect(existsSync(syncRef)).toBe(true);
    const content = readFileSync(syncRef, "utf-8");
    expect(content).toMatch(/^##\s+Contents\s*$/m);
  });

  it("reference/ask.md is structurally read-only (no cursor advance, no write)", () => {
    const askRef = join(dirname(skillPath), "reference", "ask.md");
    const content = readFileSync(askRef, "utf-8");
    expect(content).toMatch(/Do NOT.*call any source write tool/i);
    expect(content).toMatch(/Do NOT.*advance any cursor/i);
    expect(content).toMatch(/Do NOT.*edit any file under.*<agntux project root>/i);
  });

  it("single skill directory at skills/{slug}/ — no stray skills/sync/", () => {
    expect(existsSync(join(PLUGIN_ROOT, "skills", "sync", "SKILL.md"))).toBe(false);
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

  it("index.ts exists and registers tools on CallToolRequestSchema", () => {
    expect(existsSync(indexPath)).toBe(true);
    expect(indexText).toContain("CallToolRequestSchema");
  });

  it("does NOT reintroduce a license gate", () => {
    // Plugins are Apache-2.0 and unconditionally free; the relicensing PR
    // removed `@agntux/mcp-license` entirely. This regression guard catches
    // any reintroduction.
    expect(indexText).not.toContain("@agntux/mcp-license");
    expect(indexText).not.toContain("createLicenseGate");
    expect(indexText).not.toContain("requireValidLicense");
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
