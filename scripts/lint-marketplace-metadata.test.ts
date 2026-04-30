/**
 * lint-marketplace-metadata.test.ts
 *
 * Fixture-based tests for the P15 marketplace metadata linter.
 * Each error code has >= 1 failing fixture; happy path must produce zero errors.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { lintPlugin, type Finding } from "./lint-marketplace-metadata.js";

// ---------------------------------------------------------------------------
// Fixture resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "__fixtures__");
const validDir = path.join(fixturesDir, "valid");
const invalidDir = path.join(fixturesDir, "invalid");

/**
 * Run the linter on a fixture directory. The fixture acts as both the
 * "repo root" (for relative-path display) and the "plugins dir" parent,
 * with the plugin slug being the fixture dir name.
 */
function lintFixture(fixtureBase: string, slug: string): Finding[] {
  const pluginDir = path.join(fixtureBase, slug);
  // Use fixtureBase as the pluginsDir so requires_plugins cross-checks
  // resolve against sibling fixtures when needed.
  const opts = {
    repoRoot: fixtureBase,
    pluginsDir: fixtureBase,
  };
  return lintPlugin(slug, pluginDir, opts);
}

function errors(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === "error");
}

function codes(findings: Finding[]): string[] {
  return findings.map((f) => f.code);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("happy path", () => {
  it("valid agntux-core fixture produces zero errors", () => {
    const findings = lintFixture(validDir, "agntux-core");
    expect(errors(findings)).toHaveLength(0);
  });

  it("valid agntux-core fixture may have warnings but no errors", () => {
    const findings = lintFixture(validDir, "agntux-core");
    // Warnings are allowed; errors are not
    const errs = errors(findings);
    expect(errs).toHaveLength(0);
  });

  it("linting twice returns identical results (idempotent)", () => {
    const run1 = lintFixture(validDir, "agntux-core");
    const run2 = lintFixture(validDir, "agntux-core");
    expect(run1).toEqual(run2);
  });
});

// ---------------------------------------------------------------------------
// Pass 1 — E01: required files
// ---------------------------------------------------------------------------

describe("E01 — missing required files", () => {
  it("reports E01 when listing.yaml is missing", () => {
    const findings = lintFixture(invalidDir, "e01-missing-listing");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E01");
    const e01 = errs.filter((f) => f.code === "E01");
    expect(e01.some((f) => f.message.includes("listing.yaml"))).toBe(true);
  });

  it("reports E01 when icon.png is missing", () => {
    const findings = lintFixture(invalidDir, "e01-missing-icon");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E01");
    const e01 = errs.filter((f) => f.code === "E01");
    expect(e01.some((f) => f.message.includes("icon.png"))).toBe(true);
  });

  it("reports E01 when README.md is missing", () => {
    const findings = lintFixture(invalidDir, "e01-missing-readme");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E01");
    const e01 = errs.filter((f) => f.code === "E01");
    expect(e01.some((f) => f.message.includes("README.md"))).toBe(true);
  });

  it("reports E01 when CHANGELOG.md is missing", () => {
    const findings = lintFixture(invalidDir, "e01-missing-changelog");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E01");
    const e01 = errs.filter((f) => f.code === "E01");
    expect(e01.some((f) => f.message.includes("CHANGELOG.md"))).toBe(true);
  });

  it("reports E01 when screenshots directory is empty", () => {
    const findings = lintFixture(invalidDir, "e01-no-screenshots");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E01");
    const e01 = errs.filter((f) => f.code === "E01");
    expect(e01.some((f) => f.message.includes("screenshot"))).toBe(true);
  });

  it("all E01 findings have the correct plugin slug", () => {
    const findings = lintFixture(invalidDir, "e01-missing-listing");
    const e01 = findings.filter((f) => f.code === "E01");
    for (const f of e01) {
      expect(f.plugin).toBe("e01-missing-listing");
    }
  });
});

// ---------------------------------------------------------------------------
// Pass 2 — Schema errors
// ---------------------------------------------------------------------------

describe("E02 — icon wrong dimensions", () => {
  it("reports E02 for a 1024×1024 icon", () => {
    const findings = lintFixture(invalidDir, "e02-icon-wrong-dims");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E02");
    const e02 = errs.filter((f) => f.code === "E02");
    expect(e02[0].message).toMatch(/1024.*1024/);
    expect(e02[0].message).toMatch(/512.*512/);
  });

  it("E02 finding mentions expected dimensions", () => {
    const findings = lintFixture(invalidDir, "e02-icon-wrong-dims");
    const e02 = errors(findings).filter((f) => f.code === "E02");
    expect(e02.length).toBeGreaterThanOrEqual(1);
  });
});

describe("E03 — changelog version mismatch", () => {
  it("reports E03 when plugin.json version differs from CHANGELOG.md", () => {
    // e03-changelog-mismatch: plugin.json=2.0.0, CHANGELOG=1.0.0
    const findings = lintFixture(invalidDir, "e03-changelog-mismatch");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E03");
    const e03 = errs.filter((f) => f.code === "E03");
    expect(e03[0].message).toMatch(/2\.0\.0/);
    expect(e03[0].message).toMatch(/1\.0\.0/);
  });

  it("E03 finding targets the CHANGELOG.md file", () => {
    const findings = lintFixture(invalidDir, "e03-changelog-mismatch");
    const e03 = errors(findings).filter((f) => f.code === "E03");
    expect(e03[0].file).toMatch(/CHANGELOG\.md/);
  });
});

describe("E04 — invalid enum value in listing.yaml", () => {
  it('reports E04 for an invalid category "real-time"', () => {
    const findings = lintFixture(invalidDir, "e04-bad-category");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E04");
  });

  it("E04 finding references the categories field", () => {
    const findings = lintFixture(invalidDir, "e04-bad-category");
    const e04 = errors(findings).filter((f) => f.code === "E04");
    expect(e04[0].message).toMatch(/categor/i);
  });
});

describe("E05 — unknown or invalid shape in listing.yaml", () => {
  it("reports E05 for the removed pricing_tier field", () => {
    const findings = lintFixture(invalidDir, "e05-unknown-field");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E05");
    const e05 = errs.filter((f) => f.code === "E05");
    expect(e05.some((f) => f.message.includes("pricing_tier"))).toBe(true);
  });

  it("E05 finding targets listing.yaml", () => {
    const findings = lintFixture(invalidDir, "e05-unknown-field");
    const e05 = errors(findings).filter((f) => f.code === "E05");
    expect(e05[0].file).toMatch(/listing\.yaml/);
  });
});

describe("E06 — cross-check failures", () => {
  it("reports E06 when screenshot_order references a missing file", () => {
    const findings = lintFixture(invalidDir, "e06-missing-screenshot-ref");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E06");
    const e06 = errs.filter((f) => f.code === "E06");
    expect(
      e06.some((f) => f.message.includes("02-nonexistent.png")),
    ).toBe(true);
  });
});

describe("E07 — wrong image format", () => {
  it("reports E07 when a .jpg screenshot contains PNG bytes", () => {
    const findings = lintFixture(invalidDir, "e07-wrong-format");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E07");
    const e07 = errs.filter((f) => f.code === "E07");
    expect(e07.some((f) => f.message.includes("jpg"))).toBe(true);
  });
});

describe("E08 — image too large", () => {
  it("reports E08 when icon.png exceeds 512 KB", () => {
    const findings = lintFixture(invalidDir, "e08-icon-too-large");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E08");
    const e08 = errs.filter((f) => f.code === "E08");
    expect(e08[0].message).toMatch(/KB/);
  });
});

describe("E09 — screenshot aspect ratio out of range", () => {
  it("reports E09 for a 2560×720 screenshot (ratio 3.55)", () => {
    const findings = lintFixture(invalidDir, "e09-bad-aspect");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E09");
    const e09 = errs.filter((f) => f.code === "E09");
    expect(e09[0].message).toMatch(/3\.\d+/); // ratio like 3.55
  });

  it("E09 finding mentions the allowed range", () => {
    const findings = lintFixture(invalidDir, "e09-bad-aspect");
    const e09 = errors(findings).filter((f) => f.code === "E09");
    expect(e09[0].message).toMatch(/1\.33/);
    expect(e09[0].message).toMatch(/2\.33/);
  });
});

describe("E10 — bad screenshot filename", () => {
  it("reports E10 for a screenshot with underscore in filename", () => {
    const findings = lintFixture(invalidDir, "e10-bad-filename");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E10");
    const e10 = errs.filter((f) => f.code === "E10");
    expect(e10[0].message).toMatch(/bad_name\.png/);
  });

  it("E10 message mentions the expected pattern", () => {
    const findings = lintFixture(invalidDir, "e10-bad-filename");
    const e10 = errors(findings).filter((f) => f.code === "E10");
    expect(e10[0].message).toMatch(/NN-slug-name/);
  });
});

// ---------------------------------------------------------------------------
// Pass 2 — E14: ingest plugin missing proposed_schema
// ---------------------------------------------------------------------------

describe("E14 — ingest plugin missing proposed_schema", () => {
  it("reports E14 when an ingest plugin (slug ending -ingest) has no proposed_schema", () => {
    const findings = lintFixture(invalidDir, "e14-missing-schema-ingest");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E14");
    const e14 = errs.filter((f) => f.code === "E14");
    expect(e14[0].message).toMatch(/proposed_schema/);
    expect(e14[0].file).toMatch(/listing\.yaml/);
  });

  it("does NOT report E14 when an ingest plugin declares a valid proposed_schema", () => {
    const findings = lintFixture(validDir, "notes-ingest");
    const errs = errors(findings);
    expect(codes(errs)).not.toContain("E14");
    // The valid notes-ingest fixture should pass cleanly.
    expect(errs).toHaveLength(0);
  });

  it("does NOT report E14 for orchestrator (non-ingest) plugins without proposed_schema", () => {
    // agntux-core has no proposed_schema and slug doesn't end in -ingest.
    const findings = lintFixture(validDir, "agntux-core");
    const errs = errors(findings);
    expect(codes(errs)).not.toContain("E14");
  });
});

describe("E11 — reserved field rejected", () => {
  it('reports E11 for "featured" reserved field in listing.yaml', () => {
    const findings = lintFixture(invalidDir, "e11-reserved-field");
    const errs = errors(findings);
    expect(codes(errs)).toContain("E11");
    const e11 = errs.filter((f) => f.code === "E11");
    expect(e11[0].message).toMatch(/featured/);
  });

  it("E11 finding targets listing.yaml", () => {
    const findings = lintFixture(invalidDir, "e11-reserved-field");
    const e11 = errors(findings).filter((f) => f.code === "E11");
    expect(e11[0].file).toMatch(/listing\.yaml/);
  });
});

// ---------------------------------------------------------------------------
// Structural / behavioural checks
// ---------------------------------------------------------------------------

describe("finding structure", () => {
  it("every finding has required fields: code, severity, plugin, file, message", () => {
    const findings = lintFixture(invalidDir, "e01-missing-listing");
    for (const f of findings) {
      expect(f.code).toBeTruthy();
      expect(f.severity).toMatch(/^(error|warning)$/);
      expect(f.plugin).toBeTruthy();
      expect(f.file).toBeTruthy();
      expect(f.message).toBeTruthy();
    }
  });

  it("errors have severity=error, warnings have severity=warning", () => {
    const allFindings = [
      ...lintFixture(invalidDir, "e01-missing-listing"),
      ...lintFixture(validDir, "agntux-core"),
    ];
    for (const f of allFindings) {
      expect(["error", "warning"]).toContain(f.severity);
    }
  });
});

describe("edge cases", () => {
  it("valid agntux-core fixture passes schema checks for all known fields", () => {
    const findings = lintFixture(validDir, "agntux-core");
    const schemaErrs = errors(findings).filter(
      (f) => f.code === "E04" || f.code === "E05" || f.code === "E11",
    );
    expect(schemaErrs).toHaveLength(0);
  });

  it("E11 reserved fields do not also emit E05 for the same key", () => {
    const findings = lintFixture(invalidDir, "e11-reserved-field");
    const errs = errors(findings);
    // 'featured' should be E11 only, not also E05
    const e11keys = errs
      .filter((f) => f.code === "E11")
      .map((f) => f.message);
    const e05keys = errs
      .filter((f) => f.code === "E05")
      .map((f) => f.message);
    const featuredInE05 = e05keys.some((m) => m.includes("featured"));
    expect(featuredInE05).toBe(false);
    expect(e11keys.some((m) => m.includes("featured"))).toBe(true);
  });
});
