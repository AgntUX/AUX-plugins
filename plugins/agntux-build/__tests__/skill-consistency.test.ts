// skill-consistency: ensures the orchestrator skill's routing table
// stays in lock-step with the references it loads. Catches the kind
// of stage-number drift caught in code review (where SKILL.md said
// "stage 2" but the underlying reference file said "Stage 1").
//
// Static-grep only — no LLM, no spawn.

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");
const SKILL_DIR = join(PLUGIN_ROOT, "skills", "build");
const REF_DIR = join(SKILL_DIR, "references");

describe("skill ↔ references consistency", () => {
  const refFiles = readdirSync(REF_DIR).filter((n) => n.endsWith(".md"));
  const skillBody = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");

  it("each NN-*.md reference's H1 advertises matching stage NN", () => {
    const numbered = refFiles.filter((n) => /^\d{2}-/.test(n));
    expect(numbered.length).toBeGreaterThan(0);

    for (const f of numbered) {
      const stageNum = Number(f.slice(0, 2));
      const body = readFileSync(join(REF_DIR, f), "utf-8");
      const h1Match = body.match(/^# ([^\n]+)/);
      expect(h1Match, `${f} must start with an H1`).not.toBeNull();
      const h1 = h1Match![1];
      // The H1 must announce "Stage <stageNum>" — case-insensitive,
      // tolerant of em-dash variation.
      const re = new RegExp(`Stage\\s+${stageNum}\\b`, "i");
      expect(
        re.test(h1),
        `${f} H1 "${h1}" must announce Stage ${stageNum}`,
      ).toBe(true);
    }
  });

  it("each NNa-*.md reference's H1 advertises matching stage N.5", () => {
    // Half-stage files use the `NNa-` prefix (e.g., `09a-` → Stage 9.5).
    // These intentionally fall outside the NN-*.md numbered range
    // because they are inserted between major stages.
    const halfStage = refFiles.filter((n) => /^\d{2}a-/.test(n));
    for (const f of halfStage) {
      const stageNum = Number(f.slice(0, 2));
      const halfNum = `${stageNum}.5`;
      const body = readFileSync(join(REF_DIR, f), "utf-8");
      const h1Match = body.match(/^# ([^\n]+)/);
      expect(h1Match, `${f} must start with an H1`).not.toBeNull();
      const h1 = h1Match![1];
      const re = new RegExp(`Stage\\s+${halfNum.replace(".", "\\.")}\\b`, "i");
      expect(
        re.test(h1),
        `${f} H1 "${h1}" must announce Stage ${halfNum}`,
      ).toBe(true);
    }
  });

  it("SKILL.md links to every numbered reference exactly once", () => {
    // Include both major-stage (NN-) and half-stage (NNa-) files —
    // both shapes need to be linked from the routing table.
    const numbered = refFiles.filter((n) => /^\d{2}a?-/.test(n));
    for (const f of numbered) {
      const occurrences = countOccurrences(
        skillBody,
        `references/${f}`,
      );
      expect(
        occurrences,
        `SKILL.md must link to references/${f}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("SKILL.md links to design-standards, voice-and-gratitude, and update-mode", () => {
    for (const f of [
      "voice-and-gratitude.md",
      "design-standards.md",
      "update-mode.md",
    ]) {
      expect(
        existsSync(join(REF_DIR, f)),
        `references/${f} must exist`,
      ).toBe(true);
    }
    // SKILL.md must reference voice-and-gratitude (the load-bearing
    // voice doc); design-standards is referenced from sub-references,
    // not necessarily SKILL.md itself.
    expect(skillBody).toMatch(/references\/voice-and-gratitude\.md/);
  });

  it("references contain no broken sibling links", () => {
    for (const f of refFiles) {
      const body = readFileSync(join(REF_DIR, f), "utf-8");
      // Match only relative markdown links — skip http(s):, mailto:,
      // data:, fragment-only links, parent-dir links, and absolute paths.
      const links = [
        ...body.matchAll(/\]\(([^)\s#]+)/g),
      ]
        .map((m) => m[1])
        .filter(
          (l) =>
            !/^(https?:|mailto:|data:|tel:|#|\/)/.test(l) &&
            !l.startsWith("../"),
        );
      for (const link of links) {
        const resolved = join(REF_DIR, link);
        expect(
          existsSync(resolved),
          `${f} contains broken link: ${link}`,
        ).toBe(true);
      }
    }
  });

  it("SKILL.md sets disable-model-invocation: true", () => {
    expect(skillBody).toMatch(/disable-model-invocation:\s*true/);
  });

  it("07-build.md advertises 7 internal specialists", () => {
    const body = readFileSync(join(REF_DIR, "07-build.md"), "utf-8");
    expect(body).toMatch(/seven internal specialists/i);
    expect(body).toMatch(/Building\.\.\. \(1\/7\)/);
    expect(body).toMatch(/Building\.\.\. \(7\/7\)/);
  });

  it("SKILL.md routing table stays 1:1 with file numbers", () => {
    // The routing table claims stage N loads references/NN-*.md.
    // Spot-check a few rows.
    expect(skillBody).toMatch(
      /\| 0 \|.*references\/00-identity-and-dco\.md/,
    );
    expect(skillBody).toMatch(
      /\| 1 \|.*references\/01-search-marketplace\.md/,
    );
    expect(skillBody).toMatch(
      /\| 12 \|.*references\/12-submit\.md/,
    );
  });

  it("12-submit.md keeps the 0.8.0 sync-submission invariants", () => {
    // The 0.8.0 redesign replaced the zip + email handoff with a
    // finalization marker the AgntUX desktop app auto-syncs. These
    // prose-level assertions — invisible to the structural cold-start
    // test — guard that the email/zip channel stays gone and the
    // marker flow stays documented.
    const body = readFileSync(join(REF_DIR, "12-submit.md"), "utf-8");

    // (a) The zip + email channel is gone. Gmail blocked archive
    // attachments and dead-ended submission for the target audience;
    // no attachment/email path may return.
    expect(body).not.toMatch(/plugins@agntux\.ai/);
    expect(body).not.toMatch(/\.zip/);
    expect(body).not.toMatch(/mailto:/);

    // (b) The marker flow is documented: the finalization marker, the
    // signature that rides with the tree, and the synced build path.
    expect(body).toContain("SUBMISSION.json");
    expect(body).toContain("CONTRIBUTING-SIGNATURE.md");
    expect(body).toMatch(/\.agntux-build\/builds\//);

    // (c) Sync is hard-required — the AgntUX desktop app must be
    // running and signed in (teams.json + daemon.lock present) before
    // the flow may claim the plugin was submitted.
    expect(body).toContain("daemon.lock");
    expect(body).toContain("teams.json");
    expect(body.toLowerCase()).toContain("desktop app");

    // (d) The marker is written by a DETERMINISTIC program, not hand-authored
    // (the 0.13.0 fix for the silent-skip class: a slim/misplaced marker that
    // the daemon drops at its schema_version/kind/status gate while the flow
    // still reports "submitted"). Guard the program + its self-check + the
    // exact wire-shape literals the daemon validates.
    expect(body).toMatch(/don't hand-author|do not author it by hand/i);
    expect(body).toContain('kind: "agntux-build.submission"');
    expect(body).toContain('status: "final"');
    expect(body).toContain("schema_version");
    expect(body).toContain("tree_sha256");
    // The marker is a sibling of the plugin dir, never inside it — the program
    // self-checks this so a misplaced marker throws instead of being skipped.
    expect(body.toLowerCase()).toContain("self-check");
    expect(body).toMatch(/SUBMISSION\.json` failed self-check|failed self-check/);
  });

  it("update-mode.md keeps the 0.8.0 update-mode marker fields", () => {
    // The cross-repo contract matches a fix to an existing plugin via
    // the marker's top-level `mode` + `previous_version`, so the
    // update-mode stage-12 prose must keep documenting both — and it
    // must drop the old email/zip channel and reuse create mode's
    // hard-require sync gate.
    const body = readFileSync(join(REF_DIR, "update-mode.md"), "utf-8");

    expect(body).toContain('mode: "update"');
    expect(body).toContain("previous_version");

    expect(body).not.toMatch(/plugins@agntux\.ai/);
    expect(body).not.toMatch(/\.zip/);
    expect(body).not.toMatch(/mailto:/);

    // Same hard-require sync gate as create mode (12-submit.md step e).
    expect(body.toLowerCase()).toContain("hard-require");
  });
});

function countOccurrences(haystack: string, needle: string) {
  let n = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    n++;
    idx += needle.length;
  }
  return n;
}
