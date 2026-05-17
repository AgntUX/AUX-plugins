// PASSING FIXTURE — third-party mcp__ reference appears inside a *multi-line*
// `description:` string. The `description:` key sits on one line and the
// opening quote sits on the next; the linter must still treat the body as a
// documentation string and skip the reference.
//
// Regression for the bug where sync-installed-plugins.ts started failing CI
// because the per-line description regex didn't span newlines.

export const someTool = {
  description:
    "Persist installed plugins. Called by the host after it enumerates plugins via `mcp__plugins__list_plugins`. Replaces the array atomically.",
  async handler(_args: Record<string, unknown>) {
    return { ok: true };
  },
};
