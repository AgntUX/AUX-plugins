// Tests for the maintain-index.mjs PostToolUse hook.
// Strategy: spawn the hook as a child process with stdin JSON, then inspect
// the resulting files on a temporary directory. We pass HOME=tmpRoot so that
// homedir() inside the hook resolves to our temp dir, making inScope() accept
// paths under tmpRoot/agntux/.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOOK_PATH = join(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../../../prompts/orchestrator/hooks/maintain-index.mjs"
);

/** Run the hook synchronously with the given stdin JSON payload.
 *  Passes HOME=tmpRoot so homedir() inside the hook resolves to our temp dir,
 *  making inScope() accept paths under tmpRoot/agntux/. */
function runHook(payload, home) {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, HOME: home },
  });
  return result;
}

/** Create a minimal entity file with optional sources frontmatter block. */
function writeEntityFile(dir, slug, summary = "Test entity.", sources = null) {
  const srcBlock = sources
    ? `sources:\n${Object.entries(sources).map(([k, v]) => `  ${k}: ${v}`).join("\n")}\n`
    : "";
  const content = `---
id: ${slug}
type: entity
subtype: companies
schema_version: "1.0.0"
${srcBlock}---

## Summary
${summary}
`;
  writeFileSync(join(dir, `${slug}.md`), content, "utf8");
}

/** Create a minimal action file. */
function writeActionFile(dir, id) {
  const content = `---
id: ${id}
type: action-item
schema_version: "1.0.0"
status: open
priority: high
reason_class: deadline
created_at: 2026-04-25T14:22:00Z
source: slack
source_ref: T01_test
---

## Why this matters
Test action.
`;
  writeFileSync(join(dir, `${id}.md`), content, "utf8");
}

// ---------------------------------------------------------------------------
// Fixture setup / teardown
// ---------------------------------------------------------------------------

let tmpRoot, entitiesRoot, actionsRoot, companiesDir;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `maintain-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  entitiesRoot = join(tmpRoot, "agntux", "entities");
  actionsRoot = join(tmpRoot, "agntux", "actions");
  companiesDir = join(entitiesRoot, "companies");
  mkdirSync(companiesDir, { recursive: true });
  mkdirSync(actionsRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Gap 2(a) — Idempotency: running the hook twice with the same write event
// produces a byte-identical _index.md (only updated_at may differ).
// Gap 5 option (a) in maintain-index.mjs skips the atomic rename when only
// the timestamp would change, so the file is literally unchanged on 2nd run.
// ---------------------------------------------------------------------------

describe("idempotency", () => {
  it("running hook twice with same write event leaves _index.md byte-identical (modulo updated_at)", () => {
    const slug = "acme-corp";
    writeEntityFile(companiesDir, slug);
    const filePath = join(companiesDir, `${slug}.md`);
    const payload = { tool_name: "Write", tool_input: { file_path: filePath } };

    runHook(payload, tmpRoot);
    const indexPath = join(companiesDir, "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const first = readFileSync(indexPath, "utf8");

    runHook(payload, tmpRoot);
    const second = readFileSync(indexPath, "utf8");

    // Strip updated_at for comparison — only timestamp is allowed to differ.
    const strip = (s) => s.replace(/^updated_at: .+$/m, "updated_at: __TS__");
    expect(strip(second)).toBe(strip(first));
  });
});

// ---------------------------------------------------------------------------
// Gap 2(b) — _sources.json dedup: writing the same (subtype, source, source_id)
// tuple twice produces exactly one row in _sources.json entries.
// ---------------------------------------------------------------------------

describe("_sources.json dedup", () => {
  it("writing same (subtype, source, source_id) twice yields exactly one entry", () => {
    const slug = "acme-corp";
    // Entity with a source entry.
    writeEntityFile(companiesDir, slug, "Acme Corp.", { hubspot: "hs-001" });
    const filePath = join(companiesDir, `${slug}.md`);
    const payload = { tool_name: "Write", tool_input: { file_path: filePath } };

    // First write.
    runHook(payload, tmpRoot);
    // Second write — identical event.
    runHook(payload, tmpRoot);

    const sourcesPath = join(entitiesRoot, "_sources.json");
    expect(existsSync(sourcesPath)).toBe(true);
    const record = JSON.parse(readFileSync(sourcesPath, "utf8"));
    const matching = record.entries.filter(
      (e) => e.subtype === "companies" && e.source === "hubspot" && e.source_id === "hs-001"
    );
    expect(matching).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Gap 2(c) — Path-filter: write event for a file outside ~/agntux-code/ produces
// no _index.md write (hook exits silently).
// ---------------------------------------------------------------------------

describe("path filter", () => {
  it("write event for /tmp/foo.md outside agntux root does not touch any _index.md", () => {
    const payload = { tool_name: "Write", tool_input: { file_path: "/tmp/foo.md" } };
    runHook(payload, tmpRoot);

    // No index should have been created in our temp dirs.
    expect(existsSync(join(actionsRoot, "_index.md"))).toBe(false);
    expect(existsSync(join(companiesDir, "_index.md"))).toBe(false);
  });

  it("hook exits silently for _index.md itself (no re-emit loop)", () => {
    const indexPath = join(companiesDir, "_index.md");
    writeFileSync(indexPath, "---\ntype: index\n---\n\n", "utf8");
    const payload = { tool_name: "Write", tool_input: { file_path: indexPath } };
    const result = runHook(payload, tmpRoot);
    expect(result.status).toBe(0);

    // Content should be unchanged — hook bailed without writing.
    const after = readFileSync(indexPath, "utf8");
    expect(after).toBe("---\ntype: index\n---\n\n");
  });
});

// ---------------------------------------------------------------------------
// Gap 2(d) — Atomic-rename smoke test: verify the hook uses a .tmp rename
// pattern rather than writing directly to the index path.
// This is a structural check — full race coverage isn't realistic in a unit test.
// ---------------------------------------------------------------------------

describe("atomic rename smoke test", () => {
  it("hook source uses atomic rename pattern (.tmp + renameSync)", () => {
    const src = readFileSync(HOOK_PATH, "utf8");
    // atomicWrite writes to a .tmp file then renames atomically.
    expect(src).toMatch(/\.tmp/);
    expect(src).toMatch(/renameSync/);
  });
});

// ---------------------------------------------------------------------------
// Bonus: action index is also written on action file events.
// ---------------------------------------------------------------------------

describe("action index write", () => {
  it("writes _index.md for action files inside ~/agntux-code/actions/", () => {
    const id = "2026-04-25-test-action";
    writeActionFile(actionsRoot, id);
    const filePath = join(actionsRoot, `${id}.md`);
    const payload = { tool_name: "Write", tool_input: { file_path: filePath } };

    runHook(payload, tmpRoot);

    const indexPath = join(actionsRoot, "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf8");
    expect(content).toContain(`[[${id}]]`);
  });
});
