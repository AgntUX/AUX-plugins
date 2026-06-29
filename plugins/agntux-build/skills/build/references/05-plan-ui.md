# Stage 5 — plan the action buttons

The "action buttons" are the write-capable UI handlers the plugin
ships. When AgntUX surfaces an action item from the new connector
into triage, the host's ingest LLM picks **one** suggested-action
button from the handlers your plugin makes available — clicking it
opens an inline iframe with a pre-composed draft, an editable form,
and a Send button that's the explicit authorisation gate for the
source-side write.

The default is **one handler per meaningful write verb identified
in stage 4** — typically 1 for chat (`reply`), 4–5 for project
trackers (`comment`, `transition`, `assign`, `edit description`,
`set priority`). Goal: the user can complete their everyday work
in this connector without bouncing back to the source app.

**Plan for any user, not just this contributor.** The handler set,
the verb phrasing, and the screen must render for any user's source
context — don't bake in assumptions from the contributor's own
workspace, naming, or data shape. The source context the iframe quotes
(thread, issue, message) is whatever the host hands the handler at
render time; keep it generic.

## Read-only sources

If `primary_write_verbs` is empty (stage 4), there's no UI handler.
Skip this whole stage and go to stage 6 — but stage 6 also becomes
a no-op (no preview to design). Move directly to
[`07-build.md`](07-build.md). Tell the user:

> Since {connector-display-name} doesn't have a way to act back,
> there's no action button to design — action items will just have
> "Open in {connector-display-name}." That's set. Building now.

## Sources with multiple write verbs (the common case)

Stage 4 saved an array of verbs. Each gets its own UI handler.
Frame each in user terms:

| Verb (saved) | Component name | Verb phrase (user-facing) |
|---|---|---|
| `create_comment` | `comment` | "comment on the issue" |
| `transition_state` | `transition` | "move the issue to a new state" |
| `assign_user` | `assign` | "assign the issue to someone" |
| `edit_description` | `edit` | "edit the issue description" |
| `set_priority` | `priority` | "set priority or labels" |
| `send_message` | `reply` | "send a reply" |

For each handler to be valid:

- It MUST map to exactly one connector write tool.
- It MUST quote the user's source-side context above the editor (the
  thread / issue / message they're acting on).
- It MUST commit via the iframe Send click — not via a chat
  round-trip.

## When inputs collapse, collapse to tabs

If two verbs take the **same input shape** (e.g., "reply" vs
"reply scheduled" — both need the body of a message), collapse to
mode tabs above one Send button instead of two handlers.

If two verbs take **genuinely different inputs** (comment text vs
transition state picker), ship two handlers.

That's the only collapse rule. There is no cap on handler count —
ship whatever the connector's verbs warrant.

## "Open in <source>" is always secondary

Every UI handler's iframe ships an `Open ↗` link in the header
pointing at the source-side context (the issue URL, thread
permalink, etc.) — same convention as `agntux-slack` and
`agntux-gmail`. It's a small text link, not a button, and never
a top-level suggested-action button. The host LLM picks
suggested actions per action item from the in-host handlers;
"Open in <source>" lives inside the iframe chrome the user sees
after clicking one of those handlers, never alongside them.

## One button per action — no "more" menus

AgntUX's suggested-action UX is one button per action, chosen by
the host's ingest LLM based on what fits the action item. We do
NOT bundle multiple actions behind a "more" affordance — that
pushes the choice onto the user. Every UI handler the plugin
ships is an *option* the host LLM can surface; the plugin
doesn't decide which renders for any given action item. If you
ship five handlers, the host picks one of those five per action
item; the user sees one button.

## A backing view tool means a MANDATORY view hand-off

Any skill lane or model hand-off that presents data which **has a
backing view tool** (a render tool the plugin ships) must instruct the
model with MANDATORY language, not soft prose. The instruction must:

1. **Name the exact view-tool id** — the literal
   `agntux_<slug>_<name>` id, never a description like "the schedule
   view" or "the results view".
2. **Explicitly forbid answering in plain text** / a chat summary —
   even for a single result, even for a case that feels "simple."

Canonical phrasing pattern:

> You MUST call `agntux_<slug>_<name>` with <data>. Do NOT
> list/summarise the results as text — the view is the only correct
> surface.

Soft phrasing ("re-open the schedule view with the results",
"consider showing the times") lets the model treat the call as optional
and reply with a plain-text list instead — that is the
agntux-google-calendar time-slot bug, where the view never opened and
the model dumped times into chat. Whenever a lane presents data that a
view tool renders, write the hand-off as a hard requirement naming the
exact tool id.

## Plan the structuredContent (internal)

Internally (silent to user), `ui-handler-author` will design the
`structuredContent` schema for each view tool — the typed shape the
component receives at render time. You don't need to surface this
to the user. Save the planned shape in the session file:

```json
{
  ...,
  "ui_handlers": [
    {
      "name": "comment",
      "verb_phrase": "comment on the issue",
      "primary_write_tool": "mcp__claude_ai_Jira__create_comment",
      "structured_content_keys": ["issue_url", "issue_key", "issue_title", "draft_body", "personalization_signals"]
    },
    {
      "name": "transition",
      "verb_phrase": "move the issue to a new state",
      "primary_write_tool": "mcp__claude_ai_Jira__transition_issue",
      "structured_content_keys": ["issue_url", "issue_key", "current_state", "available_transitions"]
    },
    {
      "name": "assign",
      "verb_phrase": "assign the issue to someone",
      "primary_write_tool": "mcp__claude_ai_Jira__assign_issue",
      "structured_content_keys": ["issue_url", "issue_key", "current_assignee", "candidate_assignees"]
    },
    {
      "name": "edit",
      "verb_phrase": "edit the issue description",
      "primary_write_tool": "mcp__claude_ai_Jira__update_issue",
      "structured_content_keys": ["issue_url", "issue_key", "current_description", "draft_description"]
    }
  ]
}
```

## Show the design as an HTML prototype — never ASCII

When you present the planned UI to the contributor (a wireframe of each action
button's screen, or any layout sketch), render it as an **HTML prototype that
Cowork displays inline** — not as an ASCII/text drawing. Cowork renders HTML
artifacts inline natively, and an HTML wireframe is far easier for a
non-technical contributor to read and react to than a text box-drawing.

- Emit a small self-contained HTML mock (light mode, the standard AgntUX design
  tokens) for each handler's screen and let Cowork show it inline.
- **NEVER** present the design as ASCII art, box-drawing characters, or a
  plain-text layout description. If you catch yourself sketching the UI in text,
  stop and emit HTML instead.
- This is the pre-build wireframe; stage 6 then builds the real component and
  previews it live in a Chromium window. Both are HTML — the contributor never
  sees a text mockup of the UI.

## What you say to advance

> Got it — {N} buttons: {comma-list of verb phrases}. I'll put together a quick
> HTML wireframe of each one so you can see the layout, and we'll iterate
> together until each feels right.

Then load [`06-design-and-preview.md`](06-design-and-preview.md).

## What to watch for

- User asks for dark mode → redirect per
  [`design-standards.md`](design-standards.md).
- User asks for a non-standard layout → redirect.
- User wants to surface raw connector data verbatim → no, the
  component shows the user's source context (a quoted message, a
  rendered issue card) plus an editable body. Raw JSON is forbidden.
- User wants to skip the editor and "just send" → no, the editable
  form is the authorisation gate. The Send click is what makes the
  write authorised.
- User asks for a "more" menu / overflow affordance to bundle
  several actions → no. AgntUX surfaces one suggested-action
  button per action item; if the source has more verbs, ship more
  handlers and let the host LLM pick.
