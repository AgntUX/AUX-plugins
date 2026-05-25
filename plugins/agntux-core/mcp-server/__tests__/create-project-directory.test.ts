/**
 * create-project-directory.test.ts
 *
 * Unit tests for the `agntux_core_create_project_directory` MCP tool. The
 * tool creates the AgntUX project root at `~/agntux` (no-op if present) and
 * returns its absolute path, so Cowork onboarding can make the folder
 * without a terminal command before calling `request_cowork_directory`.
 *
 * We redirect home via `AGNTUX_HOME_OVERRIDE` (the same test seam
 * sync-installed-plugins uses) so the tool writes into a tmpdir instead of
 * the developer's real `~/agntux`.
 *
 * Coverage:
 *   - absent → creates `<home>/agntux`, returns absolute path, created:true
 *   - already a directory → created:false, idempotent, no throw
 *   - exists as a file → error envelope, file left untouched
 *   - creates intermediate dirs when the home root doesn't exist yet
 *   - returned path is absolute and ends in `/agntux`
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { createProjectDirectoryTool } from "../src/tools/create-project-directory.js";

let tempHome: string;
const ORIGINAL_OVERRIDE = process.env.AGNTUX_HOME_OVERRIDE;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "agntux-create-project-dir-"));
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

interface Result {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent: { ok: boolean; path: string; created: boolean; error?: string };
}

describe("agntux_core_create_project_directory — creation", () => {
  it("creates ~/agntux when absent and reports created:true", async () => {
    const target = join(tempHome, "agntux");
    expect(existsSync(target)).toBe(false);

    const res = (await createProjectDirectoryTool.handler({})) as Result;

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.ok).toBe(true);
    expect(res.structuredContent.created).toBe(true);
    expect(res.structuredContent.path).toBe(target);
    expect(existsSync(target)).toBe(true);
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it("returns an absolute path ending in the platform-joined agntux segment", async () => {
    const res = (await createProjectDirectoryTool.handler({})) as Result;
    expect(isAbsolute(res.structuredContent.path)).toBe(true);
    expect(res.structuredContent.path).toBe(join(tempHome, "agntux"));
    expect(res.structuredContent.path.endsWith(`${sep}agntux`)).toBe(true);
  });

  it("creates intermediate dirs when the home root does not exist yet", async () => {
    const nestedHome = join(tempHome, "nested", "home");
    process.env.AGNTUX_HOME_OVERRIDE = nestedHome;
    expect(existsSync(nestedHome)).toBe(false);

    const res = (await createProjectDirectoryTool.handler({})) as Result;

    expect(res.structuredContent.created).toBe(true);
    expect(existsSync(join(nestedHome, "agntux"))).toBe(true);
  });
});

describe("agntux_core_create_project_directory — idempotence", () => {
  it("is a no-op when ~/agntux already exists (created:false, no throw)", async () => {
    const target = join(tempHome, "agntux");
    mkdirSync(target, { recursive: true });
    // Drop a sentinel file to prove the directory is not recreated/cleared.
    const sentinel = join(target, "keep.txt");
    writeFileSync(sentinel, "preserve me");

    const res = (await createProjectDirectoryTool.handler({})) as Result;

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.ok).toBe(true);
    expect(res.structuredContent.created).toBe(false);
    expect(res.structuredContent.path).toBe(target);
    expect(existsSync(sentinel)).toBe(true);
    expect(readFileSync(sentinel, "utf8")).toBe("preserve me");
  });

  it("two calls in a row both succeed; second reports created:false", async () => {
    const first = (await createProjectDirectoryTool.handler({})) as Result;
    const second = (await createProjectDirectoryTool.handler({})) as Result;
    expect(first.structuredContent.created).toBe(true);
    expect(second.structuredContent.created).toBe(false);
    expect(second.structuredContent.path).toBe(first.structuredContent.path);
  });
});

describe("agntux_core_create_project_directory — conflict", () => {
  it("returns an error envelope when ~/agntux exists as a file, leaving it untouched", async () => {
    const target = join(tempHome, "agntux");
    writeFileSync(target, "i am a file, not a dir");

    const res = (await createProjectDirectoryTool.handler({})) as Result;

    expect(res.isError).toBe(true);
    expect(res.structuredContent.ok).toBe(false);
    expect(res.structuredContent.created).toBe(false);
    expect(res.structuredContent.error).toBe("path-is-file");
    expect(res.content[0].text).toContain(target);
    // The file is left exactly as it was.
    expect(statSync(target).isFile()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("i am a file, not a dir");
  });

  it("returns a structured mkdir-failed envelope (not a throw) when the parent is not a directory", async () => {
    // Point home at a path that is itself a file, so `<home>/agntux` cannot
    // be created. mkdir throws ENOTDIR/EEXIST; the tool must translate it.
    const blocker = join(tempHome, "blocker");
    writeFileSync(blocker, "not a directory");
    process.env.AGNTUX_HOME_OVERRIDE = blocker;

    const res = (await createProjectDirectoryTool.handler({})) as Result;

    expect(res.isError).toBe(true);
    expect(res.structuredContent.ok).toBe(false);
    expect(res.structuredContent.created).toBe(false);
    expect(["mkdir-failed", "stat-failed"]).toContain(res.structuredContent.error);
  });
});

describe("agntux_core_create_project_directory — symlinks", () => {
  it("treats a symlink to an existing directory as the project root (no-op, created:false)", async () => {
    // Legitimate setup: ~/agntux symlinked to a cloud-synced folder.
    const realDir = join(tempHome, "real-agntux");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "keep.txt"), "preserve me");
    symlinkSync(realDir, join(tempHome, "agntux"));

    const res = (await createProjectDirectoryTool.handler({})) as Result;

    expect(res.isError).toBeUndefined();
    expect(res.structuredContent.ok).toBe(true);
    expect(res.structuredContent.created).toBe(false);
    // The symlink target is untouched.
    expect(readFileSync(join(realDir, "keep.txt"), "utf8")).toBe("preserve me");
  });

  it("rejects a symlink that points at a file (path-is-file error)", async () => {
    const realFile = join(tempHome, "real-file");
    writeFileSync(realFile, "i am a file");
    symlinkSync(realFile, join(tempHome, "agntux"));

    const res = (await createProjectDirectoryTool.handler({})) as Result;

    expect(res.isError).toBe(true);
    expect(res.structuredContent.error).toBe("path-is-file");
  });

  it("returns a structured envelope (not a throw) for a dangling symlink", async () => {
    // statSync on a dangling symlink throws ENOENT → classified "missing" →
    // mkdir then throws EEXIST. The tool must surface mkdir-failed, not throw.
    symlinkSync(join(tempHome, "nonexistent-target"), join(tempHome, "agntux"));

    const res = (await createProjectDirectoryTool.handler({})) as Result;

    expect(res.isError).toBe(true);
    expect(res.structuredContent.ok).toBe(false);
    expect(res.structuredContent.error).toBe("mkdir-failed");
    // The symlink itself is left in place (not replaced by a real dir).
    expect(lstatSync(join(tempHome, "agntux")).isSymbolicLink()).toBe(true);
  });
});
