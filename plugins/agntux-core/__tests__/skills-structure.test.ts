/**
 * skills-structure.test.ts
 *
 * Structural test: verifies the 8.0.0 single-skill consolidation. The
 * eight legacy `agntux-{ask,feedback-review,onboard,profile,schema,
 * sync,teach,triage}/` skill directories are gone; their bodies live in
 * `skills/agntux/reference/{name}.md`, loaded on demand by the slim
 * `skills/agntux/SKILL.md` router. The host's cold-start "available
 * skills" surface now carries one frontmatter block instead of eight.
 *
 * Asserts:
 *   - The single `/agntux` skill exists and is shaped as
 *     `skills/agntux/SKILL.md`.
 *   - All eight reference resources exist under
 *     `skills/agntux/reference/{name}.md` and are linked from
 *     `SKILL.md`'s routing table.
 *   - The router stays slim (≤ 200 lines).
 *   - The shared helper references (`_preconditions.md`,
 *     `_resolve-root.md`) exist at `skills/` root.
 *   - The flat `skills/orchestrator.md` (3.0.0 deletion) is gone.
 *   - None of the eight legacy `agntux-*` skill directories survive.
 *   - Frontmatter declares `name`, `description`, and `argument-hint`
 *     (the router takes args, so the hint is mandatory).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const AGNTUX_SKILL_DIR = join(SKILLS_DIR, "agntux");
const REFERENCE_DIR = join(AGNTUX_SKILL_DIR, "reference");

const REQUIRED_RESOURCES = [
  "onboard.md",
  "profile.md",
  "schema.md",
  "teach.md",
  "ask.md",
  "sync.md",
  "feedback-review.md",
  "triage-digest.md",
] as const;

const LEGACY_SKILL_DIRS = [
  "agntux-ask",
  "agntux-feedback-review",
  "agntux-onboard",
  "agntux-profile",
  "agntux-schema",
  "agntux-sync",
  "agntux-teach",
  "agntux-triage",
] as const;

// Read a TypeScript view-tool source file and collapse string-concatenation
// continuations (`" +\n  "`) so substring assertions can match prose that
// the formatter wrapped across multiple lines. Mirrors what TypeScript would
// emit at runtime — the description string the host actually sees.
function readToolSource(p: string): string {
  const raw = readFileSync(p, "utf-8");
  return raw.replace(/"\s*\+\s*\n\s*"/g, "");
}

function readFrontmatter(skillPath: string): Record<string, string> {
  const src = readFileSync(skillPath, "utf-8");
  const match = src.match(/^---\n([\s\S]*?)\n---/);
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

describe("agntux-core skills directory structure", () => {
  it("flat skills/orchestrator.md (the 2.0.0 invisible-skill bug) is gone", () => {
    expect(existsSync(join(SKILLS_DIR, "orchestrator.md"))).toBe(false);
  });

  it("the shared _preconditions.md reference exists", () => {
    // Leading underscore keeps it out of the slash-command surface; it
    // is referenced from skills/agntux/SKILL.md and from the reference
    // resources.
    expect(existsSync(join(SKILLS_DIR, "_preconditions.md"))).toBe(true);
  });

  it("the shared _resolve-root.md reference exists", () => {
    // Owns the resolve-then-route ladder Check 0 of _preconditions.md
    // delegates to. Removing it would silently re-introduce the old
    // fail-loud refusal behaviour for users with ~/agntux populated
    // but a non-agntux cwd.
    expect(existsSync(join(SKILLS_DIR, "_resolve-root.md"))).toBe(true);
  });

  it("none of the eight legacy agntux-* skill directories survive", () => {
    // 8.0.0 consolidation. Every `/agntux-*` slash command was retired
    // in favour of `/agntux <sub-command>`. A leftover legacy directory
    // would re-register a competing skill in the host's cold-start
    // surface and re-introduce the eight-frontmatter cost the
    // consolidation was meant to eliminate.
    for (const legacy of LEGACY_SKILL_DIRS) {
      expect(
        existsSync(join(SKILLS_DIR, legacy)),
        `legacy ${legacy}/ should be removed`,
      ).toBe(false);
    }
  });

  describe("/agntux router skill", () => {
    const skillPath = join(AGNTUX_SKILL_DIR, "SKILL.md");

    it("is a directory shaped as skills/agntux/SKILL.md", () => {
      expect(existsSync(AGNTUX_SKILL_DIR)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
    });

    it("frontmatter declares name: agntux", () => {
      const fm = readFrontmatter(skillPath);
      expect(fm.name).toBe("agntux");
    });

    it("frontmatter declares a description", () => {
      const fm = readFrontmatter(skillPath);
      expect(fm.description).toBeTruthy();
      expect(fm.description.length).toBeGreaterThan(20);
    });

    it("frontmatter declares argument-hint enumerating every sub-command", () => {
      const fm = readFrontmatter(skillPath);
      expect(fm["argument-hint"]).toBeTruthy();
      // Parse the bracketed, pipe-delimited option list so the `triage`
      // command is distinguished from `triage-digest` (a plain substring
      // match can't tell them apart — `triage` is a prefix of the other).
      const m = fm["argument-hint"]!.match(/\[([^\]]+)\]/);
      expect(
        m,
        "argument-hint should contain a [a|b|…] option list",
      ).toBeTruthy();
      const options = m![1].split("|").map((s) => s.trim());
      for (const sub of [
        "onboard",
        "triage",
        "profile",
        "schema",
        "teach",
        "sync",
        "ask",
        "feedback-review",
        "triage-digest",
      ]) {
        expect(
          options.includes(sub),
          `argument-hint should list ${sub} as an option`,
        ).toBe(true);
      }
    });

    it("router body is ≤ 200 lines (slim by design — the heavy bodies live in reference/)", () => {
      const src = readFileSync(skillPath, "utf-8");
      const lineCount = src.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(200);
    });
  });

  describe("skills/agntux/reference/ resources", () => {
    it("the reference/ directory exists", () => {
      expect(existsSync(REFERENCE_DIR)).toBe(true);
    });

    for (const resource of REQUIRED_RESOURCES) {
      it(`reference/${resource} exists`, () => {
        expect(existsSync(join(REFERENCE_DIR, resource))).toBe(true);
      });
    }

    it("SKILL.md routing table mentions every reference/ resource by relative path", () => {
      const src = readFileSync(join(AGNTUX_SKILL_DIR, "SKILL.md"), "utf-8");
      for (const resource of REQUIRED_RESOURCES) {
        expect(
          src.includes(`reference/${resource}`),
          `SKILL.md should link reference/${resource}`,
        ).toBe(true);
      }
    });
  });

  describe("router preconditions carve-out for background sub-commands", () => {
    // Regression guard for the divert-to-onboard bug: if the router runs
    // _preconditions.md unconditionally for `feedback-review` and
    // `triage-digest`, a Daily 16:00 / Daily 08:00 fire with no `user.md`
    // would chain into `/agntux onboard` — wrong behaviour for an
    // unattended scheduled task. The router must opt those two out of the
    // check ladder; the resources themselves run unattended-aware
    // preconditions inline.
    const skillSrc = readFileSync(join(AGNTUX_SKILL_DIR, "SKILL.md"), "utf-8");

    it("SKILL.md carves feedback-review out of the precondition check ladder", () => {
      expect(skillSrc).toMatch(/feedback-review[\s\S]*opt out/);
    });

    it("SKILL.md carves triage-digest out of the precondition check ladder", () => {
      expect(skillSrc).toMatch(/triage-digest[\s\S]*opt out/);
    });

    it("SKILL.md notes the inline-preconditions reason (no /agntux onboard divert on unattended fires)", () => {
      // The carve-out exists because router-level checks would route a
      // missing user.md to /agntux onboard, which is wrong on an
      // unattended fire. The reason has to live in the prompt.
      expect(skillSrc).toMatch(/unattended|no user present|silent/i);
    });
  });

  describe("/agntux triage interactive command wiring (10.4.0)", () => {
    // Regression guard for the 10.3.0 change that made `/agntux triage` a
    // first-class, deterministic command instead of relying on the host
    // inferring "what's hot" / "show triage" from natural language, and the
    // 10.4.0 change that made it open the UI instantly (no preflight/ladder).
    const skillSrc = readFileSync(join(AGNTUX_SKILL_DIR, "SKILL.md"), "utf-8");

    it("routing table has a `triage` row that invokes agntux_core_triage_view", () => {
      expect(skillSrc).toMatch(
        /\|\s*`triage`\s*\|[\s\S]*?agntux_core_triage_view/,
      );
    });

    it("triage is NOT backed by a reference/triage.md resource (it calls the tool directly)", () => {
      expect(existsSync(join(REFERENCE_DIR, "triage.md"))).toBe(false);
      // The prose may mention the path to explain its absence; what must
      // never appear is a loadable markdown link `](reference/triage.md)`.
      expect(skillSrc).not.toMatch(/\]\(reference\/triage\.md\)/);
    });

    it("triage is carved out of the preflight + precondition ladder — instant zero-arg call (10.4.0)", () => {
      // /agntux triage calls agntux_core_triage_view immediately with `{}` —
      // no preflight, no preconditions. The view tool self-resolves root/data
      // and surfaces an onboarding pointer in-UI, so the ladder is
      // unnecessary here. Regression guard against re-adding the ramp that
      // delayed first paint (the multi-file-read churn in the bug report).

      // 1. An explicit carve-out bullet opts triage out of the ladder. Match
      //    the bullet's intent ("`triage` … opt(s) out"), not exact prose, so
      //    a benign reword (e.g. "entire" → "whole") doesn't fail the test —
      //    same durable style as the feedback-review / triage-digest guards.
      expect(skillSrc).toMatch(/`triage`[\s\S]{0,40}?opts? out/);

      // 2. The "remaining sub-commands … run the full check ladder" line must
      //    NOT list triage (it used to, pre-10.4.0). Structural fact-check,
      //    not a phrase-grep.
      const remaining = skillSrc.match(
        /remaining sub-commands\s*\(([^)]*)\)[\s\S]*?run\s+the\s+full\s+check\s+ladder/,
      );
      expect(
        remaining,
        "expected a 'remaining sub-commands (…) run the full check ladder' line",
      ).toBeTruthy();
      expect(remaining![1]).not.toMatch(/triage/);

      // 3. The routing-table triage row instructs an immediate call that skips
      //    the ladder. Assert intent (immediate + skips preflight/preconditions)
      //    rather than the exact comma-joined phrasing, so a reword survives.
      const row = skillSrc.match(/\|\s*`triage`\s*\|[^\n]*\n/);
      expect(row, "expected a `triage` routing-table row").toBeTruthy();
      expect(row![0]).toMatch(/immediately/i);
      expect(row![0]).toMatch(/no\s+pre(flight|condition)|skip/i);
    });

    it("the natural-language 'show triage' heuristic also fires the tool instantly (10.4.0)", () => {
      // The 10.4.0 change introduces a SECOND instant-call site: an empty-args
      // "what's hot / show triage" must invoke agntux_core_triage_view
      // immediately too, not run the ladder. Guard it so a revert of the
      // heuristic bullet to the old "after the preflight + preconditions"
      // wording is caught — the explicit-`triage`-token guard above would not
      // catch that. Anchored on the bullet's unique phrasing
      // ("what should I look at / show triage") so it can't accidentally match
      // the triage-digest routing row, which also mentions "show triage".
      const heuristic = skillSrc.match(
        /what should I look at \/ show triage[\s\S]{0,300}/i,
      );
      expect(
        heuristic,
        "expected the 'what's hot / what should I look at / show triage' heuristic bullet",
      ).toBeTruthy();
      expect(heuristic![0]).toMatch(/immediately/i);
      expect(heuristic![0]).toMatch(
        /skipping the preflight|no\s+pre(flight|condition)/i,
      );
    });
  });

  describe("/agntux triage after-render onboarding-gap nudge (10.6.0)", () => {
    // 10.6.0: triage now surfaces a non-blocking "you installed a plugin but
    // haven't onboarded it" nudge AFTER the UI renders. Guards: the carve-out
    // must keep the view-tool-first ordering, describe the gap check, emit the
    // 📦 run-/agntux-onboard line, reuse the _preconditions Check 0.5
    // comparison, and exclude the infra plugins so the hub/builder are never
    // flagged. Without these, a revert would silently drop the nudge and
    // re-open the "installed a plugin, nothing happened" confusion.
    const skillSrc = readFileSync(join(AGNTUX_SKILL_DIR, "SKILL.md"), "utf-8");

    it("documents an after-render, non-blocking onboarding-gap check", () => {
      expect(skillSrc).toMatch(/after the iframe renders/i);
      expect(skillSrc).toMatch(/non-blocking/i);
    });

    it("keeps the view-tool-first ordering so first paint is never delayed", () => {
      // The check must run AFTER the view tool call. Assert the intent
      // (UI/view tool first), not exact prose.
      expect(skillSrc).toMatch(
        /view tool call MUST go first|MUST go first|UI opens with zero ramp/i,
      );
    });

    it("emits the 📦 run-/agntux-onboard nudge line", () => {
      expect(skillSrc).toMatch(/📦[^\n]*\/agntux onboard/);
    });

    it("reuses the _preconditions Check 0.5 comparison and excludes infra plugins", () => {
      expect(skillSrc).toMatch(/Check 0\.5/);
      expect(skillSrc).toMatch(/excluding[\s\S]{0,40}agntux-build/i);
      expect(skillSrc).toContain("agntux-core");
    });
  });

  describe("background-only resources document the refuse-and-redirect guard", () => {
    // The 7.x `disable-model-invocation: true` frontmatter is gone — the
    // equivalent guard now lives inside each resource as a refuse-and-
    // redirect on detected interactive context. Without this, the model
    // could auto-invoke a background-only sub-command from natural
    // language and write spurious output / contend with the scheduled
    // fire's run.
    for (const resource of ["feedback-review.md", "triage-digest.md"] as const) {
      const src = readFileSync(join(REFERENCE_DIR, resource), "utf-8");

      it(`${resource} declares Background-only`, () => {
        expect(src).toMatch(/[Bb]ackground-only/);
      });

      it(`${resource} carries an interactive-context refuse-and-redirect`, () => {
        expect(src).toMatch(/refuse|redirect|exit cleanly/i);
        expect(src).toMatch(/interactive/i);
      });
    }
  });

  describe("sync.md resource — bare-name expansion + step ordering", () => {
    // The 8.0.0 router ships /agntux sync slack as a UX win. Bare-name
    // expansion has to happen before the "not installed" check but AFTER
    // the empty-check, otherwise a user typing `/agntux sync` with no
    // arg would try to expand the empty string against the installed
    // list. Reordering bug regressions are easy to write — guard them
    // here.
    const src = readFileSync(join(REFERENCE_DIR, "sync.md"), "utf-8");

    it("documents bare-name expansion", () => {
      expect(src).toMatch(/[Bb]are-name expansion/);
      expect(src).toMatch(/agntux-/);
      expect(src).toMatch(/installed/i);
    });

    it("Empty? check runs BEFORE bare-name expansion (step ordering invariant)", () => {
      const emptyIdx = src.search(/\*\*Empty\?\*\*/);
      const expandIdx = src.search(/\*\*Bare-name expansion\*\*/);
      expect(emptyIdx).toBeGreaterThan(-1);
      expect(expandIdx).toBeGreaterThan(-1);
      expect(emptyIdx).toBeLessThan(expandIdx);
    });

    it("re-dispatches /{slug} sync (does not call source MCPs itself)", () => {
      expect(src).toMatch(/\/\{resolved-slug\} sync|\/\{slug\} sync|Re-dispatch/);
      expect(src).toMatch(/NO ingest work|only re-dispatches/i);
    });
  });
});

describe("UI handler routing surface (P5 view-only shape — descriptors own it)", () => {
  // P5 moved the triage_view descriptor + handler to the view-tool/ subtree.
  // The legacy `agents/ui-handlers/{triage,entity-browser}.md` operational
  // manifests are gone — every field they carried (verb_phrases, view_tool,
  // resource_uri, structured_content_schema, follow_up_intents,
  // degraded_states) now lives on the view tool's descriptor in
  // `view-tool/src/agntux-core-view.ts`. The tests below assert the
  // surface alignment lives there now.
  const triageViewPath = join(PLUGIN_ROOT, "view-tool", "src", "agntux-core-view.ts");

  it("the entire agents/ directory is gone (no other agents survive in agntux-core)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("triage-view tool source exists at view-tool/src/agntux-core-view.ts (P5 view-only shape)", () => {
    expect(existsSync(triageViewPath)).toBe(true);
  });

  it("triage-view declares the v6.0.0+ namespaced tool name agntux_core_triage_view", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    expect(src).toContain('name: "agntux_core_triage_view"');
  });

  it("triage-view advertises ui://agntux-core/triage as the resource URI (P5 plugin-namespaced)", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    expect(src).toContain('TRIAGE_RESOURCE_URI = "ui://agntux-core/triage"');
    expect(src).toMatch(/ui_resource_uri:\s*TRIAGE_RESOURCE_URI/);
  });

  it("triage-view description carries the user-facing trigger phrases inline (the host's tool selector matches against this)", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    // The 8.0.0 consolidation keeps the interactive triage UI on the
    // tool's description-matched routing — the user types a phrase, the
    // host invokes the tool directly. No `/agntux-triage` slash command
    // exists any more (it became `/agntux triage-digest`, which is the
    // background-only text-digest path).
    for (const phrase of [
      "show triage",
      "what's hot",
      "what should I look at",
      "what's on my plate",
      "triage me",
      "show me my action items",
      "what should I do today",
    ]) {
      expect(src).toContain(phrase);
    }
  });

  it("triage-view inputSchema is empty (zero-arg call site — host invokes with `{}`)", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    const inputSchemaMatch = src.match(/inputSchema:\s*\{[\s\S]*?required:\s*\[[^\]]*\],?[\s\S]*?\}/);
    expect(inputSchemaMatch).toBeTruthy();
    const block = inputSchemaMatch![0];
    expect(block).toContain("properties: {}");
    expect(block).toContain("required: []");
    // Legacy back-compat fields (view_handled_days, limit) must be absent
    // from the input surface — they remain server-side as DEFAULT_*
    // constants.
    expect(block).not.toContain("view_handled_days");
    expect(block).not.toMatch(/limit:\s*\{/);
  });

  it("triage-view structured-error envelope declares the canonical degraded-state codes", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    for (const code of ["actions_index_missing"]) {
      expect(src).toContain(`"${code}"`);
    }
  });

  it("triage-view does not declare a license_paused error code (Apache-2.0)", () => {
    const src = readFileSync(triageViewPath, "utf-8");
    expect(src).not.toContain("license_paused");
  });

  it("local mcp-server does NOT register agntux_core_triage_view (P5 view-only)", () => {
    // triage_view is loaded by the remote MCP server registry from
    // view-tool/dist/agntux-core-view.js — not by the local stdio server.
    // We grep for the registration shape, not bare token mentions (the
    // file's comments still document the migration).
    const indexPath = join(PLUGIN_ROOT, "mcp-server", "src", "index.ts");
    const text = readFileSync(indexPath, "utf-8");
    // The TOOLS object must not register the view tool.
    expect(text).not.toMatch(/agntux_core_triage_view:\s*\{/);
    // The legacy imports must be gone.
    expect(text).not.toMatch(/import\s*\{[^}]*triageViewTool/);
    expect(text).not.toMatch(/import\s*\{[^}]*handleTriageView/);
  });

  it("agntux-core mcp-server source does not reintroduce a license gate", () => {
    // Plugins are Apache-2.0 and unconditionally free; the relicensing PR
    // removed `@agntux/mcp-license` entirely. This regression guard catches
    // any reintroduction.
    const indexPath = join(PLUGIN_ROOT, "mcp-server", "src", "index.ts");
    const text = readFileSync(indexPath, "utf-8");
    expect(text).not.toContain("@agntux/mcp-license");
    expect(text).not.toContain("createLicenseGate");
    expect(text).not.toContain("requireValidLicense");
  });
});

describe("agntux-core plugin manifest version", () => {
  it("plugin.json version matches the most-recent CHANGELOG entry", () => {
    const manifestPath = join(
      PLUGIN_ROOT,
      ".claude-plugin",
      "plugin.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(typeof manifest.version).toBe("string");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);

    // Cross-check: the manifest version MUST match the first non-Unreleased
    // header in CHANGELOG.md. Same invariant the marketplace linter enforces;
    // surfacing it here gives a fast vitest signal so the literal-version
    // pin doesn't drift across version bumps (which is exactly what happened
    // when 6.2.1 was pinned and 6.2.2-6.2.5 shipped without updating it).
    const changelogPath = join(PLUGIN_ROOT, "CHANGELOG.md");
    const changelog = readFileSync(changelogPath, "utf-8");
    const versionHeader = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
    expect(versionHeader, "CHANGELOG.md is missing a versioned ## header").not.toBeNull();
    if (versionHeader) {
      expect(manifest.version).toBe(versionHeader[1]);
    }
  });

  it("mcp-server/package.json declares the ./agntux-root subpath export", () => {
    const mcpPkgPath = join(PLUGIN_ROOT, "mcp-server", "package.json");
    const pkg = JSON.parse(readFileSync(mcpPkgPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const exports = pkg.exports as Record<string, unknown>;
    expect(exports).toBeDefined();
    expect(exports["./agntux-root"]).toBeDefined();
    // Subpath exports use the conditional shape with both `types` and `import`
    // fields so NodeNext consumers get full type information.
    const subpath = exports["./agntux-root"] as Record<string, unknown>;
    expect(subpath.types).toBe("./dist/agntux-root.d.ts");
    expect(subpath.import).toBe("./dist/agntux-root.js");
  });
});
