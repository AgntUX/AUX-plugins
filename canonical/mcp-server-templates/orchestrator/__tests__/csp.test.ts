import { describe, it, expect } from "vitest";
import { buildCSP } from "../src/csp.js";

describe("buildCSP", () => {
  it("returns a string", () => {
    expect(typeof buildCSP()).toBe("string");
  });

  it("includes required directives", () => {
    const csp = buildCSP();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("is semicolon-delimited", () => {
    const csp = buildCSP();
    const directives = csp.split("; ");
    expect(directives.length).toBeGreaterThan(4);
  });

  it("is deterministic (same output on repeated calls)", () => {
    expect(buildCSP()).toBe(buildCSP());
  });
});
