# Connector-targeted envelopes

The default write-back shape for any source plugin with a UI handler that
commits writes back to the source. This file is referenced by
`draft-flow-author.md` §1 (picking your authorisation gate),
`action-feedback.md` (the modern alternative to chat-confirm), and
`ui-handler-author.md` §6 (view tool wiring).

## When to use connector-targeted envelopes

Your plugin matches **all three** of:

1. The plugin ships a UI handler (a `ui-handlers/{name}/component/` tree
   with a Send-style commit button).
2. The user has a host-installed connector providing the source's write
   tools (e.g., Slack Connector, Linear Connector). Connector tools are
   typically prefixed with a per-instance UUID rather than the plugin slug.
3. The component's commit action posts a payload back to the source —
   sending a message, scheduling a reply, saving a draft, creating a
   canvas, transitioning an issue.

If any of those three is false, fall back to the legacy chat-confirm-then-
write flow (see `${CLAUDE_PLUGIN_ROOT}/skills/author/templates/draft-skill.md`)
or skip the write-back path entirely (read-only ingest plugins emit
suggested-action `host_prompt`s with `Open in {Source}` style buttons that
deep-link via the `url` field).

## There is no envelope-builder export — build the string by hand

Before you reach for an import: **no package exports a
`buildConnectorEnvelope` (or any other "envelope-builder") symbol — it does
not exist anywhere.** Treat it exactly like `StickyFooter` and
`SimpleMcpApp`: a hallucinated import the build gate will hard-fail on. The
connector envelope is a **hand-built string** assembled in a plugin-local
helper. The real pattern is agntux-slack's
`view-tool/src/apps/compose/lib/build-envelope.ts` — a per-plugin
`buildEnvelope()` that concatenates the prose instruction, the inline
arguments, and the guillemet-delimited body from current form state.
Don't import an envelope builder from `@agntux/ui-primitives`,
`@agntux/plugin-runtime`, or anywhere else; copy the agntux-slack
`build-envelope.ts` shape into your own `view-tool/src/.../lib/` and adapt
it. (The build runs `scripts/check-view-tool-imports.mjs` before vite and
will hard-fail on any import of a symbol exported by nothing.)

## The shape

A connector-targeted envelope is a natural-language instruction the host's
LLM executes verbatim. The envelope addresses the user's connector by
display name and instructs the host with `Use the {Source} Connector to …`,
followed by the required arguments inline, the body delimited by Unicode
guillemets, and (optionally) trailing metadata in parentheses.

The reference shape:

```
Use the {Source} Connector to {verb} a {Source} {object} as {qualifier}.
{required_field}: {value}, {required_field}: {value}.
{threading-or-mode-instruction}.
Body: «{user_text}». ({metadata})
```

Example (Slack reply, from agntux-slack 5.0.0+):

```
Use the Slack Connector to send a Slack message as a thread reply.
channel_id: C1234 (#general), thread_ts: 1714400000.000200.
Reply in-thread; if no thread exists yet on the parent message, this
reply will start one when posted.
Body: «{edited_body}». (action_id: {action_id})
```

Example (Slack scheduled message):

```
Use the Slack Connector to send a Slack message as a scheduled reply.
channel_id: C1234 (#general), thread_ts: 1714400000.000200,
send_at: 1714486400.
Reply in-thread; if no thread exists yet on the parent message, this
scheduled reply will start one when posted.
Body: «{edited_body}». (action_id: {action_id})
```

Example (Linear comment):

```
Use the Linear Connector to comment on a Linear issue.
issue_id: ENG-1234.
Body: «{edited_body}». (action_id: {action_id})
```

The connector-name capitalisation matches the host's connector display name
(`Slack Connector`, `Linear Connector`, `Gmail Connector`) — not the
underlying source slug. Hosts route by display name to the user's
authorised connector instance, which avoids the UUID-prefix problem that
made the older draft-skill chain fragile.

## Guillemet escaping for the body field

The body is delimited by Unicode `«` (U+00AB) and `»` (U+00BB). These are
chosen because they don't collide with normal punctuation in user prose and
because the host's parser can recover them unambiguously.

Literal `«` or `»` in the user-edited body are escaped by **doubling** —
`««` for a literal `«`, `»»` for a literal `»`. The host's parser reverses
the doubling on extraction:

| Author writes | On-the-wire | Host extracts |
|---|---|---|
| `Reply per discussion.` | `Body: «Reply per discussion.»` | `Reply per discussion.` |
| `Quote: «yes»` | `Body: «Quote: ««yes»»»` | `Quote: «yes»` |
| `Use the » glyph here.` | `Body: «Use the »» glyph here.»` | `Use the » glyph here.` |

The doubling rule applies **only** to the body field. Metadata fields
(`channel_id`, `thread_ts`, `send_at`, `action_id`) carry primitive values
that don't need escaping.

This replaces `inline()` / `block()` from `action-feedback.md` for the
connector-envelope shape — both are valid; pick by intent type:

- `inline()` / `block()` + `@key:value` sigils — for **observation-log
  envelopes** that prepend metadata to a per-plugin file (`drafts-sent.md`,
  `activity.md`). Sigils match the file's own schema.
- Guillemets — for **connector-targeted envelopes** that direct the host
  to call a connector with user-authored body content.

## Threading semantics

Make threading explicit in the envelope so the host doesn't have to infer.
The canonical Slack pattern:

```
Reply in-thread; if no thread exists yet on the parent message, this
reply will start one when posted.
```

The instruction is in plain prose because the host's LLM reads it. Encoding
threading as a flag (`thread_mode: in-thread-or-start`) loses the
connector's natural understanding of the verb. Other sources have
analogous instructions:

- Linear: omit threading; the connector's `comment` verb is always
  attached to the issue.
- Gmail: `Reply on this thread.` (Gmail's `gmail_send_message` accepts
  `threadId` directly; the threading is unambiguous when threadId is
  supplied.)
- Notion: `Comment on the page.` (Notion's discussion threads are
  attached to the page, not free-floating.)

## Discard is local

Discard does **not** round-trip. When the user clicks Discard in the iframe:

1. The component sets a local `discarded` flag in `useState`.
2. It replaces the form with a banner: `Discarded — no message was sent.
   The action item is still open.`
3. **No envelope is emitted** to chat. No `sendFollowUpMessage`, no
   `callTool`, no observation-log write.

The retired pattern (an envelope `ux: Use the {plugin-slug} plugin to
discard the draft for action {id}`) generated host-side noise for an
action that has no host-side state. The local-only behaviour is
indistinguishable to the user and avoids the round-trip.

If your plugin needs to track discards (analytics, training data), do it
inside the component via `widgetState` or a local storage hook — don't
re-route through the host.

## Two-step commits (the canvas pattern)

Some flows require the connector envelope to orchestrate **two** host calls
in sequence. The canvas pattern from agntux-slack:

```
Use the Slack Connector in two steps:
1. Create a Slack canvas titled «{canvas_title}» with body assembled from
   TL;DR «{tldr}», decisions «{decisions_json}», open_questions «{open_q_json}».
   Use slack_create_canvas.
2. Take the canvas URL returned by step 1 and post it as a thread reply in
   channel_id: {channel_id} ({channel_name}), thread_ts: {thread_ts},
   with body «{followup_body}» followed by the canvas URL formatted as a
   Slack mrkdwn link `<{canvas_url}|{canvas_title}>` — substitute
   {canvas_url} with the URL returned by step 1 and {canvas_title} with
   the unescaped canvas title (the same text passed to slack_create_canvas,
   with any «« or »» pairs collapsed back to single « or »). Reply
   in-thread; if no thread exists yet on the parent message, this reply
   will start one. Use slack_send_message. (action_id: {action_id})
```

Two-step envelopes are valid when the second step needs a value the first
step produces. Cap at two steps — three-step envelopes are an anti-pattern
(the host's LLM is asked to thread state through three tool calls in one
turn, which fails frequently). For longer chains, fold the orchestration
into a server-side tool that the connector exposes directly.

The placeholder substitution idiom (`{canvas_url}` filled by the host with
step 1's return) is the load-bearing trick. The component cannot precompute
the URL — only the host has it after step 1 succeeds. The envelope spells
out the substitution explicitly so the host doesn't have to infer the
intent.

## The iframe Send button is the authorisation gate

Clicking Send inside the iframe **is** the user's explicit authorisation
to write. The component's onClick handler:

1. Constructs the envelope from current form state.
2. Calls `client.sendFollowUpMessage(envelope)`.
3. Optimistically updates the UI (banner, status badge, opacity dimming).

There is **no chat round-trip** — the older "draft → chat-confirm →
yes/no/edit" pattern is retired for UI-handler plugins because the iframe
Send button is a stronger, more visible gate than a textual `yes` reply.
The user just authored the body in a focused form; clicking Send commits
that body verbatim with no interpretation step.

The hard rules from the orchestrator's "authorisation gate" contract still
apply:

- **No write call without an explicit user gesture.** Either the iframe's
  Send click (this pattern) or a chat `yes` (legacy chat-confirm pattern).
- **Show the exact payload.** The form already shows the body verbatim;
  don't transform it on commit. The envelope quotes the body using
  guillemets so the user-authored bytes survive round-trip.
- **Quote the original message above the draft.** In the iframe, the
  parent thread / source-side context renders above the body editor. The
  user reads the original alongside the draft they're about to send.
- **Never auto-pivot.** If the user changes verbs mid-flow (Send →
  Schedule), re-show the form in the new mode rather than firing a Send
  envelope with the schedule arguments.
- **Tone discipline.** The form is the only authoring surface. Don't
  wrap the user's body in additional copy at envelope-construction time.

## Anti-pattern: legacy `ux:` envelopes

The retired shape — emitted by older agntux-slack pre-5.0.0:

```
ux: Use the agntux-slack plugin to commit the drafted reply for action
{id} with body «...» (mode: ...)
```

These route to the retired `skills/draft/` flow, which has been removed
from agntux-slack 5.0.0+. **Don't emit envelopes addressing the
plugin-slug**; address the connector directly.

The mechanical difference:

| Retired | Current |
|---|---|
| `Use the agntux-slack plugin to commit…` | `Use the Slack Connector to send…` |
| Envelope routes to a chat-confirm draft skill | Envelope routes directly to the connector |
| channel_id, thread_ts read from disk by the skill | channel_id, thread_ts inline in the envelope |

## Anti-pattern: direct `callTool` to a connector tool

Do NOT dispatch the write by calling the connector tool directly from the
component:

```ts
// WRONG — connector tool names are host-specific, so a hard-coded literal
// throws "MCP error -32602: Tool not found" at click time.
await client.callTool("mcp__claude_ai_Google_Calendar__create_event", { … });
```

Connector tool names differ per host: UUID-prefixed in local agent mode
(`mcp__<uuid>__create_event`) and `mcp__claude_ai_<Connector>__create_event`
on claude.ai. A hard-coded literal matches neither reliably (this was the
agntux-google-calendar 2026-06 "Tool not found: create_event" bug). **Always
dispatch via `client.sendFollowUpMessage(envelope)`** and let the host's LLM
resolve the connector tool. This also covers connector *reads* whose result
must reach the iframe (e.g. "find available times"): the iframe cannot receive
a connector tool's return, so instruct the host to run the read and **re-open
the view pre-populated** instead of awaiting a `callTool` result. The only
tools a component may call directly are the plugin's own action-mutation
server tools (`mcp__agntux…`). Lint pass 17 (E32) enforces this.
| Send is gated by a chat `yes` turn | Send is gated by the iframe Send click |
| Three round-trips (button → skill → connector → ack) | One round-trip (button → connector) |

If you're migrating an older plugin, the migration recipe is in the
agntux-slack 5.0.0 CHANGELOG entry. The new flow eliminates the
intermediate skill and the disk read.

---

## See also

- `${CLAUDE_PLUGIN_ROOT}/canonical/prompts/agntux-core-hub-contract.md` §4
  — the two write-back patterns from the hub's perspective.
- `draft-flow-author.md` §1 — picking your authorisation gate
  (UI-handler vs chat-only).
- `action-feedback.md` — `inline()` / `block()` helpers and observation-log
  envelopes (the sigil pattern, distinct from this one).
- `ui-handler-author.md` §6 — view tool + ui-resources wiring; the view
  tool is what reads the action file's `## Compose payload` body section
  and pre-fills the form so the iframe Send envelope carries fresh data.
