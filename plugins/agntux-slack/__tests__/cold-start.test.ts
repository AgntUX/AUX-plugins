/**
 * cold-start.test.ts
 *
 * Structural test: verifies that the agntux-slack plugin's manifest, hooks,
 * agent prompts, and example fixture conform to the canonical shape.
 *
 * LIMITATION (per T18 pattern): the ingest skill is an LLM that cannot be
 * invoked in-process. Instead, the test asserts:
 *   1. plugin.json carries the required fields including a non-empty
 *      free-form recommended_ingest_cadence string.
 *   2. The plugin ships no hooks/ directory.
 *   3. skills/{slug}/SKILL.md is a slim router (≤100 lines) frontmatter-named
 *      after the plugin slug, with a `## Sub-commands` table linking
 *      `reference/sync.md` (procedural body) and `reference/ask.md` (live NL
 *      query). Steps 0–11 carry no unsubstituted {{placeholder}} tokens,
 *      reference the Slack read MCP tools, and the sync sub-command runs
 *      inline (no `context: fork`, no nested `general-purpose` agent —
 *      forking broke "Allow for all scheduled runs" inheritance).
 *   4. skills/draft/ is removed (5.0.0+ envelopes target the Slack Connector
 *      directly), and the sync sub-command codifies the "no write without
 *      explicit yes" rule.
 *   5. The example entity files conform to the P3 entity schema.
 *   6. The example action item conforms to the P3 action-item schema and uses
 *      the parent thread `(channel_id, thread_ts)` as `source_ref`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = join(PLUGIN_ROOT, "examples", "starter-thread");
const EXPECTED_ENTITIES = join(EXAMPLES_DIR, "expected-entities");
const EXPECTED_ACTIONS = join(EXAMPLES_DIR, "expected-actions");
const EXPECTED_STATE = join(EXAMPLES_DIR, "expected-state");

// Slug from plugin.json — the skill directory and frontmatter `name:` both
// match the plugin slug after the 7.0.0 slash-command unification refactor.
const PLUGIN_SLUG = (
  JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
  ) as { name: string }
).name;

// When reading the slug-named SKILL.md, fold in sibling reference/*.md files
// (sorted) with `<!-- {filename} -->` boundary markers so grep-style
// assertions on procedural body content keep working post-router-split.
// Pass-through for all other paths.
function readMd(p: string): string {
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
    expect(manifest.license).toBe("Apache-2.0");
  });

  it("recommended_ingest_cadence is a non-empty descriptive string", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
    expect(manifest.recommended_ingest_cadence).toBeTruthy();
    expect(typeof manifest.recommended_ingest_cadence).toBe("string");
    // The field is free-form (friendly cadence string, cron expression, or
    // natural-language description); personalization reads it verbatim and
    // hands it to the host's scheduled-task tool.
  });
});

// ---------------------------------------------------------------------------
// Pass 2: hooks shape — agntux-slack ships no hooks. The Slack data connector
// is host-installed; the plugin's MCP App UI server lives in mcp-server/.
// ---------------------------------------------------------------------------

describe("hooks shape (ingest variant)", () => {
  it("does NOT ship a hooks/ directory", () => {
    expect(existsSync(join(PLUGIN_ROOT, "hooks"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pass 2b: license-gate absence (Apache-2.0 regression guard)
// ---------------------------------------------------------------------------

describe("license-gate absence", () => {
  const indexPath = join(PLUGIN_ROOT, "mcp-server", "src", "index.ts");
  const indexText = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "";
  const pkgPath = join(PLUGIN_ROOT, "mcp-server", "package.json");
  const pkgJson = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
      })
    : { dependencies: {} };

  it("mcp-server source does not import the @agntux/mcp-license gate", () => {
    expect(indexText).not.toContain("@agntux/mcp-license");
    expect(indexText).not.toContain("createLicenseGate");
    expect(indexText).not.toContain("requireValidLicense");
  });

  it("mcp-server package.json does not depend on @agntux/mcp-license", () => {
    expect(pkgJson.dependencies?.["@agntux/mcp-license"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pass 3: agent prompt substitution + read-only invariant
// ---------------------------------------------------------------------------

describe("ingest skill prompt", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");

  it("skills/{slug}/SKILL.md exists at the slug-named directory", () => {
    expect(existsSync(syncSkill)).toBe(true);
  });

  it("frontmatter `name` matches the plugin slug", () => {
    const content = readFileSync(syncSkill, "utf-8");
    const fm = parseFrontmatter(content);
    expect(fm["name"]).toBe(PLUGIN_SLUG);
  });

  it("SKILL.md is a slim router (≤ 100 lines)", () => {
    const content = readFileSync(syncSkill, "utf-8");
    const lines = content.split("\n").length;
    expect(lines).toBeLessThanOrEqual(100);
  });

  it("SKILL.md routing-table heading `## Sub-commands` is present", () => {
    const content = readFileSync(syncSkill, "utf-8");
    expect(content).toMatch(/^##\s+Sub-commands\s*$/m);
  });

  it("reference/ask.md exists and is linked from SKILL.md", () => {
    const askRef = join(dirname(syncSkill), "reference", "ask.md");
    expect(existsSync(askRef)).toBe(true);
    const content = readFileSync(syncSkill, "utf-8");
    expect(content).toMatch(/reference\/ask\.md/);
  });

  it("reference/sync.md carries a `## Contents` TOC at the top", () => {
    const syncRef = join(dirname(syncSkill), "reference", "sync.md");
    expect(existsSync(syncRef)).toBe(true);
    const content = readFileSync(syncRef, "utf-8");
    expect(content).toMatch(/^##\s+Contents\s*$/m);
  });

  it("reference/ask.md is structurally read-only (no cursor advance, no write)", () => {
    const askRef = join(dirname(syncSkill), "reference", "ask.md");
    const content = readFileSync(askRef, "utf-8");
    // Each prohibition is load-bearing — ask-mode is the live-query
    // branch and MUST NOT touch the knowledge store or advance cursors.
    expect(content).toMatch(/Do NOT.*call any source write tool/i);
    expect(content).toMatch(/Do NOT.*advance any cursor/i);
    expect(content).toMatch(/Do NOT.*edit any file under.*<agntux project root>/i);
  });

  it("skills/draft/ is removed in 5.0.0+ (envelopes target the Slack Connector directly — no skill round-trip)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "skills", "draft", "SKILL.md"))).toBe(false);
    expect(existsSync(join(PLUGIN_ROOT, "skills", "draft"))).toBe(false);
  });

  it("agents/ directory is gone (de-fork sweep — ui-handler metadata folded into view-tool descriptors; no orchestrator agents)", () => {
    // Post de-fork sweep: agentux-slack ships zero subagents. The legacy
    // orchestrator/ingest agents (deleted in earlier rounds) and the
    // ui-handler operational manifests (deleted alongside the view-tool
    // description promotion — see ui-routing.test.ts) all live elsewhere
    // now. No agents/ directory should remain.
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("sync skill runs inline — no `context: fork`, no nested agent, no `tools:` whitelist", () => {
    const fm = parseFrontmatter(readMd(syncSkill));
    expect(fm["context"]).toBeUndefined();
    expect(fm["agent"]).toBeUndefined();
    expect(fm["tools"]).toBeUndefined();
  });

  it("sync skill has no unsubstituted {{placeholder}} tokens", () => {
    const src = readMd(syncSkill);
    const matches = src.match(/\{\{[\w-]+\}\}/g) ?? [];
    expect(matches).toHaveLength(0);
  });

  it("sync skill references the Slack read MCP tools", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("slack_read_channel");
    expect(src).toContain("slack_read_thread");
    expect(src).toContain("slack_read_user_profile");
    expect(src).toContain("slack_search_public_and_private");
  });

  it("sync skill is declared read-only — never calls Slack write tools", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("read-only");
    expect(src).toContain("Never call a Slack write tool");
  });

  it("sync skill uses the Slack-specific cursor semantics (per-channel ts map)", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("ts");
    expect(src).toContain("JSON.parse");
  });

  it("sync skill documents the bootstrap_window_days override (7 default for Slack)", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("bootstrap_window_days");
    expect(src).toContain("Slack-ingest default is 7 days");
  });

  it("sync skill bootstrap onboarding mode drops the 5-channel cap and shows a heads-up message", () => {
    const src = readMd(syncSkill);
    // The 5-channel cap is gone — coverage > snappiness for a one-time post-setup run.
    expect(src).not.toContain("onboarding-mode cap of 5 channels");
    expect(src).not.toContain("slack-onboarding-deferred");
    // Replaced with a heads-up chat message and an interrupt-aware error log kind.
    expect(src).toContain("Onboarding mode — heads-up, no cap");
    expect(src).toContain("processes every channel surfaced by discovery");
    expect(src).toContain("hit the stop button");
    expect(src).toContain("slack-bootstrap-interrupted");
  });

  it("sync skill proposes the canonical six action classes (no decision-needed)", () => {
    const src = readMd(syncSkill);
    expect(src).toContain("`deadline`, `response-needed`, `knowledge-update`, `risk`, `opportunity`, `other`");
    // Every appearance of `decision-needed` in the prompt MUST be a negation.
    // Find every occurrence and confirm "no" or "folded" sits within ~30 chars.
    const occurrences = [...src.matchAll(/`decision-needed`/g)];
    for (const m of occurrences) {
      const window = src.slice(Math.max(0, m.index! - 40), m.index! + 80);
      expect(window).toMatch(/no\s+`decision-needed`|folded/);
    }
  });

  it("sync skill pre-flight exits cleanly and points the user at /agntux onboard for missing contracts", () => {
    const src = readMd(syncSkill);
    // No .proposed file dance — Mode B reads listing.yaml directly. The
    // exit message routes to /agntux onboard and documents the wait-and-
    // retry behaviour.
    expect(src).not.toMatch(/run `\/agntux schema review agntux-slack`/);
    expect(src).not.toMatch(/host-dropped `?\.proposed`? file/);
    expect(src).toMatch(/run `\/agntux onboard`|will retry on the next scheduled tick/i);
  });

  it("sync skill registered as a directory-shaped skill (Claude Code spec)", () => {
    const flatForm = join(PLUGIN_ROOT, "skills", "orchestrator.md");
    expect(existsSync(flatForm)).toBe(false);
    expect(existsSync(syncSkill)).toBe(true);
    // Single skill directory at skills/{slug}/. No stray skills/sync/.
    expect(existsSync(join(PLUGIN_ROOT, "skills", "sync", "SKILL.md"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pass 3.5 — 1.1.0 behavior changes (post-test feedback fixes)
// ---------------------------------------------------------------------------

describe("sync skill 1.1.1 — Step 5c-pre drains null thread cursors every run", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const src = readMd(syncSkill);

  it("Step 5c-pre heading exists and is positioned between 5b and 5c", () => {
    const step5b = src.indexOf("### Step 5b — Discovery sweep");
    const step5cPre = src.indexOf("### Step 5c-pre — Drain bootstrap-deferred null thread cursors");
    const step5c = src.indexOf("### Step 5c — Per-channel polling");
    expect(step5b).toBeGreaterThan(0);
    expect(step5cPre).toBeGreaterThan(step5b);
    expect(step5c).toBeGreaterThan(step5cPre);
  });

  it("Step 5c-pre runs on every run, not just bootstrap", () => {
    expect(src).toMatch(/runs on \*\*every run\*\*/);
    expect(src).toMatch(/Bootstrap-deferred `null` thread cursors must NEVER survive/);
  });

  it("Step 5c-pre advances null thread cursors so they don't survive a successful read", () => {
    expect(src).toMatch(/never leave a thread-shaped key with `null` after a successful read/);
  });

  it("Step 5d's bootstrap branch is now a fallback (5c-pre owns the steady-state)", () => {
    expect(src).toMatch(/Bootstrap branch \(fallback only\)/);
    expect(src).toMatch(/this entry should have already been drained by Step 5c-pre/);
  });
});

describe("sync skill 1.1.1 — `Thread: N replies` envelope trigger", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const src = readMd(syncSkill);

  it("Step 5c heuristic 4 lists the `Thread: N replies` envelope line as thread evidence", () => {
    expect(src).toContain("`Thread: N replies (latest: YYYY-MM-DD HH:MM:SS TZ)`");
    expect(src).toMatch(/slack_read_channel` detailed format does not return a numeric `reply_count`/);
  });

  it("Step 5e heuristic (a) folds the envelope line into the no-evidence disjunction", () => {
    expect(src).toMatch(/no `Thread: N replies` envelope line/);
  });
});

describe("sync skill 1.1.0 — thread fanout broadened (correctness fix)", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const src = readMd(syncSkill);

  it("Step 5c thread fanout triggers on multiple evidence fields, not just reply_count", () => {
    expect(src).toMatch(/Thread fanout — pull every thread, always/);
    expect(src).toContain("reply_users_count");
    expect(src).toContain("latest_reply");
    expect(src).toContain("thread_ts");
  });

  it("Step 5c warns explicitly that reply_count alone is unreliable on slack_read_channel payloads", () => {
    expect(src).toMatch(/Slack frequently omits it on `slack_read_channel`/);
    expect(src).toMatch(/Do not rely on `reply_count` alone/);
  });

  it("Step 5c suppresses dependent action when slack_read_thread fails", () => {
    expect(src).toMatch(/do not raise an action item that depends on that thread's content/);
    expect(src).toContain("better silence than a half-context decision");
  });

  it("Step 5e — Thread coverage check exists and logs slack-thread-orphaned for gaps", () => {
    expect(src).toContain("Step 5e — Thread coverage check");
    expect(src).toContain("slack-thread-orphaned");
    expect(src).toContain("parent_ref:");
  });

  it("Step 5e is a self-check, not a re-fetch (no new MCP calls)", () => {
    expect(src).toMatch(/self-check on Step 5c's broader-trigger rule, not a re-fetch/);
    expect(src).toMatch(/does not call any MCP tool/);
  });
});

describe("sync skill 1.1.0 — merged-thread triage", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const src = readMd(syncSkill);

  it("Step 6 carries the merged-thread prefix", () => {
    const step6Index = src.indexOf("## Step 6 — Identify entities");
    const step7Index = src.indexOf("## Step 7 — Update each affected entity");
    expect(step6Index).toBeGreaterThan(0);
    expect(step7Index).toBeGreaterThan(step6Index);
    const step6Body = src.slice(step6Index, step7Index);
    expect(step6Body).toMatch(/Triage operates on the merged thread, not the parent in isolation/);
  });

  it("Step 8 carries the merged-thread prefix", () => {
    const step8Index = src.indexOf("## Step 8 — Decide if action-worthy");
    const step85Index = src.indexOf("## Step 8.5 — Reconcile already-open response-needed items");
    expect(step8Index).toBeGreaterThan(0);
    expect(step85Index).toBeGreaterThan(step8Index);
    const step8Body = src.slice(step8Index, step85Index);
    expect(step8Body).toMatch(/Triage operates on the merged thread, not the parent in isolation/);
  });

  it("Step 10 `## Why this matters` instructs citing both parent ts and reply ts", () => {
    expect(src).toMatch(/cite the parent ts AND the most-recent or most-action-relevant reply ts/);
  });
});

describe("sync skill 1.1.0 — Step 8a reply-state scan", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const src = readMd(syncSkill);

  it("Step 8a — Reply-state scan section exists before the heuristics list", () => {
    const step8aIndex = src.indexOf("Step 8a — Reply-state scan");
    const heuristicsIndex = src.indexOf("Apply heuristics in order:");
    expect(step8aIndex).toBeGreaterThan(0);
    expect(heuristicsIndex).toBeGreaterThan(step8aIndex);
  });

  it("Step 8a runs over the in-memory fetch buffer (no new MCP calls)", () => {
    expect(src).toMatch(/no new MCP calls/);
    // PR #1 (2026-05-08) tightened Step 8a; the canonical wording is now
    // "Pure read over the in-memory fetch buffer" (capitalised). Match
    // case-insensitively so future tone tweaks don't break the gate.
    expect(src).toMatch(/pure read over the in-memory fetch buffer/i);
  });

  it("Step 8a skips silently when the user already responded (no log entry)", () => {
    // PR #1 (2026-05-08) killed the kind: debug `slack-user-already-replied`
    // entry per O4 — `errors:` is no longer a journal of intermediate
    // reasoning. The new behaviour: skip raising, NO log entry.
    expect(src).not.toContain("slack-user-already-replied");
    // Step 8a still names "skip" as the no-match outcome.
    expect(src).toMatch(/No match → skip/);
  });

  it("Step 8a raises with citation when a follow-up appears after the user reply", () => {
    // PR #1 tightened the prose to a 4-line decision. The follow-up
    // citation now lives in the rule "Match → raise, citing the trigger
    // in `## Why this matters`."
    expect(src).toMatch(/Match → raise/);
    expect(src).toMatch(/citing the trigger in `## Why this matters`/);
  });

  it("Step 8a defines follow-up signals (question / mention / deadline / escalation keyword)", () => {
    expect(src).toMatch(/follow-up question \(`\?`\)/);
    expect(src).toMatch(/`@user_id` mention/);
    expect(src).toMatch(/escalation keyword \(`urgent\|asap\|blocker\|sev\[123\]`\)/);
  });
});

describe("sync skill 1.1.0 — Step 8.5 reconcile open response-needed", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const src = readMd(syncSkill);

  it("Step 8.5 sits between Step 8 and Step 9", () => {
    const step8Idx = src.indexOf("## Step 8 — Decide if action-worthy");
    const step85Idx = src.indexOf("## Step 8.5 — Reconcile already-open response-needed items");
    const step9Idx = src.indexOf("## Step 9 — Dedupe against existing action items");
    expect(step8Idx).toBeGreaterThan(0);
    expect(step85Idx).toBeGreaterThan(step8Idx);
    expect(step9Idx).toBeGreaterThan(step85Idx);
  });

  it("Step 8.5 scans response-needed items via Path A (same-source) or Path B (cross-source links)", () => {
    // 5.2.0: Step 8.5 was broadened to cover cross-source-merged actions
    // (Path B). The same-source predicate (Path A) still requires
    // `source: slack`; the cross-source path scans actions whose
    // `## Cross-source links` body section names a slack thread the
    // current run touched. The whole step remains gated on
    // `reason_class: response-needed`.
    expect(src).toMatch(/`status: open`,\s*`reason_class: response-needed`/);
    expect(src).toMatch(/Path A.*same-source action.*`source: slack`/s);
    expect(src).toMatch(/Path B.*Cross-source links/s);
  });

  it("Step 8.5 only acts on threads/channels touched in this run's fetch", () => {
    expect(src).toMatch(/touched in this run's fetch/);
  });

  it("Step 8.5 transitions open → done with `## Auto-resolved` body section", () => {
    expect(src).toContain("## Auto-resolved");
    expect(src).toMatch(/`status: done`, `completed_at: <now RFC 3339>`/);
    expect(src).toMatch(/Closed automatically\. If this was wrong/);
  });

  it("Step 8.5 leaves the index hook to update _index.md (no direct edits)", () => {
    expect(src).toMatch(/do NOT touch `_index\.md` directly/);
  });

  it("Step 8.5 logs slack-reconcile-failed on write failure rather than half-state", () => {
    expect(src).toContain("slack-reconcile-failed");
  });

  it("Honesty rules document the auto-resolution authority and the bounded conditions", () => {
    expect(src).toMatch(/Auto-resolution authority \(Step 8\.5\)/);
    expect(src).toMatch(/agntux-core MCP server.*not direct file edits from this skill/);
  });
});

describe("sync skill 4.0.0 — suggested_actions carries the three standard buttons", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const src = readMd(syncSkill);

  it("default suggested_actions includes the three standard buttons in order", () => {
    const labelOrder = [
      `label: "Draft a reply"`,
      `label: "Schedule a reply"`,
      `label: "Open in Slack"`,
    ];
    let cursor = 0;
    for (const label of labelOrder) {
      const idx = src.indexOf(label, cursor);
      expect(idx, `expected to find ${label} after offset ${cursor}`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it("'Mark done — already handled in Slack' is NOT emitted as a YAML row in 4.0.0+ (redundant with triage Done button)", () => {
    // Removed in 4.0.0 because the agntux-core triage Done button covers
    // the same outcome. The phrase may still appear in *prose* explaining
    // the removal — assert only on the YAML row shape.
    expect(src).not.toMatch(
      /^\s*-\s+label:\s*"Mark done — already handled in Slack"/m,
    );
  });

  it("Snooze 24h and Stop raising buttons are NOT emitted (duplicates of agntux-core triage chrome)", () => {
    expect(src).not.toMatch(/^\s*-\s+label:\s*"Snooze 24h"/m);
    expect(src).not.toMatch(/^\s*-\s+label:\s*"Stop raising items like this"/m);
  });

  it("Draft / Schedule / Summarise prompts route directly to the view tools (no skill round-trip)", () => {
    expect(src).toMatch(/Use the agntux-slack plugin to open the reply composer for action \{id\}/);
    expect(src).toMatch(/Use the agntux-slack plugin to open the reply composer in schedule mode for action \{id\}/);
    expect(src).toMatch(/Use the agntux-slack plugin to open the canvas summariser for action \{id\}/);
  });

  it("suggested_actions rules document the 2–4 button range (4.0.0+ — was 2–5 before Mark done was retired)", () => {
    expect(src).toMatch(/2[–-]4 buttons/);
  });
});

describe("sync skill 1.1.0 — Compose / Canvas payload body sections", () => {
  const syncSkill = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");
  const src = readMd(syncSkill);

  it("inline schema_version is bumped to 1.1.0", () => {
    expect(src).toMatch(/schema_version:\s*"1\.1\.0"/);
  });

  it("Step 10.1 — Gather file-store context — is documented as a sub-step inside Step 10", () => {
    expect(src).toMatch(/Step 10\.1\s*—\s*Gather file-store context/);
    expect(src).toMatch(/response-needed/);
  });

  it("authoring rules describe a `## Compose payload` body section with a fenced YAML block", () => {
    expect(src).toMatch(/##\s+Compose payload/);
    expect(src).toMatch(/drafted_body:/);
    expect(src).toMatch(/personalization_signals:/);
    expect(src).toMatch(/thread_context:/);
  });

  it("authoring rules describe a `## Canvas payload` body section for canvas-worthy items", () => {
    expect(src).toMatch(/##\s+Canvas payload/);
    expect(src).toMatch(/drafted_canvas:/);
    expect(src).toMatch(/proposed_followup_message:/);
  });

  it("the §4 contract divergence note documents composition-at-ingest", () => {
    expect(src).toMatch(/§4 contract divergence/);
    expect(src).toMatch(/composition at ingest/i);
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
    expect(fm.schema_version).toBe('"1.1.0"');
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

  it("ships the three default suggested-action buttons (4.0.0 — Mark done also removed; Snooze 24h / Stop raising were retired in 3.0.0)", () => {
    const content = readMd(actionPath);
    expect(content).toContain("Draft a reply");
    expect(content).toContain("Schedule a reply");
    expect(content).toContain("Open in Slack");
    // 4.0.0 removed the Mark done row (covered by agntux-core triage Done).
    expect(content).not.toMatch(
      /^\s*-\s+label:\s*"Mark done — already handled in Slack"/m,
    );
    // 3.0.0 removed both — both are duplicates of agntux-core triage chrome.
    expect(content).not.toContain("Snooze 24h");
    expect(content).not.toContain("Stop raising items like this");
  });

  it("Open in Slack uses url: (3.0.0 spec — no host_prompt)", () => {
    const content = readMd(actionPath);
    expect(content).toMatch(/-\s+label:\s+"Open in Slack"\s+url:\s+"https:\/\/[^"]+\.slack\.com\/archives\/[^"]+"/);
  });

  it("carries a `## Compose payload` body section with the YAML draft block", () => {
    const content = readMd(actionPath);
    expect(content).toMatch(/^##\s+Compose payload\s*$/m);
    expect(content).toContain("drafted_body:");
    expect(content).toContain("personalization_signals:");
    expect(content).toContain("thread_context:");
    expect(content).toContain("channel:");
    expect(content).toContain("generated_at:");
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
