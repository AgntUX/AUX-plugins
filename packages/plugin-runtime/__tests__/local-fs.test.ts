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
    expect(paths).toEqual(["data/actions/a.md", "data/actions/b.md"]);
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
});
