// Authority discipline contract test — P3a §1, §7 (item 7).
// Verifies each new sub-agent's prompt frontmatter declares the right tool
// surface AND the body forbids writes to paths outside the agent's lane.
//
// Prompt-discipline test, not a runtime guard. Runtime is enforced by the
// validator hook (validate-schema.mjs) for entity/action writes; this test
// catches drift in the prompts themselves so future edits don't accidentally
// expand authority.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS_DIR = new URL("../agents/", import.meta.url).pathname;

function readAgent(name) {
  return readFileSync(join(AGENTS_DIR, name), "utf8");
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}

describe("data-architect authority", () => {
  const text = readAgent("data-architect.md");

  it("declares the right tool surface", () => {
    const fm = frontmatter(text);
    // 4.0.0: Bash added (architect needs `rm -f` to delete .proposed
    // files after Mode B review — Edit can't delete). WebSearch and
    // WebFetch added to support discovery-driven schema synthesis.
    expect(fm).toMatch(/^tools: Read, Write, Edit, Glob(, Bash)?(, WebSearch, WebFetch)?$/m);
    expect(fm).toMatch(/^name: data-architect$/m);
  });

  it("forbids writes outside data/schema/ and data/schema-{warnings,requests}.md", () => {
    // Either prose form is acceptable: "Cannot touch user.md ..." or "do NOT touch user.md ...".
    expect(text).toMatch(/(?:Cannot|do NOT)\s+touch.+user\.md.+data\/instructions.+entities.+actions/i);
    expect(text).toMatch(/authority.+<agntux project root>\/data\/schema\//i);
  });

  it("documents Modes A, B, and C", () => {
    expect(text).toMatch(/## Mode A.+Bootstrap/i);
    expect(text).toMatch(/## Mode B.+Plugin install review/i);
    expect(text).toMatch(/## Mode C.+Schema edit/i);
  });

  it("logs migration warnings to data/schema-warnings.md", () => {
    expect(text).toMatch(/data\/schema-warnings\.md/);
    // Confirm the legacy state/ path was retired.
    expect(text).not.toMatch(/state\/schema-warnings\.md/);
  });
});

describe("user-feedback authority", () => {
  const text = readAgent("user-feedback.md");

  it("declares the right tool surface", () => {
    const fm = frontmatter(text);
    expect(fm).toMatch(/^tools: Read, Write, Edit, Glob$/m);
    expect(fm).toMatch(/^name: user-feedback$/m);
  });

  it("forbids writes outside data/instructions/ and data/schema-requests.md", () => {
    expect(text).toMatch(/data\/schema\/.+\*\*No\*\*/);
    expect(text).toMatch(/user\.md.+\*\*No\*\*/);
  });

  it("documents Modes A, B, and C", () => {
    expect(text).toMatch(/## Mode A.+Capture/i);
    expect(text).toMatch(/## Mode B.+Teach interview/i);
    expect(text).toMatch(/## Mode C.+Structural escalation/i);
  });

  it("escalates structural requests to data/schema-requests.md", () => {
    expect(text).toMatch(/data\/schema-requests\.md/);
    // Confirm the legacy state/ path was retired.
    expect(text).not.toMatch(/state\/schema-requests\.md/);
  });

  it("requires provenance lines on captured rules", () => {
    expect(text).toMatch(/source: \{YYYY-MM-DD\}/);
  });
});

describe("pattern-feedback rename", () => {
  const text = readAgent("pattern-feedback.md");

  it("uses pattern-feedback as its name", () => {
    const fm = frontmatter(text);
    expect(fm).toMatch(/^name: pattern-feedback$/m);
  });

  it("preserves read-only-Edit-on-user.md authority", () => {
    const fm = frontmatter(text);
    expect(fm).toMatch(/^tools: Read, Glob, Edit$/m);
    // Body still says it only writes to user.md → # Auto-learned.
    expect(text).toMatch(/# Auto-learned/);
  });

  it("disambiguates from user-feedback in the description", () => {
    expect(text).toMatch(/distinct from.+user-feedback/i);
  });
});

describe("personalization Mode A extension", () => {
  const text = readAgent("personalization.md");

  it("adds Stage 2.5 (Day-to-Day, Aspirations, Goals)", () => {
    expect(text).toMatch(/Stage 2\.5/);
    expect(text).toMatch(/# Day-to-Day/);
    expect(text).toMatch(/# Aspirations/);
    expect(text).toMatch(/# Goals/);
  });

  it("adds Stage 4.5 (Sources)", () => {
    expect(text).toMatch(/Stage 4\.5/);
    expect(text).toMatch(/# Sources/);
  });

  it("adds Stage 4.6 (AgntUX plugins) with Installed/Planned subsections", () => {
    expect(text).toMatch(/Stage 4\.6/);
    expect(text).toMatch(/# AgntUX plugins/);
    expect(text).toMatch(/## Installed/);
    expect(text).toMatch(/## Planned/);
  });

  it("cross-links to user-feedback for imperatives", () => {
    expect(text).toMatch(/user-feedback/);
  });
});

describe("data-architect reads AgntUX plugins for schema sizing", () => {
  const text = readAgent("data-architect.md");

  it("Mode A Stage 1 reads # AgntUX plugins → ## Installed and ## Planned", () => {
    expect(text).toMatch(/# AgntUX plugins.*## Installed/s);
    expect(text).toMatch(/# AgntUX plugins.*## Planned/s);
  });

  it("Mode A does not preemptively grant ownership for Planned plugins", () => {
    expect(text).toMatch(/Planned[\s\S]*do NOT preemptively grant.+ownership/);
  });

  it("Mode A sizes baseline using each plugin's proposed_schema (with fallback)", () => {
    expect(text).toMatch(/proposed_schema/);
    // 4.0.0: prose simplified — Mode A reads each Installed plugin's
    // listing.yaml proposed_schema block to size the baseline. Fallback
    // is implicit (best-effort read).
    expect(text).toMatch(/marketplace\/listing\.yaml.*proposed_schema/i);
  });
});

describe("user-feedback Mode B sanity-checks the teach target", () => {
  const text = readAgent("user-feedback.md");

  it("reads # AgntUX plugins → ## Installed in Stage 1", () => {
    expect(text).toMatch(/# AgntUX plugins[^\n]*## Installed/);
  });

  it("warns (but does not block) when teach target slug is not on Installed", () => {
    expect(text).toMatch(/I don.{1,3}t see `\{plugin-slug\}`/);
    expect(text).toMatch(/proceed|continue/);
  });
});
