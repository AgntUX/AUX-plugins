# Stage 8 — headless test the action button

The plugin is built. Before the user installs it in Claude Desktop,
run the action button through the in-plugin headless host so we know
it renders correctly. This catches the kind of issue ("the textarea
overflows on mobile width", "the Send button is disabled when it
shouldn't be") that's painful to iterate on after install.

The big UX win here: **no MCPJam Inspector running locally**. The
test happens via `agntux-build-test` which spins up the in-plugin
host renderer + Playwright and returns a screenshot + console log.
The user doesn't start anything — it just runs.

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
   - **`structuredContent`** — must match the schema declared in
     stage 5.
   - **`screenshot`** — visual sanity check. Render and show inline
     (the screenshot is base64-encoded PNG; show with the host's
     image rendering).

## What you say to the user

Before:

> Quick automated check — making sure the {verb-phrase} button
> renders correctly. This runs locally; nothing to install.

During:

> Running the check...

On success (no console errors, structuredContent matches):

> Looks good. Here's what the button looks like with mock data:
>
> ![{ui-handler-name} preview](data:image/png;base64,...)
>
> Same as the design we landed on. Ready to install on your
> machine?

On failure:

> Hit something — {plain-language-translation-of-error}.
>
> {one-sentence-suggestion-for-fix}. Want me to try a fix and
> re-run, or step back and look at it together?

## Common failure modes and how to translate them

| Console error | Plain language |
|---|---|
| `Failed to load resource: net::ERR_CONNECTION_REFUSED` at port `*` | "the plugin's MCP server didn't start — usually a missing build step. Want me to rebuild and retry?" |
| `Refused to execute inline script because it violates the following Content Security Policy directive: 'script-src ...'` | "the component is using a feature that doesn't fit AgntUX's security rules. I'll fix and retry." |
| `Cannot read properties of undefined (reading 'verb')` | "one of the typed fields the component expects is missing. Probably from the design step — I'll patch and retry." |
| `Maximum update depth exceeded` (React) | "an infinite render loop in the component. I'll patch and retry." |
| `_meta.ui.resourceUri is not set` on tool descriptor | "the action button's metadata isn't pointing at its UI bundle yet. Fixing." |

If the same error recurs after one retry, redirect to issues:

> The {error-class} keeps hitting on retry. Best to flag it on the
> issues page — `https://github.com/AgntUX/AUX-plugins/issues`. Save
> the session file at {path} and link it.

## Multi-handler case

Run all handlers sequentially. Show each result. The user moves
forward only when **all** pass.

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

- Don't surface raw stack traces. Translate.
- Don't let the user skip the headless test — it catches the
  cheapest class of bug we can.
- Don't re-render a screenshot you already showed; if iterating,
  make a new screenshot per iteration so the user can see the
  diff.
- Don't run the headless test in parallel with anything else. The
  spawned MCP server and the spawned Playwright process are both
  resource-heavy; serial is fine.

## Path forward

Once all UI handlers pass, advance to
[`09-zip-and-install.md`](09-zip-and-install.md).
