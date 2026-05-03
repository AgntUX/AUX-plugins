/**
 * draft-flow.test.ts
 *
 * Validates that `agents/draft.md`'s prompt structure makes it impossible
 * to call a Slack write tool without an explicit user "yes" in the
 * immediately preceding turn.
 *
 * LIMITATION (per T18 pattern): the draft agent is an LLM. We can't
 * stage a real conversation in a unit test. Instead we assert that the
 * prompt itself codifies the gate — every reference to a write tool is
 * paired with a confirmation requirement, and the "no auto-pivot",
 * "exact payload", and "no signature padding" rules are all present.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRAFT_MD = join(PLUGIN_ROOT, "agents", "draft.md");

function readMd(p: string): string {
  return readFileSync(p, "utf-8");
}

const WRITE_TOOLS = [
  "slack_send_message",
  "slack_send_message_draft",
  "slack_schedule_message",
  "slack_create_canvas",
  "slack_update_canvas",
];

// ---------------------------------------------------------------------------
// Pass 1: draft.md exists and references each write tool
// ---------------------------------------------------------------------------

describe("draft.md write-tool references", () => {
  it("draft.md exists", () => {
    expect(existsSync(DRAFT_MD)).toBe(true);
  });

  for (const tool of WRITE_TOOLS) {
    it(`draft.md references ${tool}`, () => {
      const src = readMd(DRAFT_MD);
      expect(src).toContain(tool);
    });
  }
});

// ---------------------------------------------------------------------------
// Pass 2: confirmation gate is codified
// ---------------------------------------------------------------------------

describe("draft.md confirmation gate", () => {
  const src = readMd(DRAFT_MD);

  it("requires explicit yes in the immediately preceding turn", () => {
    expect(src).toContain("explicit user `yes`");
    expect(src).toContain("immediately preceding turn");
  });

  it("forbids prior yes answers from carrying over to a new payload", () => {
    expect(src).toContain("Prior `yes` answers in earlier turns do NOT carry over");
  });

  it("documents the Send this now? (yes / no / edit) prompt template", () => {
    expect(src).toContain("Send this now? (yes / no / edit)");
  });

  it("documents the 'no' branch — discard with no write call", () => {
    expect(src).toContain("Discarded.");
    expect(src).toContain("No write tool is called");
  });

  it("documents the 'edit' branch — accept revisions, re-confirm", () => {
    expect(src).toContain("Accept user revisions");
    expect(src).toContain("re-show the full payload");
  });
});

// ---------------------------------------------------------------------------
// Pass 3: payload integrity rules
// ---------------------------------------------------------------------------

describe("draft.md payload integrity", () => {
  const src = readMd(DRAFT_MD);

  it("requires showing the exact payload — no paraphrasing", () => {
    expect(src).toContain("exact");
    expect(src).toContain("payload");
    expect(src).toMatch(/no.+hand-waves/i);
  });

  it("requires quoting the original message above the draft", () => {
    expect(src).toContain("Quote the original message");
  });

  it("forbids auto-pivoting verbs", () => {
    expect(src).toContain("Never auto-pivot");
  });

  it("documents tone discipline — no injected signatures", () => {
    expect(src).toContain("Tone discipline");
    expect(src).toContain("No injected signatures");
  });

  it("does not pre-fill orchestrator-authored content during ingest", () => {
    expect(src).toContain("Do not pre-fill orchestrator-authored content");
  });
});

// ---------------------------------------------------------------------------
// Pass 4: read-only context fetch happens before draft
// ---------------------------------------------------------------------------

describe("draft.md read-before-write order", () => {
  const src = readMd(DRAFT_MD);

  it("Step 3 fetches the full thread context via slack_read_thread", () => {
    // The "Step 3" header should reference slack_read_thread
    const stepThreeIdx = src.indexOf("## Step 3");
    expect(stepThreeIdx).toBeGreaterThan(0);
    const stepFourIdx = src.indexOf("## Step 4");
    const stepThree = src.slice(stepThreeIdx, stepFourIdx > 0 ? stepFourIdx : undefined);
    expect(stepThree).toContain("slack_read_thread");
  });

  it("Step 5 (draft payload) precedes any write tool reference in flow", () => {
    const stepFiveIdx = src.indexOf("## Step 5");
    const stepSixIdx = src.indexOf("## Step 6");
    const stepFive = src.slice(stepFiveIdx, stepSixIdx > 0 ? stepSixIdx : undefined);
    expect(stepFive.toLowerCase()).toContain("do not call any write tool yet");
  });

  it("Step 7 yes branch is the only place that calls write tools", () => {
    const stepSevenIdx = src.indexOf("## Step 7");
    const honestyIdx = src.indexOf("## Hard rules");
    const stepSeven = src.slice(stepSevenIdx, honestyIdx > 0 ? honestyIdx : undefined);
    // The yes sub-branch must reference at least one of the write tools
    expect(stepSeven).toContain("### `yes`");
    const yesBlock = stepSeven.slice(stepSeven.indexOf("### `yes`"));
    expect(yesBlock).toMatch(/slack_send_message|slack_schedule_message|slack_create_canvas/);
  });
});

// ---------------------------------------------------------------------------
// Pass 5: SKILL.md dispatches suggested-action prompts to the draft subagent
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pass 6: A4 — Step 8 calls set_status MCP, not direct frontmatter writes
// ---------------------------------------------------------------------------

describe("draft.md Step 8 uses agntux-core MCP for action mutation (A4)", () => {
  const src = readMd(DRAFT_MD);

  it("Step 8 calls mcp__agntux-core__set_status", () => {
    expect(src).toContain("mcp__agntux-core__set_status");
  });

  it("Step 8 explicitly forbids direct frontmatter writes", () => {
    expect(src).toContain("Direct frontmatter writes from this agent are forbidden");
  });

  it("Step 8 forbids fallback to direct frontmatter editing on MCP failure", () => {
    expect(src).toContain("Do NOT fall back to direct frontmatter editing");
  });

  it("tool surface lists mcp__agntux-core__set_status", () => {
    const toolIdx = src.indexOf("## Tool surface");
    expect(toolIdx).toBeGreaterThan(0);
    const block = src.slice(toolIdx);
    expect(block).toContain("mcp__agntux-core__set_status");
  });

  it("Step 8 success and failure messages are verb-aware (covers all four verbs)", () => {
    const stepEightIdx = src.indexOf("## Step 8");
    const hardRulesIdx = src.indexOf("## Hard rules");
    const stepEight = src.slice(stepEightIdx, hardRulesIdx);
    // Each verb must appear in the verb-aware messaging block.
    for (const verb of ["draft a reply", "schedule a reply", "summarise to canvas", "save as draft"]) {
      expect(stepEight).toContain(verb);
    }
  });
});

describe("SKILL.md dispatches suggested-action prompts", () => {
  const skillMd = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");

  it("SKILL.md exists", () => {
    expect(existsSync(skillMd)).toBe(true);
  });

  it("SKILL.md classifies suggested-action prompts as Lane B and routes to agntux-slack:draft", () => {
    const src = readMd(skillMd);
    expect(src).toContain("Lane B");
    expect(src).toContain("agntux-slack:draft");
  });

  it("SKILL.md never calls a write tool itself — routing only", () => {
    const src = readMd(skillMd);
    expect(src).toContain("Do NOT");
    // The skill should not contain references to write tools as if it were calling them.
    // It can mention them in describing what `agents/draft.md` does, but the
    // text "Do NOT call a Slack write tool" should be present.
    expect(src).toContain("Do NOT");
    expect(src).toContain("Do not call a Slack write tool");
  });
});
