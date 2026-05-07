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
const SKILL_PATH = join(PLUGIN_ROOT, "skills", "sync", "SKILL.md");

// When reading a sync SKILL.md, fold in sibling resources/*.md files (sorted)
// with `<!-- {filename} -->` boundary markers so future Phase-3/4 splits don't
// break grep-style assertions. Pass-through for all other paths.
function readSkill(p: string): string {
  if (!existsSync(p)) return "";
  const content = readFileSync(p, "utf-8");
  if (basename(p) === "SKILL.md" && basename(dirname(p)) === "sync") {
    const resourcesDir = join(dirname(p), "resources");
    if (existsSync(resourcesDir)) {
      const parts = [content];
      for (const name of readdirSync(resourcesDir).filter((f) => f.endsWith(".md")).sort()) {
        parts.push(`\n<!-- ${name} -->\n`);
        parts.push(readFileSync(join(resourcesDir, name), "utf-8"));
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

  it("Step 10.1 + 10.2 inform the drafted_body", () => {
    expect(SKILL_TEXT).toMatch(/Step 10\.1/);
    expect(SKILL_TEXT).toMatch(/Step 10\.2/);
    expect(SKILL_TEXT).toMatch(/informed by Step 10\.1.*10\.2/);
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
