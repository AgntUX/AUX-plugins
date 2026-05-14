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

// The 9.3.0 / P9 prefs file is at schema_version 2 with the v2 default
// shape: filter maps, sort, show toggles, and a per-path triage_state
// map. Tests assert subsets of this shape rather than full equality so
// adding future v2 fields doesn't require updating every test.
const V2_EMPTY_SHAPE = {
  schema_version: 2,
  muted_team_slugs: [],
  muted_view_slugs: [],
  team_filters: {},
  view_filters: {},
  relevance_class_filters: {},
  sort: "priority",
  show_done: false,
  show_snoozed: false,
  show_dismissed: false,
  triage_state: {},
};

describe("agntux_core_save_triage_prefs (v1 back-compat path)", () => {
  it("writes a fresh file at v2 default shape for empty input", async () => {
    await triagePrefsTool.handler({});
    expect(readPrefs()).toEqual(V2_EMPTY_SHAPE);
  });

  it("translates legacy muted_* arrays into the v2 filter maps and back into the legacy mirror", async () => {
    await triagePrefsTool.handler({
      muted_team_slugs: ["platform", "infra"],
      muted_view_slugs: ["all-eng"],
    });
    const prefs = readPrefs() as Record<string, unknown>;
    expect(prefs.schema_version).toBe(2);
    // Filter map carries the muted entries.
    expect(prefs.team_filters).toEqual({ platform: "hidden", infra: "hidden" });
    expect(prefs.view_filters).toEqual({ "all-eng": "hidden" });
    // Legacy arrays are kept in sync — older bundle that reads only
    // muted_team_slugs still honors the user's hidden teams.
    expect((prefs.muted_team_slugs as string[]).sort()).toEqual(["infra", "platform"]);
    expect(prefs.muted_view_slugs).toEqual(["all-eng"]);
  });

  it("dedupes repeated entries", async () => {
    await triagePrefsTool.handler({
      muted_team_slugs: ["platform", "infra", "platform", "infra"],
      muted_view_slugs: [],
    });
    const prefs = readPrefs() as { muted_team_slugs: string[] };
    expect(prefs.muted_team_slugs.sort()).toEqual(["infra", "platform"]);
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

// New: v2 patch-merge semantics.
import { setTriagePrefTool } from "../src/tools/triage-prefs.js";

describe("agntux_core_save_triage_prefs — v2 patch merge", () => {
  it("merges team_filters per-key without touching other keys", async () => {
    await triagePrefsTool.handler({
      team_filters: { platform: "hidden", infra: "shown" },
    });
    await triagePrefsTool.handler({
      team_filters: { platform: "shown" }, // patch only platform
    });
    const prefs = readPrefs() as { team_filters: Record<string, string> };
    expect(prefs.team_filters).toEqual({ platform: "shown", infra: "shown" });
  });

  it("stores relevance_class_filters per team without losing siblings", async () => {
    await triagePrefsTool.handler({
      relevance_class_filters: {
        platform: ["product-decisions", "customer-pain"],
        infra: ["infra-incidents"],
      },
    });
    await triagePrefsTool.handler({
      relevance_class_filters: { platform: ["customer-pain"] }, // patch platform
    });
    const prefs = readPrefs() as {
      relevance_class_filters: Record<string, string[]>;
    };
    expect(prefs.relevance_class_filters).toEqual({
      platform: ["customer-pain"],
      infra: ["infra-incidents"],
    });
  });

  it("ignores unknown sort values and keeps existing", async () => {
    await triagePrefsTool.handler({ sort: "due-then-priority" });
    await triagePrefsTool.handler({ sort: "not-a-real-sort" });
    expect((readPrefs() as { sort: string }).sort).toBe("due-then-priority");
  });

  it("accepts show_done / show_snoozed / show_dismissed booleans", async () => {
    await triagePrefsTool.handler({ show_done: true, show_snoozed: true });
    const prefs = readPrefs() as Record<string, unknown>;
    expect(prefs.show_done).toBe(true);
    expect(prefs.show_snoozed).toBe(true);
    expect(prefs.show_dismissed).toBe(false);
  });

  it("filter-map writes update the legacy muted_* mirror", async () => {
    await triagePrefsTool.handler({
      team_filters: { platform: "hidden", infra: "shown" },
      view_filters: { "all-eng": "hidden" },
    });
    const prefs = readPrefs() as Record<string, unknown>;
    expect(prefs.muted_team_slugs).toEqual(["platform"]);
    expect(prefs.muted_view_slugs).toEqual(["all-eng"]);
  });
});

describe("agntux_core_set_triage_pref", () => {
  it("sets snoozed_until + dismissed_at for a personal-action path", async () => {
    await setTriagePrefTool.handler({
      path: "actions/2026-05-12-foo.md",
      snoozed_until: "2026-05-14T09:00:00Z",
    });
    const prefs = readPrefs() as { triage_state: Record<string, unknown> };
    expect(prefs.triage_state["actions/2026-05-12-foo.md"]).toEqual({
      snoozed_until: "2026-05-14T09:00:00Z",
      dismissed_at: null,
    });
  });

  it("sets dismissed_at for a team-scoped path", async () => {
    await setTriagePrefTool.handler({
      path: "teams/platform/actions/2026-05-12-acme.md",
      dismissed_at: "2026-05-12T08:30:00Z",
    });
    const prefs = readPrefs() as { triage_state: Record<string, unknown> };
    expect(
      prefs.triage_state["teams/platform/actions/2026-05-12-acme.md"],
    ).toEqual({ snoozed_until: null, dismissed_at: "2026-05-12T08:30:00Z" });
  });

  it("clears the entry when both fields become null", async () => {
    await setTriagePrefTool.handler({
      path: "actions/2026-05-12-foo.md",
      snoozed_until: "2026-05-14T09:00:00Z",
    });
    await setTriagePrefTool.handler({
      path: "actions/2026-05-12-foo.md",
      snoozed_until: null,
    });
    const prefs = readPrefs() as { triage_state: Record<string, unknown> };
    expect(prefs.triage_state["actions/2026-05-12-foo.md"]).toBeUndefined();
  });

  it("rejects traversal-shaped paths", async () => {
    await expect(
      setTriagePrefTool.handler({
        path: "../etc/passwd.md",
        snoozed_until: "2099-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/[Pp]ath traversal/);
  });

  it("rejects non-actions paths", async () => {
    await expect(
      setTriagePrefTool.handler({
        path: "entities/companies/acme.md",
        snoozed_until: "2099-01-01T00:00:00Z",
      }),
    ).rejects.toThrow(/[Pp]ath traversal/);
  });

  it("rejects empty path", async () => {
    await expect(
      setTriagePrefTool.handler({ path: "" }),
    ).rejects.toThrow(/path is required/);
  });

  it("preserves siblings when patching one path", async () => {
    await setTriagePrefTool.handler({
      path: "actions/foo.md",
      snoozed_until: "2099-01-01T00:00:00Z",
    });
    await setTriagePrefTool.handler({
      path: "teams/platform/actions/bar.md",
      dismissed_at: "2099-01-01T00:00:00Z",
    });
    const prefs = readPrefs() as { triage_state: Record<string, unknown> };
    expect(Object.keys(prefs.triage_state).sort()).toEqual([
      "actions/foo.md",
      "teams/platform/actions/bar.md",
    ]);
  });
});
