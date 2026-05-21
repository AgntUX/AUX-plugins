# Workflow Testing

> **Outdated below.** Source plugins now ship as remote-view-only —
> no local MCP server, no `HTTP_MODE` spawn, no MCPJam Inspector
> dependency. The current iteration loop runs through agntux-build's
> own `host-renderer/` (in-process view-tool module loader + headed
> Playwright) and `test-harness/bin/cli.mjs` (headless screenshot
> harness against `/__test/render`). The user-facing flow lives in
> `plugins/agntux-build/skills/build/references/06-design-and-preview.md`
> (stage 6 headed preview) and `08-headless-test.md` (stage 8
> regression screenshot). Read those first; treat the sections below
> as historical context unless you're maintaining the legacy
> MCPJam-driven path.

End-to-end testing for AgntUX plugin UI handlers runs through the
`plugin-toolkit-test` CLI (in `${CLAUDE_PLUGIN_ROOT}/test-harness/bin/cli.mjs`)
talking to a locally-running MCPJam Inspector. The harness launches Chromium
via Playwright, navigates to MCPJam with the plugin's MCP server URL,
drives the chat input, waits for the inner MCP App iframe to render, and
captures screenshots + RPC logs + console errors. Mirrors the proven
pattern from `langgraph/src/tools/workflow-test/`.

The mechanical contract of the CLI lives in
`${CLAUDE_PLUGIN_ROOT}/test-harness/README.md` and
`${CLAUDE_PLUGIN_ROOT}/test-harness/bin/cli.mjs --help`.

## Subcommands and roles

| Subcommand | Use it for |
|---|---|
| `render` | Single-shot: spawn server, render the tool, capture artifacts. Pass `--keep-session` to chain `interact`/`screenshot`. |
| `interact` | One UI action against the kept-alive iframe (click, fill, query, read_text, scroll_to, press, …). |
| `screenshot` | Re-capture iframe state from the kept session. |
| `cleanup` | Tear down the kept browser + MCP server. |

## Visual / E2E testing workflow

After a successful build, run visual tests to verify the component renders
and behaves correctly inside an MCP App-capable host.

**When to test:**

- After every component edit that lands in `src/components/main-component.tsx`.
- After bumping any `structuredContent` field in the view tool.
- After every revision rebuild during the iteration loop.
- Before opening a PR.

**Step 1 — Build both layers (per B.7):**

```sh
# In component/
npm run build       # produces out/index.html

# In mcp-server/
npm run build       # tsc + scripts/embed-bundle.mjs (re-embeds the bundle)
npm run check:bundle-sync   # CI guard — confirms no stale embed
```

Skipping the mcp-server rebuild ships a stale bundle to MCPJam — the
single most common cause of "my edit isn't reflected in the screenshot."

**Step 2 — Trigger rendering:**

```sh
# Prereq: MCPJam Inspector running in a separate terminal, e.g.
ENVIRONMENT=dev AGNTUX_MODE=true npm --prefix /path/to/MCPJam-inspector run dev

# In the plugin tree
npm run test:e2e
# or, equivalently:
plugin-toolkit-test render \
  --plugin . \
  --tool {name}_view \
  --fixture fixtures/{name}-default.json \
  --out test-results/
```

The inspector URL defaults to `$MCPJAM_URL`, then `http://127.0.0.1:5173`.
Override per-invocation with `--inspector-url <url>`.

The harness:

1. Resolves the plugin's compiled MCP server entry.
2. Spawns it with `HTTP_MODE=1 PORT=5170` (override with `--mcp-port`).
3. Waits for `GET /health` to return 200.
4. Launches Chromium and navigates to
   `${MCPJAM_URL}?mcpServerUrl=http://localhost:5170/mcp`.
5. Sends the chat prompt
   `Call the tool {toolName} with arguments {JSON.stringify(args)}`
   (override per-fixture with a top-level `prompt` field).
6. Waits for the assistant message + `iframe[sandbox]` to appear, then
   waits for the inner iframe content to settle (interactive elements
   present, no skeleton/loading indicators).
7. Captures: full-content iframe screenshot, MCPJam SSE RPC logs (parsed
   into a tool-call chain), classified console errors (component vs
   MCPJam infra noise), and the conversation transcript.

**Step 3 — Review every signal in `test-results/`:**

| Artifact | What to check |
|---|---|
| `render.png` | Visual layout looks correct. Component is not stuck in skeleton/loading state. Primary action is visible at 600px viewport (test the inline budget). |
| `results.json` → `success` | Must be `true`. Means `mcpAppRendered` AND `consoleErrors` is empty. |
| `results.json` → `mcpAppRendered` | Must be `true`. If false, the iframe never appeared — usually a deployment/skill issue. |
| `results.json` → `logs.consoleErrors` | These are errors FROM YOUR COMPONENT. Must be empty. **Every error here is a bug you must fix. Zero tolerance.** |
| `results.json` → `logs.mcpjamErrors` | Known MCPJam infra noise (HTTP 500/409, hydration warnings, sandbox CSP warnings). **Ignore.** |
| `results.json` → `logs.toolCallChain` | The MCP tool call sequence. The view tool you instructed should appear. Any extra calls are unexpected. |
| `results.json` → `logs.rpcLogs` | JSON-RPC request/response pairs. Check for failed RPC calls or malformed payloads. |
| `results.json` → `conversation` | Read the host agent's reply. Look for tool errors or unexpected behavior in the assistant text. |
| `results.json` → `responseTimeMs` | Sanity bound — render should complete within `--timeout` (default 120s). |

**Step 4 — Interactive testing (act like a real user):**

Read app-spec **Section 5 (User Interactions)** and **Section 13 (Visual/E2E
Test Scenarios)** to understand every user action the component supports.
Then systematically test each one with `--keep-session`:

```sh
plugin-toolkit-test render --plugin . --tool {name}_view \
  --fixture fixtures/{name}-default.json --keep-session
plugin-toolkit-test interact --action query --selector '[data-testid]'
plugin-toolkit-test interact --action click --selector '[data-testid="dismiss-btn"]'
plugin-toolkit-test screenshot --out test-results/after-dismiss.png
```

**CRITICAL: You must verify that each interaction ACTUALLY WORKED, not
just that it didn't throw an error.** Clicking a button without checking
what happened is not testing — you must confirm the expected outcome
occurred.

For each user action (button click, form fill, tab switch, status
change, dropdown):

a. Use `interact --action query` first to discover available interactive
   elements and their selectors. **NEVER guess `data-testid` names** —
   guessing wastes interaction calls when the guess is wrong.
b. Use `interact --action {click|fill|...}` to perform the action.
c. Check `newConsoleErrors` in the result — must be empty. Any error
   here is a bug you must fix.
d. Use `screenshot` to capture post-interaction state, then read the PNG
   to visually verify the UI updated correctly.
e. **VERIFY THE OUTCOME — this is the most important step:**
   - Use `interact --action read_text` or `--action query` to confirm the
     expected state change actually happened.
   - For edit/save flows: verify the saved content persists after exiting
     edit mode (read the text back).
   - For toggle/expand actions: verify the toggled state is reflected in
     the DOM.
   - For delete actions: verify the element was removed.
f. **If the feature didn't work as expected, that's a bug** — even if
   there were no console errors.
g. **Action Feedback Verification (REQUIRED for every write-back action):**
   After performing any action that triggers `sendFollowUpMessage` or
   `callTool`, verify ALL of these:
   - `read_text` or `query` confirms **SUCCESS FEEDBACK is visible** —
     a status badge change, confirmation banner, or visual state change
     on the item that was acted on.
   - `read_text` or `query` confirms the **ITEM STATE changed** — it
     should no longer appear in its original "pending/actionable" state.
   - If no visible feedback appeared, that is a **BUG** — even if there
     were zero console errors.
   - Take a screenshot and confirm the feedback is visible without
     scrolling past the acted-on item.

Test edge cases too: rapid clicks, empty form submissions, boundary
values where applicable.

**Step 5 — Inline Viewport Budget (REQUIRED for every test session):**

The real host gives inline iframes ~400–600px of height. The component
must remain fully usable at that size. Because the harness grows the
iframe to capture full content, screenshots DO NOT reveal clipping by
themselves — you must assert reachability via DOM queries.

- After opening any modal, dialog, or overlay, use `read_text` or `query`
  to confirm the PRIMARY ACTION button (Save, Submit, Confirm, Next) is
  present in the DOM. If the query returns it but the screenshot appears
  clipped in the unresized state, the modal is not internal-scroll-compliant
  — that's a BUG.
- Use `interact --action scroll_to --selector <primary-action>` and
  re-query — if `scroll_to` succeeds, the modal's body has proper internal
  scroll.
- Grep the component source for `min-h-screen`, `h-screen`, `100vh`,
  `100dvh` — any match is a bug; fix before deploying.
- For long forms/wizards, fill every field, scroll to the bottom, and
  verify the submit button is reachable. If a form needs > 600px of
  scroll height, its submit button MUST live in a `sticky bottom-0` footer.

## Selector guidance

**CRITICAL: NEVER guess `data-testid` names. ALWAYS run `interact --action
query` first to discover available elements and their attributes.**

- BEST: `[data-testid="share-send-btn"]` — deterministic, stable across
  refactors (but discover via `query` first!).
- GOOD: `button:has-text("Save")`, `input[name="search"]`,
  `tr:nth-child(2) td:first-child`.
- AVOID: `:has-text('long text with special chars')` — Playwright's CSS
  parser struggles with quotes and special characters.
- BAD: `button`, `div`, `span` — too generic, Playwright strict mode
  fails on multiple matches.

**Workflow: query first, then interact:**

1. Run `interact --action query --selector 'button'` (or `[data-testid]`)
   to discover elements.
2. Pick the specific selector from the query results.
3. Use that exact selector for `click`, `fill`, `read_text`, etc.

Use `--action scroll_to` before interacting with elements below the viewport.

## Infrastructure noise (IGNORE — these are NOT component bugs)

- Vite dev server warnings (HMR, module resolution, hot reload).
- Sandbox / CSP warnings from the test environment.
- MCPJam infrastructure errors (HTTP 500/409, React hydration warnings)
  — these surface in `mcpjamErrors`, not `consoleErrors`.

Only `logs.consoleErrors` (errors from your component code) are bugs.
Zero tolerance for those.

## State persistence across test sessions

Persistent state (`filed_ids`, `dismissed_ids`, watermarks) survives
across test sessions when fixtures share the same `widgetState` keys.
If a previous test run dismissed an item, subsequent runs may see it
as already processed.

- Before re-testing after code revisions, reset relevant fixture files
  to a clean baseline.
- If you see an unexpected empty state, check whether the fixture's
  `widgetState` field is filtering out all items.
- Document which state keys need clearing in the test plan when testing
  stateful workflows.

## Smoke test (light) — verify the deployed bundle

The full iteration loop above is for active development. After the
component lands and you're about to open a PR, run a smoke test — a
light sanity check that the bundle is correctly embedded and the
component renders end-to-end.

```sh
npm run test:e2e -- --fixture fixtures/{name}-default.json --out test-results/smoke/
```

Quick result review:

| Signal | Expectation |
|---|---|
| `success` | `true` |
| `mcpAppRendered` | `true` |
| `consoleErrors` | empty |
| `render.png` | correct layout, not stuck in loading |
| `toolCallChain` | view tool was called, no unexpected extra calls |

Spot-check 1–2 representative interactions (primary action + one
data-entry flow) — do NOT re-test every interaction.

## Completion gate — present to reviewer when

- All per-case fixtures pass with `success: true` and zero console errors.
- Screenshots show correctly rendered component at every state.
- `mcp-server/scripts/check-bundle-sync.mjs` passes.
- `npm test` passes in the component directory (vitest unit tests).
- All write-back actions show visible success feedback (status change,
  confirmation, visual update on the acted item).

## Failure handling

If the harness fails for environmental reasons (MCPJam unreachable, MCP
server entry not found, fixture invalid, Playwright browser missing):

1. Read the CLI's error message — it names the specific check that
   failed and the suggested remedy.
2. Fix the environment (start MCPJam, rebuild mcp-server, fix the
   fixture JSON, run `npx playwright install chromium`), not the component.
3. Re-run.

If it fails because the component itself is broken (non-empty
`consoleErrors`, screenshot stuck in loading):

1. Diagnose by reading the failure mode in `results.json`.
2. Edit the component.
3. Rebuild both layers (Step 1 of the main workflow).
4. Re-run.

## Rate-limit handling

If MCPJam Inspector returns HTTP 429 or starts timing out under load:

- Wait 2 minutes before retrying.
- You have a budget of 3 retry attempts per test session.
- If all 3 retries fail, surface "E2E testing blocked by rate limits.
  Build passed. Manual testing recommended." to the orchestrator and
  stop.

## Cleanup

`render --keep-session` leaves a browser + MCP server alive. Always run
`plugin-toolkit-test cleanup` when you're done iterating, or rely on the
next `render --keep-session` to evict the prior one. The session
lockfile is `<plugin-cwd>/.plugin-toolkit-test/session.json`.

## `--keep-session` survives only in a persistent parent shell

`render --keep-session` uses `chromium.launchServer()`, which produces
a detached browser process — but the process is still subject to
SIGHUP when the controlling shell exits. **If each invocation of the
CLI runs in a freshly-spawned shell that exits between commands** (the
standard environment for many agentic harnesses, including Claude
Code's Bash tool), the detached browser dies between `render` and the
next `interact`/`screenshot`. Single-shot `render` calls succeed;
chained interaction tests do not.

Recommended pattern by environment:

| Environment | Pattern |
|---|---|
| Real terminal / tmux / screen | `--keep-session` chains work as designed. |
| Agent harness with one-shot Bash invocations | Use a single-shot `render` per fixture, OR write a wrapper shell script that keeps the parent alive across the chain. Don't chain `--keep-session` calls from separate Bash invocations. |
| CI (one-shot) | Use single-shot `render` with `--check` for input validation and a separate fixture-driven render for the visual pass. |

If you find a stale browser server from a prior session, run
`plugin-toolkit-test cleanup` (which closes the wsEndpoint) before
the next `render`. If that doesn't reclaim the port, fall back to
`lsof -nP -iTCP:5170 -sTCP:LISTEN` (or your `--mcp-port`) and SIGTERM
the bound process explicitly.

## Default prompt fails tools with required `structuredContent` fields

The harness's default chat prompt is
`Call the tool {toolName} with arguments {JSON.stringify(args)}`. That
satisfies tools whose input schema has zero required fields (e.g.,
`triage_view` with all-optional args), but **MCPJam's chat LLM
refuses** when the schema declares 5+ required `structuredContent`
fields (e.g., `compose_view`, `canvas_view`) — it asks the user for
clarification, hits the page-load timeout, and the render fails.

Two fixes (the harness now does the first automatically; the second
is for explicit override):

1. **Auto-prompt**: when `--fixture` carries a non-empty
   `args.structuredContent` and neither `--prompt` nor
   `fixture.prompt` is set, the harness builds a directive prompt
   inlining the JSON args verbatim:

   ```
   Call the {toolName} tool with these exact JSON args (do not ask
   for clarification, do not request user input): {JSON-args}
   ```

   The harness logs the chosen prompt to stderr so you can see it.

2. **Manual override**: pass `--prompt` (or set `fixture.prompt` in
   the fixture JSON) with the directive language above. Use this when
   you want to test a different chat phrasing.

This is a test-harness pattern, not a component constraint —
production never goes through chat-LLM tool dispatch. Draft skills
call view tools directly with full structured args.

## Per-handler TESTING.md runbook

For UI handlers shipped to the marketplace, drop a `TESTING.md` next
to the handler's source so contributors can re-run the same e2e pass
without rediscovering the build ordering. The canonical layout
(matches the AUX-plugins `agntux-core` triage handler):

```
plugins/{slug}/ui-handlers/{name}/
├── TESTING.md                 # Runbook (this file)
├── component/                 # React + Vite source
├── fixtures/
│   ├── {name}-empty.json
│   ├── {name}-single-high.json
│   ├── {name}-many.json
│   └── {name}-error-payload.json
└── README.md                  # Human-facing doc (optional)
```

A starter TESTING.md template lives at
`${CLAUDE_PLUGIN_ROOT}/canonical/ui-handlers/_template/TESTING.md`.

Four canonical fixtures, each with a single failure mode it surfaces:

| Fixture | What it asserts |
|---|---|
| `{name}-empty.json` | Empty-state copy renders; bootstrap-period tone (no FORBIDDEN words from `ui-designer-discipline.md`); no skeleton stuck. |
| `{name}-single-high.json` | Single high-priority item; primary action button reachable + write-back action triggers visible status change (per Step 4 Action Feedback Verification). |
| `{name}-many.json` | Wide scope, internal-scroll discipline holds; row-count assertion via `interact --action query`; no horizontal scroll on desktop or mobile. |
| `{name}-error-payload.json` | Invalid / partial structuredContent; component falls back to error/empty state without throwing — `consoleErrors` MUST be empty. |

Fixture pass/fail rules (same for all four):

- `success: true` AND `consoleErrors: []` → pass.
- `mcpjamErrors` non-empty → ignore (infra noise; see "Infrastructure
  noise" above).
- Any `consoleErrors` entry → bug; fix before moving on.

Starter fixture stubs live at
`${CLAUDE_PLUGIN_ROOT}/canonical/ui-handlers/_template/fixtures/`.
