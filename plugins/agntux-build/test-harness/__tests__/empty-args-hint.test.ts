import { describe, it, expect } from "vitest";

// Pure predicate lifted out of host-bridge-entry.mjs (browser code,
// untestable directly) so the most subtle gating logic in the args-source
// chain has unit coverage.
//
// The path crosses package boundaries because host-renderer/ doesn't have
// its own vitest setup; the test-harness already imports across the
// boundary for probe-chromium, so this matches the existing pattern.
import {
  shouldShowEmptyArgsHint,
  EMPTY_ARGS_HINT_TEXT,
} from "../../host-renderer/src/empty-args-hint.mjs";

describe("shouldShowEmptyArgsHint", () => {
  it("fires when no args source was applied AND view tool returned not_found", () => {
    expect(
      shouldShowEmptyArgsHint({ argsExplicit: false, errorKind: "not_found" }),
    ).toBe(true);
  });

  it("does NOT fire when an explicit args source was applied (even if args resolve to {})", () => {
    // The HIGH-severity bug we fixed: a fixture whose args is {} on
    // purpose (empty-state regression test) was tripping the hint and
    // dressing up a deliberate test as a misconfiguration.
    expect(
      shouldShowEmptyArgsHint({ argsExplicit: true, errorKind: "not_found" }),
    ).toBe(false);
  });

  it("does NOT fire when error kind is anything other than not_found", () => {
    // The hint is specifically about missing required ID args. auth_failed,
    // network errors, validation_error etc. have different remediation paths
    // and shouldn't be conflated.
    for (const kind of [
      "auth_failed",
      "network",
      "validation_error",
      "rate_limit",
      "",
    ]) {
      expect(
        shouldShowEmptyArgsHint({ argsExplicit: false, errorKind: kind }),
      ).toBe(false);
    }
  });

  it("does NOT fire when there is no error at all", () => {
    expect(
      shouldShowEmptyArgsHint({ argsExplicit: false, errorKind: null }),
    ).toBe(false);
    expect(
      shouldShowEmptyArgsHint({ argsExplicit: false, errorKind: undefined }),
    ).toBe(false);
  });

  it("hint text mentions fixtures.json so the operator knows what to do", () => {
    expect(EMPTY_ARGS_HINT_TEXT).toMatch(/fixtures\.json/);
    expect(EMPTY_ARGS_HINT_TEXT).toMatch(/handler/);
  });
});
