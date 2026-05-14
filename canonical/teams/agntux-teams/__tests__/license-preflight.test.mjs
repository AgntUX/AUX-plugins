// S7.2 — license JWT freshness gate tests.
//
// The license preflight is LLM-driven prose, not executable code, so the
// test surface is "the prose pins the load-bearing contract": the four
// P11 verification-matrix scenarios (offline-24h, offline-25h,
// lapse_grace, canceled_locked), the exit copy, the public-plugin
// invariant, and the lint pass 8 line cap.
//
// We do NOT invoke the LLM at test time — these are static prompt-grep
// assertions on the markdown source files.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REF_DIR = join(HERE, "..", "skills", "agntux-teams", "reference");
const LIB_PATH = join(REF_DIR, "_lib.md");

const SUB_COMMAND_FILES = [
  "sync.md",
  "onboard-team-lead.md",
  "onboard-member.md",
  "onboard-leader.md",
  "ask.md",
  "teach.md",
  "status.md",
  "reshape.md",
];

let LIB = "";
let LIB_LINES = [];

beforeAll(() => {
  expect(existsSync(LIB_PATH), "_lib.md must exist").toBe(true);
  LIB = readFileSync(LIB_PATH, "utf8");
  LIB_LINES = LIB.split("\n");
});

describe("_lib.md — file shape", () => {
  it("exists at reference/_lib.md", () => {
    expect(existsSync(LIB_PATH)).toBe(true);
  });

  it("stays at or under the CLAUDE.md lint pass 8 ceiling of 500 lines", () => {
    // Trailing-newline-only lines count toward `wc -l`. Strip the final
    // empty entry that split("\n") produces when the file ends with a
    // newline so the assertion matches `wc -l`.
    const wcLines = LIB.endsWith("\n") ? LIB_LINES.length - 1 : LIB_LINES.length;
    expect(wcLines).toBeLessThanOrEqual(500);
  });

  it("opens with the shared-preflight-library heading", () => {
    expect(LIB_LINES[0]).toMatch(/^#\s+Shared preflight library/);
  });

  it("does not carry any unresolved {{placeholders}}", () => {
    // _lib.md is canonical source-of-truth, not a render template. Any
    // {{ }} survival means a forgotten substitution.
    expect(LIB).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it("uses prose references to sibling files, not markdown links (lint pass 8)", () => {
    // Sibling references must be prose-only ("the _lib.md snippet"),
    // never markdown link form ("[`_lib.md`](_lib.md)"). One level deep.
    const siblingLinkPattern = /\]\(\.?\/?(?:sync|ask|teach|status|reshape|onboard-[a-z-]+)\.md\)/;
    expect(LIB).not.toMatch(siblingLinkPattern);
  });
});

describe("_lib.md — license freshness gate semantics (P11 §Validation in agntux-teams preflight)", () => {
  it("reads teams.json.license_jwt", () => {
    expect(LIB).toMatch(/teams\.json/);
    expect(LIB).toMatch(/license_jwt/);
  });

  it("decodes the JWT payload (base64url middle segment, JSON parse)", () => {
    expect(LIB).toMatch(/[Dd]ecode/);
    expect(LIB).toMatch(/base64url/i);
    expect(LIB).toMatch(/\bJSON\b/);
  });

  it("ratifies the P11 no-crypto-at-LLM-layer design", () => {
    // P11 §"Validation in agntux-teams preflight" is explicit: the LLM
    // can't run crypto.verify(). Forged JWTs are caught at the
    // server-side mint and publish endpoints. The _lib.md gate is the
    // soft-gate.
    expect(LIB).toMatch(/[Nn]o crypto verification/);
    expect(LIB).toMatch(/[Ee]d25519/);
    expect(LIB).toMatch(/soft-gate/);
    expect(LIB).toMatch(/hard-gate/);
  });

  it("checks the exp claim against now", () => {
    expect(LIB).toMatch(/\bexp\b/);
    expect(LIB).toMatch(/exp\s*<\s*now/);
    expect(LIB).toMatch(/exp\s*>=?\s*now/);
  });

  it("checks subscription_status against the allowed set", () => {
    expect(LIB).toMatch(/subscription_status/);
    expect(LIB).toMatch(/\btrialing\b/);
    expect(LIB).toMatch(/\bactive\b/);
    expect(LIB).toMatch(/\blapse_grace\b/);
  });

  it("explicitly rejects out-of-set subscription_status values", () => {
    // Listing the bad values is load-bearing — a refactor that
    // accidentally drops 'canceled' from the rejection set would
    // silently green-light a canceled subscription.
    expect(LIB).toMatch(/past_due/);
    expect(LIB).toMatch(/\bcanceled\b/);
    expect(LIB).toMatch(/\bunpaid\b/);
  });

  it("makes no network calls and no retries", () => {
    expect(LIB).toMatch(/[Nn]o network calls/);
    expect(LIB).toMatch(/[Nn]o retries/);
  });
});

describe("_lib.md — exit copy (verbatim billing pointer)", () => {
  it("emits the exact P11-spec exit message on any failure", () => {
    // The verbatim exit copy must survive refactors — the desktop daemon
    // and the AgntUX web app's billing flow are wired to this exact
    // phrasing for the lapsed-state surface.
    expect(LIB).toMatch(
      /Your team's AgntUX Teams subscription is no longer active\./,
    );
    expect(LIB).toMatch(/admin can update billing at/);
    expect(LIB).toMatch(/app\.agntux\.ai\/org\/\{slug\}\/billing/);
  });

  it("requires 'no writes, no state changes' on failure exit", () => {
    expect(LIB).toMatch(/[Nn]o writes/);
    expect(LIB).toMatch(/no state changes/);
  });
});

describe("_lib.md — lapse_grace soft warning", () => {
  it("emits a soft-warning prefix during lapse_grace, not a hard exit", () => {
    expect(LIB).toMatch(/soft.?warning/i);
    expect(LIB).toMatch(/grace period/i);
    expect(LIB).toMatch(/update billing by/);
  });

  it("resolves the {N}-day countdown from lapse_grace_ends_at", () => {
    expect(LIB).toMatch(/lapse_grace_ends_at/);
    expect(LIB).toMatch(/\{N\}-day/);
  });

  it("ratifies that grace state continues normal execution", () => {
    expect(LIB).toMatch(/[Cc]ontinue with the sub-command body/);
    // [\s\S] allows the regex to match across markdown line wraps
    // ("not** a\nhard gate" in the source).
    expect(LIB).toMatch(/\bnot\b[\s\S]{0,15}hard gate/i);
  });
});

describe("_lib.md — P11 verification-matrix scenarios", () => {
  it("documents the offline-24h pass scenario (fresh JWT, exp > now)", () => {
    expect(LIB).toMatch(/[Oo]ffline 24h/);
    expect(LIB).toMatch(/still fresh/i);
  });

  it("documents the offline-25h reject scenario (exp < now, daemon couldn't refresh)", () => {
    expect(LIB).toMatch(/[Oo]ffline 25h/);
    expect(LIB).toMatch(/expired/);
    expect(LIB).toMatch(/Daemon offline/);
  });

  it("documents the lapse_grace accept scenario", () => {
    expect(LIB).toMatch(/[Ll]apse grace/);
    expect(LIB).toMatch(/7-day window/);
  });

  it("documents the canceled-locked reject scenario", () => {
    expect(LIB).toMatch(/[Cc]anceled.{0,5}locked/);
    expect(LIB).toMatch(/mint endpoint returns 403/);
  });
});

describe("_lib.md — public-plugin invariant (P3 cross-plugin contract)", () => {
  it("explicitly declares public plugins must NOT invoke this snippet", () => {
    // The "free for individuals" master-plan invariant: a lapsed org's
    // members can still use AgntUX for personal data. Public plugins
    // (agntux-core, agntux-build, agntux-slack, agntux-gmail) gate on
    // teams.json file presence only. [\s\S] handles markdown line wraps
    // between "Public plugins" and "NOT".
    expect(LIB).toMatch(/[Pp]ublic plugins[\s\S]{0,200}NOT/);
    expect(LIB).toMatch(/agntux-core/);
    expect(LIB).toMatch(/agntux-build/);
    expect(LIB).toMatch(/file presence/);
  });

  it("calls out the master-plan 'free for individuals' invariant", () => {
    // \s+ allows the markdown line wrap between "free for" and "individuals".
    expect(LIB).toMatch(/free for\s+individuals/);
  });

  it("documents the agntux-build edge case (opaque pass-through, not claim-level)", () => {
    // agntux-build does READ license_jwt from teams.json but only to
    // forward it as Bearer to the backend publish endpoint. The backend
    // does the Ed25519 verify. The LLM never decodes the JWT in
    // agntux-build, which is the correct two-layer split.
    expect(LIB).toMatch(/agntux_build_publish_to_team/);
    expect(LIB).toMatch(/opaque pass-through/);
    expect(LIB).toMatch(/[Bb]ackend does the Ed25519 verify/);
  });
});

describe("reference files — every sub-command Step 0 references _lib.md", () => {
  // S7.2 spec: "Reference the _lib.md snippet from
  // reference/{sync, onboard-team-lead, onboard-member, onboard-leader,
  // ask, teach, status, reshape}.md as the first step of every preflight."
  // The reference must be in the preflight section AND must appear
  // before the first numbered preflight step so the gate truly runs first.

  for (const file of SUB_COMMAND_FILES) {
    describe(`reference/${file}`, () => {
      let body = "";

      beforeAll(() => {
        body = readFileSync(join(REF_DIR, file), "utf8");
      });

      it("references the _lib.md snippet by prose name", () => {
        // Some files wrap the blockquote so the regex must allow
        // newline + "> " between `_lib.md` and "snippet".
        expect(body).toMatch(/`_lib\.md`[\s>]+(?:snippet|license-JWT|license freshness)/);
      });

      it("invokes the license freshness gate before the first numbered step", () => {
        // Find the preflight heading. sync/onboard-* use "## Step 0",
        // ask/teach/status/reshape use "## Preflight".
        const preflightAnchor = body.search(
          /^##\s+(Step 0|Preflight)\b/m,
        );
        expect(preflightAnchor, "preflight section must exist").toBeGreaterThan(-1);

        const preflightSlice = body.slice(preflightAnchor);

        // Find the first numbered list item (e.g., "1. **Parse...").
        // The license gate callout must appear before it.
        const firstNumberedItem = preflightSlice.search(/^1\.\s+\*\*/m);
        const libReference = preflightSlice.indexOf("_lib.md");

        expect(libReference, "_lib.md must be referenced inside the preflight section").toBeGreaterThan(-1);

        if (firstNumberedItem > -1) {
          expect(
            libReference,
            `_lib.md reference must appear before the first numbered preflight item in ${file}`,
          ).toBeLessThan(firstNumberedItem);
        }
      });

      it("calls out 'License freshness gate (runs first)' to make ordering explicit", () => {
        expect(body).toMatch(/License freshness gate \(runs first\)/);
      });

      it("quotes the billing pointer in the callout", () => {
        // The pointer is mentioned in the callout itself so readers
        // don't have to chase _lib.md to know what the failure mode
        // looks like.
        expect(body).toMatch(/app\.agntux\.ai\/org\/\{slug\}\/billing/);
      });
    });
  }
});

describe("public-plugin invariant — agntux-core + agntux-build don't run claim-level checks", () => {
  // Cross-checks the public-plugin invariant. Catches regressions if a
  // future refactor accidentally adds JWT decode/exp/status logic to
  // agntux-core or agntux-build's plugin code.

  const REPO_ROOT = join(HERE, "..", "..", "..", "..");

  it("agntux-core source carries no license_jwt code references", () => {
    // The CHANGELOG documents the invariant; this test enforces it.
    const corePluginDir = join(REPO_ROOT, "plugins", "agntux-core");
    if (!existsSync(corePluginDir)) {
      // Test runs in canonical-only environments too; skip cleanly.
      return;
    }

    // We allow CHANGELOG mentions (which document the invariant) but
    // not source-code references to license_jwt in mcp-server src/
    // or hooks/.
    const { execSync } = require("node:child_process");
    let hits = "";
    try {
      hits = execSync(
        `grep -rn "license_jwt" "${corePluginDir}/mcp-server/src" "${corePluginDir}/hooks" 2>/dev/null || true`,
        { encoding: "utf8" },
      );
    } catch {
      // grep returns 1 when no matches — that's the success case.
      hits = "";
    }
    expect(
      hits.trim(),
      "agntux-core source must not reference license_jwt (per P3 + P11 invariant)",
    ).toBe("");
  });

  it("agntux-build's mcp-server src never decodes JWT claims (opaque pass-through invariant)", () => {
    const buildSrcDir = join(REPO_ROOT, "plugins", "agntux-build", "mcp-server", "src");
    if (!existsSync(buildSrcDir)) return;

    const { execSync } = require("node:child_process");
    let hits = "";
    try {
      // Sweep the entire mcp-server/src/ subtree, not just publish-to-team.ts.
      // A future regression in a sibling tool (e.g., a hypothetical
      // validate-token.ts) would otherwise slip through.
      hits = execSync(
        `grep -rEn "\\.exp\\b|\\.subscription_status\\b|claims\\.exp|claims\\.subscription_status" "${buildSrcDir}" 2>/dev/null || true`,
        { encoding: "utf8" },
      );
    } catch {
      hits = "";
    }
    expect(
      hits.trim(),
      "agntux-build/mcp-server/src/ must not decode JWT claims anywhere — license_jwt is opaque Bearer pass-through only (per P11 + P3 cross-plugin contract)",
    ).toBe("");
  });
});
