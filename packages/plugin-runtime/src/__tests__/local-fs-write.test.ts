/**
 * Tests for the write surface (`writeFile` / `update` / `deleteFile`) on
 * `createLocalFsContext`. The S3 backend has its own integration tests;
 * here we pin the local-fs contract:
 *
 *   - writeFile creates parent dirs and atomically lands the body.
 *   - writeFile CAS guard rejects mismatched parent_sha with `conflict`.
 *   - update reads-modifies-writes through the CAS guard automatically.
 *   - update retries on conflict and converges if the patch is monotonic.
 *   - deleteFile is idempotent on already-missing paths.
 */

import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalFsContext } from "../local-fs.js";
import { ViewToolFsError } from "../context.js";

const SCOPE = { user_id: "user-1", organization_id: "org-1" };

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "local-fs-write-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("createLocalFsContext.fs.writeFile", () => {
  it("creates parent directories and writes the body atomically", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    const res = await ctx.fs.writeFile(
      "actions/2026/05/foo.md",
      "hello world",
    );
    const body = await readFile(join(root, "actions/2026/05/foo.md"), "utf8");
    expect(body).toBe("hello world");
    expect(res.new_sha256).toBe(sha256("hello world"));
    expect(res.container_id).toBe("local-fs");
  });

  it("accepts a Buffer body", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    const res = await ctx.fs.writeFile(
      "actions/buf.md",
      Buffer.from("from buffer", "utf8"),
    );
    expect(res.new_sha256).toBe(sha256("from buffer"));
  });

  it("CAS — succeeds when parent_sha matches the file's current head", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    await ctx.fs.writeFile("actions/a.md", "v1");
    const v1Sha = sha256("v1");
    await expect(
      ctx.fs.writeFile("actions/a.md", "v2", { parent_sha: v1Sha }),
    ).resolves.toMatchObject({ new_sha256: sha256("v2") });
  });

  it("CAS — rejects with `conflict` when parent_sha doesn't match", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    await ctx.fs.writeFile("actions/a.md", "v1");
    await expect(
      ctx.fs.writeFile("actions/a.md", "v2", {
        parent_sha: "deadbeef".repeat(8),
      }),
    ).rejects.toBeInstanceOf(ViewToolFsError);
    const file = await readFile(join(root, "actions/a.md"), "utf8");
    expect(file).toBe("v1"); // unchanged
  });

  it("CAS — parent_sha=null requires file to be absent (create-only)", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    await ctx.fs.writeFile("actions/new.md", "v1", { parent_sha: null });
    await expect(
      ctx.fs.writeFile("actions/new.md", "v2", { parent_sha: null }),
    ).rejects.toBeInstanceOf(ViewToolFsError);
  });
});

describe("createLocalFsContext.fs.update", () => {
  it("reads the current body, applies the patch, and writes the result", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    await ctx.fs.writeFile("actions/u.md", "---\nstatus: open\n---\nbody\n");

    let seen: string | null = "<unset>";
    await ctx.fs.update("actions/u.md", (current) => {
      seen = current;
      return "---\nstatus: done\n---\nbody\n";
    });

    expect(seen).toBe("---\nstatus: open\n---\nbody\n");
    const body = await readFile(join(root, "actions/u.md"), "utf8");
    expect(body).toBe("---\nstatus: done\n---\nbody\n");
  });

  it("calls the patch with `null` when the file does not exist", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    let observed: string | null = "<unset>";
    await ctx.fs.update("actions/missing.md", (current) => {
      observed = current;
      return "freshly created\n";
    });
    expect(observed).toBe(null);
    const body = await readFile(join(root, "actions/missing.md"), "utf8");
    expect(body).toBe("freshly created\n");
  });

  it("retries on CAS conflict and converges (simulated by external mutation between read and write)", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    const filePath = join(root, "actions/race.md");
    await ctx.fs.writeFile("actions/race.md", "v1");

    let calls = 0;
    await ctx.fs.update("actions/race.md", async (current) => {
      calls++;
      // First call: race a concurrent write in BEFORE we return. The
      // local-fs CAS guard rejects on shaped mismatch, and update()
      // retries.
      if (calls === 1) {
        await fsp.writeFile(filePath, "v2-by-other-writer", { mode: 0o644 });
      }
      return (current ?? "") + "+patch";
    });
    expect(calls).toBeGreaterThan(1); // retried at least once
    const final = await readFile(filePath, "utf8");
    expect(final).toBe("v2-by-other-writer+patch");
  });
});

describe("createLocalFsContext.fs.deleteFile", () => {
  it("removes an existing file", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    await ctx.fs.writeFile("actions/del.md", "bye");
    await ctx.fs.deleteFile("actions/del.md");
    await expect(
      readFile(join(root, "actions/del.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is idempotent on an already-missing path", async () => {
    const ctx = createLocalFsContext({ root, scope: SCOPE });
    await expect(
      ctx.fs.deleteFile("actions/never-existed.md"),
    ).resolves.toMatchObject({ container_id: "local-fs" });
  });
});
