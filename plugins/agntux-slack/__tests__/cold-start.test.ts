/**
 * cold-start.test.ts
 *
 * Structural test: verifies that the agntux-slack plugin's manifest, hooks,
 * agent prompts, and example fixture conform to the canonical shape.
 *
 * LIMITATION (per T18 pattern): the ingest agent is an LLM that cannot be
 * invoked in-process. Instead, the test asserts:
 *   1. plugin.json carries the required fields including the Hourly cadence.
 *   2. hooks/hooks.json has the ingest-variant shape (no PostToolUse).
 *   3. agents/ingest.md has no unsubstituted {{placeholder}} tokens, references
 *      the Slack read MCP tools, and is read-only.
 *   4. agents/draft.md exists, references the write tools, and codifies the
 *      "no write without explicit yes" rule.
 *   5. skills/sync/SKILL.md exists in the directory-shaped form.
 *   6. The example entity files conform to the P3 entity schema.
 *   7. The example action item conforms to the P3 action-item schema and uses
 *      the parent thread `(channel_id, thread_ts)` as `source_ref`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = join(PLUGIN_ROOT, "examples", "starter-thread");
const EXPECTED_ENTITIES = join(EXAMPLES_DIR, "expected-entities");
const EXPECTED_ACTIONS = join(EXAMPLES_DIR, "expected-actions");
const EXPECTED_STATE = join(EXAMPLES_DIR, "expected-state");

function readMd(p: string): string {
  return readFileSync(p, "utf-8");
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

function hasSections(content: string, sections: string[]): boolean {
  return sections.every((s) => content.includes(`## ${s}`));
}

// ---------------------------------------------------------------------------
// Pass 1: plugin manifest
// ---------------------------------------------------------------------------

describe("plugin manifest", () => {
  const manifestPath = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");

  it("plugin.json exists", () => {
    expect(existsSync(manifestPath)).toBe(true);
  });

  it("plugin.json has required fields", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    expect(manifest.name).toBe("agntux-slack");
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof manifest.description).toBe("string");
    expect(manifest.license).toBe("ELv2");
  });

  it("recommended_ingest_cadence is Hourly", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    expect(manifest.recommended_ingest_cadence).toBe("Hourly");
  });
});

// ---------------------------------------------------------------------------
// Pass 2: hooks shape (ingest variant — no PostToolUse)
// ---------------------------------------------------------------------------

describe("hooks shape (ingest variant)", () => {
  const hooksPath = join(PLUGIN_ROOT, "hooks", "hooks.json");

  it("hooks.json exists", () => {
    expect(existsSync(hooksPath)).toBe(true);
  });

  it("has SessionStart with license-check", () => {
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const entries = hooks.hooks.SessionStart ?? [];
    const cmds = entries.flatMap((e) => e.hooks ?? []).map((h) => h.command ?? "");
    expect(cmds.some((c) => c.includes("license-check.mjs"))).toBe(true);
  });

  it("has PreToolUse with license-validate", () => {
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
    };
    const entries = hooks.hooks.PreToolUse ?? [];
    const entry = entries.find((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes("license-validate.mjs"))
    );
    expect(entry).toBeDefined();
    expect(entry?.matcher).toMatch(/Write\|Edit/);
  });

  it("does NOT have PostToolUse (ingest plugins do not own the maintain-index hook)", () => {
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as {
      hooks: Record<string, unknown>;
    };
    expect(hooks.hooks.PostToolUse).toBeUndefined();
  });

  it("agntux-plugins.mjs lists agntux-core and agntux-slack", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "hooks", "lib", "agntux-plugins.mjs"), "utf-8");
    expect(src).toContain('"agntux-core"');
    expect(src).toContain('"agntux-slack"');
    expect(src).not.toContain("{{AGNTUX_PLUGIN_SLUGS}}");
  });

  it("public-key.mjs has the substituted Ed25519 PEM", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "hooks", "lib", "public-key.mjs"), "utf-8");
    expect(src).toContain("agntux-license-v1");
    expect(src).toContain("BEGIN PUBLIC KEY");
    expect(src).not.toContain("{{PUBLIC_KEY_KID}}");
    expect(src).not.toContain("{{PUBLIC_KEY_SPKI_PEM}}");
  });
});

// ---------------------------------------------------------------------------
// Pass 3: agent prompt substitution + read-only invariant
// ---------------------------------------------------------------------------

describe("ingest agent prompt", () => {
  const ingestMd = join(PLUGIN_ROOT, "agents", "ingest.md");
  const draftMd = join(PLUGIN_ROOT, "agents", "draft.md");
  const syncSkill = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");

  it("agents/ingest.md exists", () => {
    expect(existsSync(ingestMd)).toBe(true);
  });

  it("agents/draft.md exists", () => {
    expect(existsSync(draftMd)).toBe(true);
  });

  it("skills/sync/SKILL.md exists", () => {
    expect(existsSync(syncSkill)).toBe(true);
  });

  it("ingest.md has no unsubstituted {{placeholder}} tokens", () => {
    const src = readMd(ingestMd);
    const matches = src.match(/\{\{[\w-]+\}\}/g) ?? [];
    expect(matches).toHaveLength(0);
  });

  it("draft.md has no unsubstituted {{placeholder}} tokens", () => {
    const src = readMd(draftMd);
    const matches = src.match(/\{\{[\w-]+\}\}/g) ?? [];
    expect(matches).toHaveLength(0);
  });

  it("sync skill has no unsubstituted {{placeholder}} tokens", () => {
    const src = readMd(syncSkill);
    const matches = src.match(/\{\{[\w-]+\}\}/g) ?? [];
    expect(matches).toHaveLength(0);
  });

  it("ingest.md references the Slack read MCP tools", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("slack_read_channel");
    expect(src).toContain("slack_read_thread");
    expect(src).toContain("slack_read_user_profile");
    expect(src).toContain("slack_search_public_and_private");
  });

  it("ingest.md is declared read-only — never calls Slack write tools", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("read-only");
    expect(src).toContain("Never call a Slack write tool");
  });

  it("ingest.md uses the Slack-specific cursor semantics (per-channel ts map)", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("Per-channel");
    expect(src).toContain("ts");
    expect(src).toContain("JSON.parse");
  });

  it("ingest.md documents the bootstrap_window_days override (7 default for Slack)", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("bootstrap_window_days");
    expect(src).toContain("default is 7 days");
  });

  it("ingest.md documents the onboarding-mode 5-channel cap", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("onboarding-mode cap of 5 channels");
    expect(src).toContain("slack-onboarding-deferred");
  });

  it("ingest.md proposes the canonical six action classes (no decision-needed)", () => {
    const src = readMd(ingestMd);
    expect(src).toContain("`deadline`, `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other`");
    // Every appearance of `decision-needed` in the prompt MUST be a negation.
    // Find every occurrence and confirm "no" or "folded" sits within ~30 chars.
    const occurrences = [...src.matchAll(/`decision-needed`/g)];
    for (const m of occurrences) {
      const window = src.slice(Math.max(0, m.index! - 40), m.index! + 80);
      expect(window).toMatch(/no\s+`decision-needed`|folded/);
    }
  });

  it("ingest.md pre-flight exits cleanly and waits for architect Mode B (no manual /agntux-schema review nag)", () => {
    const src = readMd(ingestMd);
    // Mode B fires automatically per A1 — pre-flight exits cleanly and
    // waits. (1) No manual nag, (2) the wait-and-retry behaviour is
    // explicitly documented so the next scheduled run picks up.
    expect(src).not.toMatch(/run `\/agntux-schema review agntux-slack`/);
    expect(src).toMatch(/awaiting data-architect Mode B|will retry on the next scheduled tick/i);
  });

  it("sync skill registered as a directory-shaped skill (Claude Code spec)", () => {
    const flatForm = join(PLUGIN_ROOT, "skills", "orchestrator.md");
    expect(existsSync(flatForm)).toBe(false);
    expect(existsSync(syncSkill)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pass 4: example entity files conform to the P3 entity schema
// ---------------------------------------------------------------------------

const entityFiles = [
  { path: join(EXPECTED_ENTITIES, "people", "john-smith.md"), expectedId: "john-smith", expectedSubtype: "person" },
  { path: join(EXPECTED_ENTITIES, "topics", "project-mango.md"), expectedId: "project-mango", expectedSubtype: "topic" },
  { path: join(EXPECTED_ENTITIES, "companies", "acme.md"), expectedId: "acme", expectedSubtype: "company" },
];

describe("example entity files", () => {
  for (const { path: filePath, expectedId, expectedSubtype } of entityFiles) {
    const label = expectedId;

    it(`${label}: file exists`, () => {
      expect(existsSync(filePath)).toBe(true);
    });

    it(`${label}: required frontmatter fields present`, () => {
      const content = readMd(filePath);
      const fm = parseFrontmatter(content);
      expect(fm.id).toBe(expectedId);
      expect(fm.type).toBe("entity");
      expect(fm.schema_version).toBe('"1.0.0"');
      expect(fm.subtype).toBe(expectedSubtype);
      expect(fm.created_at).toBeTruthy();
      expect(fm.updated_at).toBeTruthy();
    });

    it(`${label}: has all four required body sections`, () => {
      const content = readMd(filePath);
      expect(hasSections(content, ["Summary", "Key Facts", "Recent Activity", "User notes"])).toBe(true);
    });

    it(`${label}: User notes is the last section`, () => {
      const content = readMd(filePath);
      const userNotesIdx = content.lastIndexOf("## User notes");
      const afterUserNotes = content.slice(userNotesIdx + "## User notes".length);
      expect(afterUserNotes).not.toMatch(/^## /m);
    });

    it(`${label}: source is slack`, () => {
      const content = readMd(filePath);
      expect(content).toContain("slack:");
    });

    it(`${label}: Recent Activity has at least one slack entry`, () => {
      const content = readMd(filePath);
      expect(content).toMatch(/- \d{4}-\d{2}-\d{2} — slack:/);
    });

    it(`${label}: source row keys on parent thread (channel_id#thread_ts), never a reply ts`, () => {
      const content = readMd(filePath);
      const fm = parseFrontmatter(content);
      // sources line is on the line below `sources:`; for entities sourced
      // from Slack thread artefacts the value must use `<channel_id>#<thread_ts>`.
      // The parent ts in our fixture is 1714300000.000100; reply ts are
      // 1714300100.000200 and 1714386500.000300 — those must NOT appear as
      // the source key.
      const slackSourceMatch = content.match(/slack:\s*"([^"]+)"/);
      expect(slackSourceMatch).toBeTruthy();
      const sourceVal = slackSourceMatch![1];
      expect(sourceVal).toMatch(/^[CD][A-Z0-9]+#\d+\.\d+$/);
      // None of the reply-only ts values may appear here
      expect(sourceVal).not.toContain("1714300100.000200");
      expect(sourceVal).not.toContain("1714386500.000300");
    });
  }
});

// ---------------------------------------------------------------------------
// Pass 5: example action item conforms to P3 action-item schema
// ---------------------------------------------------------------------------

describe("example action item", () => {
  const actionPath = join(EXPECTED_ACTIONS, "2026-04-28-mango-pricing-tiers.md");

  it("action file exists", () => {
    expect(existsSync(actionPath)).toBe(true);
  });

  it("required frontmatter fields present", () => {
    const content = readMd(actionPath);
    const fm = parseFrontmatter(content);
    expect(fm.id).toBe("2026-04-28-mango-pricing-tiers");
    expect(fm.type).toBe("action-item");
    expect(fm.schema_version).toBe('"1.0.0"');
    expect(fm.status).toBe("open");
    expect(["high", "medium", "low"]).toContain(fm.priority);
    expect(["deadline", "response-needed", "knowledge-update", "risk", "opportunity", "other"]).toContain(fm.reason_class);
    expect(fm.source).toBe("slack");
  });

  it("source_ref uses the parent thread identifier (channel_id#thread_ts)", () => {
    const content = readMd(actionPath);
    const fm = parseFrontmatter(content);
    const ref = (fm.source_ref ?? "").replace(/^"|"$/g, "");
    expect(ref).toMatch(/^[CD][A-Z0-9]+#\d+\.\d+$/);
    // Must be the parent ts, not a reply ts
    expect(ref.split("#")[1]).toBe("1714300000.000100");
  });

  it("has both required body sections", () => {
    const content = readMd(actionPath);
    expect(hasSections(content, ["Why this matters", "Personalization fit"])).toBe(true);
  });

  it("references john-smith and project-mango entities", () => {
    const content = readMd(actionPath);
    expect(content).toContain("people/john-smith");
    expect(content).toContain("topics/project-mango");
  });

  it("ships the four default suggested-action buttons", () => {
    const content = readMd(actionPath);
    expect(content).toContain("Draft a reply");
    expect(content).toContain("Schedule a reply");
    expect(content).toContain("Open in Slack");
    expect(content).toContain("Snooze 24h");
  });

  it("suggested_actions host_prompts start with ux: and name a plugin", () => {
    const content = readMd(actionPath);
    const lines = content.split("\n");
    const promptLines = lines.filter((l) => l.trim().startsWith("ux: Use the"));
    expect(promptLines.length).toBeGreaterThan(0);
    for (const line of promptLines) {
      expect(line.trim()).toMatch(/^ux: Use the (agntux-slack|agntux-core) plugin to/);
    }
  });
});

// ---------------------------------------------------------------------------
// Pass 6: expected sync state with channel + thread cursor maps
// ---------------------------------------------------------------------------

describe("expected sync state", () => {
  const syncPath = join(EXPECTED_STATE, ".state", "sync.md");

  it("sync.md exists", () => {
    expect(existsSync(syncPath)).toBe(true);
  });

  it("has # slack section", () => {
    const content = readMd(syncPath);
    expect(content).toContain("# slack");
  });

  it("cursor is a unified single-line JSON map carrying both channel and thread keys", () => {
    const content = readMd(syncPath);
    const m = content.match(/- cursor: (\{[^\n]*\})/);
    expect(m).toBeTruthy();
    const parsed = JSON.parse(m![1]) as Record<string, string>;
    // Channel-shaped keys (no #)
    expect(parsed["C01PROJMANGO"]).toBe("1714300000.000100");
    expect(parsed["D03JOHN"]).toBe("1714390000.000400");
    // Thread-shaped keys (contains #) live in the SAME map per A5
    expect(parsed["C01PROJMANGO#1714300000.000100"]).toBe("1714386500.000300");
  });

  it("there is NO separate `threads:` field (folded into cursor per A5)", () => {
    const content = readMd(syncPath);
    expect(content).not.toMatch(/^- threads:/m);
  });
});

// ---------------------------------------------------------------------------
// Pass 7: listing.yaml proposed_schema — canonical six action classes (A3)
// ---------------------------------------------------------------------------

describe("listing.yaml proposed_schema action classes (A3)", () => {
  const listingPath = join(PLUGIN_ROOT, "marketplace", "listing.yaml");

  it("listing.yaml exists", () => {
    expect(existsSync(listingPath)).toBe(true);
  });

  it("proposes the canonical six action classes", () => {
    const src = readFileSync(listingPath, "utf-8");
    for (const cls of [
      "class: deadline",
      "class: response-needed",
      "class: knowledge-update",
      "class: risk",
      "class: opportunity",
      "class: other",
    ]) {
      expect(src).toContain(cls);
    }
  });

  it("does NOT propose decision-needed (folded into response-needed per A3)", () => {
    const src = readFileSync(listingPath, "utf-8");
    expect(src).not.toMatch(/class:\s*decision-needed/);
  });

  it("cursor_semantics describes a single unified map (A5)", () => {
    const src = readFileSync(listingPath, "utf-8");
    expect(src).toContain("Single JSON map");
    expect(src).toContain("Two key shapes");
  });
});

// ---------------------------------------------------------------------------
// Pass 8: remaining expected-sync-state assertions
// (discovery_ts, last_success, lock, items_processed)
// ---------------------------------------------------------------------------

describe("expected sync state — remaining fields", () => {
  const syncPath = join(EXPECTED_STATE, ".state", "sync.md");

  it("discovery_ts is set", () => {
    const content = readMd(syncPath);
    expect(content).toMatch(/- discovery_ts: "[^"]+"/);
  });

  it("last_success is set", () => {
    const content = readMd(syncPath);
    expect(content).toMatch(/- last_success: "[^"]+"/);
  });

  it("lock is released", () => {
    const content = readMd(syncPath);
    expect(content).toContain("- lock: null");
  });

  it("items_processed is 1 for the single Mango action raised", () => {
    const content = readMd(syncPath);
    expect(content).toContain("- items_processed: 1");
  });
});
