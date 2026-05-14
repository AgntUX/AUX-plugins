import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectedAgntuxRoot, resolveAgntuxRoot } from "../src/agntux-root.js";

const ORIGINAL = process.env.AGNTUX_ROOT_OVERRIDE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AGNTUX_ROOT_OVERRIDE;
  else process.env.AGNTUX_ROOT_OVERRIDE = ORIGINAL;
});

beforeEach(() => {
  delete process.env.AGNTUX_ROOT_OVERRIDE;
});

describe("resolveAgntuxRoot", () => {
  it("honors AGNTUX_ROOT_OVERRIDE when set", () => {
    process.env.AGNTUX_ROOT_OVERRIDE = "/synthetic/path";
    expect(resolveAgntuxRoot()).toBe("/synthetic/path");
  });

  it("walks up from a nested cwd to find an ancestor `agntux` directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "agntux-root-test-"));
    const root = join(parent, "agntux");
    const nested = join(root, "data", "schema");
    await mkdir(nested, { recursive: true });
    expect(resolveAgntuxRoot(nested)).toBe(root);
  });

  it("is case-insensitive on the basename", async () => {
    const parent = await mkdtemp(join(tmpdir(), "agntux-root-test-"));
    const root = join(parent, "Agntux");
    const nested = join(root, "data");
    await mkdir(nested, { recursive: true });
    expect(resolveAgntuxRoot(nested)).toBe(root);
  });

  it("falls back to <home>/agntux when no walk-up match exists", () => {
    // Use a cwd guaranteed to have no `agntux` ancestor.
    const out = resolveAgntuxRoot("/");
    // Either null (no <home>/agntux) or the home fallback — both valid.
    if (out !== null) {
      expect(out).toBe(join(homedir(), "agntux"));
    }
  });
});

describe("expectedAgntuxRoot", () => {
  it("never returns null — falls back to <home>/agntux", () => {
    const out = expectedAgntuxRoot("/");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("honors AGNTUX_ROOT_OVERRIDE", () => {
    process.env.AGNTUX_ROOT_OVERRIDE = "/synthetic/expected";
    expect(expectedAgntuxRoot()).toBe("/synthetic/expected");
  });
});
