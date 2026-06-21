# Natural-language query against PostHog

The user typed `/agntux-posthog <words>` where the first token is
not `sync`. They want a live answer about PostHog.

## Contents

- Preflight (interactive context)
- Behavior
- Citation rules
- Refusal (no connector)

## Preflight (interactive context)

Ask-mode runs in an interactive chat context, not a scheduled-task
fire. Skip the orchestrator gate — `<agntux project root>/user.md`
may not exist, and that's fine. The PostHog read MCP
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

1. Use these PostHog read MCP tools to investigate:
   mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__query-error-tracking-issues-list, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__query-error-tracking-issue, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__alerts-list, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__alert-get, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__experiment-list, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__experiment-results-get, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__comments-list, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__comment-thread, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__annotations-list, mcp__d9955327-e9a7-4c3e-9a38-3c591b361c23__inbox-reports-list.
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
configured for posthog), reply verbatim:

> "I can't reach PostHog right now. Make sure the
> PostHog connector is enabled in your host's
> integrations panel, then try again."

Do not attempt fallback inference from the knowledge store. Be
honest about the missing live access.
