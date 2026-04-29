import { describe, it, expect } from "vitest";
import { setFrontmatter } from "../src/frontmatter.js";

const SAMPLE = `---
id: 2026-04-25-acme-renewal
type: action-item
schema_version: "1.0.0"
status: open
priority: high
reason_class: deadline
created_at: 2026-04-25T14:22:00Z
source: slack
source_ref: T01_1714043640
related_entities:
  - companies/acme-corp
due_by: 2026-04-30
snoozed_until: null
completed_at: null
dismissed_at: null
---

## Why this matters
Acme renewal pricing is in flight.

## Personalization fit
- Matches top-10 account rule
`;

describe("setFrontmatter", () => {
  it("patches a single field", () => {
    const result = setFrontmatter(SAMPLE, { status: "done" });
    expect(result).toContain("status: done");
    expect(result).not.toContain("status: open");
  });

  it("patches multiple fields atomically", () => {
    const result = setFrontmatter(SAMPLE, {
      status: "snoozed",
      snoozed_until: "2026-05-01T09:00:00Z",
      completed_at: null,
      dismissed_at: null,
    });
    expect(result).toContain("status: snoozed");
    expect(result).toContain("snoozed_until: 2026-05-01T09:00:00Z");
    expect(result).toContain("completed_at: null");
    expect(result).toContain("dismissed_at: null");
  });

  it("preserves body verbatim", () => {
    const result = setFrontmatter(SAMPLE, { status: "done" });
    expect(result).toContain("## Why this matters\nAcme renewal pricing is in flight.");
    expect(result).toContain("## Personalization fit\n- Matches top-10 account rule");
  });

  it("preserves unpatched frontmatter fields", () => {
    const result = setFrontmatter(SAMPLE, { status: "done" });
    expect(result).toContain("id: 2026-04-25-acme-renewal");
    expect(result).toContain("priority: high");
    expect(result).toContain("reason_class: deadline");
    expect(result).toContain("source: slack");
  });

  it("adds a new field not previously present", () => {
    const result = setFrontmatter(SAMPLE, { completed_at: "2026-04-26T10:00:00Z" });
    expect(result).toContain("completed_at: 2026-04-26T10:00:00Z");
  });

  it("serialises null correctly", () => {
    const result = setFrontmatter(SAMPLE, { snoozed_until: null });
    expect(result).toContain("snoozed_until: null");
  });

  it("throws when file has no frontmatter", () => {
    expect(() => setFrontmatter("just body text\nno frontmatter", { status: "done" })).toThrow(
      /no frontmatter/
    );
  });

  it("throws when frontmatter has no closing ---", () => {
    expect(() =>
      setFrontmatter("---\nstatus: open\n", { status: "done" })
    ).toThrow();
  });

  it("quotes string values with colons", () => {
    const result = setFrontmatter(SAMPLE, { source_ref: "T01:msg" });
    expect(result).toContain('source_ref: "T01:msg"');
  });
});
