# Natural-language query against {{source-display-name}}

The user typed `/{{plugin-slug}} <words>` where the first token is
not `sync`. They want a live answer about {{source-display-name}}.
<!-- append:ask-intent-redirect -->

## Contents

- Preflight (interactive context)
- Behavior
- Citation rules
- Refusal (no connector)

## Preflight (interactive context)

Ask-mode runs in an interactive chat context, not a scheduled-task
fire. Skip the orchestrator gate — `<agntux project root>/user.md`
may not exist, and that's fine. The {{source-display-name}} read MCP
tools work without a knowledge store.

If the user appears to be in a scheduled-task context (no chat input,
typical scheduled-task scaffold), exit cleanly with no message —
ask-mode is interactive only.

## Behavior

1. Use these {{source-display-name}} read MCP tools to investigate:
   {{source-mcp-tools}}.
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
configured for {{source-slug}}), reply verbatim:

> "I can't reach {{source-display-name}} right now. Make sure the
> {{source-display-name}} connector is enabled in your host's
> integrations panel, then try again."

Do not attempt fallback inference from the knowledge store. Be
honest about the missing live access.
