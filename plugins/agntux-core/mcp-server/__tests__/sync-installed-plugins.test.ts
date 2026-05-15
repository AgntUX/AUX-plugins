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

  it("rejects entries with empty marketplace", async () => {
    await syncInstalledPluginsTool.handler({
      plugins: [
        { slug: "agntux-core", marketplace: "" },
        { slug: "agntux-build", marketplace: "agntux" },
      ],
    });
    const parsed = readFile() as { plugins: Array<{ slug: string }> };
    expect(parsed.plugins.map((p) => p.slug)).toEqual(["agntux-build"]);
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

  it("empty input writes a valid envelope with an empty plugins array", async () => {
    await syncInstalledPluginsTool.handler({ plugins: [] });
    const parsed = readFile() as Record<string, unknown>;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.plugins).toEqual([]);
  });

  it("non-array plugins arg is treated as empty", async () => {
    await syncInstalledPluginsTool.handler({ plugins: "not-an-array" });
    const parsed = readFile() as { plugins: unknown[] };
    expect(parsed.plugins).toEqual([]);
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
