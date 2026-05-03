---
name: sync
description: Run an agntux-slack pass now (or on schedule). Reads schema and per-plugin contract, fetches Slack messages since the last cursor, synthesises entities and action items, advances the cursor. Also dispatches inbound suggested-action prompts (`draft a reply`, `schedule a reply`, `summarise the thread`) to the draft subagent. Use for "sync slack", "ingest slack now", "refresh slack", or when a scheduled task fires `/agntux-slack:sync`, or when a `ux:` prompt routes back to agntux-slack from a suggested-action click.
---

# `/agntux-slack:sync` — manual or scheduled ingest, plus suggested-action dispatch

Lane: a single agntux-slack pass, or — if the inbound prompt is a suggested-action `ux:` body — a hand-off to `agents/draft.md`. Backed by the recommended scheduled task whose prompt body is `/agntux-slack:sync` at `Hourly`. Also the target of `/agntux-sync agntux-slack`.

## Always check first

### Project root

Confirm the active project root is exactly `<agntux project root>/`. If it is not, fail loud — print exactly one sentence:

> "AgntUX plugins require the project to be `<agntux project root>/`. Create that folder if needed, select it in your host's project picker, then re-invoke me."

Stop immediately. Do NOT touch source data, do NOT call source MCPs, do NOT advance any cursor.

### AgntUX orchestrator gate

Check whether `<agntux project root>/user.md` exists.

**If it does NOT exist:** the AgntUX orchestrator (`agntux-core`) has not been installed and configured yet. Print this message verbatim and stop:

> "This plugin needs AgntUX Core to be installed and configured first. Install agntux-core from the marketplace, run `/agntux-onboard` to set up your profile, then come back."

Do NOT touch source data, do NOT create entity files, do NOT advance any cursor.

**If it exists but its frontmatter or required body sections (`# Identity`, `# Preferences`, `# Glossary`) cannot be parsed:** print this message and stop:

> "user.md looks malformed. Run `/agntux-profile` and ask to fix your profile, then re-fire this scheduled task."

Do not attempt to repair user.md — the personalization subagent owns it.

**If it exists and parses cleanly:** proceed to dispatch.

These guards are mandatory. Without the correct project root and the orchestrator's data tree (`user.md` for preferences, `actions/_index.md` for dedup), the ingest subagent has nothing to synthesise against and every write is noise.

## Classify the inbound prompt

Pick exactly ONE lane based on the prompt body (after the host has stripped the leading `ux: `):

### Lane A — Ingest run

**Triggers:**
- The bare slash command `/agntux-slack:sync` (or `/agntux-sync agntux-slack`).
- An imperative referring to syncing or ingesting Slack: "sync slack", "ingest slack data", "run agntux-slack", "refresh slack".

**Pre-dispatch: resolve Slack MCP tool names (Cowork UUID prefix)**

Cowork prefixes connector tools with a server-instance UUID
(e.g. `mcp__7f3a-uuid__slack_read_channel`). The ingest subagent's
frontmatter `tools:` list must contain the exact prefixed names, or the
host will deny the calls and the run fails. Resolve them at dispatch:

1. Use ToolSearch to discover the read tools (one keyword query covers
   all of them):
   `ToolSearch({query: "slack_read_channel slack_read_thread slack_read_user_profile slack_search_public_and_private slack_search_channels slack_read_canvas", max_results: 20})`

2. Filter the results to **read-only** tools — drop any name containing
   `_send_`, `_create_`, `_update_`, `_schedule_`, `_post_`, `_delete_`.
   The ingest subagent must never receive a write tool.

   **If the filtered set is empty** (ToolSearch returned only write tools,
   or returned a non-Slack ranked match), do NOT dispatch and do NOT
   edit frontmatter. Print the same "tools aren't loaded" message as
   the zero-hits guard below and stop.

3. Read `${CLAUDE_PLUGIN_ROOT}/agents/ingest.md` frontmatter `tools:` line.
   Compare to the resolved names from step 2.

4. **If the resolved names already match what's in frontmatter, skip the
   edit** — the previous run's UUIDs are still current (the common case
   for an hourly task). Proceed straight to dispatch.

5. Otherwise, edit the frontmatter `tools:` line to the new resolved set:
   `tools: Read, Write, Edit, Glob, Grep, mcp__<uuid>__slack_read_channel, mcp__<uuid>__slack_read_thread, …`

6. Dispatch the ingest subagent (Lane A normal flow). **Do NOT restore**
   the original tools line after the run — the resolved names stay in
   place. Stale UUIDs cause no harm because step 2 re-resolves and step 4
   re-validates on every dispatch; a UUID rotation just triggers an edit
   on the next run.

If ToolSearch returns zero hits for any required tool, do NOT dispatch.
Print: "Slack connector tools aren't loaded — open Cowork's connector
panel and verify Slack is connected, then re-fire this skill." Stop.

Engage the **ingest** subagent (namespace `agntux-slack:ingest`). Frame the request and let the host's plugin auto-routing carry the conversation to the subagent's fresh context window. The subagent reads its state, fetches new items, synthesises entities and action items conformant to the tenant schema, and advances the cursor. The ingest subagent is read-only and never calls Slack write tools.

Do NOT do the ingest work yourself. Your job is routing.

### Lane B — Suggested-action dispatch (text-mediated draft flow)

**Triggers** — the inbound prompt body matches one of these patterns:

- `Use the agntux-slack plugin to draft a reply for action {id}.`
- `Use the agntux-slack plugin to draft a reply and schedule it for action {id}.`
- `Use the agntux-slack plugin to summarise the thread for action {id} into a Slack canvas.`

These come from the `suggested_actions[].host_prompt` field on action items the ingest subagent wrote. The host re-routed them as a fresh `ux:` prompt back to this plugin.

**Pre-dispatch: resolve Slack MCP tool names (Cowork UUID prefix)**

Same resolve → compare → skip-or-edit pattern as Lane A, but with the
**write** tools included. The draft subagent's confirmation gate
(yes / no / edit) is the safety property — exposing the write tools is
intentional.

1. Use ToolSearch to discover the read AND write tools:
   `ToolSearch({query: "slack_read_thread slack_read_user_profile slack_send_message slack_send_message_draft slack_schedule_message slack_create_canvas slack_update_canvas", max_results: 20})`

2. Do NOT filter out write tools here — the draft subagent needs them.
   But still verify the result set contains at least one read tool
   (`slack_read_thread`, `slack_read_user_profile`) AND at least one
   write tool (`slack_send_message`). If either category is missing,
   do NOT dispatch — print the zero-hits message at the end of this
   block and stop.

3. Read `${CLAUDE_PLUGIN_ROOT}/agents/draft.md` frontmatter `tools:` line.
   Compare to the resolved names from step 1.

4. **If the resolved names already match, skip the edit.** Proceed
   straight to dispatch.

5. Otherwise, edit the frontmatter `tools:` line to include the
   UUID-prefixed names alongside the base host tools.

6. Dispatch the draft subagent. Do NOT restore the original tools line.

If ToolSearch returns zero hits for the read tools, do NOT dispatch.
Print: "Slack connector tools aren't loaded — open Cowork's connector
panel and verify Slack is connected, then re-fire this action." Stop.

Engage the **draft** subagent (namespace `agntux-slack:draft`). The draft subagent:

1. Reads `<agntux project root>/actions/{id}.md`.
2. Calls `slack_read_thread` for full thread context.
3. Drafts a payload (reply body, schedule + body, or canvas content + title).
4. Shows the exact payload in chat with a `Send this now? (yes / no / edit)` confirm prompt.
5. On `yes`, calls the matching Slack write tool (`slack_send_message`, `slack_schedule_message`, `slack_create_canvas`, etc.).
6. On `no`, discards.
7. On `edit`, accepts revisions and re-confirms.

This is the present-day text-mediated stand-in for a future card-with-Send-button UI component. The chat confirmation is what guarantees no Slack write fires without explicit user consent.

Do NOT do the drafting work yourself. The draft subagent owns the confirmation gate; calling a write tool from this skill would defeat the entire safety property.

**Stale placeholders:** if the inbound prompt body contains a literal `{...}` template string (a generator substitution error from the ingest pass that wrote the action item), do not proceed. Return: `"Got a malformed dispatch from the orchestrator (placeholders not filled). Try again."` This surfaces upstream bugs rather than masking them.

### Fallback

If the prompt does not match Lane A or Lane B, tell the user what this plugin handles (`/agntux-slack:sync` for an ingest pass, suggested-action prompts on agntux-slack action items for the draft flow) and ask them to clarify. Do not guess. Do not call a Slack write tool from here under any circumstance.

## Out of scope

You do NOT:
- Fetch data from the Slack MCP — that is the ingest subagent's job (read-only) or the draft subagent's job (read for context).
- Author proposed replies or summaries yourself — that is `agents/draft.md`'s job, gated by user confirmation.
- Call any Slack write tool — only `agents/draft.md` does, and only after explicit user `yes`.
- Edit files under `<agntux project root>/` — only the ingest and draft subagents do that.
- Create, enable, disable, or delete scheduled tasks — those are a host-UI-only primitive.

## Routing mechanics

Plugin-bundled subagents are auto-discovered (namespaces `agntux-slack:ingest` and `agntux-slack:draft`). The host's plugin auto-routing engages them based on each subagent's `description:` frontmatter. Frame the request and let the host carry the conversation to the subagent in a fresh context window.

If your environment exposes a Task tool with `subagent_type` = `agntux-slack:ingest` or `agntux-slack:draft`, you may use it. Behaviour is the same either way.
