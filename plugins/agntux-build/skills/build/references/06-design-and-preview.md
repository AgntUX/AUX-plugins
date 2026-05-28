# Stage 6 — design and preview

For each UI handler from stage 5, scaffold the component, build the
view-tool bundle, then preview it in a **real Chromium window** the
user can click in. They see the real iframe — they don't see internal
stage names or scaffold filenames.

## What happens internally (silent)

You — the orchestrator — dispatch `ui-handler-author` (one of the
internal specialists) with the planned UI handler shape. The
specialist:

1. Reads the canonical UI knowledge layer at
   `${CLAUDE_PLUGIN_ROOT}/canonical/prompts/ui/`.
2. Generates the view-tool source from
   `${CLAUDE_PLUGIN_ROOT}/canonical/ui-handlers/_template/view-tool/`,
   substituting `{{plugin-slug}}`, `{{ui-name}}`,
   `{{view-tool-name}}`, `{{view-tool-description}}` and the
   structured-content schema.
3. Writes `view-tool/src/{slug}-view.ts` (handler) and
   `view-tool/src/{ui-name}-ui.tsx` (React iframe entry) plus the
   `{{ui-name}}.html` Vite entry into the working `agntux-{slug}/`
   tree.

Then run the view-tool build and launch the headed host-renderer:

```bash
cd {build-path}/view-tool && npm run build
node ${CLAUDE_PLUGIN_ROOT}/host-renderer/bin/host.mjs \
  --plugin {build-path} \
  --tool {view-tool-name}
```

The renderer:

- Dynamically imports `view-tool/dist/{slug}-view.js` in-process — no
  MCP server spawn.
- Serves `dist/ui-resources/{ui-name}.html` to Chromium with CSP and
  permissions from `view-tools.manifest.json`.
- Backs `ctx.fs` with the plugin's own `examples/` or `__tests__/fixtures/`
  (or `--fixtures-dir`).
- Intercepts every iframe `useAppsClient().callTool()` invocation,
  logs the `{toolName, args}` payload to stdout and to an SSE stream,
  and returns a stubbed-success envelope. Mutations never execute.

You don't tell the user any of this. You just open the window.

## How the preview works (user-facing)

A real Chromium window opens. The user sees the iframe live with
realistic mock data sourced from the plugin's fixtures:

- An action item card on top with mock source context (quoted
  message, issue title, etc.).
- The editable body pre-filled with a draft.
- Mode tabs above the Send button (Send / Schedule / Save draft for
  chat-style verbs; just Send for issue-state verbs).
- The Send button bottom-right.

They click around. When they click Send (or Schedule, or any verb),
the renderer intercepts the payload and the SSE stream surfaces it.
Echo it back in chat so the user confirms the *shape* of the
mutation is right:

> Send fired with:
> ```
> {channel: "#general", text: "Thanks — taking a look now and will reply by EOD."}
> ```
> That's the envelope your plugin will hand the {connector-display-name}
> connector. Looks right?

The mutation never reaches the real connector during iteration.
The deployed remote MCP server is the first place it actually runs.

## What you accept and don't accept

Keep the design general-purpose: it has to render for **any** user of
this connector, not just the contributor previewing it now. The mock
data is for finding layout bugs, not a spec — don't bake in the
contributor's own workspace names, data volume, or field shapes. The
source context the iframe quotes comes from whatever the host hands
the handler at render time.

### Accept and apply

- Copy changes (button labels, helper text, placeholder text).
- Layout tweaks within the canonical primitives (more or less
  vertical space between the source context and the editor).
- Adding a single optional helper line below the editor (e.g.,
  "tone preferences from your profile applied").

### Reject (state the rule, move on)

- Dark mode, custom theme, custom hex.
- Custom typography.
- Modals (`<dialog>`, `position:fixed`).
- A second Send-style button.
- Three-column layouts or other non-canonical structures.
- Custom hotkey layers (cmd-k, custom shortcuts).
- Removing the "quoted source context above editor" — that's
  load-bearing for the authorisation gate.

When you reject, do it the way [`design-standards.md`](design-standards.md)
prescribes:

> Light mode only — keeps every AgntUX plugin looking the same.

## Iteration loop

1. Build the view-tool and launch the renderer (only on the first
   iteration; for follow-ups, edit source + rebuild + reload the tab).
2. Ask: *"How does that look? Anything to change?"*
3. On feedback within the acceptable set, regenerate the source,
   re-run `npm run build` inside `view-tool/`, then reload the
   Chromium tab (Playwright `page.reload()`) so the new bundle takes
   effect.
4. On feedback outside the acceptable set, state the rule and move
   on (per [`design-standards.md`](design-standards.md)).
5. Loop until the user says "looks good", "ship it", or similar.
6. Confirm: *"Looking great. Saving this as the design — building
   the plugin around it now."*

Cap iterations at 5. If the user is still not happy at iteration 5,
ask gently:

> {Name}, we've gone five rounds — usually we land it by this point.
> Want to step back and tell me what's still feeling off, or are we
> close enough to call this a v0.1 and iterate after we see it
> against your real data?

## Multi-handler case

Stage 5 typically plans 1 handler for chat connectors and 4–5 for
project trackers. Design them sequentially — don't batch, the user
fatigues. Show handler 1, iterate to acceptance, then handler 2,
and so on. Acknowledge the work between each:

> One down — "{verb-1}" looks great. Next up: "{verb-2}".

For plugins with 4+ handlers, after handler 3 check in:

> Three down, {N-remaining} to go. Want a quick break, or keep
> rolling?

Don't push through user fatigue. A handler designed by an exhausted
contributor is worse than the same handler designed two hours
later.

## Screenshot emit at acceptance

Once the user confirms the design ("looks good", "ship it", or similar),
emit the first preview capture as `marketplace/screenshots/00-overview.png`
(1280×720) before closing the renderer:

```bash
# Playwright capture against the open renderer window
page.screenshot({
  path: "plugins/{slug}/marketplace/screenshots/00-overview.png",
  clip: { x: 0, y: 0, width: 1280, height: 720 }
})
```

If the capture fails for any reason (renderer not available, headless-only
host, or the plugin ships no UI handler), fall back to the scaffold script so
the screenshots directory is never empty and never contains a README.md:

```bash
node scripts/scaffold-marketplace-assets.mjs --slug {slug}
```

**Never write a `README.md` into `marketplace/screenshots/`** — it triggers
lint error E10. The scaffold script handles the placeholder correctly.

## Saved state at end of stage 6

```json
{
  ...,
  "ui_handlers": [
    {
      "name": "reply",
      ...,
      "preview_iterations": 3,
      "preview_accepted_at": "2026-05-08T...",
      "screenshot_path": "marketplace/screenshots/00-overview.png",
      "intercepted_payloads": [
        {"tool": "slack_send_message", "args": {"channel": "#general", "text": "..."}}
      ]
    }
  ]
}
```

Save the intercepted payload shapes so stage 12's submission body
can surface them to the AgntUX maintainers ("here are the envelopes
this plugin will emit").

## What you say to advance

> Great — designs are locked. Building the plugin around them now.
> This part takes a minute or two — the metadata, the sync prompt,
> the wiring around the action button(s). I'll show you a summary
> when it's done.

Then load [`07-build.md`](07-build.md).
