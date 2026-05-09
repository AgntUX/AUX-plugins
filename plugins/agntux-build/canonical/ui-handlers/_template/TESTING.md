# Testing `{{ui-name}}` end-to-end

A runbook for re-running the visual + interaction pass on this UI
handler. Mirrors the AUX-plugins `agntux-core/ui-handlers/triage/TESTING.md`
shape so contributors can re-discover nothing.

## Prerequisites (one-time)

1. **MCPJam Inspector** running locally on port 5173 (default):

   ```sh
   ENVIRONMENT=dev AGNTUX_MODE=true \
     npm --prefix /path/to/MCPJam-inspector run dev
   ```

2. **Playwright Chromium** installed once per machine:

   ```sh
   npx playwright install chromium
   ```

3. The plugin's component + MCP server built (Step 1 below).

## Step 1 — Build both layers (mandatory; CI guard catches drift)

```sh
# In component/
npm install
npm run build       # produces out/index.html (gitignored)
npm test            # vitest unit tests

# In mcp-server/ (one directory up + over)
npm install
npm run build       # tsc + scripts/embed-bundle.mjs (re-embeds the bundle)
npm run check:bundle-sync   # CI guard — fails on stale embed
```

Skipping the mcp-server rebuild ships a stale bundle to MCPJam. The
symptom is "my edit isn't visible in the screenshot." Run
`check:bundle-sync` whenever you push.

## Step 2 — Run each fixture against the harness

```sh
# Empty state
plugin-toolkit-test render --plugin . --tool {{view-tool-name}} \
  --fixture fixtures/{{ui-name}}-empty.json --out test-results/empty/

# Single high-priority item
plugin-toolkit-test render --plugin . --tool {{view-tool-name}} \
  --fixture fixtures/{{ui-name}}-single-high.json --out test-results/single/

# Many items (wide scope)
plugin-toolkit-test render --plugin . --tool {{view-tool-name}} \
  --fixture fixtures/{{ui-name}}-many.json --out test-results/many/

# Error payload (defensive coercion)
plugin-toolkit-test render --plugin . --tool {{view-tool-name}} \
  --fixture fixtures/{{ui-name}}-error-payload.json --out test-results/error/
```

Pass/fail rules for each fixture:

- `results.json → success: true` AND `consoleErrors: []` → pass.
- Any entry in `consoleErrors` → bug. Fix before moving on. Zero
  tolerance.
- `mcpjamErrors` is infra noise (HTTP 500/409, hydration warnings).
  **Ignore.**
- `render.png` shows the expected state, not a stuck skeleton.

If a fixture has 5+ required `structuredContent` fields and you're not
seeing the auto-prompt help, pass `--prompt` explicitly:

```sh
plugin-toolkit-test render --plugin . --tool {{view-tool-name}} \
  --fixture fixtures/{{ui-name}}-single-high.json \
  --prompt "Call the {{view-tool-name}} tool with these exact JSON args (do not ask for clarification): {ARGS}"
```

## Step 3 — Interactive pass (single-shot per action)

For each user-facing action listed in the handler's spec §5, run a
single-shot render against `single-high` (or another fixture that
exercises the action), then verify state via DOM query. Don't chain
`--keep-session` interactions from a one-shot agent shell — see
`canonical/prompts/ui/workflow-testing.md → "--keep-session survives
only in a persistent parent shell"`.

Example: dismiss button verification.

```sh
plugin-toolkit-test render --plugin . --tool {{view-tool-name}} \
  --fixture fixtures/{{ui-name}}-single-high.json \
  --keep-session
plugin-toolkit-test interact --action query --selector '[data-testid]'
plugin-toolkit-test interact --action click --selector '[data-testid="dismiss-btn"]'
plugin-toolkit-test interact --action read_text --selector '[data-testid="status-badge"]'
plugin-toolkit-test screenshot --out test-results/after-dismiss.png
plugin-toolkit-test cleanup
```

Verify (per Step 4 Action Feedback Verification in the workflow
guide):
- Status badge changed (e.g. "Pending" → "Dismissed").
- Item moved out of the active list, OR is visibly de-emphasised.
- A success banner / toast appears, OR the item card visually
  confirms the write-back.

## Step 4 — Inline viewport budget

For every modal/overlay/dialog, after opening:
- Run `interact --action read_text` on the primary action selector
  (Save / Submit / Confirm / Next) — the query MUST succeed without
  scrolling.
- Run `interact --action scroll_to --selector <primary-action>` —
  must succeed (proves internal-scroll body, not natural document
  scroll).

Grep the source for `min-h-screen|h-screen|100vh|100dvh` — any match
is a bug.

## Completion gate

Before opening a PR, all of these must hold:

- All four fixtures pass (`success: true`, `consoleErrors: []`).
- `npm run check:bundle-sync` exits 0.
- `npm test` passes in `component/`.
- Every write-back action in the spec shows a visible state change
  on the acted item (per Step 4 of the workflow guide).
- `render.png` for each fixture is committed to the test-results
  archive (or referenced in the PR description) so reviewers can see
  the visual pass.

## Failure modes

See `canonical/prompts/ui/workflow-testing.md → "Failure handling"`
for the canonical decision tree. The fixture-specific failures most
worth calling out:

- `*-empty.json` shows a non-empty state → fixture filter is wrong, OR
  `widgetState` was persisted from a prior run. Reset fixture's
  `widgetState` keys.
- `*-error-payload.json` throws a console error → component is
  missing a `safe-accessors.ts` coercion at one of the field
  boundaries. Add it; do not catch errors in the component tree.
- `*-many.json` clips horizontally → table has a non-sticky header or
  a missing `overflow-x-auto`.
