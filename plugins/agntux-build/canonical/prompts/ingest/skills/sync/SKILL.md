---
name: {{plugin-slug}}
description: The {{source-display-name}} command surface for AgntUX. Runs an ingest pass against {{source-display-name}} or answers natural-language questions about {{source-slug}} content live. Use for "/{{plugin-slug}}", "sync {{source-slug}}", "ingest {{source-slug}} now", "refresh {{source-slug}}", "fire a {{source-slug}} pass", "what's happening in #{{example-channel}}", "what's in my {{source-slug}}", "what did {person} say in {{source-slug}} this week", "summarise last week's {topic} thread", "any new threads about {project}", "any unread {{source-slug}}", {{extra-skill-triggers}}or any {{source-display-name}}-scoped question.
argument-hint: "[sync | <natural-language question>]"
---

<!--
Placeholders are P6-substituted at build time (double-curly form).
The full registry, override mechanism, and skill lineage live in
canonical/prompts/ingest/STUBS.md. Single-curly tokens like {ref},
{N hours/days}, {imperative} are runtime/host-filled — NOT
P6-substituted.
-->

# `/{{plugin-slug}}` — {{source-display-name}} command surface

Lane: single user-facing entry into the {{plugin-slug}} plugin. Read
the first whitespace-delimited token of `$ARGUMENTS`; route to the
right reference file.

## Voice rules

Speak as the {{source-display-name}} surface of AgntUX. Never reference
internal architecture: do NOT say "router", "dispatch", "sub-command",
"reference file", "$ARGUMENTS", or "preflight" to the user. Branch
transitions are silent — load the matching `reference/{name}.md`
resource and follow its body.

## Schema-drift preflight

The sync sub-command's schema-drift preflight ladder is owned by
[`reference/sync.md`](./reference/sync.md) (interactive vs scheduled-fire
branches, lock acquisition, contract validation). The ask sub-command
skips schema-drift preflight by design — live queries don't write to
the knowledge store.

## Preconditions

The sync sub-command's project-root resolution and orchestrator-gate
checks are inlined in [`reference/sync.md`](./reference/sync.md)
(canonical-mirrored from `agntux-core/skills/_resolve-root.md` —
ingest plugins ship independently and can't cross-plugin-link). The
ask sub-command (and any other interactive lane) runs the lighter
access preflight in [`reference/data-access.md`](./reference/data-access.md)
— what AgntUX is, how to resolve the project root, how to connect the
folder when Cowork hasn't mounted it, the on-disk data layout, and how to
resolve a person to a contact detail — before reading the knowledge store.

## Sub-commands

| First $ARGUMENTS token | Reference | Notes |
|---|---|---|
| (empty) or `sync` | [`reference/sync.md`](./reference/sync.md) | Run an ingest pass. Steps 0–11. Owns project-root preflight, orchestrator gate, cursor advance. |
| anything else | [`reference/ask.md`](./reference/ask.md) | Live natural-language query. **Read-only.** No cursor advance, no knowledge-store write. |
<!-- append:sub-commands -->

## Argument parsing

1. Trim `$ARGUMENTS`; if empty, treat as `sync`.
2. Lowercase the first whitespace-delimited token. If it equals
   `sync`, strip the token from `$ARGUMENTS` and load
   `reference/sync.md`.
<!-- append:argument-parsing -->
3. Otherwise, load `reference/ask.md` with the full untrimmed
   `$ARGUMENTS` as the natural-language query.

## Reference shape (sync sub-command)

`reference/sync.md` is the procedural body. It describes its detail
shapes by name; the actual schemas/details live in the siblings below
and are loaded directly when the body needs them.

- [`reference/fetch.md`](./reference/fetch.md) — Step 5 fetch shape.
- [`reference/cursor.md`](./reference/cursor.md) — cursor-map semantics.
- [`reference/compose-payload.md`](./reference/compose-payload.md) — write shape (for `host_prompt` suggested actions).
- [`reference/runbook.md`](./reference/runbook.md) — failure-mode taxonomy.
- [`reference/deep-links.md`](./reference/deep-links.md) — host URL formation for citations.
- [`reference/honesty.md`](./reference/honesty.md) — what to claim and refuse.

## Out of scope

- Writing to the knowledge store from `ask.md` — that's the sync
  branch's job and only fires under empty/`sync` $ARGUMENTS.
- Source write tools — reserved for click-time iframe envelopes
  (Save / Send buttons in UI handlers); the skill never invokes them.
- Scheduled-task creation / edit — host UI primitive (referenced
  from `agntux-core`'s `reference/onboard.md` and `reference/profile.md`).
