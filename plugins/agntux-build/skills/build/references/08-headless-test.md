# Stage 8 — headless test the action buttons

The plugin is built. Before the user installs it in Claude Desktop,
run each action button through the in-plugin headless host so we
know they render correctly. This catches the kind of issue ("the
textarea overflows on mobile width", "the Send button is disabled
when it shouldn't be") that's painful to iterate on after install.

The big UX win here: **no MCPJam Inspector running locally**. The
test happens via `agntux-build-test` which spins up the in-plugin
host renderer + Playwright and returns a screenshot + console log.
The user doesn't start anything — it just runs.

## Read-only-host fallback (Cowork sandbox)

If `${CLAUDE_PLUGIN_ROOT}` is read-only (Cowork's sandbox is the
canonical example, but Claude Desktop mounts plugins similarly),
the harness can't `npm install` in place. The orchestrator's
fallback: copy `${CLAUDE_PLUGIN_ROOT}/host-renderer/` and
`${CLAUDE_PLUGIN_ROOT}/test-harness/` to a writable scratch dir
under `os.tmpdir()/agntux-headless-tools-{plugin-version}/`,
chmod writable, run `npm install` once there, and pass
`--host-bin {scratch}/host-renderer/bin/host.mjs` to the harness
on subsequent calls. The first run incurs the install cost; later
runs hit the cached scratch dir.

(A future harness change will make this prepare-scratch step
internal so the orchestrator doesn't need to drive it. Until then,
the orchestrator handles it.)

## Stage 7.5 — invariant gates before the render run

Before any handler renders, run four silent build-verify gates
(same self-fix pattern as stage 7 — no user narration):

1. **Compile gate.** Run `npx tsc -p mcp-server/tsconfig.json`
   from the build path. On error, dispatch `executor`
   (model=sonnet) with the tsc output and "fix and continue." Up
   to two retries; on third miss, escalate per stage 7's
   one-liner.
2. **Boilerplate gate.** Grep `mcp-server/dist/index.js` for
   `setRequestHandler(ListToolsRequestSchema` — must match.
   Grep for the literal string `Example MCP server setup` —
   must NOT match. If either fails, the scaffold left
   commented-out boilerplate; dispatch `executor` with the gap
   description.
3. **Embed gate.** Grep `mcp-server/dist/` for any `__EMBED__`
   substring — must NOT match. If it does, the embed step never
   ran; dispatch `executor` to add the embed pass to
   `scripts/build-plugin.mjs` (or run it inline) and rebuild.
4. **`_meta.ui.resourceUri` gate.** Spawn the server in HTTP
   mode, list tools via the MCP client, confirm every `*_view`
   tool's `_meta.ui.resourceUri` is a `ui://` URI that resolves
   via `readResource`. If not, the scaffold's ListTools handler
   is wrong; dispatch `executor`.

The user sees one status line for the whole pass:

> Verifying build...

## Chromium fallback (first run on a new host)

Playwright is a dev dependency of `agntux-build/host-renderer/`,
but the Chromium binary is downloaded separately on first install.
Some hosts (Cowork's sandbox is the canonical example) run the
harness without ever having had Chromium installed.

Before the first render attempt of a session, probe:

```
${CLAUDE_PLUGIN_ROOT}/test-harness/bin/cli.mjs probe-chromium
```

The probe returns `{ installed: bool, version?: string }`. If
`installed` is false:

1. Run `npx --prefix ${CLAUDE_PLUGIN_ROOT}/host-renderer playwright install chromium`.
2. Surface one status line to the user:

   > Setting up the render check (one-time, ~1 min)...

3. On install success, proceed to step 2 (`render`).
4. On install failure (offline / disk / permissions), surface the
   same one-liner from the self-fix path (saving session, link to
   issues). Don't dump the install log.

The probe + install runs once per machine. After that the binary
is cached at `~/Library/Caches/ms-playwright/` (macOS) and the
probe short-circuits.

## What you do

For each UI handler in the session's `ui_handlers` array:

1. Run the test harness:
   ```
   ${CLAUDE_PLUGIN_ROOT}/test-harness/bin/cli.mjs render \
     --plugin {build-path} \
     --tool {ui-handler-name}_view \
     --headless
   ```

2. The CLI:
   - Spawns the plugin's `mcp-server/dist/index.js` in HTTP mode
     (`HTTP_MODE=1 PORT=auto`).
   - Spawns the in-plugin host renderer (`host-renderer/`) in
     headless mode (no port-8080 web server; serves to Playwright
     directly via the internal `/__test/render` endpoint).
   - Drives a Playwright Chromium instance to load the host page,
     trigger the tool call, wait for `tool-result`, and capture
     `{screenshot, logs, consoleErrors, structuredContent}`.
   - Returns the result as JSON.

3. Read the result. Inspect:
   - **`consoleErrors`** — must be empty. Any error is a fail.
   - **`renderState`** — must be `tool-result`.
   - **`structuredContent`** — must match the schema declared in
     stage 5.
   - **`contentChecks.failed`** — must be empty. The harness
     verifies the rendered DOM contains the source-side context
     (issue key, draft body, verb-labelled button) per the
     content rubric in `playwright-driver.mjs`.

   The screenshot is captured for the session file (debugging
   surface for maintainers); it is NOT shown inline to the user
   in this stage. Visual verification belongs in stage 11, after
   install.

## What you say to the user

One status line, no confirmation gate from stage 7:

> Running render checks for {N} button(s)...

No "ready to install?" prompt. No screenshot inline (the user
doesn't need to verify visuals here — that happens after install,
in stage 11). On all-pass, advance silently to stage 9.

## On failure — self-fix, don't narrate

If a handler's render returns `consoleErrors.length > 0` or
`renderState !== "tool-result"`:

1. **Do not surface the error to the user.** No "hit something",
   no plain-language translation, no choice prompt.
2. Dispatch `executor` (model=sonnet) with the failing handler's
   name, the console-error array, and the structuredContent diff
   against the schema declared in stage 5. Directive: "fix the
   handler so the next render is clean." `executor` edits the
   component / view tool / structuredContent shape directly.
3. Re-run the test. If the second attempt also fails, escalate to
   `executor` with model=opus and one more retry.
4. Only after three failed attempts on the same handler do you
   surface anything, and it's the same one-liner from stage 7
   (saving the session, link to issues).

## Common failure modes (used internally to direct the self-fix)

| Console error | What `executor` should target |
|---|---|
| `Failed to load resource: net::ERR_CONNECTION_REFUSED` at port `*` | MCP server didn't start — rebuild the mcp-server, recheck `HTTP_MODE` listening line. |
| `Refused to execute inline script because it violates the following Content Security Policy directive: 'script-src ...'` | Component is using a CSP-incompatible feature; switch to a permitted primitive. |
| `Cannot read properties of undefined (reading 'verb')` | structuredContent shape drift; reconcile with the schema declared in stage 5. |
| `Maximum update depth exceeded` (React) | Infinite render loop; patch the offending hook. |
| `_meta.ui.resourceUri is not set` on tool descriptor | ListTools handler isn't emitting `_meta.ui.resourceUri`; patch the mcp-server's ListTools handler (covered by the stage-7.5 gate but recheck). |

## Saved state at end of stage 8

```json
{
  ...,
  "headless_tests": [
    {
      "ui_handler": "reply",
      "passed": true,
      "screenshot_path": ".agntux-build/sessions/{id}/headless-reply.png",
      "console_errors_count": 0,
      "structured_content_keys": ["issue_url", "issue_title", "draft_body"]
    }
  ],
  "stage_8_completed_at": "2026-05-08T..."
}
```

## What you do NOT do

- Don't surface raw stack traces — self-fix per the rule above.
- Don't let the user skip the headless check — it catches the
  cheapest class of bug we can.
- Don't show the screenshot inline. Visual verification is
  stage 11's job, after install.
- Don't run the headless check in parallel with anything else.
  The spawned MCP server and the spawned Playwright process are
  both resource-heavy; per-handler serial is fine.

## Path forward

Once all UI handlers pass, advance to
[`09-zip-and-install.md`](09-zip-and-install.md).
