# Design standards (non-negotiable)

These are the visual rules the orchestrator enforces during stages 5–8
(plan UI → design + preview → build → headless test). They are
**non-negotiable** — when the user pushes back, state the rule and
move on rather than relenting. Never volunteer them unprompted.

The reason is user-facing: every plugin in the AgntUX marketplace
shares the same look so users can move between them without
relearning. Dark mode, custom hex, custom typography, modal dialogs,
extra-large surfaces all break that.

## Mandatory

- **Light mode only.** No dark-mode toggle, no "auto" theme. The host
  passes a `theme: "light"` `hostContext` value at initialisation and
  the component honours it. The component MUST NOT read system
  `prefers-color-scheme`.
- **Design tokens, never raw hex.** Colours, spacing, radii, shadows,
  type scale all come from the shared CSS variables defined by the
  host's `hostContext.styles.variables`. Read
  [`canonical/prompts/ui/styling.md`](../../../canonical/prompts/ui/styling.md)
  for the full table.
- **The standard scaffold.** Every UI handler's component starts from
  `${CLAUDE_PLUGIN_ROOT}/canonical/ui-handlers/_template/component/`.
  Don't hand-write the iframe protocol — the scaffold's `SimpleMcpApp`
  does it.
- **One write button per UI.** The Send button is the authorisation
  gate (the iframe Send click is the explicit user gesture for any
  source-side write). One commit verb per component. If the user wants
  Send AND Schedule AND Save-draft, those are mode tabs above one Send
  button, not three buttons. See
  [`canonical/prompts/ui/connector-envelopes.md`](../../../canonical/prompts/ui/connector-envelopes.md).
- **Inline display mode by default.** `displayMode: "inline"` and
  `containerDimensions.maxHeight: 600` (the canonical AgntUX defaults).
  Fullscreen is reachable but not the default.
- **`ScrollablePanel`, never `ScrollableModal`.** Modals are
  forbidden in inline iframes — the host clips them. The canonical
  scaffold uses the non-modal `ScrollablePanel`. See
  [`canonical/prompts/ui/briefing-learnings.md`](../../../canonical/prompts/ui/briefing-learnings.md)
  §1.14 + §2.4.

## Forbidden

- Dark mode, custom themes, system theme detection.
- Custom hex codes, custom font families, custom type scales.
- Modal dialogs (`<dialog>`, `react-modal`, role="dialog" with
  position:fixed). Use `ScrollablePanel` instead.
- More than one commit button per UI.
- Raw HTML+CSS without the `_template/` scaffold's primitives.
- Reading `window.matchMedia("(prefers-color-scheme: dark)")` at
  runtime.
- Custom hotkey layers (cmd-k command palettes, custom keyboard
  shortcuts beyond Esc-to-close). The host owns hotkeys.
- Fire-and-poll patterns inside the component. Use the bridge's
  postMessage flow.

## What to do when the user pushes back

1. State the rule (light mode only / one Send button / no custom
   hex / etc.).
2. State the user-facing reason: "AgntUX plugins all share the same
   look so the people who use them don't have to relearn for each
   new system."
3. Move on. Don't qualify, don't apologise, don't relent.

If the user repeats the request a second time, stay polite but
firm: "I'll keep the standard look — that's a marketplace-wide
rule."

## Examples — common pushbacks

| User says | You say |
|---|---|
| "Can we make this dark mode?" | "Light only — keeps every AgntUX plugin looking the same." |
| "I want the brand colour as the button" | "Buttons use the standard AgntUX colour token so users see the same primary across plugins. I'll keep the token here." |
| "Send AND Schedule AND Save — three buttons" | "One commit button per UI. We can give Send / Schedule / Save mode tabs above one button — clearer for the user, same outcomes." |
| "Use Inter, not the system font" | "Type scale comes from the host. The font matches whatever the AgntUX desktop is using — no override here." |
| "A modal would be cleaner" | "Modals get clipped in the inline iframe. The canonical layout is `ScrollablePanel` — same scroll behaviour, no clipping." |

## Lift, don't reinvent

The canonical UI knowledge layer at
`${CLAUDE_PLUGIN_ROOT}/canonical/prompts/ui/` is 17 modules deep and
already encodes every load-bearing rule. During stage 6 (design +
preview) and stage 7 (build), `ui-handler-author` reads from there.
You — the orchestrator — don't need to know the specifics, just that
a deviation request is a non-negotiable redirect.
