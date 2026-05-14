import { describe, expect, it } from "vitest";
import {
  mergeScope,
  ViewToolFsError,
  type ViewToolContext,
  type ViewToolFs,
  type ViewToolScope,
} from "../src/context.js";

const stubFs: ViewToolFs = {
  async readFile() {
    return Buffer.from("");
  },
  async list() {
    return [];
  },
  async exists() {
    return false;
  },
};

describe("ViewToolFsError", () => {
  it("maps each code to the documented HTTP status", () => {
    expect(new ViewToolFsError("not-found", "x").status).toBe(404);
    expect(new ViewToolFsError("forbidden", "x").status).toBe(403);
    expect(new ViewToolFsError("transient", "x").status).toBe(503);
    expect(new ViewToolFsError("schema", "x").status).toBe(500);
  });

  it("preserves path and a default message", () => {
    const err = new ViewToolFsError("not-found", "teams/foo/x.md");
    expect(err.path).toBe("teams/foo/x.md");
    expect(err.message).toContain("teams/foo/x.md");
    expect(err.name).toBe("ViewToolFsError");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts a custom message", () => {
    const err = new ViewToolFsError("schema", "x", "bad yaml");
    expect(err.message).toBe("bad yaml");
  });
});

describe("mergeScope", () => {
  it("produces a frozen merged scope", () => {
    const base: ViewToolScope = {
      user_id: "u1",
      organization_id: "o1",
    };
    const merged = mergeScope(base, { team_slug: "eng" });
    expect(merged).toEqual({
      user_id: "u1",
      organization_id: "o1",
      team_slug: "eng",
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  it("does not mutate the original scope", () => {
    const base: ViewToolScope = { user_id: "u1", organization_id: "o1" };
    mergeScope(base, { team_slug: "eng" });
    expect(base).toEqual({ user_id: "u1", organization_id: "o1" });
  });
});

describe("ViewToolContext shape", () => {
  it("can be constructed from the stub fs + scope", () => {
    const scope: ViewToolScope = { user_id: "u1", organization_id: "o1" };
    const ctx: ViewToolContext = {
      fs: stubFs,
      scope,
      now: () => new Date(0),
      log: () => {},
      withScope(extra) {
        return { ...ctx, scope: mergeScope(scope, extra) };
      },
    };
    expect(ctx.now().getTime()).toBe(0);
    const child = ctx.withScope({ team_slug: "eng" });
    expect(child.scope.team_slug).toBe("eng");
    expect(ctx.scope.team_slug).toBeUndefined();
  });
});
