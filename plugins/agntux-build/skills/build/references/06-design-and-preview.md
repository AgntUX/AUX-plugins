# Stage 6 — design and preview

For each UI handler from stage 5, we now scaffold the component and
preview it inline. The user sees a real rendered iframe; they don't
see internal stage names or scaffold filenames.

## What happens internally (silent)

You — the orchestrator — dispatch `ui-handler-author` (one of the
internal specialists) with the planned UI handler shape. The
specialist:

1. Reads the canonical UI knowledge layer at
   `${CLAUDE_PLUGIN_ROOT}/canonical/prompts/ui/`.
2. Generates the component scaffold from
   `${CLAUDE_PLUGIN_ROOT}/canonical/ui-handlers/_template/component/`,
   substituting `{{plugin-slug}}`, `{{ui-name}}`,
   `{{verb-phrases}}`, `{{structured-content-schema}}`.
3. Writes the handler manifest, view tool stub, and ui-resources
   fragment into the working `agntux-{slug}/` tree.
4. Returns the rendered HTML for the preview.

You don't tell the user any of this. You just show the result.

## How the preview works

Use the host's preview tool. Resolve via `ToolSearch`:
`mcp__claude_preview__preview_start` is the typical name. It renders
HTML inline in the chat surface — no setup, no extra terminal.

```
{
  "type": "html",
  "html": "<inline preview HTML from the scaffold>"
}
```

The preview shows the iframe with realistic mock data:

- An action item card on top with mock source context (quoted
  message, issue title, etc.).
- The editable body pre-filled with a draft (a real-feeling 3-line
  message based on the action item).
- Mode tabs above the Send button (Send / Schedule / Save draft —
  for the chat-style verbs; just Send for issue-state verbs).
- The Send button bottom-right.

The user sees this rendered. They iterate by saying things like
"can the title be smaller", "make the draft area taller", "add a
'Cancel' button".

## What you accept and don't accept

### ✅ Accept and apply

- Copy changes (button labels, helper text, placeholder text).
- Layout tweaks within the canonical primitives (more or less
  vertical space between the source context and the editor).
- Adding a single optional helper line below the editor (e.g.,
  "tone preferences from your profile applied").

### ❌ Reject (redirect to issues)

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
> If something feels broken about that, the issues page is the
> right place: `https://github.com/AgntUX/AUX-plugins/issues`.

## Iteration loop

1. Show the preview.
2. Ask: *"How does that look? Anything to change?"*
3. On feedback within the acceptable set, regenerate the preview
   with the change applied.
4. On feedback outside, redirect to issues.
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
      "final_html_preview_path": ".agntux-build/sessions/{id}/preview-reply.html"
    }
  ]
}
```

Save the final preview HTML so stage 8's headless test can compare
against it.

## What you say to advance

> Great — designs are locked. Building the plugin around them now.
> This part takes a minute or two — the metadata, the sync prompt,
> the wiring around the action button(s). I'll show you a summary
> when it's done.

Then load [`07-build.md`](07-build.md).
