/**
 * ingest-skill-shape.test.ts
 *
 * Repo-level structural assertion that every ingest plugin under
 * `plugins/` follows the inline-skill pattern. Lineage:
 *   1. router skill + ingest sub-agent pair (retired)
 *   2. top-level skill with `context: fork` + `agent: general-purpose`
 *      (retired — forked sub-context did not inherit the host's
 *      "Allow for all scheduled runs" working-directory grant, so
 *      every scheduled fire silently re-prompted)
 *   3. top-level skill that runs **inline** in the dispatch context
 *      (current — one Allow click holds across every fire)
 *
 * Asserted shape:
 *   - `agents/` directory absent. (Pre-launch the de-fork sweep retired
 *     the `agents/ui-handlers/` metadata-carrier exception too; the
 *     view-tool descriptor in `mcp-server/src/tools/{name}-view.ts` is
 *     now the single source of truth for the UI handler.)
 *   - `skills/{plugin-slug}/SKILL.md` present (e.g.
 *     `skills/agntux-slack/SKILL.md`). Skill `name:` matches the slug
 *     post-7.0.0 unification — the host exposes it as `/{plugin-slug}`.
 *   - Frontmatter on `skills/{plugin-slug}/SKILL.md` does NOT declare
 *     `context:`, `agent:`, or `tools:` — the skill runs inline,
 *     inherits the parent's full tool surface, and inherits the
 *     parent's working-directory grant.
 *   - If `skills/draft/SKILL.md` exists, same shape.
 *
 * An "ingest plugin" is any plugin whose slug starts with `agntux-`
 * EXCEPT `agntux-core` (the orchestrator). The discriminator at
 * file-tree level is the presence of `skills/{slug}/SKILL.md` where
 * the slug matches the plugin's manifest `name`. Authoring tools (the
 * `plugin-toolkit` bundle) live in the dedicated
 * `agntux-plugin-dev` marketplace and are not in this repo.
 *
 * Catches the "next ingest plugin silently ships a forked-context
 * shape" failure mode that re-introduces the scheduled-run
 * permission-prompt loop.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");

function listPlugins(): string[] {
  return readdirSync(PLUGINS_DIR).filter((name) => {
    const full = join(PLUGINS_DIR, name);
    return statSync(full).isDirectory() && existsSync(join(full, ".claude-plugin", "plugin.json"));
  });
}

function isIngestPlugin(slug: string): boolean {
  // The structural discriminator: shipping a SKILL.md whose directory name
  // matches the plugin slug makes a plugin an ingest plugin. Post-7.0.0
  // unification, the skill `name:` matches the plugin slug so the host
  // exposes the skill as `/{plugin-slug}`. agntux-core (orchestrator)
  // is correctly excluded — its skill is named `agntux`, not its slug.
  const manifestPath = join(PLUGINS_DIR, slug, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { name?: string };
  if (!manifest.name) return false;
  if (manifest.name === "agntux-core") return false;
  return existsSync(join(PLUGINS_DIR, slug, "skills", manifest.name, "SKILL.md"));
}

function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fm[key] = value;
  }
  return fm;
}

const ingestPlugins = listPlugins().filter(isIngestPlugin);

describe("ingest-skill shape — repo-level structural assertion", () => {
  it("at least two ingest plugins exist (catches future renames silently breaking discovery)", () => {
    // Sentinel: agntux-slack and agntux-gmail are both expected to be
    // discovered as ingest plugins. If a future rename breaks the
    // discriminator, this assertion fails loudly instead of the suite
    // silently passing with zero ingest plugins under inspection.
    expect(ingestPlugins.length).toBeGreaterThanOrEqual(2);
  });

  for (const slug of ingestPlugins) {
    const pluginRoot = join(PLUGINS_DIR, slug);

    describe(`${slug}`, () => {
      const agentsDir = join(pluginRoot, "agents");
      const syncSkill = join(pluginRoot, "skills", slug, "SKILL.md");
      const draftSkill = join(pluginRoot, "skills", "draft", "SKILL.md");

      it("has no agents/ directory", () => {
        expect(
          existsSync(agentsDir),
          `${slug}: agents/ must be absent. The de-fork sweep retired the agents/ui-handlers/ metadata-carrier exception; trigger phrases and output shape now live inline in mcp-server/src/tools/{name}-view.ts. Convert any classical sub-agents to top-level inline skills under skills/{name}/SKILL.md (no context: fork, no agent: general-purpose, no tools: whitelist).`,
        ).toBe(false);
      });

      it(`has skills/${slug}/SKILL.md`, () => {
        expect(existsSync(syncSkill)).toBe(true);
      });

      it("sync skill runs inline — no `context:`, no `agent:`, no `tools:` whitelist", () => {
        const fm = parseFrontmatter(readFileSync(syncSkill, "utf-8"));
        expect(
          fm["context"],
          `${slug} skills/${slug}/SKILL.md must NOT declare context: — the skill runs inline so it inherits the host's "Allow for all scheduled runs" working-directory grant. \`context: fork\` re-introduces the scheduled-run prompt loop.`,
        ).toBeUndefined();
        expect(
          fm["agent"],
          `${slug} skills/${slug}/SKILL.md must NOT declare agent: — the inline skill executes in the parent dispatch context and inherits its tool surface.`,
        ).toBeUndefined();
        expect(
          fm["tools"],
          `${slug} skills/${slug}/SKILL.md must NOT declare a tools: whitelist — the inline-running skill inherits the host's full tool surface (including UUID-prefixed connector tools).`,
        ).toBeUndefined();
      });

      if (existsSync(draftSkill)) {
        it("draft skill runs inline — no `context:`, no `agent:`, no `tools:` whitelist", () => {
          const fm = parseFrontmatter(readFileSync(draftSkill, "utf-8"));
          expect(fm["context"], `${slug} skills/draft/SKILL.md frontmatter context`).toBeUndefined();
          expect(fm["agent"], `${slug} skills/draft/SKILL.md frontmatter agent`).toBeUndefined();
          expect(
            fm["tools"],
            `${slug} skills/draft/SKILL.md must NOT declare a tools: whitelist`,
          ).toBeUndefined();
        });
      }
    });
  }
});
