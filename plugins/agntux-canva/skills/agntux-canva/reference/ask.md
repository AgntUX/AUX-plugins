# Natural-language query against Canva

The user typed `/agntux-canva <words>` where the first token is
not `sync`. They want a live answer about Canva.

## Contents

- Preflight (interactive context)
- Behavior
- Citation rules
- Refusal (no connector)

## Preflight (interactive context)

Ask-mode runs in an interactive chat context, not a scheduled-task
fire. Skip the orchestrator gate — `<agntux project root>/user.md`
may not exist, and that's fine. The Canva read MCP
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

1. Use these Canva read MCP tools to investigate:
   mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__search-designs, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__get-design, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__list-comments, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__list-replies, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__list-folder-items, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__search-folders, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__get-design-content, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__get-design-pages, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__search-brand-templates, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__list-brand-kits, mcp__679539c6-bf39-4a83-8da6-34d02f9561ce__get-export-formats.
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
configured for canva), reply verbatim:

> "I can't reach Canva right now. Make sure the
> Canva connector is enabled in your host's
> integrations panel, then try again."

Do not attempt fallback inference from the knowledge store. Be
honest about the missing live access.
