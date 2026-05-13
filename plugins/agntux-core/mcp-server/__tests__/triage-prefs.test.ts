/**
 * triage-prefs.test.ts
 *
 * Unit tests for the new `agntux_core_save_triage_prefs` MCP tool (P3 v2 §1).
 * Tests the deterministic write of `<root>/.agntux/triage-prefs.json` against
 * a temp AgntUX root injected via AGNTUX_ROOT_OVERRIDE.
 *
 * Coverage:
 *   - empty input → file with empty arrays at schema_version 1
 *   - non-empty input → arrays in the file match input order, deduplicated
 *   - invalid slugs are dropped (traversal / non-matching pattern guard)
 *   - parent dir is created when missing
 *   - atomic write — no .tmp leftover on success
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { triagePrefsTool } from "../src/tools/triage-prefs.js";

let tempBase: string;
let agntuxRoot: string;
const ORIGINAL_OVERRIDE = process.env.AGNTUX_ROOT_OVERRIDE;

beforeEach(() => {
  tempBase = join(
    tmpdir(),
    `agntux-prefs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  );
  agntuxRoot = join(tempBase, "agntux");
  mkdirSync(agntuxRoot, { recursive: true });
  process.env.AGNTUX_ROOT_OVERRIDE = agntuxRoot;
});

afterEach(() => {
  if (ORIGINAL_OVERRIDE === undefined) {
    delete process.env.AGNTUX_ROOT_OVERRIDE;
  } else {
    process.env.AGNTUX_ROOT_OVERRIDE = ORIGINAL_OVERRIDE;
  }
  try {
    rmSync(tempBase, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function readPrefs(): unknown {
  return JSON.parse(readFileSync(join(agntuxRoot, ".agntux", "triage-prefs.json"), "utf8"));
}

describe("agntux_core_save_triage_prefs", () => {
  it("writes a fresh file with empty arrays for empty input", async () => {
    await triagePrefsTool.handler({});
    expect(readPrefs()).toEqual({
      schema_version: 1,
      muted_team_slugs: [],
      muted_view_slugs: [],
    });
  });

  it("writes the input arrays verbatim when both are well-formed", async () => {
    await triagePrefsTool.handler({
      muted_team_slugs: ["platform", "infra"],
      muted_view_slugs: ["all-eng"],
    });
    expect(readPrefs()).toEqual({
      schema_version: 1,
      muted_team_slugs: ["platform", "infra"],
      muted_view_slugs: ["all-eng"],
    });
  });

  it("dedupes repeated entries while preserving first-seen order", async () => {
    await triagePrefsTool.handler({
      muted_team_slugs: ["platform", "infra", "platform", "infra"],
      muted_view_slugs: [],
    });
    const prefs = readPrefs() as { muted_team_slugs: string[] };
    expect(prefs.muted_team_slugs).toEqual(["platform", "infra"]);
  });

  it("drops slugs that fail the strict pattern (traversal / non-conforming)", async () => {
    await triagePrefsTool.handler({
      muted_team_slugs: [
        "../etc",
        "..\\Windows",
        "",
        "  ",
        "Upper",
        "ok-team",
        "-leading-dash",
        "trailing-dash-",
      ],
      muted_view_slugs: ["view-slug-ok"],
    });
    const prefs = readPrefs() as {
      muted_team_slugs: string[];
      muted_view_slugs: string[];
    };
    expect(prefs.muted_team_slugs).toEqual(["ok-team"]);
    expect(prefs.muted_view_slugs).toEqual(["view-slug-ok"]);
  });

  it("creates the .agntux/ parent directory when it doesn't exist yet", async () => {
    expect(existsSync(join(agntuxRoot, ".agntux"))).toBe(false);
    await triagePrefsTool.handler({ muted_team_slugs: ["one"] });
    expect(existsSync(join(agntuxRoot, ".agntux", "triage-prefs.json"))).toBe(true);
  });

  it("does not leave a .tmp file behind after a successful write", async () => {
    await triagePrefsTool.handler({});
    expect(
      existsSync(join(agntuxRoot, ".agntux", "triage-prefs.json.tmp")),
    ).toBe(false);
  });
});
