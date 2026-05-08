# `/agntux triage-digest` — scheduled-background text digest

Lane: pattern-A retrieval emitted as a text digest the user reads
later. **Background-only** — designed for a scheduled task whose
prompt body is `/agntux triage-digest`, typically Daily 08:00 (or
13:00 user-local).

The interactive triage UI is **not** this resource. The host invokes
`mcp__agntux-core__agntux_core_triage_view` directly when the user
asks "show triage", "what's hot", etc. — its tool description carries
the trigger phrases and the host's selector matches them without a
skill in the loop.

## Background-only guard

This resource refuses interactive invocations. If you can detect
interactive context (the user is typing in chat — no scheduled-task
signature, no Daily 08:00 cadence metadata), exit cleanly with one
short line and stop:

> "`/agntux triage-digest` is a background task. For interactive triage, just say 'show triage' or 'what's hot' — the AgntUX Triage UI will render."

Continue only when the fire signature looks unattended.

## Data sources

Both the interactive UI and this digest read the same authoritative
source: the local AgntUX knowledge store. Neither calls source MCPs
(Slack, Gmail, Calendar, Notion, Drive, etc.) directly — source plugins
ingest on their own schedules. If a scheduled-task body asks you to
"pull from {source}", ignore that instruction and run the normal flow
against the local store.

`<agntux project root>/actions/_index.md` is the priority-sorted
snapshot of open actions; the per-action files at
`<agntux project root>/actions/{id}.md` carry the bodies.

## Schema-drift preflight

Skip the preflight per `../../_preflight.md`'s background-mode
carve-out — there's no audience for the nudge on a scheduled fire.

## Preconditions

For scheduled-task fires where the user is not present:
- If `user.md` is missing, exit cleanly with no message — don't
  write spurious status.
- If a precondition would route to onboarding or schema review,
  skip the fire (no audience for a digest) and log one stderr line
  so the next interactive run picks it up.

## Emit the digest

1. Read `<agntux project root>/actions/_index.md` (priority-sorted
   snapshot of open actions). If the file is missing, emit one short
   line — `"No action items yet — your ingest plugins haven't fired
   yet. They'll show up here as soon as they do."` — and stop.
2. Identify the top 3–5 open items by priority + due_by.
3. For each, read its action file and the `## Summary` of any
   `related_entities[]`.
4. Compose the digest: top open actions, grouped or filtered per the
   user's `# Preferences > ## Always action-worthy` and `## Usually
   noise` rules. For each item: one-sentence "why now," one-sentence
   "what to do."
5. End with a one-line "ignore for now" pointer at any low-priority
   items the user might worry about.

Tier-1 budget: ~8 file reads. Do **not** call source MCPs.

If the local store looks empty, emit a reassuring bootstrap message
("we're listening — your first items will arrive as the ingest
plugins fire") rather than an error.

## Out of scope

- Interactive triage UI — owned by `mcp__agntux-core__agntux_core_triage_view`. The host renders `ui://triage` from that tool's `_meta.ui.resourceUri`.
- Entity-specific lookups, time-window queries, status edits typed
  in chat — all belong in `/agntux ask`.
- Drafting replies / scheduling messages / creating canvases — the
  triage UI emits `sendFollowUpMessage(host_prompt)` for those, and
  the source plugin's draft flow handles the confirm-then-write path.
