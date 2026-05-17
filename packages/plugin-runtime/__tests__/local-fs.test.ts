import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalFsContext } from "../src/local-fs.js";
import { ViewToolFsError } from "../src/context.js";

let ROOT: string;

beforeAll(async () => {
  ROOT = await mkdtemp(join(tmpdir(), "plugin-runtime-localfs-"));
  await mkdir(join(ROOT, "data", "actions"), { recursive: true });
  await writeFile(join(ROOT, "data", "actions", "a.md"), "alpha\n", "utf8");
  await writeFile(join(ROOT, "data", "actions", "b.md"), "bravo\n", "utf8");
  // c.md has YAML frontmatter so listWithMeta has something to surface
  // metadata for. The other two are body-only so the test can also
  // assert the `meta: null` branch.
  await writeFile(
    join(ROOT, "data", "actions", "c.md"),
    `---
status: open
priority: high
---
charlie body
`,
    "utf8",
  );
  await mkdir(join(ROOT, "teams", "engineering", "data"), { recursive: true });
  await writeFile(
    join(ROOT, "teams", "engineering", "data", "x.md"),
    "x-team\n",
    "utf8",
  );
});

afterAll(async () => {
  // Best-effort: leave the tmpdir for the OS to GC.
});

function makeCtx() {
  return createLocalFsContext({
    root: ROOT,
    scope: { user_id: "u1", organization_id: "o1" },
  });
}

describe("createLocalFsContext", () => {
  it("readFile returns bytes for an existing file", async () => {
    const ctx = makeCtx();
    const buf = await ctx.fs.readFile("data/actions/a.md");
    expect(buf.toString("utf8")).toBe("alpha\n");
  });

  it("readFile maps ENOENT → not-found", async () => {
    const ctx = makeCtx();
    await expect(ctx.fs.readFile("nope.md")).rejects.toMatchObject({
      code: "not-found",
      status: 404,
    });
  });

  it("readFile throws forbidden on path traversal", async () => {
    const ctx = makeCtx();
    await expect(
      ctx.fs.readFile("../../etc/passwd"),
    ).rejects.toBeInstanceOf(ViewToolFsError);
    await expect(
      ctx.fs.readFile("../../etc/passwd"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("list returns sorted relative paths", async () => {
    const ctx = makeCtx();
    const paths = await ctx.fs.list("data/actions");
    expect(paths).toEqual([
      "data/actions/a.md",
      "data/actions/b.md",
      "data/actions/c.md",
    ]);
  });

  it("list returns [] for a missing prefix", async () => {
    const ctx = makeCtx();
    const paths = await ctx.fs.list("data/missing");
    expect(paths).toEqual([]);
  });

  it("list walks nested directories", async () => {
    const ctx = makeCtx();
    const paths = await ctx.fs.list("teams");
    expect(paths).toContain("teams/engineering/data/x.md");
  });

  it("exists is true for a present file", async () => {
    const ctx = makeCtx();
    expect(await ctx.fs.exists("data/actions/a.md")).toBe(true);
  });

  it("exists is false for a missing file", async () => {
    const ctx = makeCtx();
    expect(await ctx.fs.exists("data/actions/zzz.md")).toBe(false);
  });

  it("exists is false (not throw) for a traversal attempt", async () => {
    const ctx = makeCtx();
    expect(await ctx.fs.exists("../etc/passwd")).toBe(false);
  });

  it("withScope returns a NEW context with the merged scope", () => {
    const ctx = makeCtx();
    const child = ctx.withScope({ team_slug: "engineering" });
    expect(child.scope.team_slug).toBe("engineering");
    expect(ctx.scope.team_slug).toBeUndefined();
    // Both contexts share the same fs instance.
    expect(child.fs).toBe(ctx.fs);
  });

  it("uses the injected now() for deterministic tests", () => {
    const fixed = new Date("2024-01-01T00:00:00Z");
    const ctx = createLocalFsContext({
      root: ROOT,
      scope: { user_id: "u1", organization_id: "o1" },
      now: () => fixed,
    });
    expect(ctx.now()).toBe(fixed);
  });
});

// EACCES test — skipped on CI where the test process runs as root and chmod
// 000 is a no-op. Locally on macOS/Linux it asserts the forbidden mapping.
const skipEaccess = process.getuid?.() === 0;
describe.skipIf(skipEaccess)("createLocalFsContext — EACCES mapping", () => {
  it("readFile maps EACCES → forbidden", async () => {
    const ctx = makeCtx();
    const forbiddenFile = join(ROOT, "no-read.md");
    await writeFile(forbiddenFile, "secret\n", "utf8");
    await chmod(forbiddenFile, 0o000);
    try {
      await expect(ctx.fs.readFile("no-read.md")).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });
    } finally {
      await chmod(forbiddenFile, 0o644);
    }
  });

  it("readMany returns position-correlated Buffers and null for a missing path", async () => {
    const ctx = makeCtx();
    const result = await ctx.fs.readMany([
      "data/actions/a.md",
      "data/actions/MISSING.md",
      "data/actions/b.md",
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]?.toString("utf8")).toBe("alpha\n");
    expect(result[1]).toBeNull();
    expect(result[2]?.toString("utf8")).toBe("bravo\n");
  });

  it("readMany returns null (not throw) for a path that escapes the root", async () => {
    const ctx = makeCtx();
    // A real readFile call for ".." would throw `forbidden`. The
    // contract of readMany is: per-file failures resolve to null.
    // The whole batch must not abort on a single bad path.
    const result = await ctx.fs.readMany([
      "data/actions/a.md",
      "../../etc/passwd",
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.toString("utf8")).toBe("alpha\n");
    expect(result[1]).toBeNull();
  });

  it("listWithMeta surfaces frontmatter for files that have it, null otherwise", async () => {
    const ctx = makeCtx();
    const entries = await ctx.fs.listWithMeta("data/actions");
    // The list is sorted asc by path; a.md → null, b.md → null, c.md → { status, priority }.
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.meta]));
    expect(byPath["data/actions/a.md"]).toBeNull();
    expect(byPath["data/actions/b.md"]).toBeNull();
    expect(byPath["data/actions/c.md"]).toEqual({
      status: "open",
      priority: "high",
    });
  });
});
