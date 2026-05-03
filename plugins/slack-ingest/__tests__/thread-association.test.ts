/**
 * thread-association.test.ts
 *
 * Validates the load-bearing thread invariant from the previous
 * Slack-ingestion attempt's lesson: every action item, every entity-source
 * row, and every dedup lookup MUST use the parent's `(channel_id, thread_ts)`
 * as the canonical reference, never a reply's own `ts`.
 *
 * Without this rule, the same person mentioned across N replies in one
 * thread would create N duplicate `_sources.json` rows, and the same thread
 * would raise a fresh action item on every new reply.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = join(PLUGIN_ROOT, "examples", "starter-thread");
const EXPECTED_ENTITIES = join(EXAMPLES_DIR, "expected-entities");
const EXPECTED_ACTIONS = join(EXAMPLES_DIR, "expected-actions");
const SLACK_EXPORT = join(EXAMPLES_DIR, "slack-export");

// Parent ts for the Mango thread; replies must NOT key any source row.
const MANGO_PARENT_TS = "1714300000.000100";
const MANGO_REPLY_TS = ["1714300100.000200", "1714386500.000300"];

function readMd(p: string): string {
  return readFileSync(p, "utf-8");
}

function collectMdFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMdFiles(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Pass 1: ingest.md prompt codifies the parent-ref rule
// ---------------------------------------------------------------------------

describe("ingest.md thread-association rule", () => {
  const ingestMd = join(PLUGIN_ROOT, "agents", "ingest.md");
  const src = readMd(ingestMd);

  it("documents source_id format keyed on parent thread", () => {
    expect(src).toContain("<channel_id>#<thread_ts>");
  });

  it("forbids using a reply's own ts as the source key (lesson from prior attempt)", () => {
    expect(src).toContain("never the reply's own ts");
  });

  it("documents the unified cursor map carrying both channel and thread keys (per A5)", () => {
    expect(src).toContain("unified");
    expect(src).toContain("two key shapes");
    expect(src).toContain("<channel_id>#<thread_ts>");
  });

  it("does NOT introduce a separate `threads:` field in sync.md (A5)", () => {
    // The prompt should describe a single cursor map. There must be no
    // instruction telling the agent to read or write a `threads:` field.
    expect(src).not.toMatch(/Read.+threads:/);
    expect(src).not.toMatch(/`threads`\s+field/);
  });

  it("documents the 30-day eviction policy on thread-shaped entries (channel-shaped never evicted)", () => {
    expect(src).toContain("30 days");
    expect(src).toContain("evicted");
    expect(src).toContain("Channel-shaped entries are never evicted");
  });

  it("documents the 'reply detected via thread_ts !== ts' branch", () => {
    expect(src).toContain("thread_ts");
  });

  it("documents that Recent Activity bullets cite the thread once per run, not once per reply", () => {
    expect(src).toContain("once per ingest run, not once per reply");
  });

  it("Step 5d skips threads already fanned out in Step 5c (no duplicate slack_read_thread calls)", () => {
    expect(src).toContain("fanned_out");
    expect(src).toContain("NOT in the `fanned_out` set");
  });

  it("Step 5d handles null-cursor (newly discovered) threads via a bootstrap branch", () => {
    expect(src).toContain("Bootstrap branch");
    expect(src).toContain("cursor[<channel_id>#<thread_ts>] === null");
  });

  it("Step 5b discovery only upserts missing keys (must not clobber existing cursors)", () => {
    expect(src).toContain("upserts missing keys");
    expect(src).toContain("must NOT overwrite an existing");
  });
});

// ---------------------------------------------------------------------------
// Pass 2: every entity-source row in the fixture uses the parent ts
// ---------------------------------------------------------------------------

describe("entity-source rows key on parent thread", () => {
  const entityFiles = collectMdFiles(EXPECTED_ENTITIES);

  it("fixture has at least one entity file", () => {
    expect(entityFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of entityFiles) {
    const label = filePath.split("/").slice(-2).join("/");

    it(`${label}: every slack: source row uses the parent thread ts`, () => {
      const content = readMd(filePath);
      // Match `slack: "<value>"` or `slack: <bare-value>` lines under the sources block.
      const slackLines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("slack:"));
      expect(slackLines.length).toBeGreaterThan(0);
      for (const line of slackLines) {
        // None of the reply-only ts values may appear in any source row
        for (const replyTs of MANGO_REPLY_TS) {
          expect(line).not.toContain(replyTs);
        }
        // The parent ts must be the one referenced for our Mango fixture
        if (line.includes("C01PROJMANGO")) {
          expect(line).toContain(MANGO_PARENT_TS);
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Pass 3: action item source_ref keys on parent thread, not a reply
// ---------------------------------------------------------------------------

describe("action item source_ref keys on parent thread", () => {
  const actionPath = join(EXPECTED_ACTIONS, "2026-04-28-mango-pricing-tiers.md");

  it("action file exists", () => {
    expect(existsSync(actionPath)).toBe(true);
  });

  it("source_ref is the parent <channel_id>#<thread_ts>, never a reply ts", () => {
    const content = readMd(actionPath);
    const m = content.match(/source_ref:\s*"?([^"\n]+)"?/);
    expect(m).toBeTruthy();
    const ref = m![1].trim().replace(/^"|"$/g, "");
    expect(ref).toBe(`C01PROJMANGO#${MANGO_PARENT_TS}`);
    for (const replyTs of MANGO_REPLY_TS) {
      expect(ref).not.toContain(replyTs);
    }
  });
});

// ---------------------------------------------------------------------------
// Pass 4: no duplicate action items for the same thread on re-ingest
// ---------------------------------------------------------------------------

describe("idempotent thread ingest", () => {
  it("fixture does NOT contain a -2 / -3 collision-suffix file for the Mango thread", () => {
    if (!existsSync(EXPECTED_ACTIONS)) return;
    const files = readdirSync(EXPECTED_ACTIONS).filter((f) =>
      f.includes("mango-pricing-tiers")
    );
    // A second ingest run must not create mango-pricing-tiers-2.md — instead
    // the existing item's body is updated to cite the new reply.
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("2026-04-28-mango-pricing-tiers.md");
  });
});

// ---------------------------------------------------------------------------
// Pass 5: every reply in the synthetic Slack export resolves to its parent
// ---------------------------------------------------------------------------

describe("synthetic Slack export — every reply resolves to its parent", () => {
  it("messages.jsonl has exactly one parent for every reply (no orphans)", () => {
    const path = join(SLACK_EXPORT, "messages.jsonl");
    const content = readFileSync(path, "utf-8");
    const lines = content.trim().split("\n").map((l) => JSON.parse(l) as {
      ts: string;
      thread_ts: string;
      channel_id: string;
      reply_count?: number;
    });

    const parents = new Set<string>();
    for (const m of lines) {
      if (m.ts === m.thread_ts) {
        parents.add(`${m.channel_id}#${m.thread_ts}`);
      }
    }

    for (const m of lines) {
      // Skip standalone messages (where ts === thread_ts and reply_count is 0)
      if (m.ts === m.thread_ts) continue;
      // Reply: parent must exist
      const parentKey = `${m.channel_id}#${m.thread_ts}`;
      expect(parents.has(parentKey)).toBe(true);
    }
  });
});
