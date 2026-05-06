/**
 * draft-flow.test.ts
 *
 * Validates that `skills/draft/SKILL.md`'s prompt structure makes it
 * impossible to call a Slack write tool without an explicit user "yes"
 * in the immediately preceding turn.
 *
 * LIMITATION (per T18 pattern): the draft skill is an LLM. We can't
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
const DRAFT_MD = join(PLUGIN_ROOT, "skills", "draft", "SKILL.md");

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

describe("draft SKILL.md write-tool references", () => {
  it("skills/draft/SKILL.md exists", () => {
    expect(existsSync(DRAFT_MD)).toBe(true);
  });

  for (const tool of WRITE_TOOLS) {
    it(`draft SKILL.md references ${tool}`, () => {
      const src = readMd(DRAFT_MD);
      expect(src).toContain(tool);
    });
  }
});

// ---------------------------------------------------------------------------
// Pass 2: confirmation gate is codified (committed-envelope contract)
// ---------------------------------------------------------------------------

describe("draft SKILL.md confirmation gate", () => {
  const src = readMd(DRAFT_MD);

  it("committed envelope from the iframe is the explicit authorisation", () => {
    // The new contract: iframe Send button replaces the chat yes/no/edit flow.
    expect(src).toContain("iframe Send button");
    expect(src).toContain("committed envelope");
  });

  it("forbids calling write tools without a well-formed committed envelope", () => {
    expect(src).toContain("Never sends without a committed envelope from the iframe");
  });

  it("documents the discard envelope — no write call, action stays open", () => {
    expect(src).toContain("Discarded. The action item is still open.");
    // Discard rule: no Slack tool called, no set_status
    expect(src).toContain("Do not call any Slack tool. Do not call `set_status`.");
  });

  it("documents the freeform-reply fallback — ask about iframe, do not send", () => {
    // When user types freeform rather than the iframe emitting an envelope
    expect(src).toContain("I'm waiting on the iframe Send button");
  });
});

// ---------------------------------------------------------------------------
// Pass 3: payload integrity rules
// ---------------------------------------------------------------------------

describe("draft SKILL.md payload integrity", () => {
  const src = readMd(DRAFT_MD);

  it("hard rule: do not re-compose between commit and send — body is authoritative", () => {
    // The new contract: skill must not paraphrase/polish the committed envelope body.
    // The exact hard-rule bullet in the skill uses bold markdown formatting.
    expect(src).toContain("Do not re-compose between commit and send.");
  });

  it("hard rule: show the exact payload in the iframe — no misrepresentation", () => {
    expect(src).toContain("Show the exact payload");
    expect(src).toContain("must never misrepresent what will be sent");
  });

  it("forbids auto-pivoting verbs", () => {
    expect(src).toContain("Never auto-pivot");
  });

  it("documents tone discipline — no injected signatures", () => {
    expect(src).toContain("Tone discipline");
    expect(src).toContain("No injected signatures");
  });

  it("3.0.0+ inverts the pre-fill rule — composition is at ingest, not at click", () => {
    // The retired hard-rule line ("Do not pre-fill orchestrator-authored
    // content during ingest") is intentionally absent in 1.1.0+. The new
    // hard rule names the body sections that carry pre-composed content.
    expect(src).not.toContain("Do not pre-fill orchestrator-authored content during ingest");
    expect(src).toContain("Composition is at ingest, not at click");
    expect(src).toContain("## Compose payload");
    expect(src).toContain("## Canvas payload");
  });
});

// ---------------------------------------------------------------------------
// Pass 4: simplified click-time flow — Step 2 reads source_ref only, Step 6
// renders the iframe with action_id-only invocation
// ---------------------------------------------------------------------------

describe("draft SKILL.md simplified click-time flow (1.1.0+)", () => {
  const src = readMd(DRAFT_MD);

  it("Step 2 reads only source_ref + status from the action file (no thread fetch, no body composition)", () => {
    const stepTwoIdx = src.indexOf("## Step 2");
    expect(stepTwoIdx).toBeGreaterThan(0);
    const stepSixIdx = src.indexOf("## Step 6");
    const stepTwo = src.slice(stepTwoIdx, stepSixIdx > 0 ? stepSixIdx : undefined);
    expect(stepTwo).toContain("source_ref");
    // The thread-fetch + body-composition steps are gone in 1.1.0+. Verify
    // Step 2 does NOT instruct a slack_read_thread call.
    expect(stepTwo).not.toContain("slack_read_thread");
  });

  it("Step 6 renders the iframe with action_id-only invocation (no working-memory payload)", () => {
    const stepSixIdx = src.indexOf("## Step 6 ");
    expect(stepSixIdx).toBeGreaterThan(0);
    const stepSixFiveIdx = src.indexOf("## Step 6.5");
    const stepSix = src.slice(stepSixIdx, stepSixFiveIdx > 0 ? stepSixFiveIdx : undefined);
    // Both view tools listed; required args reduced to action_id (+ initial_verb for compose)
    expect(stepSix).toContain("compose_view");
    expect(stepSix).toContain("canvas_view");
    expect(stepSix).toContain("action_id");
  });

  it("Step 7 mode-branch is the only place that calls write tools (after committed envelope)", () => {
    const stepSevenIdx = src.indexOf("## Step 7");
    const stepEightIdx = src.indexOf("## Step 8 —");
    const stepSeven = src.slice(stepSevenIdx, stepEightIdx > 0 ? stepEightIdx : undefined);
    // Step 7 table branches on committed envelope mode and calls write tools.
    // The table rows use backtick-wrapped mode labels: | `send` | …
    expect(stepSeven).toContain("`send`");
    expect(stepSeven).toMatch(/slack_send_message|slack_schedule_message|slack_create_canvas/);
  });
});

// ---------------------------------------------------------------------------
// Pass 5: SKILL.md dispatches suggested-action prompts to the draft subagent
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pass 6: A4 — Step 8 calls set_status MCP, not direct frontmatter writes
// ---------------------------------------------------------------------------

describe("draft SKILL.md Step 8 uses agntux-core MCP for action mutation (A4)", () => {
  const src = readMd(DRAFT_MD);

  it("Step 8 calls mcp__agntux-core__set_status", () => {
    expect(src).toContain("mcp__agntux-core__set_status");
  });

  it("Step 8 explicitly forbids direct frontmatter writes", () => {
    expect(src).toContain("Direct frontmatter writes from this skill are forbidden");
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

  it("Step 8 success and failure messages are mode-aware (covers all four modes)", () => {
    const stepEightIdx = src.indexOf("## Step 8 —");
    // Use the exact full heading to avoid matching the earlier "### Hard rules for receipt"
    const hardRulesIdx = src.indexOf("## Hard rules (do not violate)");
    const stepEight = src.slice(stepEightIdx, hardRulesIdx > stepEightIdx ? hardRulesIdx : undefined);
    // Each mode must appear in the mode-aware messaging block.
    // The new skill uses mode labels (send/schedule/canvas/save_draft) not verb phrases.
    for (const mode of ["`send`", "`schedule`", "`canvas`", "`save_draft`"]) {
      expect(stepEight).toContain(mode);
    }
  });
});

// ---------------------------------------------------------------------------
// Pass 7: committed envelope routing (new contract — iframe replaces chat confirm)
// ---------------------------------------------------------------------------

describe("committed envelope routing", () => {
  const src = readMd(DRAFT_MD);

  it("Step 6.5 exists in the skill (new step landed)", () => {
    expect(src).toContain("Step 6.5");
  });

  it("references mcp__agntux-slack__compose_view at least once", () => {
    expect(src).toContain("mcp__agntux-slack__compose_view");
  });

  it("references mcp__agntux-slack__canvas_view at least once", () => {
    expect(src).toContain("mcp__agntux-slack__canvas_view");
  });

  it("compose committed-envelope regex is documented (commit the drafted reply for action)", () => {
    // The regex appears in a fenced code block preceded by the ^ux: anchor
    expect(src).toContain("commit the drafted reply for action");
    // The regex block starts with ^ux:
    const regexBlockIdx = src.indexOf("^ux: Use the agntux-slack plugin to commit the drafted reply");
    expect(regexBlockIdx).toBeGreaterThan(0);
  });

  it("canvas committed-envelope regex is documented (commit the drafted canvas for action)", () => {
    expect(src).toContain("commit the drafted canvas for action");
    const regexBlockIdx = src.indexOf("^ux: Use the agntux-slack plugin to commit the drafted canvas");
    expect(regexBlockIdx).toBeGreaterThan(0);
  });

  it("discard regex is documented (discard the (draft|canvas) for action)", () => {
    expect(src).toContain("discard the (draft|canvas) for action");
    const regexBlockIdx = src.indexOf("^ux: Use the agntux-slack plugin to discard the (draft|canvas)");
    expect(regexBlockIdx).toBeGreaterThan(0);
  });

  it("guillemet escape rule is documented — «« and »» both appear", () => {
    expect(src).toContain("««");
    expect(src).toContain("»»");
  });

  it("hard rule: iframe Send button is the explicit authorisation", () => {
    expect(src).toContain("iframe Send button");
  });

  it("does NOT contain the retired chat-only confirm prompt string 'yes / no / edit'", () => {
    // The exact concatenated string is forbidden; individual words may appear separately.
    expect(src).not.toContain("yes / no / edit");
  });

  it("documents mode: send", () => {
    expect(src).toContain("mode: send");
  });

  it("documents mode: schedule", () => {
    expect(src).toContain("mode: schedule");
  });

  it("documents mode: save_draft", () => {
    expect(src).toContain("mode: save_draft");
  });
});

describe("Suggested-action prompts auto-route to the draft skill (no router)", () => {
  // With context: fork + general-purpose, the draft skill is matched
  // directly by Claude Code's description-based auto-routing — there is
  // no router skill that classifies and dispatches Lane B. The sync skill
  // and the draft skill are independent dispatch targets; neither routes
  // to the other.
  const draftSkill = join(PLUGIN_ROOT, "skills", "draft", "SKILL.md");
  const syncSkill = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");

  it("draft skill description mentions the suggested-action verbs", () => {
    const fm = (() => {
      const src = readMd(draftSkill);
      const m = src.match(/^---\n([\s\S]*?)\n---/);
      return m?.[1] ?? "";
    })();
    expect(fm).toContain("draft a reply for action");
    expect(fm).toContain("summarise the thread");
  });

  it("sync skill explicitly disclaims handling suggested-action ux: prompts", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("Suggested-action `ux:` prompts auto-route");
    expect(src).toContain("skills/draft/SKILL.md");
  });
});
