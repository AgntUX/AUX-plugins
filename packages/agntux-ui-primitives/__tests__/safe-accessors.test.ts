import { describe, expect, it } from "vitest";
import {
  daysSince,
  formatTime,
  safeArray,
  safeBoolean,
  safeDate,
  safeEnum,
  safeNumber,
  safeObject,
  safeString,
} from "../src/safe-accessors.js";

describe("safeArray", () => {
  it("returns the array unchanged", () => {
    expect(safeArray<number>([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("returns [] for non-array values", () => {
    expect(safeArray(undefined)).toEqual([]);
    expect(safeArray(null)).toEqual([]);
    expect(safeArray("hello")).toEqual([]);
    expect(safeArray({ length: 3 })).toEqual([]);
  });
});

describe("safeString", () => {
  it("returns the string unchanged", () => {
    expect(safeString("hi")).toBe("hi");
  });
  it("returns the fallback for non-strings", () => {
    expect(safeString(undefined)).toBe("");
    expect(safeString(123)).toBe("");
    expect(safeString(null, "fallback")).toBe("fallback");
  });
});

describe("safeNumber", () => {
  it("returns finite numbers unchanged", () => {
    expect(safeNumber(42)).toBe(42);
    expect(safeNumber(-1.5)).toBe(-1.5);
  });
  it("returns the fallback for non-finite or non-numbers", () => {
    expect(safeNumber(NaN)).toBe(0);
    expect(safeNumber(Infinity)).toBe(0);
    expect(safeNumber("3")).toBe(0);
    expect(safeNumber(undefined, 7)).toBe(7);
  });
});

describe("safeBoolean", () => {
  it("returns booleans unchanged", () => {
    expect(safeBoolean(true)).toBe(true);
    expect(safeBoolean(false)).toBe(false);
  });
  it("returns the fallback for non-booleans", () => {
    expect(safeBoolean(undefined)).toBe(false);
    expect(safeBoolean("true")).toBe(false);
    expect(safeBoolean(0, true)).toBe(true);
  });
});

describe("safeObject", () => {
  it("returns plain objects unchanged", () => {
    expect(safeObject({ a: 1 })).toEqual({ a: 1 });
  });
  it("returns {} for arrays, null, primitives", () => {
    expect(safeObject([1, 2])).toEqual({});
    expect(safeObject(null)).toEqual({});
    expect(safeObject("x")).toEqual({});
  });
});

describe("safeEnum", () => {
  const allowed = ["a", "b", "c"] as const;
  it("returns allowed values unchanged", () => {
    expect(safeEnum("a", allowed, "a")).toBe("a");
  });
  it("returns the fallback for disallowed values", () => {
    expect(safeEnum("z", allowed, "b")).toBe("b");
    expect(safeEnum(undefined, allowed, "c")).toBe("c");
  });
});

describe("safeDate", () => {
  it("returns Date instances unchanged when valid", () => {
    const d = new Date("2025-01-01T00:00:00Z");
    expect(safeDate(d)).toEqual(d);
  });
  it("parses ISO strings", () => {
    const d = safeDate("2025-01-01T00:00:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });
  it("parses epoch numbers", () => {
    expect(safeDate(0)).toEqual(new Date(0));
  });
  it("returns undefined for garbage", () => {
    expect(safeDate("not a date")).toBeUndefined();
    expect(safeDate(null)).toBeUndefined();
    expect(safeDate(NaN)).toBeUndefined();
  });
});

describe("formatTime", () => {
  it("returns — for invalid input", () => {
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("garbage")).toBe("—");
  });
  it("formats valid dates", () => {
    const out = formatTime("2025-01-01T15:30:00Z", "en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    });
    expect(out).toMatch(/3:30/);
  });
});

describe("daysSince", () => {
  it("returns — for invalid dates", () => {
    expect(daysSince(undefined)).toBe("—");
    expect(daysSince("garbage")).toBe("—");
  });
  it("returns whole-day counts for past dates", () => {
    const now = new Date("2025-01-10T00:00:00Z");
    expect(daysSince("2025-01-01T00:00:00Z", now)).toBe(9);
  });
  it("clamps future dates to 0", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    expect(daysSince("2025-12-01T00:00:00Z", now)).toBe(0);
  });
});
