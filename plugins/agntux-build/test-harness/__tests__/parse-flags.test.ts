import { describe, it, expect } from "vitest";
import { parseFlags, required, parseIntFlag } from "../src/parse-flags.mjs";

describe("parseFlags", () => {
  it("parses simple key/value pairs", () => {
    const out = parseFlags(["--plugin", "/path/to/plugin", "--tool", "view"]);
    expect(out).toEqual({ plugin: "/path/to/plugin", tool: "view" });
  });

  it("camelCases multi-word flags", () => {
    const out = parseFlags(["--host-bin", "/x"]);
    expect(out).toEqual({ hostBin: "/x" });
  });

  it("treats --help as boolean", () => {
    const out = parseFlags(["--help"]);
    expect(out).toEqual({ help: true });
  });

  it("rejects positional args", () => {
    expect(() => parseFlags(["positional"])).toThrow(/positional/);
  });

  it("rejects missing values", () => {
    expect(() => parseFlags(["--tool"])).toThrow(/missing value for --tool/);
  });

  it("rejects empty values", () => {
    expect(() => parseFlags(["--tool", ""])).toThrow(/empty value for --tool/);
  });
});

describe("required", () => {
  it("returns a present flag", () => {
    expect(required({ plugin: "/x" }, "plugin")).toBe("/x");
  });

  it("translates camelCase keys", () => {
    expect(required({ hostBin: "/x" }, "host-bin")).toBe("/x");
  });

  it("throws on missing", () => {
    expect(() => required({}, "plugin")).toThrow(/missing required flag: --plugin/);
  });

  it("throws on empty string", () => {
    expect(() => required({ plugin: "" }, "plugin")).toThrow(/missing required flag/);
  });
});

describe("parseIntFlag", () => {
  it("parses ints", () => {
    expect(parseIntFlag("60000", "timeout", 0)).toBe(60_000);
  });

  it("falls back when undefined", () => {
    expect(parseIntFlag(undefined, "timeout", 60_000)).toBe(60_000);
  });

  it("throws on non-integer", () => {
    expect(() => parseIntFlag("ten", "timeout", 0)).toThrow(/must be an integer/);
  });
});
