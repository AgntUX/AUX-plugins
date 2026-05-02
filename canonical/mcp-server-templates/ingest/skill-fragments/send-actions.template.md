<!--
SKILL FRAGMENT: Send actions
============================
This file is a reusable prose fragment for inclusion in a per-source plugin's
SKILL.md under a "## Send actions" section. Copy this block into the plugin's
orchestrator.md (skills/orchestrator.md) and substitute:

  {{plugin-slug}}            — e.g., slack-ingest
  {{source-display-name}}    — e.g., Slack
  {{ui-name}}                — e.g., thread
  {{send-mcp-tool}}          — e.g., mcp__slack__post_message

The worked example below uses Slack reply-to-thread as the canonical reference
(P9 §8.3). Every other plugin copies this pattern with source-specific verbs.

Verb categories from P9 §7.2:
  send-thread-reply       (Slack, Gmail)          — D-1 / DR-3 verbs
  send-channel-message    (Slack variant)          — DR-6 verb
  send-email              (Gmail)                  — DR-1 verb
  send-email-reply        (Gmail)                  — DR-3 verb
  transition-ticket       (Jira, Linear)           — M-1 verb
  comment-on-ticket       (Jira, HubSpot)          — DR-2 verb
  transition-deal         (HubSpot)                — M-1 verb
  mark-channel-summary-read (Slack)                — no source call; file edit only
-->

## Send actions

Every state-mutating action initiated by an action-UI component reaches this skill
as a `ui/message` JSON-RPC call (i.e., `useAppsClient().sendFollowUpMessage(text)`).
The text is a structured natural-language intent. This section teaches the host how to
fulfill each intent.

There are no plugin-side send tools on the local stdio MCP server. All mutations route
through the host's main loop and the source MCP (P9 D3).

---

### intent-key:send-thread-reply

**Canonical example: Slack reply-to-thread**

When you receive a `ui/message` whose first line matches:

  User confirmed sending this Slack reply to thread {thread_ts} in channel {channel_id}

Steps:

1. Extract `thread_ts`, `channel_id`, the reply text (between the `---` fences),
   and `action_id` from the intent body.
2. Call `mcp__slack__post_message({ channel: <channel_id>, thread_ts: <thread_ts>, text: <reply text> })`.
3. From the response, capture `{ ts, permalink }`.
4. If the post failed (HTTP error, rate limit, channel archived), surface a one-line
   message to the user: "Couldn't send Slack reply: <reason>. The action item is
   unchanged." Do not edit the file. STOP.
5. Edit `<agntux project root>/actions/{action_id}.md`:
   - Frontmatter: set `status: done` and `completed_at: <ISO now>`. Leave all other
     fields untouched.
   - Body: append a new `## Resolution log` section if it does not exist; append
     a single bullet line:
     ```
     - <ISO now> — Sent reply via slack. permalink: <permalink>
     ```
6. After the file write succeeds, return no further tool calls and no assistant text.
   The PostToolUse index hook handles `_index.md` propagation automatically (P4 §7).

**Component-side intent body template (for reference; not substituted at SKILL.md level):**

```
User confirmed sending this Slack reply to thread {thread_ts} in channel {channel_id} (#{channel_name}):
---
{final reply text}
---
After posting via mcp__slack__post_message succeeds, do ALL of the following silently:
1. Edit <agntux project root>/actions/{action_id}.md — set status=done and completed_at=<ISO now> in frontmatter.
2. Append to body section "## Resolution log":
   - <ISO now> — Sent reply via slack. permalink: <permalink>
3. Do not emit any further tool calls or assistant text.
```

The trailing "Do not emit any further tool calls or assistant text" line is load-bearing:
it triggers the host's silent-persistence termination (P9 §8.2 / state-management.ts
"How UI-Initiated State Changes Flow").

`<ISO now>` is a literal placeholder — the host substitutes ISO 8601 UTC at the time of
the file edit. Do NOT pre-fill on the component side; clock skew between iframe and host
is unspecified (P9 §8.2).

---

### intent-key:send-channel-message

When you receive a `ui/message` whose first line matches:

  User confirmed sending this Slack message to channel {channel_id}

Steps:

1. Extract `channel_id`, the message text (between `---` fences), and `action_id`.
2. Call `mcp__slack__post_message({ channel: <channel_id>, text: <message text> })`.
   (Note: no `thread_ts` — this is a top-level channel post, not a thread reply.)
3. Capture `{ ts, permalink }`.
4. If the post failed, surface: "Couldn't send Slack message: <reason>. The action item
   is unchanged." STOP.
5. Edit `<agntux project root>/actions/{action_id}.md`: set `status: done`, `completed_at: <ISO now>`;
   append resolution log bullet.
6. Return no further tool calls or assistant text.

---

### Idempotency note

Sends are NOT idempotent at the source level (calling `send-thread-reply` twice posts
twice). The component is responsible for:

- Disabling the Send button after the first click.
- Showing a "sending" loading state until success or error.
- Showing a confirmation panel ("Reply sent") on success that does NOT re-enable Send.

The host's silent-persistence response means the component never gets a re-render to
clobber its optimistic state (P9 §8.5). If the source MCP fails, the component re-enables
Send for retry — the action item is unchanged because step 4 of each intent recipe refuses
to edit on failure.

---

### Adding new intent keys

Each intent key corresponds to one entry in the plugin's `operational.follow_up_intents[]`
(agents/ui-handlers/{name}.md frontmatter) and one `## intent-key:{name}` heading here.

The linter (T23) checks that every key referenced in `follow_up_intents[]` has a matching
heading in this SKILL.md. Adding a new intent key is non-breaking (P9 §8.4). Removing or
renaming an existing key is a major-version change for the plugin.
