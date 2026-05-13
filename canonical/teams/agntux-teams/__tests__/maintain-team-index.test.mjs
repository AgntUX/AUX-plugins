// maintain-team-index.mjs unit tests.
// Tests are direct module imports (not a child-process spawn) for the rebuild
// functions, since the hook's index rebuild logic is fully deterministic and
// the child-process spawn is reserved for end-to-end stdin smoke tests.
//
// Uses _setAgntuxRootForTesting to redirect the resolver so the temp dir
// behaves as the project root.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { _setAgntuxRootForTesting } from "../hooks/lib/agntux-root.mjs";
import {
  rebuildEntitySubtypeIndex,
  rebuildEntitiesRollup,
  updateTeamSourcesJson,
  rebuildActionsIndex,
  classify,
} from "../hooks/maintain-team-index.mjs";

const HOOK = new URL("../hooks/maintain-team-index.mjs", import.meta.url)
  .pathname;

function setupRoot() {
  const dir = mkdtempSync(join(tmpdir(), "maintain-team-index-"));
  mkdirSync(join(dir, "agntux", "teams", "platform", "entities", "people"), {
    recursive: true,
  });
  mkdirSync(join(dir, "agntux", "teams", "platform", "actions"), {
    recursive: true,
  });
  mkdirSync(
    join(dir, "agntux", "leader-views", "all-engineering", "actions"),
    { recursive: true },
  );
  return join(dir, "agntux");
}

function writeEntity(root, subtype, slug, options = {}) {
  const path = join(root, "teams", "platform", "entities", subtype, `${slug}.md`);
  const fm = {
    id: slug,
    subtype,
    entity_id: options.entity_id ?? null,
    sources: options.sources ?? null,
  };
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === "object") {
      lines.push(`${k}:`);
      for (const [ik, iv] of Object.entries(v)) {
        if (Array.isArray(iv)) {
          lines.push(`  ${ik}:`);
          for (const x of iv) lines.push(`    - ${x}`);
        } else {
          lines.push(`  ${ik}: ${iv}`);
        }
      }
    } else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---");
  lines.push("");
  lines.push("## Summary");
  lines.push(options.summary ?? `Summary for ${slug}.`);
  lines.push("");
  writeFileSync(path, lines.join("\n"));
  return path;
}

function writeAction(root, id, options = {}) {
  const path = join(root, "teams", "platform", "actions", `${id}.md`);
  const fm = [
    "---",
    "team_id: uuid-platform",
    "team_slug: platform",
    `schema_version: "1.0.0"`,
    options.trigger_key !== undefined
      ? `trigger_key: ${JSON.stringify(options.trigger_key)}`
      : "",
    options.reason_class !== undefined
      ? `reason_class: ${options.reason_class}`
      : "reason_class: customer-pain",
    options.status !== undefined ? `status: ${options.status}` : "status: open",
    `created_at: ${options.created_at ?? "2026-05-12T14:30:00Z"}`,
  ].filter(Boolean);

  if (options.entity_id) {
    fm.push("entity_refs:");
    fm.push(`  - entity_id: ${options.entity_id}`);
    fm.push("    role: subject");
  } else if (options.source_ref) {
    fm.push(`source_ref: ${JSON.stringify(options.source_ref)}`);
  }

  fm.push("---");
  fm.push("");
  fm.push("## Why this matters");
  fm.push(options.body ?? `Body for ${id}.`);
  fm.push("");
  writeFileSync(path, fm.join("\n"));
  return path;
}

describe("maintain-team-index hook", () => {
  let root;

  beforeEach(() => {
    root = setupRoot();
    _setAgntuxRootForTesting(root);
  });

  afterEach(() => {
    _setAgntuxRootForTesting(null);
    rmSync(join(root, ".."), { recursive: true, force: true });
  });

  describe("rebuildEntitySubtypeIndex", () => {
    it("emits a per-subtype _index.md with one line per entity", () => {
      writeEntity(root, "people", "alice", { summary: "Alice is a person." });
      writeEntity(root, "people", "bob", { summary: "Bob is also a person." });
      const subtypeDir = join(root, "teams", "platform", "entities", "people");
      rebuildEntitySubtypeIndex(subtypeDir, "platform");
      const idxRaw = readFileSync(join(subtypeDir, "_index.md"), "utf8");
      expect(idxRaw).toMatch(/team_slug: "platform"/);
      expect(idxRaw).toMatch(/- \[\[alice\]\] —/);
      expect(idxRaw).toMatch(/- \[\[bob\]\] —/);
      expect(idxRaw).toMatch(/entry_count: 2/);
    });

    it("ignores _index.md when scanning", () => {
      writeEntity(root, "people", "alice");
      const subtypeDir = join(root, "teams", "platform", "entities", "people");
      // First rebuild creates _index.md.
      rebuildEntitySubtypeIndex(subtypeDir, "platform");
      // Second rebuild must not include _index in the count.
      rebuildEntitySubtypeIndex(subtypeDir, "platform");
      const idxRaw = readFileSync(join(subtypeDir, "_index.md"), "utf8");
      expect(idxRaw).toMatch(/entry_count: 1/);
    });
  });

  describe("rebuildActionsIndex with trigger_key_index", () => {
    it("emits a trigger_key_index map keyed by trigger_key", () => {
      writeAction(root, "2026-05-12-a", {
        trigger_key: "abc1234567890def",
        reason_class: "customer-pain",
        entity_id: "e1",
      });
      writeAction(root, "2026-05-12-b", {
        trigger_key: "fedcba9876543210",
        reason_class: "product-decisions",
        entity_id: "e2",
      });
      const actionsRoot = join(root, "teams", "platform", "actions");
      rebuildActionsIndex(actionsRoot, "team", "platform");
      const idxRaw = readFileSync(join(actionsRoot, "_index.md"), "utf8");
      expect(idxRaw).toMatch(/trigger_key_index:/);
      expect(idxRaw).toMatch(/"abc1234567890def"/);
      expect(idxRaw).toMatch(/"fedcba9876543210"/);
      expect(idxRaw).toMatch(/2026-05-12-a\.md/);
      expect(idxRaw).toMatch(/2026-05-12-b\.md/);
    });

    it("recomputes trigger_key from entity_refs when frontmatter omits it (fallback path)", () => {
      // Write an action file WITHOUT trigger_key — exercises the
      // readFrontmatterWithEntityRefs + resolveTriggerInputs + computeTriggerKey
      // fallback chain in maintain-team-index.mjs.
      writeAction(root, "2026-05-12-fallback", {
        reason_class: "customer-pain",
        entity_id: "8f4b2c1d3e5a7b9c",
        // intentionally no trigger_key option
      });
      const actionsRoot = join(root, "teams", "platform", "actions");
      rebuildActionsIndex(actionsRoot, "team", "platform");
      const idxRaw = readFileSync(join(actionsRoot, "_index.md"), "utf8");
      // The hook should have recomputed the hash from team_slug:reason_class:entity_id.
      // sha256("platform:customer-pain:8f4b2c1d3e5a7b9c").slice(0,16) — assert
      // that *some* trigger key was indexed for this file (the byte-exact value
      // is pinned by trigger-key.test.mjs).
      expect(idxRaw).toMatch(/trigger_key_index:/);
      expect(idxRaw).toMatch(/2026-05-12-fallback\.md/);
      // The map must NOT be empty — the fallback must have produced a key.
      const triggerSection = idxRaw.split("trigger_key_index:")[1];
      expect(triggerSection).toMatch(/"[0-9a-f]{16}"/);
    });

    it("excludes status: superseded rows from trigger_key_index", () => {
      // The canonical row stays open; the superseded duplicate must not appear
      // in the index, so the next de-conflict cycle doesn't re-fire on it.
      writeAction(root, "2026-05-12-canonical", {
        trigger_key: "sup1234567890abc",
        entity_id: "e1",
        status: "open",
      });
      writeAction(root, "2026-05-12-dup", {
        trigger_key: "sup1234567890abc",
        entity_id: "e1",
        status: "superseded",
      });
      const actionsRoot = join(root, "teams", "platform", "actions");
      rebuildActionsIndex(actionsRoot, "team", "platform");
      const idxRaw = readFileSync(join(actionsRoot, "_index.md"), "utf8");
      const triggerSection = idxRaw.split("trigger_key_index:")[1];
      expect(triggerSection).toMatch(/2026-05-12-canonical\.md/);
      expect(triggerSection).not.toMatch(/2026-05-12-dup\.md/);
    });

    it("groups files that share the same trigger_key into a list (>1 entry = duplicate)", () => {
      writeAction(root, "2026-05-12-a", {
        trigger_key: "dup1234567890abc",
        entity_id: "e1",
      });
      writeAction(root, "2026-05-12-a-2", {
        trigger_key: "dup1234567890abc",
        entity_id: "e1",
      });
      const actionsRoot = join(root, "teams", "platform", "actions");
      rebuildActionsIndex(actionsRoot, "team", "platform");
      const idxRaw = readFileSync(join(actionsRoot, "_index.md"), "utf8");
      // Both files appear under the same trigger_key.
      expect(idxRaw).toMatch(/2026-05-12-a\.md/);
      expect(idxRaw).toMatch(/2026-05-12-a-2\.md/);
      const triggerLineRegion = idxRaw.split("trigger_key_index:")[1];
      expect(triggerLineRegion).toMatch(/2026-05-12-a\.md/);
      expect(triggerLineRegion).toMatch(/2026-05-12-a-2\.md/);
    });

    it("scopes the index to view-actions when called with scope='view'", () => {
      const viewActions = join(
        root,
        "leader-views",
        "all-engineering",
        "actions",
      );
      writeFileSync(
        join(viewActions, "2026-05-12-x.md"),
        [
          "---",
          "view_slug: all-engineering",
          "view_id: uuid-view-eng",
          `schema_version: "1.0.0"`,
          "status: open",
          "triggered_by_rule_hash: ruleabcd12345678",
          "created_at: 2026-05-12T14:30:00Z",
          "---",
          "",
          "## Why this matters",
          "Body.",
          "",
        ].join("\n"),
      );
      rebuildActionsIndex(viewActions, "view", "all-engineering");
      const idxRaw = readFileSync(join(viewActions, "_index.md"), "utf8");
      expect(idxRaw).toMatch(/scope: "view-actions"/);
      expect(idxRaw).toMatch(/view_slug: "all-engineering"/);
    });
  });

  describe("updateTeamSourcesJson with entity_id_index", () => {
    it("maintains an entity_id_index reverse map for lookup-before-write", () => {
      const filePath = writeEntity(root, "people", "alice", {
        entity_id: "8f4b2c1d3e5a7b9c",
        sources: { slack: "U123" },
      });
      const entitiesRoot = join(root, "teams", "platform", "entities");
      const fm = {
        id: "alice",
        subtype: "people",
        entity_id: "8f4b2c1d3e5a7b9c",
        sources: { slack: "U123" },
      };
      updateTeamSourcesJson(filePath, fm, entitiesRoot, "platform");
      const raw = readFileSync(
        join(entitiesRoot, "_sources.json"),
        "utf8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.entity_id_index).toBeTypeOf("object");
      expect(parsed.entity_id_index["8f4b2c1d3e5a7b9c"]).toMatch(/alice\.md$/);
      expect(parsed.entries.some((e) => e.source === "slack")).toBe(true);
      expect(parsed.entries[0].team_slug).toBe("platform");
    });
  });

  describe("hook end-to-end (child-process)", () => {
    it("exits 0 silently for paths outside teams/ and leader-views/", () => {
      const home = mkdtempSync(join(tmpdir(), "maintain-team-index-spawn-"));
      mkdirSync(join(home, "agntux", "entities"), { recursive: true });
      const r = spawnSync("node", [HOOK], {
        input: JSON.stringify({
          tool_name: "Write",
          tool_input: {
            file_path: join(home, "agntux", "entities", "x.md"),
          },
        }),
        env: { ...process.env, HOME: home },
        cwd: home,
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      rmSync(home, { recursive: true, force: true });
    });

    it("exits 0 silently for non-Write/Edit tool calls", () => {
      const home = mkdtempSync(join(tmpdir(), "maintain-team-index-spawn2-"));
      mkdirSync(join(home, "agntux"), { recursive: true });
      const r = spawnSync("node", [HOOK], {
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "ls" },
        }),
        env: { ...process.env, HOME: home },
        cwd: home,
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      rmSync(home, { recursive: true, force: true });
    });
  });
});

describe("classify", () => {
  let root;
  beforeEach(() => {
    root = setupRoot();
    _setAgntuxRootForTesting(root);
  });
  afterEach(() => {
    _setAgntuxRootForTesting(null);
    rmSync(join(root, ".."), { recursive: true, force: true });
  });

  it("returns null for _index.md (hook-owned files do not retrigger themselves)", () => {
    expect(
      classify(
        join(root, "teams", "platform", "actions", "_index.md"),
      ),
    ).toBeNull();
  });

  it("returns null for _sources.json", () => {
    expect(
      classify(
        join(root, "teams", "platform", "entities", "_sources.json"),
      ),
    ).toBeNull();
  });

  it("classifies team-entity paths", () => {
    const result = classify(
      join(root, "teams", "platform", "entities", "people", "alice.md"),
    );
    expect(result?.kind).toBe("team-entity");
    expect(result?.teamSlug).toBe("platform");
  });

  it("classifies team-action paths", () => {
    const result = classify(
      join(root, "teams", "platform", "actions", "2026-05-12-x.md"),
    );
    expect(result?.kind).toBe("team-action");
    expect(result?.teamSlug).toBe("platform");
  });

  it("classifies view-action paths", () => {
    const result = classify(
      join(
        root,
        "leader-views",
        "all-engineering",
        "actions",
        "2026-05-12-x.md",
      ),
    );
    expect(result?.kind).toBe("view-action");
    expect(result?.viewSlug).toBe("all-engineering");
  });

  it("returns null for unrelated paths", () => {
    expect(classify(join(root, "entities", "x.md"))).toBeNull();
    expect(classify(join(root, "actions", "x.md"))).toBeNull();
  });
});
