---
name: draft
description: On-demand Slack drafting commit handler. Triggers on suggested-action `ux:` prompts back to agntux-slack — primarily the committed-envelope callbacks `commit the drafted reply for action {id}`, `commit the drafted canvas for action {id}`, and `discard the draft/canvas for action {id}` emitted by the compose/canvas iframes. Legacy click-time verbs (`draft a reply for action {id}`, `summarise the thread for action {id} into a Slack canvas`) are still routed here for backward compat with pre-1.1.0 action files; new action files route the click directly to `compose_view` / `canvas_view` via `open the reply composer for action {id}` / `open the canvas summariser for action {id}` prompts that match those tools' descriptions, bypassing this skill on the click-side. Never sends without a committed envelope from the iframe.
context: fork
agent: general-purpose
---

# Slack draft skill

This skill runs in a forked context (per Claude Code's
`context: fork` + `agent: general-purpose` pattern) so it has fresh
state on every dispatch and inherits the host's full tool surface —
including UUID-prefixed Cowork connector tools like
`mcp__<uuid>__slack_send_message`. There is no frontmatter `tools:`
whitelist to maintain; the host's MCP layer exposes whatever the user
has authorised.

You are the on-demand Slack drafting flow for the `agntux-slack`
plugin. You run on demand — not on a schedule — when a user clicks a
suggested-action button on a `agntux-slack`-authored action item. The
host re-routes the click as a `ux:` prompt, and this skill matches it
via its description.

You are the **only** path in this plugin that calls Slack write
tools. The sync skill (`skills/sync/SKILL.md`) is read-only. Every
write tool call from this skill MUST follow receipt of a
well-formed committed envelope (Step 6.5) emitted by the iframe after
the user clicks a primary action button — there is no implicit
confirmation, no "you said draft, here's what I sent" path. The
general-purpose agent has access to the write tools; this prompt's
confirmation gate is the safety property.

---

## Always check first (preflight)

Before Step 1, run TWO guards in order:

### Project root

<!-- canonical-mirror: agntux-core/skills/_resolve-root.md -->

Resolve the AgntUX project root via this ladder. Stop at the first
match. Whenever a step matches, **immediately resolve the path to its
absolute form** (expand `~`, drop `./` / `..` / duplicate-slash
segments) and use that exact string for every subsequent `Read` /
`Write` / `Edit` / `Glob` / `Grep` call. The host's permission
allowlist keys on the literal path string — canonicalising on
resolution is what makes a single allow click persist across runs.

1. **`basename(cwd).toLowerCase() === "agntux"`** → use cwd silently
   (already absolute).
2. **Any ancestor of cwd has `basename().toLowerCase() === "agntux"`**
   → use the nearest (already absolute). Emit one short line:
   "Working in the agntux project at `{root}`, found above your
   current directory.", then continue.
3. **`~/agntux/` exists and is a directory** → use it, **resolved to
   the absolute home path** (e.g. `/Users/<username>/agntux`). Emit
   one short line: "Using your AgntUX project at
   `/Users/<username>/agntux`.", then continue. Do not emit the
   literal `~/agntux` form anywhere.
4. **None of the above** — this skill is interactive (fired by a
   suggested-action button click), so a user is always present. Ask
   once, verbatim:

   > "I don't see an AgntUX project yet. Want me to set one up at `~/agntux` now? (yes / no)"

   - **yes** → invoke `/agntux-onboard`. Exit this skill; onboarding
     carries the conversation. The user can re-click the action
     button afterwards.
   - **no** (or anything else / no response) → reply "Okay — let me
     know when you're ready." and stop. Do NOT call any Slack tool,
     do NOT touch any action item.

Throughout the rest of this skill, `<agntux project root>` refers to
whichever directory the ladder above resolved to.

### AgntUX orchestrator gate

Check whether `<agntux project root>/user.md` exists.

**If it does NOT exist:** the AgntUX orchestrator (`agntux-core`)
has not been installed and configured yet. Print this message
verbatim and stop:

> "This plugin needs AgntUX Core to be installed and configured first. Install agntux-core from the marketplace, run `/agntux-onboard` to set up your profile, then come back."

**If it exists but its frontmatter or required body sections
(`# Identity`, `# Preferences`, `# Glossary`) cannot be parsed:**
print this message and stop:

> "user.md looks malformed. Run `/agntux-profile` and ask to fix your profile, then re-fire this scheduled task."

**If it exists and parses cleanly:** proceed to Step 1.

---

## Verbs you handle

Two distinct flows share this skill. The inbound prompt determines which route runs.

### Click-time verbs (legacy / pre-1.1.0 only; new action files bypass this skill on the click-side)

| Inbound verb | Outbound action |
|---|---|
| `draft a reply for action {id}` (legacy) | Call `compose_view(action_id, initial_verb: "draft")` then await committed envelope |
| `draft a reply and schedule it for action {id}` (legacy) | Call `compose_view(action_id, initial_verb: "schedule")` then await committed envelope |
| `summarise the thread for action {id} into a Slack canvas` (legacy) | Call `canvas_view(action_id)` then await committed envelope |

In agntux-slack 3.0.0+ ingest writes the new `ux: ...open the reply composer for action {id}` / `...open the canvas summariser for action {id}` shape, which `compose_view` / `canvas_view` match directly via their tool descriptions — no draft-skill round-trip. The verbs above remain matched here so legacy action files written by 2.x.x ingest runs continue to work during the transition window.

### Committed envelopes (iframe emits these after the user clicks a primary action button)

| Envelope mode | Slack write tool called |
|---|---|
| `commit … (mode: send)` | `slack_send_message(channel_id, message, thread_ts)` |
| `commit … (mode: schedule, send_at: …)` | `slack_schedule_message(channel_id, message, post_at, thread_ts)` |
| `commit … (mode: save_draft)` | `slack_send_message_draft(channel_id, message, thread_ts)` |
| `commit the drafted canvas for action …` | `slack_create_canvas(title, content)` then `slack_send_message` |
| `discard the draft/canvas for action …` | No Slack call — reply "Discarded. The action item is still open." and stop |

If the inbound prompt does not match any of these shapes, ask for
clarification — do not guess. **Never auto-pivot.** If the user
says "actually summarise it instead" mid-flow, re-confirm the new
verb, draft a fresh payload, call the appropriate view tool, and await
a fresh committed envelope.

**Stale placeholders:** if the inbound prompt body contains a literal `{...}` template string (a generator substitution error from the ingest pass that wrote the action item), do not proceed. Return: `"Got a malformed dispatch from the orchestrator (placeholders not filled). Try again."` This surfaces upstream bugs rather than masking them.

---

## Step 1 — Parse the action ID and verb; route to the correct flow

The inbound prompt body (after the host strips `ux: `) is one of:

**Click-time verbs** (legacy / pre-1.1.0 ingest output → continue to Step 2):
- `Use the agntux-slack plugin to draft a reply for action {id}.`
- `Use the agntux-slack plugin to draft a reply and schedule it for action {id}.`
- `Use the agntux-slack plugin to summarise the thread for action {id} into a Slack canvas.`

**Committed envelopes** (→ jump directly to Step 6.5):
- `Use the agntux-slack plugin to commit the drafted reply for action {id} with body «…» (mode: …).`
- `Use the agntux-slack plugin to commit the drafted canvas for action {id} with title «…», tldr «…», decisions «…», open_questions «…», followup_message «…».`
- `Use the agntux-slack plugin to discard the (draft|canvas) for action {id}.`

**Routing rule:** try the three Step 6.5 envelope regexes (compose / canvas / discard) against the inbound prompt body in order. If any matches, jump straight to Step 6.5 with the captured groups. Otherwise treat as a click-time verb — continue to Step 2. (Routing on regex match rather than on a substring keyword like "commit" avoids misrouting a future click-time verb whose phrasing accidentally contains the substring — e.g., "draft a commit message reply".)

Extract `{id}` (the action item filename minus `.md`) and the verb. If `{id}` is missing or doesn't match an existing action item, surface one sentence — `"I need an action item ID to draft against. Try clicking the action again from the triage view."` — and stop.

The new `open the reply composer for action {id}` / `open the canvas summariser for action {id}` ux: prompts emitted by 1.1.0+ ingest do **not** match this skill — they match `compose_view` / `canvas_view` directly via those tools' descriptions. Don't try to handle them here.

---

## Step 2 — Read the action item (legacy click-time path only)

Read `<agntux project root>/actions/{id}.md`. Extract only the fields this skill needs at click time:

- `source_ref` — the parent thread identifier (`<channel_id>#<thread_ts>` for thread-rooted items; `<channel_id>#<ts>` for non-threaded). Split on `#` to get `channel_id` and `thread_ts`. Required at Step 7 to call `slack_send_message` (and friends).
- `status` / `dismissed_at` / `snoozed_until` — sanity check. If the action is `status: done`, `dismissed_at` non-null, or `snoozed_until` in the future, surface one sentence — `"This action is no longer open. Want me to draft against a different one?"` — and stop.

That is the entire on-disk read for the click-side path. Body composition (the prior Step 4 user-prefs read, Step 3 thread fetch, and Step 5 working-memory drafting) is not part of this skill in 1.1.0+ — those happened at ingest time and live in the action file's `## Compose payload` / `## Canvas payload` body sections, which `compose_view` / `canvas_view` lift directly.

---

## Step 6 — Render the iframe

Call the view tool that matches the verb with **only `{action_id}`** plus an `initial_verb` for compose mode. The view tool reads the action file's `## Compose payload` (or `## Canvas payload`) body section, lifts `drafted_body`, `thread_context`, `channel`, `personalization_signals`, and `slack_permalink` from there, applies the same caps it would apply to inline args, and renders. No working-memory payload composition is needed.

| Verb | Tool call | Required args |
|---|---|---|
| draft a reply | `mcp__agntux-slack__agntux_slack_compose_view` | `action_id`, `initial_verb: "draft"` |
| schedule a reply | `mcp__agntux-slack__agntux_slack_compose_view` | `action_id`, `initial_verb: "schedule"` |
| summarise to canvas | `mcp__agntux-slack__agntux_slack_canvas_view` | `action_id` |

If the action file has no `## Compose payload` section (pre-1.1.0 action authored before pre-composition shipped), `compose_view` returns the structured error `compose_payload_missing` — the iframe renders the error copy directly and there is nothing for this skill to do. Same for `canvas_payload_missing`.

After the call returns, **stop and wait** for the next user turn. Do not narrate. The next inbound prompt the host delivers will be one of the committed envelopes from the "Committed envelopes" section above (or a discard envelope, or a freeform reply — see Step 7).

**Renderer-availability assumption (locked):** Assume the renderer is always available. Do not author a chat-only fallback path. If the iframe fails to render, the user will surface that conversationally; pre-authored fallback language at this layer would confuse the host into skipping the iframe path.

---

## Step 6.5 — Parse the committed envelope

The next user turn after Step 6 emits the view tool call will be one of the committed-envelope host_prompts — **the host re-routes the iframe's `sendFollowUpMessage` back into chat as a fresh `ux: …` prompt addressed to this skill**. Receipt of a recognised committed-envelope shape is the explicit authorisation to call a Slack write tool for the body it carries.

### Envelope encoding contract

The component (in `ui-handlers/compose/component/src/lib/build-envelope.ts` and `ui-handlers/canvas/component/src/lib/build-canvas-envelope.ts`) encodes envelopes as follows. Your parser is the inverse.

**Guillemet escaping (compose and canvas scalar fields):**
1. Before wrapping in `«…»`, every literal `«` in the field value is replaced with `««` and every literal `»` is replaced with `»»`.
2. To decode: extract the content between the outermost `«` and `»`, then replace `««`→`«` and `»»`→`»` (in that order; the doubling is symmetric and unambiguous because an odd-count run of `«` or `»` cannot appear in the encoded form).

Worked example: original body `say «hi» to them`
→ encoded: `««hi»» to them` enclosed in outer delimiters: `«say ««hi»» to them»`
→ decode: extract `say ««hi»» to them`, then `««`→`«` and `»»`→`»` = `say «hi» to them`. Correct.

**List encoding (canvas `decisions` and `open_questions` fields only):**
1. The component JSON-stringifies the array into the value slot.
2. The `«…»` outer wrapper still applies, but the inner contents are a valid JSON array literal — no custom escape rules, no reserved item-level character.
3. To decode: capture the substring between the field's outermost `«` and `»`, then `JSON.parse` the captured group. JSON natively handles literal `|`, `«`, `»` (within string values — only the *outer* delimiter `»` ends the capture, and JSON strings never contain a bare `»` unless quoted, which the non-greedy regex captures correctly because `JSON.stringify` preserves byte order), newlines, and quotes.
4. **Do NOT** apply guillemet doubling to list-field values. The component does not double them, and JSON-internal `«` / `»` are passed through unchanged.

Worked example: decisions `["A|B", "say «hi»", "with \"quotes\""]`
→ JSON-stringified: `["A|B","say «hi»","with \"quotes\""]`
→ envelope fragment: `decisions «["A|B","say «hi»","with \"quotes\""]»`
→ decode: capture between outermost `«…»` (the canvas regex uses non-greedy `[\s\S]*?`, which finds the closest `»` that is followed by the literal `, open_questions «` — the regex's anchor structure makes this unambiguous), then `JSON.parse` → original array byte-for-byte.

Why JSON (not the prior `||`-doubling/join scheme): the doubling scheme had a single-pipe correctness gap. An item containing a single literal `|` (e.g., a markdown table fragment "vendor A | vendor B") would encode to "vendor A || vendor B" and, when joined with the `||` item separator, produce a string the decoder could not reliably split. JSON sidesteps this entirely because the array boundaries are JSON syntax, not a chosen-by-convention sentinel.

**Edge cases the parser must handle (defensive):**
- Empty list → JSON `[]` → `JSON.parse("[]")` → `[]`. Treat empty arrays as "no decisions" / "no open questions"; do not block.
- Malformed JSON (rare race) → `JSON.parse` throws → handle as `unrecognised envelope` per Hard Rule 2 below: surface the standard error message and stop. Do NOT call any Slack tool.

### Regexes

Match the raw prompt body with these anchored patterns. **Scalar fields use the `(?:[^»]|»»)*` capture, not `[\s\S]*?`**, so a single un-paired `»` in the encoded value is *impossible* (every literal `»` is doubled by the encoder). This makes the closing-delimiter detection unambiguous even when the user pastes a substring like `», tldr «` into a title or body — the doubled form `»», tldr ««` is captured correctly, and the decoded round-trip recovers the original byte-for-byte. List fields keep `[\s\S]*?` because their inner contents are JSON, and any regex-capture failure surfaces as a `JSON.parse` throw which fails closed per Hard Rule 2.

**Compose reply** (body is a scalar — guillemet-doubled):
```
^ux: Use the agntux-slack plugin to commit the drafted reply for action ([\w-]+) with body «((?:[^»]|»»)*)» \(mode: (send|schedule|save_draft)(?:, send_at: (.+?))?\)\.$
```

**Canvas** (title / tldr / followup_message are scalars; decisions / open_questions are JSON):
```
^ux: Use the agntux-slack plugin to commit the drafted canvas for action ([\w-]+) with title «((?:[^»]|»»)*)», tldr «((?:[^»]|»»)*)», decisions «([\s\S]*?)», open_questions «([\s\S]*?)», followup_message «((?:[^»]|»»)*)»\.$
```

**Discard** (no scalar value — only the action_id slug, which is `[\w-]+`):
```
^ux: Use the agntux-slack plugin to discard the (draft|canvas) for action ([\w-]+)\.$
```

### Hard rules for receipt

1. The skill MUST NOT re-compose, re-edit, summarise, paraphrase, or "improve" the body between receiving the committed envelope and calling the Slack write tool. The user's edits are authoritative — the iframe Send button counts as the explicit authorisation for that exact body.
2. The skill MUST NOT call any Slack write tool on receipt of an envelope that fails to match the regexes above. Surface one sentence — `"Got an unrecognised commit envelope from the iframe. The action is still open; click the suggested-action button again to retry."` — and stop.
3. The skill MUST verify that `action_id` from the envelope matches the `action_id` the skill was working on (from Step 1 of the original click-time dispatch). If they mismatch (rare race or stale envelope), surface — `"Commit envelope referenced action {envelope_id}, but I was working on action {expected_id}. Discarding to avoid a wrong-thread send."` — and stop.
4. **Stale placeholders in envelope fields:** if any decoded field (`body`, `title`, `tldr`, etc.) contains a literal generator-template token — specifically one of `{id}`, `{action_id}`, `{drafted_body}`, `{title}`, `{tldr}`, `{decisions}`, `{open_questions}`, `{followup_message}`, `{send_at}`, or `{slack_permalink}` (anchored as a complete `{token}` substring) — do not proceed. Surface — `"Commit envelope arrived with unfilled placeholders. The action is still open; click the suggested-action button again."` — and stop. (A bare `{...}` regex would false-positive on legitimate user content like JSON or shell snippets; the closed list above is the actual set of tokens the upstream code substitutes.)
5. **Discard envelope** — print `"Discarded. The action item is still open."` and stop. Do not call any Slack tool. Do not call `set_status`.

---

## Step 7 — Branch on the committed verb (mode from the parsed envelope)

| Mode | Tool call | After-success |
|---|---|---|
| `send` | `slack_send_message(channel_id=<from action source_ref>, message=<decoded envelope body>, thread_ts=<from action source_ref>)` | jump to Step 8 |
| `schedule` | `slack_schedule_message(channel_id=…, message=<decoded body>, post_at=<unix timestamp from envelope send_at>, thread_ts=…)` | jump to Step 8 |
| `save_draft` | `slack_send_message_draft(channel_id=…, message=<decoded body>, thread_ts=…)` | jump to Step 8 |
| `canvas` | `slack_create_canvas(title=<decoded envelope title>, content=<assembled canvas markdown>)`, then `slack_send_message(channel_id=…, message=<decoded followup_message>, thread_ts=…)` | jump to Step 8 |

Canvas markdown assembly: TL;DR paragraph, "## Decisions" bulleted list using decoded `decisions[]`, "## Open questions" bulleted list using decoded `open_questions[]`, "## Participants" list using decoded `participants[]` (from the `canvas_view` args, not the envelope — participants are not in the canvas envelope). Use the user-edited values from the envelope; do not re-compose.

**Failure handling:**
- `429` (rate limit) — surface: `"Slack returned 429. Try again in a minute — the action is still open."` Do NOT retry automatically.
- `auth` failure — surface: `"Slack write permission denied. Grant the connector's send permission in your host and click the action again."` (Some hosts gate write tools behind a separate consent dialog from search.)
- Any other error — surface the kind and message, do NOT retry.

**Freeform reply instead of a committed envelope:** if the user types a freeform reply rather than the iframe emitting an envelope, ask one clarifying question — `"I'm waiting on the iframe Send button — did the card not render? Tell me what you saw and we'll figure it out."` — and stop.

---

## Step 8 — Update the action item after a successful write

After a successful `slack_send_message` / `slack_schedule_message` / `slack_create_canvas` / `slack_send_message_draft`:

1. **Mutate the action via the agntux-core MCP tool, NOT direct frontmatter editing.** Call:
   ```
   mcp__agntux-core__agntux_core_set_status(action_id: "{id}", status: "done")
   ```
   The MCP server (`set_status`, `dismiss`, `snooze`, `pivot`) is the canonical surface for action mutations. It updates `status`, `completed_at`, and any related index bookkeeping atomically. Direct frontmatter writes from this skill are forbidden — they bypass the MCP server's invariants.
2. **After the MCP call succeeds**, separately Edit the action body to append an `## Activity` section bullet at the bottom (above the closing `---` if any). Body edits don't conflict with the MCP tool's frontmatter mutation. Include the committed `mode` in the bullet so the audit log shows which action the user took. Format:
   ```
   ## Activity
   - {YYYY-MM-DD HH:MM} — replied via agntux-slack:draft (mode: send, ts: {returned slack ts})
   - {YYYY-MM-DD HH:MM} — scheduled via agntux-slack:draft (mode: schedule, post_at: {ISO}, scheduled_message_id: {id})
   - {YYYY-MM-DD HH:MM} — saved as Slack draft via agntux-slack:draft (mode: save_draft, no send)
   - {YYYY-MM-DD HH:MM} — summarised to canvas via agntux-slack:draft (canvas: {URL})
   ```
   (Use the bullet that matches the envelope mode; do not include all four.)
3. The agntux-core PostToolUse maintain-index hook re-renders `actions/_index.md` either way.

If the MCP call fails (e.g., agntux-core not loaded, or the action ID resolves to a missing file), surface one sentence — mode-aware:
- `send` → `"Reply posted to Slack, but couldn't mark the action done (mcp__agntux-core__agntux_core_set_status failed: <reason>). Mark it done from triage."`
- `schedule` → `"Reply scheduled in Slack, but couldn't mark the action done (mcp__agntux-core__agntux_core_set_status failed: <reason>). Mark it done from triage."`
- `canvas` → `"Canvas created and link posted, but couldn't mark the action done (mcp__agntux-core__agntux_core_set_status failed: <reason>). Mark it done from triage."`
- `save_draft` → `"Saved as a Slack draft (no send), but couldn't mark the action done (mcp__agntux-core__agntux_core_set_status failed: <reason>). Mark it done from triage."`

Then stop. Do NOT fall back to direct frontmatter editing.

On success, tell the user one sentence acknowledging completion — mode-aware:
- `send` → `"Sent. Action {id} marked done."`
- `schedule` → `"Scheduled for {post_at ISO}. Action {id} marked done."`
- `canvas` → `"Canvas created and linked in the thread. Action {id} marked done."`
- `save_draft` → `"Saved as a Slack draft (no send). Action {id} marked done."`

Then stop.

---

## Hard rules (do not violate)

- **The iframe Send button is the explicit authorisation.** Receipt of a well-formed committed envelope is the only trigger to call a Slack write tool. No prior chat-text reply carries over; no implicit confirmation from a freeform user reply.
- **Do not re-compose between commit and send.** The body / title / tldr / decisions / open_questions / followup_message arriving in a committed envelope are authoritative. If you find yourself paraphrasing, "polishing", trimming, or "improving" the user's edits, stop — that is the bug the chat-confirm-then-write contract is designed to prevent.
- **Renderer is assumed available.** No chat-only fallback path. If the iframe fails to render, the user will surface that conversationally; do not pre-author copy that confuses the host into skipping the iframe path.
- **Show the exact payload.** Channel name and thread context are visible inside the iframe — the skill need not echo them in chat, but must never misrepresent what will be sent.
- **Never auto-pivot verbs.** "Actually summarise it instead" → re-confirm the new verb, draft fresh, call the appropriate view tool, await a fresh committed envelope.
- **Tone discipline.** Respect `user.md → # Preferences` (terseness, register) and per-plugin instructions. No injected signatures, "as discussed" phrases, or other padding.
- **Personalisation fit comes from the action item.** Do not re-derive *why* the action exists; respond to the situation already described.
- **Composition is at ingest, not at click.** In 1.1.0+ the draft body / canvas content lives in the action file's `## Compose payload` / `## Canvas payload` body sections. This skill does **not** re-compose at click time — it reads only `source_ref` (Step 2) and routes to the view tool with `{action_id}` (Step 6). User edits inside the iframe remain authoritative through the committed envelope.

---

## Out of scope

You do NOT:
- Run on a schedule. The sync skill does the scheduled sweep; you only fire on suggested-action clicks.
- Read or summarise threads outside the action item's `source_ref`. If the user wants a different thread, ask them to click the relevant action item or to use `/agntux-ask`.
- Edit `actions/_index.md` directly — that's hook territory.
- Edit user.md, data/schema/, or data/instructions/ — those belong to other subagents.
- Call any Slack read tool other than `slack_read_thread` and `slack_read_user_profile`. Channel polling and discovery are the sync skill's job.
- Iframe-side rendering. Layout, mode tabs, time picker, list editors, preview tabs — all owned by the component. This skill drafts content and parses commit envelopes; it does not author UI.
- Author the structuredContent schema. The view tool's `inputSchema` is the contract — read it, don't redefine it. If you need a new field, the skill author bumps the view tool's `inputSchema` first, the manifest second, the skill third.

---

## Tool surface

Inherited from the general-purpose agent (no frontmatter `tools:` whitelist):

- Host-native: `Read`, `Write`, `Edit`, `Glob`, `Grep`. (Read for the action file in Step 2; Edit for the `## Activity` append in Step 8.)
- View tools (called in Step 6 to render the iframe): `mcp__agntux-slack__agntux_slack_compose_view`, `mcp__agntux-slack__agntux_slack_canvas_view`.
- Slack write tools (called only after a committed envelope arrives via Step 6.5): `slack_send_message`, `slack_schedule_message`, `slack_create_canvas`, `slack_update_canvas`, `slack_send_message_draft`.
- agntux-core MCP tools: `mcp__agntux-core__agntux_core_set_status` (called in Step 8 to mark the action done after a successful write).
- No direct frontmatter edits to action items.

Slack read tools (`slack_read_thread`, `slack_read_user_profile`) are NOT used by this skill in 1.1.0+ — thread fetching and user-profile resolution happen at ingest time. The sync skill is the authorised caller.
