/**
 * retrieval-dispatch.test.mjs
 *
 * Subagent-level tests for the retrieval subagent dispatch (P4 §10).
 * Strategy: assert that agents/retrieval.md contains the required
 * pattern keywords for all 5 query patterns (A-E).
 *
 * Limitation: these are keyword/structural tests against the prompt file.
 * Full LLM dispatch simulation is not feasible at MVP without a running host.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RETRIEVAL_MD = join(PLUGIN_ROOT, "agents", "retrieval.md");

describe("retrieval agent file exists", () => {
  it("agents/retrieval.md exists", () => {
    expect(existsSync(RETRIEVAL_MD)).toBe(true);
  });
});

describe("retrieval dispatch — 5 query patterns", () => {
  let src;
  it("loads agents/retrieval.md", () => {
    src = readFileSync(RETRIEVAL_MD, "utf8");
    expect(src.length).toBeGreaterThan(100);
  });

  it("Pattern A: catch-all triage triggers present", () => {
    const s = readFileSync(RETRIEVAL_MD, "utf8");
    expect(s).toMatch(/Pattern A/);
    expect(s).toMatch(/what.*hot|triage|what.*look/i);
  });

  it("Pattern B: entity query triggers present", () => {
    const s = readFileSync(RETRIEVAL_MD, "utf8");
    expect(s).toMatch(/Pattern B/);
    expect(s).toMatch(/entity|what.*know.*about|tell.*about/i);
  });

  it("Pattern C: time query triggers present", () => {
    const s = readFileSync(RETRIEVAL_MD, "utf8");
    expect(s).toMatch(/Pattern C/);
    expect(s).toMatch(/time.*query|what.*happened|this week|today/i);
  });

  it("Pattern D: topic query triggers present", () => {
    const s = readFileSync(RETRIEVAL_MD, "utf8");
    expect(s).toMatch(/Pattern D/);
    expect(s).toMatch(/topic.*query|what.*said.*about|latest on/i);
  });

  it("Pattern E: task/prep query triggers present", () => {
    const s = readFileSync(RETRIEVAL_MD, "utf8");
    expect(s).toMatch(/Pattern E/);
    expect(s).toMatch(/prep|meeting|task/i);
  });
});

describe("retrieval agent frontmatter", () => {
  it("has name: retrieval", () => {
    const s = readFileSync(RETRIEVAL_MD, "utf8");
    expect(s).toMatch(/^name: retrieval/m);
  });

  it("has description field", () => {
    const s = readFileSync(RETRIEVAL_MD, "utf8");
    expect(s).toMatch(/^description:/m);
  });

  it("has tools field listing Read, Glob, Grep", () => {
    const s = readFileSync(RETRIEVAL_MD, "utf8");
    expect(s).toMatch(/^tools:.*Read.*Glob.*Grep/m);
  });
});
