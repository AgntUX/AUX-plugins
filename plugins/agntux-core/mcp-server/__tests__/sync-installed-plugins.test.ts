/**
 * sync-installed-plugins.test.ts
 *
 * Unit tests for the `agntux_core_sync_installed_plugins` MCP tool. The
 * tool atomically writes `~/.agntux/installed-plugins.json`, which the
 * agntux-teams daemon watches and POSTs to `/api/me/plugins`.
 *
 * We override the home directory via `os.homedir` patch so the test runs
 * against a temp dir instead of the real `~/.agntux`.
 *
 * Coverage:
 *   - happy path writes the schema_version=1 envelope
 *   - replay with same input is idempotent
 *   - invalid slug entries are dropped, valid ones kept
 *   - path-traversal-shaped slugs are rejected
 *   - dedupe by slug (last entry wins is fine for the test; just ensure
 *     no duplicate primary key would be produced)
 *   - parent dir is created when missing
 *   - atomic write — no `.tmp` leftover on success
 *   - very large input is clamped to MAX_PLUGINS
 *   - agntux-core floor: the hub is written into any NON-EMPTY set even
 *     when the caller omits it, never duplicated when present, survives
 *     the MAX_PLUGINS clamp without evicting a caller plugin that already
 *     includes it, and is NOT injected into an empty set (so the server's
 *     no-op snapshot guard is preserved) — first-run onboarding regression
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncInstalledPluginsTool } from "../src/tools/sync-installed-plugins.js";

let tempHome: string;
const ORIGINAL_OVERRIDE = process.env.AGNTUX_HOME_OVERRIDE;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "agntux-installed-plugins-"));
  // The tool resolves home via `AGNTUX_HOME_OVERRIDE` first when set —
  // this is the test seam. We can't use HOME directly because vitest's
  // runtime resolves `os.homedir()` via libuv's passwd-db lookup and
  // ignores HOME, so the tool's writes would land in the real
  // `~/.agntux` and corrupt the developer's state.
  process.env.AGNTUX_HOME_OVERRIDE = tempHome;
});

afterEach(() => {
  if (ORIGINAL_OVERRIDE === undefined) {
    delete process.env.AGNTUX_HOME_OVERRIDE;
  } else {
    process.env.AGNTUX_HOME_OVERRIDE = ORIGINAL_OVERRIDE;
  }
  try {
    rmSync(tempHome, { recursive: true, force: true });
  } catch {
    /* swallow */
  }
});

function readFile(): unknown {
  return JSON.parse(
    readFileSync(join(tempHome, ".agntux", "installed-plugins.json"), "utf8")
  );
}

describe("agntux_core_sync_installed_plugins — happy path", () => {
  it("writes a schema_version=1 envelope with the supplied plugins", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [
        {
          slug: "agntux-core",
          marketplace: "agntux",
          version: "9.3.0",
          source_sha: "deadbeef",
        },
      ],
    });
    const parsed = readFile() as Record<string, unknown>;
    expect(parsed.schema_version).toBe(1);
    expect(typeof parsed.generated_at).toBe("string");
    expect(parsed.plugins).toEqual([
      {
        slug: "agntux-core",
        marketplace: "agntux",
        version: "9.3.0",
        source_sha: "deadbeef",
      },
    ]);
  });

  it("creates the .agntux/ dir when missing", async () => {
    expect(existsSync(join(tempHome, ".agntux"))).toBe(false);
    await syncInstalledPluginsTool.handler({ plugins: [] });
    expect(existsSync(join(tempHome, ".agntux"))).toBe(true);
    expect(
      existsSync(join(tempHome, ".agntux", "installed-plugins.json"))
    ).toBe(true);
  });

  it("returns structured content with the absolute path and plugin count", async () => {
    const res = await syncInstalledPluginsTool.handler({
      plugins: [{ slug: "agntux-core", marketplace: "agntux" }],
    });
    expect((res as { structuredContent: { ok: boolean } }).structuredContent.ok).toBe(true);
    expect(
      (res as { structuredContent: { plugin_count: number } }).structuredContent
        .plugin_count
    ).toBe(1);
    expect(
      (res as { structuredContent: { path: string } }).structuredContent.path
    ).toContain(".agntux/installed-plugins.json");
  });
});

describe("agntux_core_sync_installed_plugins — replays", () => {
  it("two replays of the same input produce structurally equivalent files", async () => {
    const input = {
      plugins: [
        { slug: "agntux-core", marketplace: "agntux", version: "9.3.0" },
        { slug: "agntux-build", marketplace: "agntux" },
      ],
    };
    await syncInstalledPluginsTool.handler(input);
    const first = readFile() as { plugins: unknown };
    await syncInstalledPluginsTool.handler(input);
    const second = readFile() as { plugins: unknown };
    // generated_at may differ — what matters is the plugin set is stable.
    expect(second.plugins).toEqual(first.plugins);
  });

  it("a snapshot with one plugin removed reflects the new set on disk", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [
        { slug: "agntux-core", marketplace: "agntux" },
        { slug: "agntux-build", marketplace: "agntux" },
      ],
    });
    await syncInstalledPluginsTool.handler({
      plugins: [{ slug: "agntux-core", marketplace: "agntux" }],
    });
    const parsed = readFile() as { plugins: Array<{ slug: string }> };
    expect(parsed.plugins.map((p) => p.slug)).toEqual(["agntux-core"]);
  });
});

describe("agntux_core_sync_installed_plugins — sanitization", () => {
  it("rejects path-traversal-shaped slug entries", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [
        { slug: "../../etc/passwd", marketplace: "agntux" },
        { slug: "agntux-core", marketplace: "agntux" },
      ],
    });
    const parsed = readFile() as { plugins: Array<{ slug: string }> };
    expect(parsed.plugins.map((p) => p.slug)).toEqual(["agntux-core"]);
  });

  it("defaults a missing or empty marketplace to agntux (kept, not dropped)", async () => {
    // The tool implements the documented "default marketplace to agntux
    // when unknown" contract: an empty or omitted marketplace is filled
    // in, not dropped. (Non-core slugs so the agntux-core floor doesn't
    // mask the result.)
    await syncInstalledPluginsTool.handler({
      plugins: [
        { slug: "agntux-slack", marketplace: "" }, // empty string
        { slug: "agntux-build" }, // marketplace omitted entirely
      ],
    });
    const parsed = readFile() as {
      plugins: Array<{ slug: string; marketplace: string }>;
    };
    const bySlug = Object.fromEntries(
      parsed.plugins.map((p) => [p.slug, p.marketplace]),
    );
    expect(bySlug["agntux-slack"]).toBe("agntux");
    expect(bySlug["agntux-build"]).toBe("agntux");
  });

  it("dedupes duplicate slug entries — first occurrence wins", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [
        { slug: "agntux-core", marketplace: "agntux", version: "1.0.0" },
        { slug: "agntux-core", marketplace: "agntux", version: "2.0.0" },
      ],
    });
    const parsed = readFile() as {
      plugins: Array<{ slug: string; version?: string }>;
    };
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].version).toBe("1.0.0");
  });

  it("drops version + source_sha when they are oversized", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [
        {
          slug: "agntux-core",
          marketplace: "agntux",
          version: "x".repeat(200),
          source_sha: "y".repeat(500),
        },
      ],
    });
    const parsed = readFile() as {
      plugins: Array<{
        slug: string;
        version?: string;
        source_sha?: string;
      }>;
    };
    expect(parsed.plugins[0].slug).toBe("agntux-core");
    expect(parsed.plugins[0].version).toBeUndefined();
    expect(parsed.plugins[0].source_sha).toBeUndefined();
  });

  it("clamps an oversized input array to 256 entries", async () => {
    const oversized = Array.from({ length: 500 }, (_, i) => ({
      slug: `plugin-${i}`,
      marketplace: "agntux",
    }));
    await syncInstalledPluginsTool.handler({ plugins: oversized });
    const parsed = readFile() as { plugins: unknown[] };
    expect(parsed.plugins).toHaveLength(256);
  });

  it("empty input writes a valid envelope with an empty plugins array (no-op snapshot)", async () => {
    // The floor deliberately does NOT fire on an empty set — an empty
    // snapshot is the server's safe no-op (no ledger reconciliation).
    // See ensureCorePresent / the agntux-core floor describe block below.
    await syncInstalledPluginsTool.handler({ plugins: [] });
    const parsed = readFile() as Record<string, unknown>;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.plugins).toEqual([]);
  });

  it("non-array, non-empty plugins arg fails loud and writes nothing", async () => {
    // Old behavior silently wrote `plugins: []` and reported success. A
    // non-array truthy value is now a caller error: nothing is written so
    // a previously-good manifest is never clobbered.
    const res = await syncInstalledPluginsTool.handler({
      plugins: "not-an-array",
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(
      existsSync(join(tempHome, ".agntux", "installed-plugins.json")),
    ).toBe(false);
  });
});

describe("agntux_core_sync_installed_plugins — agntux-core floor", () => {
  it("injects agntux-core when the caller omits it (ingest-only list)", async () => {
    // This is the first-run onboarding regression: the skill historically
    // synced only the user-confirmed ingest plugins, dropping the hub and
    // with it every agntux-core view-tool the remote connector exposes.
    await syncInstalledPluginsTool.handler({
      plugins: [
        { slug: "agntux-slack", marketplace: "agntux" },
        { slug: "agntux-gmail", marketplace: "agntux" },
      ],
    });
    const parsed = readFile() as { plugins: Array<{ slug: string }> };
    const slugs = parsed.plugins.map((p) => p.slug);
    expect(slugs).toContain("agntux-core");
    expect(slugs).toContain("agntux-slack");
    expect(slugs).toContain("agntux-gmail");
    // Floor is prepended, so the hub leads the set.
    expect(slugs[0]).toBe("agntux-core");
  });

  it("does not duplicate agntux-core when the caller already includes it", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [
        { slug: "agntux-core", marketplace: "agntux", version: "10.5.1" },
        { slug: "agntux-slack", marketplace: "agntux" },
      ],
    });
    const parsed = readFile() as {
      plugins: Array<{ slug: string; version?: string }>;
    };
    const cores = parsed.plugins.filter((p) => p.slug === "agntux-core");
    expect(cores).toHaveLength(1);
    // The caller's richer entry (with version) is preserved — the floor
    // does not clobber an already-present hub entry.
    expect(cores[0].version).toBe("10.5.1");
  });

  it("keeps agntux-core present even when the list is clamped to MAX_PLUGINS", async () => {
    // 256 non-core entries saturate the cap; the floor must still land.
    const saturated = Array.from({ length: 256 }, (_, i) => ({
      slug: `plugin-${i}`,
      marketplace: "agntux",
    }));
    await syncInstalledPluginsTool.handler({ plugins: saturated });
    const parsed = readFile() as { plugins: Array<{ slug: string }> };
    expect(parsed.plugins).toHaveLength(256);
    expect(parsed.plugins.map((p) => p.slug)).toContain("agntux-core");
  });

  it("does not evict a caller plugin when 256 entries already include agntux-core", async () => {
    // Present-path: the floor must NOT prepend (no over-cap), so every
    // caller slug — including the last — survives.
    const saturated = Array.from({ length: 256 }, (_, i) =>
      i === 255
        ? { slug: "agntux-core", marketplace: "agntux" }
        : { slug: `plugin-${i}`, marketplace: "agntux" },
    );
    await syncInstalledPluginsTool.handler({ plugins: saturated });
    const parsed = readFile() as { plugins: Array<{ slug: string }> };
    const slugs = parsed.plugins.map((p) => p.slug);
    expect(slugs).toHaveLength(256);
    expect(slugs).toContain("agntux-core");
    expect(slugs).toContain("plugin-254"); // nothing was evicted
    expect(slugs).toContain("plugin-0");
  });

  it("does NOT inject agntux-core into an empty set (preserves the no-op snapshot)", async () => {
    // Critical safety property: an empty sync must stay empty so the
    // server's zero-length-snapshot guard treats it as a no-op rather
    // than reconciling a 1-entry [agntux-core] snapshot and soft-deleting
    // every other plugin's view-tools from the ledger.
    await syncInstalledPluginsTool.handler({ plugins: [] });
    const parsed = readFile() as { plugins: unknown[] };
    expect(parsed.plugins).toEqual([]);
  });
});

describe("agntux_core_sync_installed_plugins — tolerant parsing + fail-loud", () => {
  function manifestExists(): boolean {
    return existsSync(join(tempHome, ".agntux", "installed-plugins.json"));
  }

  it("accepts bare slug strings, defaulting marketplace to agntux", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: ["agntux-slack", "agntux-build"],
    });
    const parsed = readFile() as {
      plugins: Array<{ slug: string; marketplace: string }>;
    };
    const bySlug = Object.fromEntries(
      parsed.plugins.map((p) => [p.slug, p.marketplace]),
    );
    expect(bySlug["agntux-slack"]).toBe("agntux");
    expect(bySlug["agntux-build"]).toBe("agntux");
    expect(bySlug["agntux-core"]).toBe("agntux"); // floor still fires
  });

  it("parses a JSON-stringified plugins array", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: JSON.stringify([{ slug: "agntux-slack", marketplace: "agntux" }]),
    });
    const parsed = readFile() as { plugins: Array<{ slug: string }> };
    const slugs = parsed.plugins.map((p) => p.slug);
    expect(slugs).toContain("agntux-slack");
    expect(slugs).toContain("agntux-core");
  });

  it("preserves an explicitly-provided valid marketplace (no coercion)", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [{ slug: "agntux-core", marketplace: "thirdparty" }],
    });
    const parsed = readFile() as {
      plugins: Array<{ slug: string; marketplace: string }>;
    };
    const core = parsed.plugins.find((p) => p.slug === "agntux-core");
    expect(core?.marketplace).toBe("thirdparty");
  });

  it("treats an absent plugins arg as a deliberate empty no-op (not an error)", async () => {
    const res = await syncInstalledPluginsTool.handler({});
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const parsed = readFile() as { plugins: unknown[] };
    expect(parsed.plugins).toEqual([]);
  });

  it("fails loud (writes nothing) when a non-empty list has zero valid entries", async () => {
    const res = await syncInstalledPluginsTool.handler({
      plugins: [{ name: "agntux-slack" }, 42, "Bad Slug!"],
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const sc = (res as { structuredContent?: Record<string, unknown> })
      .structuredContent!;
    expect(sc.written).toBe(false);
    expect(sc.received).toBe(3);
    expect(Array.isArray(sc.dropped)).toBe(true);
    expect((sc.dropped as unknown[]).length).toBe(3);
    expect(manifestExists()).toBe(false);
  });

  it("fails loud on a non-array, non-empty plugins arg (object)", async () => {
    const res = await syncInstalledPluginsTool.handler({
      plugins: { slug: "agntux-core", marketplace: "agntux" },
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(manifestExists()).toBe(false);
  });

  it("does not clobber an existing manifest when a later call is all-invalid", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [{ slug: "agntux-slack", marketplace: "agntux" }],
    });
    const before = readFile();
    const res = await syncInstalledPluginsTool.handler({
      plugins: ["Bad Slug!"],
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(readFile()).toEqual(before); // unchanged
  });

  it("writes valid entries and reports dropped ones on a partial-drop call", async () => {
    const res = await syncInstalledPluginsTool.handler({
      plugins: [
        { slug: "agntux-slack", marketplace: "agntux" },
        { slug: "INVALID SLUG", marketplace: "agntux" },
      ],
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const parsed = readFile() as { plugins: Array<{ slug: string }> };
    expect(parsed.plugins.map((p) => p.slug)).toContain("agntux-slack");
    const sc = (res as { structuredContent?: Record<string, unknown> })
      .structuredContent!;
    expect(Array.isArray(sc.dropped)).toBe(true);
    expect((sc.dropped as unknown[]).length).toBe(1);
  });

  it("treats a provided-but-malformed marketplace as an error, never coercing it to agntux", async () => {
    // The default only fills an ABSENT/empty marketplace. A non-empty value
    // that fails the format is a real caller error — it must be dropped (and
    // here, being the sole entry, fail the whole call) rather than silently
    // rewritten to "agntux".
    const res = await syncInstalledPluginsTool.handler({
      plugins: [{ slug: "agntux-slack", marketplace: "Bad Mkt!" }],
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const sc = (res as { structuredContent?: Record<string, unknown> })
      .structuredContent!;
    expect(sc.written).toBe(false);
    expect((sc.dropped as string[]).join(" ")).toContain("marketplace");
    expect(
      existsSync(join(tempHome, ".agntux", "installed-plugins.json")),
    ).toBe(false);
  });

  it("parses a JSON-stringified EMPTY array as a deliberate empty no-op", async () => {
    const res = await syncInstalledPluginsTool.handler({ plugins: "[]" });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const parsed = readFile() as { plugins: unknown[] };
    expect(parsed.plugins).toEqual([]);
  });

  it("caps the reported drop sample but reports the true total on a huge all-invalid input", async () => {
    // Guards the unbounded-error-envelope hardening: the rendered/sampled
    // `dropped` list is clamped, while `dropped_count` carries the real total.
    const huge = Array.from({ length: 1000 }, () => ({ not: "a-plugin" }));
    const res = await syncInstalledPluginsTool.handler({ plugins: huge });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const sc = (res as { structuredContent?: Record<string, unknown> })
      .structuredContent!;
    expect(sc.received).toBe(1000);
    expect(sc.dropped_count).toBe(1000);
    expect((sc.dropped as unknown[]).length).toBeLessThanOrEqual(25);
    expect(
      existsSync(join(tempHome, ".agntux", "installed-plugins.json")),
    ).toBe(false);
  });
});

describe("agntux_core_sync_installed_plugins — atomicity", () => {
  it("leaves no .tmp file behind on success", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [{ slug: "agntux-core", marketplace: "agntux" }],
    });
    const files = readdirSync(join(tempHome, ".agntux"));
    expect(files).toContain("installed-plugins.json");
    expect(files).not.toContain("installed-plugins.json.tmp");
  });
});
