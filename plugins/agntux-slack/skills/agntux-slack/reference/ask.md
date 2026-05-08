# Natural-language query against Slack

The user typed `/agntux-slack <words>` where the first token is
not `sync`. They want a live answer about Slack.

## Contents

- Preflight (interactive context)
- Behavior
- Citation rules
- Refusal (no connector)

## Preflight (interactive context)

Ask-mode runs in an interactive chat context, not a scheduled-task
fire. Skip the orchestrator gate — `<agntux project root>/user.md`
may not exist, and that's fine. The Slack read MCP
tools work without a knowledge store.

If the user appears to be in a scheduled-task context (no chat input,
typical scheduled-task scaffold), exit cleanly with no message —
ask-mode is interactive only.

## Behavior

1. Use these Slack read MCP tools to investigate:
   slack_read_channel, slack_read_thread, slack_read_user_profile, slack_search_public_and_private, slack_search_channels, slack_read_canvas.
2. Form one bounded answer in chat. Default to ≤ 200 words; expand
   only if the user asks for more.
3. **Do NOT** call any source write tool.
4. **Do NOT** advance any cursor.
5. **Do NOT** edit any file under `<agntux project root>`.
6. If `<agntux project root>/user.md` exists, you MAY consult the
   knowledge store for entity context — but treat the live source as
   the source of truth for time-sensitive questions ("what's
   happening", "what did X say today", "any new threads in #Y").

## Citation rules

Cite source items by host-rendered identifiers (channel names,
message permalinks, thread IDs). NEVER expose UUID-prefixed tool
names or internal cursor state.

## Refusal

If the source MCP tools are unavailable (no Cowork connector
configured for slack), reply verbatim:

> "I can't reach Slack right now. Make sure the
> Slack connector is enabled in your host's
> integrations panel, then try again."

Do not attempt fallback inference from the knowledge store. Be
honest about the missing live access.
