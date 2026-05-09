# Stage 5 — plan the action button

The "action button" is the single write-capable UI handler the plugin
ships. When AgntUX surfaces an action item from the new connector
into triage, the user sees a Send-style button. Clicking it opens an
inline iframe with a pre-composed draft, an editable form, and a
Send button that's the explicit authorisation gate for the source-
side write.

The default is **one UI handler**. Sometimes two. Push back politely
on more than two — additional UIs split user attention and rarely
add value.

## Read-only sources

If `primary_write_verb` is null (stage 4), there's no UI handler.
Skip this whole stage and go to stage 6 — but stage 6 also becomes a
no-op (no preview to design). Move directly to
[`07-build.md`](07-build.md). Tell the user:

> Since {connector-display-name} doesn't have a way to act back,
> there's no action button to design — action items will just have
> "Open in {connector-display-name}." That's set. Building now.

## Sources with a single write verb

The common case. The UI handler wraps the verb. Frame it in user
terms, not connector terms:

> When AgntUX surfaces an action item from
> {connector-display-name}, what's the one button the user should
> press?

The user's answer maps to a verb. Examples:

| User says | Component name | Verb phrase |
|---|---|---|
| "Reply" | `reply` | "send a reply" |
| "Comment" | `comment` | "comment on the issue" |
| "Mark done" | `done` | "mark the issue done" |
| "Transition state" | `transition` | "move the issue to a new state" |

For the action verb to be valid:

- It MUST map to exactly one connector write tool.
- It MUST quote the user's source-side context above the editor (the
  thread / issue / message they're acting on).
- It MUST commit via the iframe Send click — not via a chat
  round-trip.

## Sources with multiple write verbs (the two-UI case)

If the user names two different actions ("reply, AND mark done as a
separate button"), confirm the split:

> Two buttons, then — one for "reply" and one for "mark done"?
>
> Just to flag: in AgntUX, the convention is one main button per
> action item, with extra modes (Reply / Schedule / Save draft) as
> tabs above one Send button when they take the same input. Here
> "Reply" needs the body of a message and "Mark done" doesn't, so
> a separate button is the right call.
>
> Confirming: two UIs — `reply` and `done`.

Save both component names. Stage 6 will design and preview both.

## More than two verbs

Push back politely:

> That's a lot of buttons. AgntUX action items work best when
> there's one main thing to do — the user gets a clear signal of
> "this is what's expected of me."
>
> Want to pick the one that comes up most, and we add the others
> later if they really feel needed?

Don't relent on this rule unless the user really pushes back AND
the verbs really are equally critical AND they take genuinely
different inputs. In that case, three is the absolute max — never
four.

## Plan the structuredContent (internal)

Internally (silent to user), `ui-handler-author` will design the
`structuredContent` schema for the view tool — the typed shape the
component receives at render time. You don't need to surface this to
the user. Save the planned shape in the session file:

```json
{
  ...,
  "ui_handlers": [
    {
      "name": "reply",
      "verb_phrase": "send a reply",
      "primary_write_tool": "mcp__claude_ai_Linear__create_comment",
      "structured_content_keys": ["issue_url", "issue_title", "draft_body", "personalization_signals"]
    }
  ]
}
```

## What you say to advance

> Got it — one button: "{user-verb}". I'll mock up the UI and we'll
> iterate together until it feels right. Heads up: I'll only do
> light mode and the standard AgntUX colours — keeps every plugin
> looking like part of the same product. If something feels off
> about that, the issues page is the place to flag it.

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
