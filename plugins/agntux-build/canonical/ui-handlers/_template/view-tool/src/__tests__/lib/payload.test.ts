// =============================================================================
// payload.test.ts — accessor regression guard. These four helpers are the
// fix for two shipped incidents (see src/lib/payload.ts). The numeric-id and
// non-openable-href cases below are the EXACT real payloads that produced a
// dead button / dead link in production — keep them.
// =============================================================================

import { describe, expect, it } from "vitest";
import { str, idStr, strArr, isOpenableUrl } from "../../lib/payload.js";

describe("str", () => {
  it("passes strings through and collapses non-strings to ''", () => {
    expect(str("hello")).toBe("hello");
    expect(str("")).toBe("");
    expect(str(42)).toBe("");
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
    expect(str({ a: 1 })).toBe("");
  });
});

describe("idStr", () => {
  it("passes string ids through", () => {
    expect(idStr("r-42")).toBe("r-42");
    expect(idStr("789")).toBe("789");
  });

  it("coerces a numeric id to its string form (the posthog dead-button case)", () => {
    // YAML `issue_id: 789` / `experiment_id: 55` parse as JS numbers.
    expect(idStr(789)).toBe("789");
    expect(idStr(55)).toBe("55");
    expect(idStr(0)).toBe("0");
  });

  it("collapses non-finite numbers and non-scalars to ''", () => {
    expect(idStr(NaN)).toBe("");
    expect(idStr(Infinity)).toBe("");
    expect(idStr(null)).toBe("");
    expect(idStr(undefined)).toBe("");
    expect(idStr({})).toBe("");
    expect(idStr(["789"])).toBe("");
  });
});

describe("strArr", () => {
  it("wraps a single string, drops empties, coerces numeric entries", () => {
    expect(strArr("a")).toEqual(["a"]);
    expect(strArr("")).toEqual([]);
    expect(strArr(["a", "b"])).toEqual(["a", "b"]);
    expect(strArr(["a", "", "b"])).toEqual(["a", "b"]);
    expect(strArr([1, 2, "c"])).toEqual(["1", "2", "c"]);
    expect(strArr(undefined)).toEqual([]);
    expect(strArr({})).toEqual([]);
  });
});

describe("isOpenableUrl", () => {
  it("accepts http(s) and mailto", () => {
    expect(isOpenableUrl("https://app.posthog.com/x")).toBe(true);
    expect(isOpenableUrl("http://example.com")).toBe(true);
    expect(isOpenableUrl("HTTPS://EXAMPLE.COM")).toBe(true);
    expect(isOpenableUrl("mailto:a@b.com")).toBe(true);
    expect(isOpenableUrl("  https://x.com  ")).toBe(true);
  });

  it("rejects fs paths, relative paths, empties, non-strings (the dead-links case)", () => {
    expect(isOpenableUrl("data/entities/person/alice.md")).toBe(false);
    expect(isOpenableUrl("/Users/x/file.md")).toBe(false);
    expect(isOpenableUrl("./relative")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("")).toBe(false);
    expect(isOpenableUrl(null)).toBe(false);
    expect(isOpenableUrl(undefined)).toBe(false);
    expect(isOpenableUrl(42)).toBe(false);
  });

  it("rejects degenerate schemes with no authority / recipient", () => {
    expect(isOpenableUrl("https:foo")).toBe(false); // no //
    expect(isOpenableUrl("http://")).toBe(false); // no host
    expect(isOpenableUrl("mailto:")).toBe(false); // no recipient
    expect(isOpenableUrl("mailto:notanemail")).toBe(false); // no @
  });
});
