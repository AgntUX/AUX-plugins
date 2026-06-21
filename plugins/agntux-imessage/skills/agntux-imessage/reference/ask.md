# Natural-language query against iMessage

The user typed `/agntux-imessage <words>` where the first token is
not `sync`. They want a live answer about iMessage.

## Contents

- Preflight (interactive context)
- Behavior
- Citation rules
- Refusal (no connector)

## Preflight (interactive context)

Ask-mode runs in an interactive chat context, not a scheduled-task
fire. Skip the orchestrator gate — `<agntux project root>/user.md`
may not exist, and that's fine. The iMessage read MCP
tools work without a knowledge store.

If you intend to enrich the answer with knowledge-store context
(resolving a named person, the user's timezone, prior threads), first
run the access preflight in the data-access reference — resolve the
project root and connect the folder if it isn't readable — and read the
paths it documents (`entities/`, `actions/`, `user.md`) rather than
blind-scanning the filesystem. If you only need the live source, skip it.

If the user appears to be in a scheduled-task context (no chat input,
typical scheduled-task scaffold), exit cleanly with no message —
ask-mode is interactive only.

## Behavior

1. Use these iMessage read MCP tools to investigate:
   mcp__Read_and_Send_iMessages__get_unread_imessages, mcp__Read_and_Send_iMessages__read_imessages, mcp__Read_and_Send_iMessages__search_contacts.
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
configured for imessage), reply verbatim:

> "I can't reach iMessage right now. Make sure the
> iMessage connector is enabled in your host's
> integrations panel, then try again."

Do not attempt fallback inference from the knowledge store. Be
honest about the missing live access.
