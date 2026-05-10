import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handlerFromToolName,
  resolveFixturePath,
  discoverDefaultFixture,
  resolveHarnessArgs,
  loadFixtureFile,
} from "../src/load-fixture.mjs";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "load-fixture-test-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeFixture(path: string, body: unknown) {
  writeFileSync(path, JSON.stringify(body));
}

describe("handlerFromToolName", () => {
  it("strips _view suffix", () => {
    expect(handlerFromToolName("compose_view")).toBe("compose");
    expect(handlerFromToolName("triage_view")).toBe("triage");
  });
  it("strips -view suffix", () => {
    expect(handlerFromToolName("triage-view")).toBe("triage");
  });
  it("returns the bare name when no view suffix", () => {
    expect(handlerFromToolName("compose")).toBe("compose");
  });
  it("handles null/empty gracefully", () => {
    expect(handlerFromToolName(null as unknown as string)).toBeNull();
    expect(handlerFromToolName("")).toBeNull();
  });
});

describe("loadFixtureFile", () => {
  it("returns args from a well-formed fixture", () => {
    const path = join(workdir, "fix.json");
    writeFixture(path, { args: { issue_key: "X-1" } });
    expect(loadFixtureFile(path)).toEqual({
      args: { issue_key: "X-1" },
      source: path,
    });
  });

  it("throws when the file is missing", () => {
    expect(() => loadFixtureFile(join(workdir, "missing.json"))).toThrow(
      /fixture file not found/,
    );
  });

  it("throws when the JSON is malformed", () => {
    const path = join(workdir, "bad.json");
    writeFileSync(path, "{not json");
    expect(() => loadFixtureFile(path)).toThrow(/not valid JSON/);
  });

  it("throws when args is missing", () => {
    const path = join(workdir, "noargs.json");
    writeFixture(path, { _doc: "no args here" });
    expect(() => loadFixtureFile(path)).toThrow(/must have an "args" object/);
  });
});

describe("discoverDefaultFixture", () => {
  it("finds <plugin>/ui-handlers/<handler>/fixtures.json from a _view tool", () => {
    const handlerDir = join(workdir, "ui-handlers", "compose");
    mkdirSync(handlerDir, { recursive: true });
    const fix = join(handlerDir, "fixtures.json");
    writeFixture(fix, { args: {} });
    expect(
      discoverDefaultFixture({ pluginRoot: workdir, toolName: "compose_view" }),
    ).toBe(fix);
  });

  it("returns null when nothing is there", () => {
    expect(
      discoverDefaultFixture({ pluginRoot: workdir, toolName: "compose_view" }),
    ).toBeNull();
  });

  it("returns null with no inputs", () => {
    expect(discoverDefaultFixture({ pluginRoot: null, toolName: null })).toBeNull();
  });
});

describe("resolveFixturePath", () => {
  it("resolves a bare fixture name under the handler's fixtures dir", () => {
    const handler = join(workdir, "ui-handlers", "compose", "fixtures");
    mkdirSync(handler, { recursive: true });
    const stamped = join(handler, "compose-empty.json");
    writeFixture(stamped, { args: {} });
    expect(
      resolveFixturePath({
        pluginRoot: workdir,
        toolName: "compose_view",
        fixtureArg: "empty",
      }),
    ).toBe(stamped);
  });

  it("falls through to a plain <name>.json under the same dir", () => {
    const handler = join(workdir, "ui-handlers", "compose", "fixtures");
    mkdirSync(handler, { recursive: true });
    const plain = join(handler, "empty.json");
    writeFixture(plain, { args: {} });
    expect(
      resolveFixturePath({
        pluginRoot: workdir,
        toolName: "compose_view",
        fixtureArg: "empty",
      }),
    ).toBe(plain);
  });

  it("treats a relative path with a slash as cwd-relative", () => {
    const path = resolveFixturePath({
      pluginRoot: workdir,
      toolName: "compose_view",
      fixtureArg: "fixtures/foo.json",
    });
    expect(path).toMatch(/fixtures\/foo\.json$/);
  });

  it("throws when a bare name has no plugin root to anchor against", () => {
    expect(() =>
      resolveFixturePath({
        pluginRoot: null,
        toolName: "compose_view",
        fixtureArg: "empty",
      }),
    ).toThrow(/bare name.*pluginRoot is missing/);
  });

  it("throws when a bare name has no handler-shaped tool name", () => {
    expect(() =>
      resolveFixturePath({
        pluginRoot: workdir,
        toolName: null,
        fixtureArg: "empty",
      }),
    ).toThrow(/bare name.*toolName is missing/);
  });

  it("throws when a bare name doesn't resolve to a file", () => {
    expect(() =>
      resolveFixturePath({
        pluginRoot: workdir,
        toolName: "compose_view",
        fixtureArg: "ghost",
      }),
    ).toThrow(/not found under.*ghost/);
  });
});

describe("resolveHarnessArgs precedence", () => {
  it("uses --args JSON when supplied", () => {
    const out = resolveHarnessArgs({
      pluginRoot: workdir,
      toolName: "compose_view",
      argsJson: '{"issue_key":"A-1"}',
    });
    expect(out).toEqual({ args: { issue_key: "A-1" }, source: "--args" });
  });

  it("uses --fixture when --args is absent", () => {
    const handler = join(workdir, "ui-handlers", "compose", "fixtures");
    mkdirSync(handler, { recursive: true });
    const fix = join(handler, "compose-single.json");
    writeFixture(fix, { args: { issue_key: "B-2" } });
    const out = resolveHarnessArgs({
      pluginRoot: workdir,
      toolName: "compose_view",
      fixtureArg: "single",
    });
    expect(out).toEqual({ args: { issue_key: "B-2" }, source: fix });
  });

  it("auto-discovers fixtures.json next to the handler when both are absent", () => {
    const handlerDir = join(workdir, "ui-handlers", "compose");
    mkdirSync(handlerDir, { recursive: true });
    const fix = join(handlerDir, "fixtures.json");
    writeFixture(fix, { args: { issue_key: "C-3" } });
    const out = resolveHarnessArgs({
      pluginRoot: workdir,
      toolName: "compose_view",
    });
    expect(out).toEqual({ args: { issue_key: "C-3" }, source: fix });
  });

  it("returns null when nothing is available (caller defaults to {})", () => {
    expect(
      resolveHarnessArgs({
        pluginRoot: workdir,
        toolName: "compose_view",
      }),
    ).toBeNull();
  });

  it("rejects malformed --args JSON with a clear error", () => {
    expect(() =>
      resolveHarnessArgs({
        pluginRoot: workdir,
        toolName: "compose_view",
        argsJson: "{not json",
      }),
    ).toThrow(/--args is not valid JSON/);
  });

  it("falls back to {} with a warning when an auto-discovered fixture is malformed", () => {
    // Auto-discovery hits a broken fixtures.json — the contributor never
    // asked for it, so this must not crash the harness.
    const handlerDir = join(workdir, "ui-handlers", "compose");
    mkdirSync(handlerDir, { recursive: true });
    writeFileSync(join(handlerDir, "fixtures.json"), "{not json");
    const out = resolveHarnessArgs({
      pluginRoot: workdir,
      toolName: "compose_view",
    });
    expect(out).not.toBeNull();
    expect(out!.args).toEqual({});
    expect(out!.source).toMatch(/auto fixture invalid/);
    expect(out!.warning).toMatch(/not valid JSON/);
  });

  it("falls back when an auto-discovered fixture has no args field", () => {
    const handlerDir = join(workdir, "ui-handlers", "compose");
    mkdirSync(handlerDir, { recursive: true });
    writeFixture(join(handlerDir, "fixtures.json"), { _doc: "no args" });
    const out = resolveHarnessArgs({
      pluginRoot: workdir,
      toolName: "compose_view",
    });
    expect(out!.args).toEqual({});
    expect(out!.warning).toMatch(/must have an "args" object/);
  });

  it("hard-fails when an EXPLICIT --fixture is malformed (no silent fallback)", () => {
    // The user asked for this file specifically; substituting silently
    // would mask the bug.
    const handlerDir = join(workdir, "ui-handlers", "compose", "fixtures");
    mkdirSync(handlerDir, { recursive: true });
    writeFileSync(join(handlerDir, "compose-bad.json"), "{not json");
    expect(() =>
      resolveHarnessArgs({
        pluginRoot: workdir,
        toolName: "compose_view",
        fixtureArg: "bad",
      }),
    ).toThrow(/not valid JSON/);
  });
});
