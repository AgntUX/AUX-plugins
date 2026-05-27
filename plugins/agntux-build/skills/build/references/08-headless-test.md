# Stage 8 — final render check

The plugin is built. The user already iterated against the headed
host-renderer in stage 6, so the iframe shape is known good. Stage 8
runs one **headless** screenshot pass per view tool as a regression
artifact — proof the build still renders cleanly after stages 6→7
finished any last edits.

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

3. On install success, proceed to render.
4. On install failure (offline / disk / permissions), surface the
   same one-liner from the self-fix path (saving session, link to
   issues). Don't dump the install log.

The probe + install runs once per machine. After that the binary
is cached at `~/Library/Caches/ms-playwright/` (macOS) and the
probe short-circuits.

## Read-only-host fallback (Cowork sandbox)

If `${CLAUDE_PLUGIN_ROOT}` is read-only, the harness can't
`npm install` in place. The orchestrator's fallback: copy
`${CLAUDE_PLUGIN_ROOT}/host-renderer/` and
`${CLAUDE_PLUGIN_ROOT}/test-harness/` to a writable scratch dir
under `os.tmpdir()/agntux-headless-tools-{plugin-version}/`,
chmod writable, run `npm install` once there, and pass
`--host-bin {scratch}/host-renderer/bin/host.mjs` to the harness
on subsequent calls. The first run incurs the install cost; later
runs hit the cached scratch dir.

## What you do

For each UI handler in the session's `ui_handlers` array:

1. Run the test harness:
   ```
   ${CLAUDE_PLUGIN_ROOT}/test-harness/bin/cli.mjs render \
     --plugin {build-path} \
     --tool {view-tool-name} \
     --headless \
     --screenshot {session-dir}/headless-{ui-name}.png
   ```

2. The CLI:
   - Dynamically imports `view-tool/dist/{slug}-view.js` in-process
     (no MCP server spawn — source plugins ship none).
   - Spawns the in-plugin host renderer in headless mode (no port-8080
     web server; serves to Playwright directly via the internal
     `/__test/render` endpoint).
   - Drives Chromium to load the host page, trigger the view tool,
     wait for `tool-result`, and capture `{screenshot, logs,
     consoleErrors, structuredContent}`.
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
   surface for maintainers); it is NOT shown inline to the user.
   The user already saw the live iframe in stage 6.

## What you say to the user

One status line:

> Running render checks for {N} button(s)...

No "ready to install?" prompt. On all-pass, advance silently to
stage 9.5.

## On failure — self-fix, don't narrate

If a handler's render returns `consoleErrors.length > 0` or
`renderState !== "tool-result"`:

1. **Do not surface the error to the user.** No "hit something",
   no plain-language translation, no choice prompt.
2. Dispatch `executor` (model=sonnet) with the failing handler's
   name, the console-error array, and the structuredContent diff
   against the schema declared in stage 5. Directive: "fix the
   handler so the next render is clean." `executor` edits the
   view-tool source, re-runs `npm run build` inside `view-tool/`,
   and re-tests.
3. Re-run the test. If the second attempt also fails, escalate to
   `executor` with model=opus and one more retry.
4. Only after three failed attempts on the same handler do you
   surface anything, and it's the same one-liner from stage 7
   (saving the session, link to issues).

## Common failure modes (used internally to direct the self-fix)

| Console error | What `executor` should target |
|---|---|
| `Refused to execute inline script because it violates the following Content Security Policy directive: 'script-src ...'` | Component is using a CSP-incompatible feature; switch to a permitted primitive. |
| `Cannot read properties of undefined (reading '...')` | structuredContent shape drift; reconcile with the schema declared in stage 5. |
| `Maximum update depth exceeded` (React) | Infinite render loop; patch the offending hook. |
| `Failed to fetch dynamically imported module` for `dist/{slug}-view.js` | View-tool bundle missing — `npm run build` didn't complete; re-run from `view-tool/`. |
| `_meta.ui.resourceUri is not set` on tool descriptor | `emit-manifest.mjs` didn't run or didn't propagate `_meta.ui` into the manifest; re-run the build. |

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
- Don't show the screenshot inline. The user already saw the live
  iframe in stage 6; this pass is a regression guard, not a UX
  review.
- Don't run the headless check in parallel with anything else.
  The spawned Playwright process is resource-heavy; per-handler
  serial is fine.

## Path forward

Once all UI handlers pass, advance to
[`09a-onboarding-iterate.md`](09a-onboarding-iterate.md).
