// Pure predicate for the empty-args self-doc hint. Lifted out of
// host-bridge-entry.mjs (browser code, depends on `window`) so it can
// be unit-tested without a Playwright spin-up.
//
// The hint should fire only when the harness was invoked with NO args
// source applied (no --args, no --fixture, no auto-discovered
// fixtures.json) AND the view tool returned a not_found / required-id
// validation failure. Gating on `!argsExplicit` rather than "args is
// empty" prevents the hint from mis-firing when an applied fixture
// resolves to {} on purpose (e.g. an empty-state regression test).

/**
 * @param {object} input
 * @param {boolean} input.argsExplicit  true iff a fixture / --args was applied upstream
 * @param {string|null|undefined} input.errorKind  view tool's structuredContent.error
 * @returns {boolean}
 */
export function shouldShowEmptyArgsHint({ argsExplicit, errorKind }) {
  if (argsExplicit) return false;
  return errorKind === "not_found";
}

export const EMPTY_ARGS_HINT_TEXT =
  "Harness ran with no args source applied; add a fixtures.json next to this handler so the harness has a known-passing args object to render against.";
