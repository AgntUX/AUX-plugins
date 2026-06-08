# Natural-language query against Google Calendar

The user typed `/agntux-google-calendar <words>` where the first token is
not `sync`. They want a live answer about Google Calendar.

## Scheduling-intent redirect (check before answering)

If the user's words express an intent to **find a time** or to **schedule /
set up / book a meeting** (e.g. "find a time to meet next week with Alice and
Bob about the roadmap", "schedule a 30-min sync", "set up a call with the
design team", "book time on my calendar"), do NOT answer read-only here.
Switch to the user-initiated scheduling lane (the `reference/schedule.md`
body): it resolves the attendees, the find-a-time window, and candidate slots,
then opens the schedule view **pre-populated** so the user just picks a slot
and clicks Schedule.

Otherwise — a genuine question about calendar contents ("what's on my calendar
Thursday", "who's organising the 2pm", "am I free Friday afternoon") —
continue with the read-only behavior below.

## Contents

- Preflight (interactive context)
- Behavior
- Citation rules
- Refusal (no connector)

## Preflight (interactive context)

Ask-mode runs in an interactive chat context, not a scheduled-task
fire. Skip the orchestrator gate — `<agntux project root>/user.md`
may not exist, and that's fine. The Google Calendar read MCP
tools work without a knowledge store.

If the user appears to be in a scheduled-task context (no chat input,
typical scheduled-task scaffold), exit cleanly with no message —
ask-mode is interactive only.

## Behavior

1. Use these Google Calendar read MCP tools to investigate:
   list_calendars, list_events, get_event.
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
configured for google-calendar), reply verbatim:

> "I can't reach Google Calendar right now. Make sure the
> Google Calendar connector is enabled in your host's
> integrations panel, then try again."

Do not attempt fallback inference from the knowledge store. Be
honest about the missing live access.
