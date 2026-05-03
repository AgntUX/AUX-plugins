// Validator hook unit tests — P3a §3, §7.
// Drives ../hooks/validate-schema.mjs as a child process with synthetic
// hook context payloads. Asserts blocking semantics: exit 2 on reject,
// exit 0 on pass.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../hooks/validate-schema.mjs", import.meta.url).pathname;

function runHook(ctx, agntuxRoot) {
  // The hook reads HOME via os.homedir(); we override it via env.
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(ctx),
    env: { ...process.env, HOME: agntuxRoot },
    encoding: "utf8",
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function setupAgntuxRoot() {
  // The hook calls `homedir()` and joins `agntux/...` underneath. We treat
  // the temp dir AS the home directory so `agntux/...` resolves correctly.
  const home = mkdtempSync(join(tmpdir(), "p3a-validator-"));
  mkdirSync(join(home, "agntux", "data", "schema"), { recursive: true });
  mkdirSync(join(home, "agntux", "entities", "people"), { recursive: true });
  mkdirSync(join(home, "agntux", "actions"), { recursive: true });
  return home;
}

function writeLock(homeRoot, lock) {
  const path = join(homeRoot, "agntux", "data", "schema", "schema.lock.json");
  writeFileSync(path, JSON.stringify(lock, null, 2));
}

function entityFrontmatter(overrides = {}) {
  return {
    id: "alice",
    type: "entity",
    schema_version: "1.0.0",
    subtype: "person",
    aliases: ["Alice"],
    sources: { notes: "/n/alice.md" },
    created_at: "2026-04-29",
    updated_at: "2026-04-29",
    last_active: "2026-04-29",
    deleted_upstream: null,
    ...overrides,
  };
}

function entityFile(fm = entityFrontmatter()) {
  const yaml = Object.entries(fm)
    .map(([k, v]) => {
      if (v === null) return `${k}: null`;
      if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`;
      if (typeof v === "object") {
        const inner = Object.entries(v)
          .map(([ik, iv]) => `  ${ik}: ${JSON.stringify(iv)}`)
          .join("\n");
        return `${k}:\n${inner}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");
  return `---\n${yaml}\n---\n\n## Summary\nA person.\n\n## Key Facts\n\n## Recent Activity\n\n## User notes\n`;
}

const VALID_LOCK = {
  schema_version: "1.0.0",
  generated_at: "2026-04-29T00:00:00Z",
  entity_subtypes: ["person", "company", "project", "topic"],
  action_classes: ["deadline", "response-needed", "knowledge-update", "risk", "opportunity", "other"],
  plugin_contracts: {
    "agntux-notes": {
      schema_version: "1.0.0",
      allowed_subtypes: ["person", "company", "project", "topic"],
      allowed_action_classes: ["knowledge-update", "deadline", "other"],
      approved_at: "2026-04-29T00:00:00Z",
      source_id_format: "Absolute file path under the configured notes directory.",
    },
    "agntux-slack": {
      schema_version: "1.0.0",
      allowed_subtypes: ["person", "company"],
      allowed_action_classes: ["response-needed", "deadline"],
      approved_at: "2026-04-29T00:00:00Z",
    },
    // Legacy slug retained to exercise the `*-ingest` verbatim branch in
    // validate-schema.mjs sourceTokenToSlug. Pre-rename entity files still
    // carrying `slack-ingest` source rows must validate against this contract
    // rather than misroute to `agntux-slack`.
    "slack-ingest": {
      schema_version: "1.0.0",
      allowed_subtypes: ["person", "company"],
      allowed_action_classes: ["response-needed", "deadline"],
      approved_at: "2026-01-01T00:00:00Z",
    },
  },
  checksum: "sha256:UNCOMPUTED",
};

describe("validate-schema hook", () => {
  let homeRoot;

  beforeEach(() => {
    homeRoot = setupAgntuxRoot();
  });

  afterEach(() => {
    if (homeRoot) rmSync(homeRoot, { recursive: true, force: true });
  });

  it("passes when path is outside entities/ and actions/", () => {
    writeLock(homeRoot, VALID_LOCK);
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "user.md"),
        content: "---\ntype: user-config\n---\n",
      },
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("passes when schema.lock.json does not exist (pre-bootstrap)", () => {
    const filePath = join(homeRoot, "agntux", "entities", "people", "alice.md");
    writeFileSync(filePath, entityFile());
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: filePath,
        content: entityFile(),
      },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("passes a valid entity write from an authorised plugin", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(homeRoot, "agntux", "entities", "people", "alice.md");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityFile() },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("legacy *-ingest slug resolves to its own contract verbatim (not coerced to agntux-* prefix)", () => {
    // Migration window: pre-rename entity files may carry `plugin: "slack-ingest"`
    // in the hook event. The validator's sourceTokenToSlug must accept this
    // verbatim (branch 2 of the ladder) rather than rewriting it to
    // `agntux-slack-ingest` or `agntux-slack`. Without this branch a stale
    // entity file from before the rename would route to the wrong contract.
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(homeRoot, "agntux", "entities", "people", "legacy.md");
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityFile() },
      plugin: "slack-ingest",
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("legacy *-ingest slug still enforces its contract's subtype restrictions", () => {
    // Belt-and-braces: the legacy slug isn't a free pass — it must enforce
    // its own contract. slack-ingest's contract excludes `project`.
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(homeRoot, "agntux", "entities", "projects", "legacy.md");
    mkdirSync(join(homeRoot, "agntux", "entities", "projects"), { recursive: true });
    const fm = entityFrontmatter({ id: "legacy", subtype: "project" });
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityFile(fm) },
      plugin: "slack-ingest",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/slack-ingest.*project/);
  });

  it("rejects when subtype is not in plugin's contract", () => {
    writeLock(homeRoot, VALID_LOCK);
    // agntux-slack's contract excludes `project`; try to write one.
    const filePath = join(homeRoot, "agntux", "entities", "projects", "mango.md");
    mkdirSync(join(homeRoot, "agntux", "entities", "projects"), { recursive: true });
    const fm = entityFrontmatter({ id: "mango", subtype: "project" });
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityFile(fm) },
      plugin: "agntux-slack",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/agntux-slack.*project/);
  });

  it("rejects when frontmatter is missing a required field", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(homeRoot, "agntux", "entities", "people", "alice.md");
    const fm = entityFrontmatter();
    delete fm.aliases;
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityFile(fm) },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/aliases/);
  });

  it("rejects when subtype is not in tenant schema at all", () => {
    writeLock(homeRoot, VALID_LOCK);
    mkdirSync(join(homeRoot, "agntux", "entities", "incidents"), { recursive: true });
    const filePath = join(homeRoot, "agntux", "entities", "incidents", "p0-2026-01.md");
    const fm = entityFrontmatter({ id: "p0-2026-01", subtype: "incident" });
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityFile(fm) },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/incident.*not in/);
  });

  it("ignores _index.md writes (hook territory)", () => {
    writeLock(homeRoot, VALID_LOCK);
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "entities", "people", "_index.md"),
        content: "# index\n",
      },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Action-item validation
  // -------------------------------------------------------------------------

  function actionFile(overrides = {}) {
    const fm = {
      id: "2026-04-29-followup-acme",
      type: "action-item",
      schema_version: "1.0.0",
      status: "open",
      priority: "high",
      reason_class: "deadline",
      created_at: "2026-04-29T14:22:00Z",
      source: "notes",
      source_ref: "/n/acme.md",
      related_entities: ["companies/acme"],
      suggested_actions: [{ label: "Open", host_prompt: "ux: open it" }],
      ...overrides,
    };
    const yaml = Object.entries(fm)
      .map(([k, v]) => {
        if (Array.isArray(v) && typeof v[0] === "object") return `${k}:\n  - label: "${v[0].label}"\n    host_prompt: "${v[0].host_prompt}"`;
        if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`;
        if (v === null) return `${k}: null`;
        return `${k}: ${JSON.stringify(v)}`;
      })
      .join("\n");
    return `---\n${yaml}\n---\n\n## Why this matters\nThing.\n\n## Personalization fit\n- match\n`;
  }

  it("passes a valid action item from an authorised plugin", () => {
    writeLock(homeRoot, VALID_LOCK);
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "actions", "2026-04-29-followup-acme.md"),
        content: actionFile(),
      },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("rejects when reason_class is not in plugin's contract", () => {
    writeLock(homeRoot, VALID_LOCK);
    // agntux-notes's allowed_action_classes are knowledge-update, deadline, other.
    // `risk` is in tenant schema but NOT in agntux-notes's contract.
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "actions", "2026-04-29-acme-risk.md"),
        content: actionFile({ id: "2026-04-29-acme-risk", reason_class: "risk" }),
      },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/agntux-notes.*risk/);
  });

  it("rejects when reason_class is not in tenant schema at all", () => {
    writeLock(homeRoot, VALID_LOCK);
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "actions", "2026-04-29-x.md"),
        content: actionFile({ id: "2026-04-29-x", reason_class: "fictional-class" }),
      },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/fictional-class.*not in/);
  });

  it("rejects action with reason_class=other but no reason_detail", () => {
    writeLock(homeRoot, VALID_LOCK);
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "actions", "2026-04-29-y.md"),
        content: actionFile({ id: "2026-04-29-y", reason_class: "other" }),
      },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/reason_detail/);
  });

  it("rejects action with invalid status enum", () => {
    writeLock(homeRoot, VALID_LOCK);
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "actions", "2026-04-29-z.md"),
        content: actionFile({ id: "2026-04-29-z", status: "in-progress" }),
      },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/status/);
  });

  // -------------------------------------------------------------------------
  // Plugin-slug resolution paths
  // -------------------------------------------------------------------------

  it("falls back to action frontmatter `source` when hook payload omits plugin", () => {
    writeLock(homeRoot, VALID_LOCK);
    // No `plugin` key on the context — slug must be derived from `source: notes`.
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "actions", "2026-04-29-fallback.md"),
        content: actionFile({ id: "2026-04-29-fallback", reason_class: "risk" }),
      },
    }, homeRoot);
    // Without agntux-notes contract restricting `risk`, the schema-level check
    // would pass (`risk` is in entity_subtypes? wait, action_classes). It IS in
    // tenant action_classes. But `risk` is NOT in agntux-notes's allowed list,
    // so the contract check should still reject when fallback resolves to agntux-notes.
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/agntux-notes.*risk/);
  });

  it("falls back to entity sources map (single key) when payload omits plugin", () => {
    writeLock(homeRoot, VALID_LOCK);
    // agntux-slack contract excludes `project`. Entity sources has only "slack".
    mkdirSync(join(homeRoot, "agntux", "entities", "projects"), { recursive: true });
    const fm = entityFrontmatter({
      id: "mango",
      subtype: "project",
      sources: { slack: "C123" },
    });
    const result = runHook({
      tool_name: "Write",
      tool_input: {
        file_path: join(homeRoot, "agntux", "entities", "projects", "mango.md"),
        content: entityFile(fm),
      },
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/agntux-slack.*project/);
  });

  // -------------------------------------------------------------------------
  // schema_version mismatch
  // -------------------------------------------------------------------------

  it("rejects when entity schema_version mismatches plugin contract", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(homeRoot, "agntux", "entities", "people", "alice.md");
    const fm = entityFrontmatter({ schema_version: "0.9.0" });
    const result = runHook({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: entityFile(fm) },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/schema_version.*0\.9\.0/);
  });

  // -------------------------------------------------------------------------
  // Edit semantics
  // -------------------------------------------------------------------------

  it("Edit: status change merges with disk content and passes", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(homeRoot, "agntux", "actions", "2026-04-29-edit.md");
    const original = actionFile({ id: "2026-04-29-edit" });
    writeFileSync(filePath, original);
    const result = runHook({
      tool_name: "Edit",
      tool_input: {
        file_path: filePath,
        old_string: "status: \"open\"",
        new_string: "status: \"snoozed\"",
      },
      plugin: "agntux-core",
    }, homeRoot);
    expect(result.code).toBe(0);
  });

  it("Edit: change to invalid subtype is rejected", () => {
    writeLock(homeRoot, VALID_LOCK);
    const filePath = join(homeRoot, "agntux", "entities", "people", "alice.md");
    writeFileSync(filePath, entityFile());
    const result = runHook({
      tool_name: "Edit",
      tool_input: {
        file_path: filePath,
        old_string: "subtype: \"person\"",
        new_string: "subtype: \"goblin\"",
      },
      plugin: "agntux-notes",
    }, homeRoot);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/goblin/);
  });
});
