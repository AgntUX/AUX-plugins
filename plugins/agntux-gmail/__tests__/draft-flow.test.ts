/**
 * draft-flow.test.ts
 *
 * Validates the compose flow contract: the sync skill pre-composes the draft
 * body in `## Compose payload`; the compose-view tool reads it; the iframe
 * Save button emits a Gmail-Connector-targeted two-step envelope.
 *
 * The Gmail MCP server has NO send-email tool — the strongest write surface
 * is `create_draft`. The envelope must reflect that: it asks for a draft
 * creation followed by a clickable link to open the draft in Gmail.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SLUG = (
  JSON.parse(
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
  ) as { name: string }
).name;
const SKILL_PATH = join(PLUGIN_ROOT, "skills", PLUGIN_SLUG, "SKILL.md");

// When reading the slug-named SKILL.md, fold in sibling reference/*.md files
// (sorted) with `<!-- {filename} -->` boundary markers so grep-style
// assertions on procedural body content keep working post-router-split.
// Pass-through for all other paths.
function readSkill(p: string): string {
  if (!existsSync(p)) return "";
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

const SKILL_TEXT = readSkill(SKILL_PATH);

const ENVELOPE_PATH = join(
  PLUGIN_ROOT,
  "ui-handlers",
  "compose",
  "component",
  "src",
  "lib",
  "build-envelope.ts",
);
const ENVELOPE_TEXT = existsSync(ENVELOPE_PATH)
  ? readFileSync(ENVELOPE_PATH, "utf-8")
  : "";

const COMPOSE_VIEW_PATH = join(
  PLUGIN_ROOT,
  "mcp-server",
  "src",
  "tools",
  "compose-view.ts",
);
const COMPOSE_VIEW_TEXT = existsSync(COMPOSE_VIEW_PATH)
  ? readFileSync(COMPOSE_VIEW_PATH, "utf-8")
  : "";

describe("Compose payload pre-composition at ingest", () => {
  it("the sync skill writes drafted_body to the action body, not host_prompt", () => {
    expect(SKILL_TEXT).toMatch(
      /Never pre.fill\s+the draft body in the ingest agent's `host_prompt`/i,
    );
    expect(SKILL_TEXT).toMatch(/drafted_body[\s\S]*Compose payload/);
  });

  it("the Compose payload schema includes recipients/subject/reply_to_message_id", () => {
    expect(SKILL_TEXT).toContain("recipients:");
    expect(SKILL_TEXT).toContain("reply_to_message_id:");
    expect(SKILL_TEXT).toContain("thread_id:");
    expect(SKILL_TEXT).toContain("subject:");
  });

  it("the Compose payload schema includes account_index (3.1.0+) so the iframe can route the Save link to the right Gmail slot", () => {
    expect(SKILL_TEXT).toMatch(/account_index: <int \| null>/);
  });

  it("Step 10.1 + 10.2 inform the drafted_body", () => {
    expect(SKILL_TEXT).toMatch(/Step 10\.1/);
    expect(SKILL_TEXT).toMatch(/Step 10\.2/);
    expect(SKILL_TEXT).toMatch(/informed by Step 10\.1.*10\.2/);
  });
});

describe("suggested_actions — pre-composed Draft a reply (3.1.0+)", () => {
  it("the override declares a `Draft a reply` row firing the compose view tool", () => {
    expect(SKILL_TEXT).toContain('label: "Draft a reply"');
    // The host_prompt MUST reference the {id} placeholder (the action id is
    // substituted at ingest time) and route through the agntux-gmail plugin
    // namespace so the host's tool selector lands on agntux_gmail_compose_view.
    expect(SKILL_TEXT).toMatch(
      /host_prompt:\s+"ux: Use the agntux-gmail plugin to open the reply composer for action \{id\}\."/,
    );
  });

  it("the `Open in Gmail` row is conditional on gmail_thread_url being non-null", () => {
    // The override carries an explicit drop-both-lines comment; the assertion
    // pins the conditional so a future edit can't silently emit a placeholder
    // URL the user can't click.
    expect(SKILL_TEXT).toMatch(
      /Include the next row ONLY IF gmail_thread_url is non-null/,
    );
  });

  it("Gmail does not emit a `Schedule a reply` row (no schedule-send tool on the connector)", () => {
    // Slack ships Schedule; Gmail must not, because the Gmail connector has
    // no schedule-send write tool (build-envelope.ts header).
    expect(SKILL_TEXT).not.toContain('label: "Schedule a reply"');
  });
});

describe("# Account / account_index parsing in Step 0 (3.1.0+)", () => {
  it("Step 0 parses `# Account` / `account_index` from data/instructions/agntux-gmail.md", () => {
    expect(SKILL_TEXT).toMatch(
      /also parse `# Account` from `data\/instructions\/agntux-gmail\.md`/,
    );
    expect(SKILL_TEXT).toMatch(/account_index: <int>/);
  });

  it("Step 10 deep-link build prefers the u/{account_index}/ form over authuser=", () => {
    expect(SKILL_TEXT).toContain(
      "https://mail.google.com/mail/u/{account_index}/?idr=inbox/{thread_id}",
    );
    // The `authuser=` form must remain documented as the fallback, not be
    // dropped entirely — it still works for users who haven't pinned an
    // account index.
    expect(SKILL_TEXT).toContain(
      "https://mail.google.com/mail/?authuser=",
    );
  });

  it("Step 10 documents the cold-start path (omit the row when nothing is known)", () => {
    expect(SKILL_TEXT).toMatch(
      /omit\*\*?\s+the\s+`Open in Gmail` row from `suggested_actions`/i,
    );
  });

  it("the `data/instructions/` lane stays user-owned — sync skill must not auto-write it", () => {
    expect(SKILL_TEXT).toMatch(
      /never auto-author or auto-mutate this section/i,
    );
  });
});

describe("Gmail Connector envelope shape", () => {
  it("the envelope is two-step: create_draft + post link", () => {
    expect(ENVELOPE_TEXT).toContain("two steps");
    expect(ENVELOPE_TEXT).toContain("create_draft");
    expect(ENVELOPE_TEXT).toContain("Open draft in Gmail");
  });

  it("targets the Gmail Connector by name (not the agntux-gmail plugin)", () => {
    expect(ENVELOPE_TEXT).toContain("Use the Gmail Connector");
    expect(ENVELOPE_TEXT).not.toContain("Use the agntux-gmail plugin to draft");
  });

  it("escapes guillemet delimiters in body and subject", () => {
    expect(ENVELOPE_TEXT).toContain("escapeGuillemets");
    expect(ENVELOPE_TEXT).toMatch(/\.replace\(.{1,5}«/);
  });

  it("uses authuser= form for the draft link to support multi-account browsers", () => {
    expect(ENVELOPE_TEXT).toContain("authuser=");
    expect(ENVELOPE_TEXT).toContain("encodeURIComponent");
  });

  it("falls back to mail/u/0/ when user_email is unknown", () => {
    expect(ENVELOPE_TEXT).toContain("mail/u/0/");
  });

  it("prefers mail/u/{account_index}/ when the user pinned a slot in instructions (3.1.0+)", () => {
    // The link-template ladder MUST check account_index first — that's the
    // only form that reliably routes a multi-account browser. Any rewrite
    // that drops the literal `mail/u/${account_index}/` template breaks the
    // multi-account fix.
    expect(ENVELOPE_TEXT).toContain("mail/u/${account_index}/");
    expect(ENVELOPE_TEXT).toMatch(/account_index !== null/);
  });

  it("account_index precedence is checked before user_email (lexically)", () => {
    // Defensive ordering check — the ladder was historically authuser-first;
    // the 3.1.0 fix flips it. Pin the precedence so a future ternary
    // refactor can't quietly regress.
    const acctIdx = ENVELOPE_TEXT.indexOf("account_index !== null");
    const authIdx = ENVELOPE_TEXT.lastIndexOf("authuser=");
    expect(acctIdx).toBeGreaterThan(0);
    expect(authIdx).toBeGreaterThan(0);
    expect(acctIdx).toBeLessThan(authIdx);
  });

  it("carries action_id as a trailing reference", () => {
    expect(ENVELOPE_TEXT).toContain("action_id:");
  });
});

describe("Compose-view tool", () => {
  it("reads the namespaced compose payload first, falls back to the bare header", () => {
    const parsePath = join(PLUGIN_ROOT, "mcp-server", "src", "parse-action.ts");
    const text = readFileSync(parsePath, "utf-8");
    // The lookup must try the namespaced header BEFORE the bare one so a
    // cross-source-merged action surfaces the gmail payload, not slack's.
    const namespacedIdx = text.indexOf("Compose payload (gmail)");
    const bareIdx = text.lastIndexOf("Compose payload\"");
    expect(namespacedIdx).toBeGreaterThan(0);
    expect(bareIdx).toBeGreaterThan(0);
    expect(namespacedIdx).toBeLessThan(bareIdx);
  });

  it("returns compose_payload_missing when neither header is present", () => {
    expect(COMPOSE_VIEW_TEXT).toContain("compose_payload_missing");
  });

  it("returns action_already_handled when status is done/dismissed/snoozed-future", () => {
    expect(COMPOSE_VIEW_TEXT).toContain("action_already_handled");
    expect(COMPOSE_VIEW_TEXT).toContain("isActionAlreadyHandled");
  });

  it("the tool name is namespaced agntux_gmail_compose_view", () => {
    expect(COMPOSE_VIEW_TEXT).toContain("agntux_gmail_compose_view");
  });

  it("lifts account_index from the parsed compose payload into structuredContent (3.1.0+)", () => {
    // The view tool reads account_index from the on-disk YAML and surfaces
    // it on the iframe payload so the Save envelope's draft-creation link
    // can route to the same Gmail slot.
    expect(COMPOSE_VIEW_TEXT).toContain("account_index: number | null");
    expect(COMPOSE_VIEW_TEXT).toContain("account_index: onDisk.account_index");
  });

  it("parse-action.ts normalizes account_index to a finite number or null", () => {
    const parsePath = join(PLUGIN_ROOT, "mcp-server", "src", "parse-action.ts");
    const text = readFileSync(parsePath, "utf-8");
    expect(text).toContain("account_index: number | null");
    expect(text).toContain("asNumberOrNull(raw.account_index)");
  });
});

describe("Ingest contract: create_draft is forbidden from the sync skill", () => {
  it("the skill explicitly bars calling create_draft from the ingest path", () => {
    expect(SKILL_TEXT).toMatch(/never call.*create_draft/i);
    expect(SKILL_TEXT).toMatch(/forbidden by this prompt/i);
  });

  it("the iframe Save click is named as the authorisation gate", () => {
    expect(SKILL_TEXT).toMatch(/Save.*authorisation gate/i);
  });
});
