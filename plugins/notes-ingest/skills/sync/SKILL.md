---
name: sync
description: Run a notes-ingest pass now (or on schedule). Reads schema and per-plugin contract, fetches notes since the last cursor, synthesises entities and action items, advances the cursor. Use for "sync my notes", "ingest notes now", "refresh notes", or when a scheduled task fires `/notes-ingest:sync`.
---

# `/notes-ingest:sync` — manual or scheduled ingest

Lane: a single notes-ingest pass. Backed by the recommended scheduled
task whose prompt body is `/notes-ingest:sync` at `Daily 09:00`. Also
the target of `/agntux-sync notes-ingest`.

## Always check first

### Project root

Confirm the active project root is exactly `~/agntux/`. If it is not,
fail loud — print exactly one sentence:

> "AgntUX plugins require the project to be `~/agntux/`. Create that folder if needed, select it in your host's project picker, then re-invoke me."

Stop immediately. Do NOT touch source data, do NOT call source MCPs,
do NOT advance any cursor.

### AgntUX orchestrator gate

Check whether `~/agntux/user.md` exists.

**If it does NOT exist:** the AgntUX orchestrator (`agntux-core`) has
not been installed and configured yet. Print this message verbatim
and stop:

> "This plugin needs AgntUX Core to be installed and configured first. Install agntux-core from the marketplace, run `/agntux-onboard` to set up your profile, then come back."

Do NOT touch source data, do NOT create entity files, do NOT advance
any cursor.

**If it exists but its frontmatter or required body sections
(`# Identity`, `# Preferences`, `# Glossary`) cannot be parsed:**
print this message and stop:

> "user.md looks malformed. Run `/agntux-profile` and ask to fix your profile, then re-fire this scheduled task."

Do not attempt to repair user.md — the personalization subagent
owns it.

**If it exists and parses cleanly:** proceed to dispatch.

These guards are mandatory. Without the correct project root and the
orchestrator's data tree (`user.md` for preferences,
`actions/_index.md` for dedup), the ingest subagent has nothing to
synthesise against and every write is noise.

## Dispatch

Engage the **ingest** subagent (namespace `notes-ingest:ingest`).
Frame the request and let the host's plugin auto-routing carry the
conversation to the subagent's fresh context window. The subagent
reads its state, fetches new items, synthesises entities and action
items conformant to the tenant schema, and advances the cursor.

Do NOT do the ingest work yourself. Your job is routing.

**Stale placeholders:** if the inbound prompt body contains a literal
`{{...}}` template string (a generator substitution error), do not
proceed. Return: "Got a malformed dispatch from the orchestrator
(placeholders not filled). Try again." This surfaces upstream bugs
rather than masking them.

## Out of scope

You do NOT:
- Fetch data from the filesystem MCP — that is the ingest subagent's
  job.
- Author proposed replies, summaries, or other UI content — this
  plugin ships no UI components.
- Edit files under `~/agntux/` — only the ingest subagent does that.
- Create, enable, disable, or delete scheduled tasks — those are a
  host-UI-only primitive.

## Routing mechanics

Plugin-bundled subagents are auto-discovered (namespace
`notes-ingest:ingest`). The host's plugin auto-routing engages them
based on each subagent's `description:` frontmatter. Frame the
request and let the host carry the conversation to the subagent in
a fresh context window.

If your environment exposes a Task tool with `subagent_type` =
`notes-ingest:ingest`, you may use it. Behaviour is the same either
way.
