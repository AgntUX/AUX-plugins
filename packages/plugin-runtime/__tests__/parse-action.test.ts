import { describe, expect, it } from "vitest";
import {
  extractFrontmatterMetadata,
  extractSection,
  parseActionFile,
  parseComposePayload,
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

describe("parseComposePayload", () => {
  const COMPOSE_YAML = `drafted_body: "Sounds good — Thursday works."
personalization_signals:
  - "Replying to Maya in #acme-partner"
`;

  it("reads the bare ## Compose payload section", () => {
    const body = `## Why this matters\n\nx\n\n## Compose payload\n\n\`\`\`yaml\n${COMPOSE_YAML}\`\`\`\n`;
    const cp = parseComposePayload(body);
    expect(cp?.drafted_body).toBe("Sounds good — Thursday works.");
  });

  it("reads the namespaced ## Compose payload (gmail) section when the bare header is absent (cross-source merge)", () => {
    // Regression guard: the header must be passed to extractFencedYaml as a
    // LITERAL ("Compose payload (gmail)") so it is regex-escaped exactly once.
    // A pre-escaped "Compose payload \\(gmail\\)" double-escapes and never
    // matches `## Compose payload (gmail)`, leaving merged invites blank.
    const body = `## Cross-source links\n\n- x\n\n## Compose payload (gmail)\n\n\`\`\`yaml\n${COMPOSE_YAML}\`\`\`\n`;
    const cp = parseComposePayload(body);
    expect(cp?.drafted_body).toBe("Sounds good — Thursday works.");
  });

  it("returns null when neither compose header is present", () => {
    expect(parseComposePayload("## Why this matters\n\nno payload here\n")).toBeNull();
  });
});

describe("extractFrontmatterMetadata", () => {
  it("returns the raw parsed YAML object for a file with frontmatter", () => {
    const text = `---
status: open
priority: high
---
body content
`;
    const result = extractFrontmatterMetadata(text);
    expect(result).toEqual({ status: "open", priority: "high" });
  });

  it("returns null when the file has no frontmatter delimiter", () => {
    expect(extractFrontmatterMetadata("just prose, no fences")).toBeNull();
  });

  it("returns null when the YAML block is not an object (array)", () => {
    const text = `---
- a
- b
---
body`;
    expect(extractFrontmatterMetadata(text)).toBeNull();
  });

  it("returns null when the YAML block is not an object (scalar)", () => {
    const text = `---
hello
---
body`;
    expect(extractFrontmatterMetadata(text)).toBeNull();
  });

  it("returns null for malformed YAML rather than throwing", () => {
    const text = `---
: : : invalid yaml
key: [unclosed
---
body`;
    expect(() => extractFrontmatterMetadata(text)).not.toThrow();
    expect(extractFrontmatterMetadata(text)).toBeNull();
  });
});
