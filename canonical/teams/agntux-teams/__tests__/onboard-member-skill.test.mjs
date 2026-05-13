// onboard-member.md skill body tests.
//
// Static prompt-grep assertions on the rendered skill body. The skill is
// LLM-driven prose, not executable code, so the test surface is "the prose
// pins the load-bearing contract": the schema-ready gate copy, the consent
// text (and its version slug), the relevance-pick min-one rule, the edit-mode
// re-entry semantics, the POST endpoint shape, and the line-count cap from
// lint pass 8.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(
  __dirname,
  "..",
  "skills",
  "agntux-teams",
  "reference",
  "onboard-member.md",
);

let TEXT = "";
let LINES = [];

beforeAll(() => {
  TEXT = readFileSync(SKILL_PATH, "utf8");
  LINES = TEXT.split("\n");
});

describe("lint pass 8 — line cap", () => {
  it("is ≤ 500 lines (per CLAUDE.md authoring rules)", () => {
    expect(LINES.length).toBeLessThanOrEqual(500);
  });
});

describe("Step 0 — Preflight gates", () => {
  it("parses {team-slug} from $ARGUMENTS and emits a usage hint when missing", () => {
    expect(TEXT).toMatch(/Parse `\$ARGUMENTS`/);
    expect(TEXT).toMatch(
      /Usage:\s*\/agntux-teams onboard:member \{team-slug\}/,
    );
  });

  it("delegates to /agntux onboard when user.md is missing", () => {
    expect(TEXT).toMatch(/user\.md/);
    expect(TEXT).toMatch(/delegate to `\/agntux onboard`/i);
  });

  it("verifies the row's team_role is 'member' and rejects 'team-lead'", () => {
    expect(TEXT).toMatch(/team_role/);
    expect(TEXT).toMatch(/onboard:team-lead/);
  });

  it("calls the schema-ready status endpoint", () => {
    expect(TEXT).toMatch(
      /GET `?\/api\/teams\/\{org_slug\}\/teams\/\{team-slug\}\/status`?/,
    );
  });

  it("exits cleanly with the schema-not-ready message when schema_ready_at is null", () => {
    expect(TEXT).toMatch(/schema_ready_at.*null/i);
    expect(TEXT).toMatch(
      /still designing the team's data structure/,
    );
    expect(TEXT).toMatch(/idempotent/i);
  });

  it("scopes 'No writes' specifically to the schema-not-ready branch (not just anywhere in the doc)", () => {
    // Find the schema-ready-gate block bounded by its bullet header and the
    // next top-level bullet (5. — Detect edit mode). Assert 'No writes' lives
    // inside that slice so a regression that drops the no-write rule from the
    // gate branch fails this test.
    const gateStart = TEXT.indexOf("Schema-ready gate");
    const detectEditModeStart = TEXT.indexOf("Detect edit mode");
    expect(gateStart).toBeGreaterThan(-1);
    expect(detectEditModeStart).toBeGreaterThan(gateStart);
    const gateSlice = TEXT.slice(gateStart, detectEditModeStart);
    expect(gateSlice).toMatch(/No writes/);
  });

  it("authenticates the schema-ready GET with the license_jwt bearer token", () => {
    // Scope the assertion to the gate block so the Authorization line must
    // appear with the GET (not just somewhere else in the doc).
    const gateStart = TEXT.indexOf("Schema-ready gate");
    const detectEditModeStart = TEXT.indexOf("Detect edit mode");
    const gateSlice = TEXT.slice(gateStart, detectEditModeStart);
    expect(gateSlice).toMatch(
      /Authorization:\s*Bearer \{license_jwt/,
    );
  });

  it("loads team-config.md (purpose, relevance_classes) and schema.lock.json (entity_subtypes, action_classes)", () => {
    expect(TEXT).toMatch(/team-config\.md/);
    expect(TEXT).toMatch(/schema\.lock\.json/);
    expect(TEXT).toMatch(/relevance_classes\[\]/);
    expect(TEXT).toMatch(/entity_subtypes\[\]/);
    expect(TEXT).toMatch(/action_classes\[\]/);
  });

  it("detects edit mode from the onboarding.md marker file", () => {
    expect(TEXT).toMatch(/onboarding\.md/);
    expect(TEXT).toMatch(/edit_mode\s*=\s*true/);
    expect(TEXT).toMatch(/member_onboarding_complete/);
  });
});

describe("Step 1 — Briefing card", () => {
  it("renders the briefing via mcp__cowork__create_artifact", () => {
    expect(TEXT).toMatch(/mcp__cowork__create_artifact/);
    expect(TEXT).toMatch(/Welcome to \{display_name\}/);
  });

  it("translates the schema to plain English (never quotes raw JSON to the user)", () => {
    expect(TEXT).toMatch(/plain English/i);
    expect(TEXT).toMatch(/never quote `schema\.lock\.json` JSON/i);
  });

  it("reframes the title in edit mode", () => {
    expect(TEXT).toMatch(/Adjusting your picks for\s+\{display_name\}/);
  });
});

describe("Step 2 — Consent (all-or-nothing)", () => {
  it("uses the v1-2026-05-12 consent text version slug", () => {
    expect(TEXT).toMatch(/v1-2026-05-12/);
  });

  it("uses AskUserQuestion with the exact P8-specified consent wording", () => {
    expect(TEXT).toMatch(/AskUserQuestion/);
    expect(TEXT).toMatch(
      /Do you consent to AgntUX lifting slices of your personal\s*data that fit this team's data shape/,
    );
    expect(TEXT).toMatch(/Other team members and your team lead will see/);
  });

  it("offers exactly the two options 'Yes — I consent' and 'No — not right now'", () => {
    expect(TEXT).toMatch(/Yes — I consent/);
    expect(TEXT).toMatch(/No — not right now/);
  });

  it("warns authors that changing the wording requires bumping the slug", () => {
    expect(TEXT).toMatch(/change a\s*character of it, also change the slug/i);
  });

  it("is skipped entirely when edit_mode === true", () => {
    expect(TEXT).toMatch(/Skip this step entirely when `edit_mode === true`/i);
  });

  it("on 'No', exits cleanly without writing anything", () => {
    expect(TEXT).toMatch(/Write nothing/i);
    expect(TEXT).toMatch(/consent_at.*stays\s*NULL/i);
    expect(TEXT).toMatch(/not-consented/i);
  });

  it("on 'No', emits the verbatim 'No problem — nothing is lifted.' user-facing copy", () => {
    expect(TEXT).toMatch(/No problem — nothing is lifted\./);
  });

  it("on a bumped consent_text_version, loads prior_picks but treats consent as not-yet-captured", () => {
    // The 'Load prior_picks ... pre-selection' clause is split across lines
    // in the rendered prose; allow whitespace between phrases.
    expect(TEXT).toMatch(/\bLoad\*?\*?\s+`?prior_picks`?\s+from\s+the\s+existing/);
    expect(TEXT).toMatch(/pre-selection/);
    expect(TEXT).toMatch(/treat consent\s+as not-yet-captured/i);
  });
});

describe("Step 3 — Relevance-class picks", () => {
  it("uses multiSelect: true with options sourced from team-config.md", () => {
    expect(TEXT).toMatch(/multiSelect:\s*true/);
    expect(TEXT).toMatch(/team-config\.md\.relevance_classes\[\]/);
  });

  it("requires at least one pick", () => {
    expect(TEXT).toMatch(/Pick at least one/);
    expect(TEXT).toMatch(/Zero picks/);
    expect(TEXT).toMatch(/You need to pick at least one/);
  });

  it("surfaces prior_picks in the edit-mode prompt", () => {
    expect(TEXT).toMatch(/prior_picks/);
    expect(TEXT).toMatch(/Your current picks are/);
  });

  it("only mentions 'general' as a default if the team-config actually includes it", () => {
    expect(TEXT).toMatch(
      /Only mention `general` if the team-config actually includes it/i,
    );
  });

  it("guards against an empty relevance_classes[] (malformed team schema)", () => {
    expect(TEXT).toMatch(/data shape doesn't include any relevance classes yet/);
  });

  it("filters stale prior_picks (slugs no longer in the current relevance_classes[])", () => {
    expect(TEXT).toMatch(/filter `prior_picks` to only slugs still present/i);
    // and degrades gracefully when filtering empties the set entirely
    expect(TEXT).toMatch(/treat the edit-mode\s+user as first-run for this step only/i);
  });
});

describe("Step 4 — Optional context", () => {
  it("offers a skip path", () => {
    expect(TEXT).toMatch(/\(Skip is fine\.\)/);
    expect(TEXT).toMatch(/Skip/);
  });

  it("in edit mode, offers keep/replace/drop for the prior body", () => {
    expect(TEXT).toMatch(/Keep current/);
    expect(TEXT).toMatch(/Replace/);
    expect(TEXT).toMatch(/Drop/);
  });
});

describe("Step 5 — Persist + POST", () => {
  it("writes the member file at <root>/teams/{team-slug}/data/members/{user_slug}.md", () => {
    expect(TEXT).toMatch(
      /<root>\/teams\/\{team-slug\}\/data\/members\/\{user_slug\}\.md/,
    );
  });

  it("writes consent_text_version: v1-2026-05-12 into the frontmatter", () => {
    expect(TEXT).toMatch(/consent_text_version:\s*v1-2026-05-12/);
  });

  it("POSTs to the consent endpoint with the documented body shape", () => {
    expect(TEXT).toMatch(
      /POST `?\/api\/teams\/\{org_slug\}\/teams\/\{team-slug\}\/members\/me\/consent`?/,
    );
    expect(TEXT).toMatch(/"version":\s*"v1-2026-05-12"/);
    expect(TEXT).toMatch(/"relevance_classes":/);
  });

  it("attaches the license_jwt as a bearer token *on the POST itself* (scoped, not anywhere)", () => {
    // Find the POST block bounded by 'POST `/api/.../consent`' and the next
    // 'Backend behavior' header. The Authorization line must live inside
    // that slice so a regression that documents auth only on the GET fails
    // here.
    const postIdx = TEXT.indexOf("/members/me/consent");
    expect(postIdx).toBeGreaterThan(-1);
    const backendBehaviorIdx = TEXT.indexOf("Backend behavior", postIdx);
    expect(backendBehaviorIdx).toBeGreaterThan(postIdx);
    const postSlice = TEXT.slice(postIdx, backendBehaviorIdx);
    expect(postSlice).toMatch(/Authorization:\s*Bearer \{license_jwt/);
  });

  it("POST body documents *only* {version, relevance_classes} — no user_id, no org_slug, no team_slug", () => {
    // Negative test: the spec body shape is exactly {version, relevance_classes}.
    // Pin that no extraneous keys creep into the documented POST body.
    const postIdx = TEXT.indexOf("/members/me/consent");
    const backendBehaviorIdx = TEXT.indexOf("Backend behavior", postIdx);
    const postSlice = TEXT.slice(postIdx, backendBehaviorIdx);
    expect(postSlice).not.toMatch(/"user_id"\s*:/);
    expect(postSlice).not.toMatch(/"org_slug"\s*:/);
    expect(postSlice).not.toMatch(/"team_slug"\s*:/);
    expect(postSlice).not.toMatch(/"user_slug"\s*:/);
  });

  it("5a (filesystem write) is documented before 5b (POST) — filesystem-first ordering invariant", () => {
    const step5aIdx = TEXT.indexOf("### 5a");
    const step5bIdx = TEXT.indexOf("### 5b");
    expect(step5aIdx).toBeGreaterThan(-1);
    expect(step5bIdx).toBeGreaterThan(step5aIdx);
    // And the ordering rationale prose must explicitly mention filesystem-first.
    expect(TEXT).toMatch(/filesystem first/i);
  });

  it("differentiates 401 (expired session, no retry) from 5xx (transient, will reconcile)", () => {
    // 401 must not be collapsed into the "couldn't reach" retry branch —
    // the daemon's reconcile loop would loop forever on a stale JWT.
    expect(TEXT).toMatch(/401/);
    expect(TEXT).toMatch(/session expired/i);
    expect(TEXT).toMatch(/sign in again/i);
  });

  it("4xx error handling falls back gracefully when the response body is unparseable", () => {
    expect(TEXT).toMatch(/HTTP \{status\}/);
  });

  it("treats the on-disk file as the synced replica on backend failure", () => {
    expect(TEXT).toMatch(/on-disk record is saved/i);
    expect(TEXT).toMatch(/reconcile/i);
  });

  it("updates teams.json memberships best-effort and continues on failure", () => {
    expect(TEXT).toMatch(/teams\.json/);
    expect(TEXT).toMatch(/memberships\[\]/);
    expect(TEXT).toMatch(/best-effort/i);
  });

  it("in edit mode, preserves the prior consent_at instead of overwriting it", () => {
    expect(TEXT).toMatch(/`consent_at`\s*is\s*\*\*preserved\*\*/i);
  });
});

describe("Step 6 — Summary + marker drop", () => {
  it("renders the summary via mcp__cowork__create_artifact", () => {
    expect(TEXT).toMatch(/Step 6 — Summary/);
    expect(TEXT).toMatch(/mcp__cowork__create_artifact/);
    expect(TEXT).toMatch(/You're set up for \{display_name\}/);
  });

  it("drops the onboarding.md marker with member_onboarding_complete: true", () => {
    expect(TEXT).toMatch(
      /<root>\/teams\/\{team-slug\}\/data\/onboarding\.md/,
    );
    expect(TEXT).toMatch(/member_onboarding_complete:\s*true/);
  });

  it("reframes summary copy in edit mode", () => {
    expect(TEXT).toMatch(/Your picks for \{display_name\} are updated\./);
  });
});

describe("Re-run / edit semantics", () => {
  it("documents that step 2 is skipped on re-run with the same consent_text_version", () => {
    expect(TEXT).toMatch(/Re-run \/ edit semantics/);
    expect(TEXT).toMatch(/Step 2 is \*\*skipped\*\*/);
  });

  it("documents that re-run only walks the relevance picks (+ optional context) when consented", () => {
    expect(TEXT).toMatch(/walks the relevance picks/);
    expect(TEXT).toMatch(/prior picks/);
  });

  it("documents that a bumped consent_text_version triggers full re-consent", () => {
    expect(TEXT).toMatch(/consent_text_version.*has changed/i);
    expect(TEXT).toMatch(/full flow\s+including step 2/i);
  });
});

describe("Out-of-scope guard rails", () => {
  it("routes schema reshape away from members", () => {
    expect(TEXT).toMatch(/\/agntux-teams reshape \{team-slug\}/);
  });

  it("documents that V1 consent is all-or-nothing (P6 invariant)", () => {
    expect(TEXT).toMatch(/all-or-nothing/i);
    expect(TEXT).toMatch(/Per-source-plugin consent granularity/i);
  });

  it("notes that leaving the team is the web-app + P4 daemon's job", () => {
    expect(TEXT).toMatch(/Leaving the team/);
    expect(TEXT).toMatch(/P4 daemon/);
  });
});

describe("Hygiene", () => {
  it("contains no STUB or TODO markers from the pre-S5.2 skeleton", () => {
    expect(TEXT).not.toMatch(/\*\*STUB/);
    expect(TEXT).not.toMatch(/TODO — Interview content/);
  });

  it("never says 'subagent', 'dispatch', or other internal-architecture words to the user", () => {
    // The voice rule from SKILL.md applies to user-facing strings; the body
    // may reference 'dispatch' / 'daemon' in author-facing notes, but
    // 'subagent' should not appear at all.
    expect(TEXT).not.toMatch(/\bsubagent\b/);
  });
});
