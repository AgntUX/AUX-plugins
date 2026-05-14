import { describe, expect, it } from "vitest";
import {
  extractSection,
  parseActionFile,
  parseFrontmatter,
} from "../src/parse-action.js";

const FULL = `---
id: action-001
status: open
priority: high
reason_class: deadline
reason_detail: invoice due Friday
source: gmail
source_ref: msg-abc
related_entities:
  - entity:org:acme
  - entity:person:alex
suggested_actions:
  - label: Open in Gmail
    host_prompt: ""
    url: https://mail.google.com/u/0/#inbox/abc
  - label: Reply now
    host_prompt: Reply to Alex about the invoice
    url: ""
due_by: 2025-05-20
team_id: t-eng
team_slug: engineering
relevance_classes:
  - billing
  - urgent
---
## Why this matters

The invoice is overdue and unpaid.

## Personalization fit

Alex flagged this last week.

## Notes

Not extracted.
`;

describe("parseActionFile (string input)", () => {
  it("parses full frontmatter and body sections", () => {
    const out = parseActionFile(FULL);
    expect(out.frontmatter.id).toBe("action-001");
    expect(out.frontmatter.status).toBe("open");
    expect(out.frontmatter.related_entities).toHaveLength(2);
    expect(out.frontmatter.suggested_actions).toHaveLength(2);
    expect(out.frontmatter.suggested_actions[0]?.url).toBe(
      "https://mail.google.com/u/0/#inbox/abc",
    );
    expect(out.frontmatter.team_slug).toBe("engineering");
    expect(out.frontmatter.relevance_classes).toEqual(["billing", "urgent"]);
    expect(out.why_matters).toContain("invoice is overdue");
    expect(out.personalization_fit).toContain("Alex flagged");
  });

  it("accepts a Buffer body", () => {
    const out = parseActionFile(Buffer.from(FULL, "utf8"));
    expect(out.frontmatter.id).toBe("action-001");
  });
});

describe("parseFrontmatter — fallbacks", () => {
  it("returns fallback frontmatter when no `---` block exists", () => {
    const { frontmatter, body } = parseFrontmatter("just some prose\n");
    expect(frontmatter.id).toBe("");
    expect(frontmatter.related_entities).toEqual([]);
    expect(body).toBe("just some prose\n");
  });

  it("recovers gracefully from malformed YAML", () => {
    const malformed = `---
id: action-bad
: : :
---
body
`;
    const { frontmatter } = parseFrontmatter(malformed);
    // Fallback values (empty strings, null) when YAML parse throws.
    expect(frontmatter.id).toBe("");
  });

  it("drops javascript: urls from suggested_actions", () => {
    const hostile = `---
suggested_actions:
  - label: Open
    host_prompt: ""
    url: javascript:alert(1)
---
body
`;
    const { frontmatter } = parseFrontmatter(hostile);
    // Row dropped because label exists but neither host_prompt nor a safe
    // url remain.
    expect(frontmatter.suggested_actions).toEqual([]);
  });

  it("normalizes blank team_slug to null", () => {
    const blank = `---
team_slug: ""
team_id: "   "
---
body
`;
    const { frontmatter } = parseFrontmatter(blank);
    expect(frontmatter.team_slug).toBeNull();
    expect(frontmatter.team_id).toBeNull();
  });
});

describe("extractSection", () => {
  it("returns the text under the named section", () => {
    const body = `## Why this matters

Because A.

## Personalization fit

Because B.
`;
    expect(extractSection(body, "Why this matters")).toBe("Because A.");
    expect(extractSection(body, "Personalization fit")).toBe("Because B.");
  });

  it("returns empty string when the section is absent", () => {
    expect(extractSection("nothing here", "Why this matters")).toBe("");
  });

  it("escapes regex metacharacters in the header name", () => {
    const body = `## A.B (C)

text
`;
    expect(extractSection(body, "A.B (C)")).toBe("text");
  });
});
