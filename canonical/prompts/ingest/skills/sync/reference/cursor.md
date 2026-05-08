# Cursor advance reference — Step 11 detail

Companion to `../SKILL.md` Step 11. The transactional rule, diff
expression, and `validate-cursor.mjs` interaction live in the SKILL
body. Per-source key shapes and advance triggers live here so the
SKILL stays under budget.

This file is **C+O** — canonical generic + per-plugin
`_overrides/resources/cursor-append.md`. The per-plugin append
extends the table below with source-specific layers (Slack adds a
thread layer, Gmail names its discovery low-water-mark `inbox`, etc.).

## Generic cursor layers

Every ingest plugin's cursor map carries at least two conceptual
layers. The minimum shape is a single JSON object on the cursor line;
plugins with richer structure namespace via key shape:

| Layer | Key shape | What advances | When advanced |
|---|---|---|---|
| Per-{{thread-unit-name}} | `<source-native id>` (no `#`) | Newest item ts processed in that {{thread-unit-name}} | After per-{{thread-unit-name}} pass completes AND every action write succeeded |
| Discovery low-water-mark | named field on `sync.md`, OR a literal-string key (e.g. `inbox`) | Newest item ts seen by any discovery search | After Step 5b discovery completes AND the transactional rule (Step 11) allows |

## Eviction

- **Per-{{thread-unit-name}} keys** with no activity for ≥30 days
  may be evicted. The next mention is caught by discovery on the
  following run.
- The discovery low-water-mark is **never** evicted — it monotonically
  advances or stays put.

For every evicted key, append a `{{source-slug}}-{{thread-unit-name}}-
evicted` entry to `sync.md → errors` naming the dropped key. The
agntux-core `validate-cursor.mjs` PreToolUse hook rejects writes that
silently drop a prior cursor key without an `evicted`-marked error
line. The same hook rejects regressions where a discovery low-water-
mark moves backward, or where a previously-non-null cursor key
regresses to `null`.

## Layered structure (when present)

Sources with thread/parent-child structure (Slack threads, Jira
sub-issues) extend the basic two-layer model with a third layer
keyed on a composite identifier. Plugins with this shape ship a
wholesale `_overrides/resources/cursor.md` documenting the exact
key shape, the channel/parent vs. reply advancement rules, and any
cross-layer eviction policies (along with worked examples of cursor
advance diffs).
