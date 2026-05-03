# Reference implementations

The shipped reference today is **`plugins/agntux-slack/`** — a
comprehensive example. Connector source, full-workspace coverage,
threads with the parent-keyed cursor pattern, drafting subagent
(chat-confirm-then-write), source write tools, onboarding-mode initial
cap. Best starting point for cloning the directory structure for any
non-trivial source.

`plugins/agntux-core/` is the orchestrator and is **not** an ingest
plugin. Don't model after it for source-ingest authoring; model
authority and structure from `agntux-slack`.

## What to copy from `agntux-slack`

- `plugin.json` shape (with a free-form descriptive
  `recommended_ingest_cadence` — agntux-slack's value
  `"Every 30 min, 7am–10pm weekdays — chat is time-sensitive during
  work hours, quiet otherwise"` is a good model for a chat source).
- `marketplace/listing.yaml` shape — categories, available_on,
  data_ingested, supported_prompts, requires_plugins, requires_source_mcp,
  developer, proposed_schema (entity_subtypes + canonical six
  action_classes).
- `LICENSE` — ELv2 stub, identical across every plugin in the
  marketplace.
- `hooks/` — byte-frozen copy from `canonical/hooks/` with the two
  documented substitutions (`lib/public-key.mjs`,
  `lib/agntux-plugins.mjs`).
- `skills/sync/SKILL.md` — substituted canonical sync template; top-level
  skill with `context: fork` + `agent: general-purpose` (no `tools:`
  whitelist; the forked context inherits the host's full tool surface,
  including UUID-prefixed connector tools).
- `skills/draft/SKILL.md` — chat-confirm-then-write skill (same shape
  as the sync skill; skeleton at `templates/draft-subagent.md`).
- `__tests__/` — cold-start + thread-association + draft-flow tests.

## What NOT to copy verbatim

- `proposed_schema` content — the entity_subtypes and action_classes
  must reflect *your* source. The shape is canonical; the values are
  per-source.
- `data_ingested` — describe what *your* plugin reads, not Slack's DMs.
- `requires_source_mcp.connector_slug` — match your source's connector
  name in the host's Connectors UI.
- README copy — write your own elevator pitch, install steps, and
  Limitations section.

## Pointers within `agntux-slack`

| File | Demonstrates |
|---|---|
| `skills/sync/SKILL.md` (12-step template) | `context: fork` top-level skill, cursor strategy, threads, lookup-before-write, contract-read at Step 0. |
| `skills/draft/SKILL.md` | `context: fork` chat-confirm-then-write, `mcp__agntux-core__set_status` after write, action body Edit for Activity bullet. |
| `marketplace/listing.yaml` | Comprehensive `proposed_schema` with cursor_semantics + source_id_format prose. |
| `__tests__/thread-association.test.ts` | Parent-keying invariants. |
| `__tests__/draft-flow.test.ts` | Confirmation-gate prompt-structure assertions. |
| `__tests__/cursor-map.test.ts` | Per-channel JSON map round-trip + tracked-thread parent-shaped keys. |
| `__tests__/idempotent.test.ts` | Static prompt-grep assertions (no LLM at test time). |
