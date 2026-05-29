import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pass9ZipUploadSafe, type Finding } from "../lint-zip-upload-safe.js";

// pass 9 enforces Claude Desktop's zip-upload rules. These tests focus on E29
// (path more than 10 folders deep), the rule agntux-build 0.15.0 tripped.
describe("pass9ZipUploadSafe — E29 path depth", () => {
  let root: string;
  let pluginDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zip-safe-"));
    pluginDir = join(root, "plugins", "agntux-x");
    mkdirSync(pluginDir, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writeAtDepth(folders: number): string {
    // folders directories deep, then a file → folder-depth === `folders`.
    const dir = join(pluginDir, ...Array.from({ length: folders }, (_, i) => `d${i}`));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "f.ts");
    writeFileSync(file, "export const x = 1;\n");
    return file;
  }

  it("flags a file more than 10 folders deep (E29 error)", () => {
    writeAtDepth(11);
    const findings: Finding[] = [];
    pass9ZipUploadSafe("agntux-x", pluginDir, root, findings);
    const e29 = findings.filter((f) => f.code === "E29");
    expect(e29).toHaveLength(1);
    expect(e29[0].severity).toBe("error");
    expect(e29[0].message).toContain("11 folders deep");
  });

  it("allows a file exactly 10 folders deep (the boundary is >10)", () => {
    writeAtDepth(10);
    const findings: Finding[] = [];
    pass9ZipUploadSafe("agntux-x", pluginDir, root, findings);
    expect(findings.filter((f) => f.code === "E29")).toHaveLength(0);
  });

  it("does NOT flag depth inside node_modules (excluded from the zip + the walk)", () => {
    const deep = join(pluginDir, "host-renderer", "node_modules", ...Array.from({ length: 12 }, (_, i) => `n${i}`));
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "x.js"), "module.exports={}\n");
    const findings: Finding[] = [];
    pass9ZipUploadSafe("agntux-x", pluginDir, root, findings);
    expect(findings.filter((f) => f.code === "E29")).toHaveLength(0);
  });

  it("a shallow, clean tree raises nothing", () => {
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), '{"name":"agntux-x","version":"0.1.0"}');
    writeFileSync(join(pluginDir, "README.md"), "# x\n");
    const findings: Finding[] = [];
    pass9ZipUploadSafe("agntux-x", pluginDir, root, findings);
    expect(findings).toHaveLength(0);
  });
});
