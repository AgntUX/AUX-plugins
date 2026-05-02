---
name: sync
description: Cross-plugin sync alias — discoverable shortcut from the agntux-core namespace that re-dispatches to a per-plugin sync command (`/agntux-core:sync notes-ingest` → `/notes-ingest:sync`). Use only when the user explicitly types `/agntux-core:sync {plugin-slug}` or asks "how do I trigger an ingest from the core namespace?". Plain "sync my notes" / "ingest now" requests should auto-dispatch to the per-plugin command directly (e.g. `/notes-ingest:sync`), not this alias.
argument-hint: "[plugin-slug]"
---

# `/agntux-core:sync` — cross-plugin sync alias

Lane: thin alias so users can manually trigger an ingest pass without
remembering each plugin's namespace. The actual work happens in the
per-plugin sync command (e.g. `/notes-ingest:sync`).

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). If checks 0–4 divert,
follow the redirect and stop. (Sync cannot run before the schema is
bootstrapped and the per-plugin contract is approved — the per-plugin
sync command will exit cleanly if those conditions are missing, but
fail-fast here is friendlier.)

## Dispatch

Read `$ARGUMENTS` and normalise — expected to be a single plugin
slug (e.g., `notes-ingest`).

1. **Normalise** — trim whitespace and strip a leading slash, a
   trailing colon, and a trailing `:sync` if the user typed
   `/notes-ingest:sync` or `notes-ingest:sync` by mistake.
2. **Empty?** If the result is empty, look up installed plugins —
   read the `# AgntUX plugins > ## Installed` section of
   `~/agntux-code/user.md`. If that section is missing or empty (older
   `user.md` predating P3a), say so and ask the user which plugin
   to sync. Stop.
3. **Not installed?** If the slug does not match a line in
   `## Installed`, say "I don't see `{slug}` in your installed
   plugins — install it from the marketplace first." and stop.
4. **Re-dispatch** — invoke `/{slug}:sync` directly. The host
   carries the conversation to the per-plugin sync command, which
   engages the plugin's ingest subagent.

This skill does NO ingest work itself. It only re-dispatches.

## Out of scope

- Scheduled-task creation/edit/disable — host-UI-only primitive.
- Per-plugin freshness warnings — owned by the per-plugin sync
  command and the retrieval subagent.
