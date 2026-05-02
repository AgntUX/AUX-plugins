---
name: agntux-schema
description: Review or edit the AgntUX tenant schema (`~/agntux/data/schema/`). Use for "review my schema", "look at the {plugin-slug} contract", "is the schema right?", "add a `health_score` field to `company`", "rename `theme` to `topic`", "add an `awaiting-customer` action class", or `/agntux-schema review|edit [plugin-slug]`. Owned by the data-architect subagent.
argument-hint: "[review|edit] [plugin-slug]"
---

# `/agntux-schema` — schema review and edit

Lane: explicit user-driven schema review or edit. Pending plugin
install reviews (`.proposed` contracts) and queued schema requests
fire automatically through `_preconditions.md` checks 3–4 on every
entry-point skill invocation — `/agntux-schema` does not need
to (and should not) duplicate that dispatch. Use this skill only
when the user says "review my schema", "edit the schema", or
typed `/agntux-schema ...` directly.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). If checks 0–4 divert,
follow the redirect and stop.

## Dispatch

Engage the **data-architect** subagent. Mode follows `$ARGUMENTS`:

| `$ARGUMENTS` | Mode | Action |
|---|---|---|
| empty / `review` | B-bare or A re-walk | Re-walk bootstrap (if needed) or review the master contract. |
| `review {plugin-slug}` | B-targeted | Re-review that plugin's approved contract. |
| `edit` / `edit {field-or-action}` | C | User-driven schema change (add subtype, rename field, add action_class). |

Pass `$ARGUMENTS` through verbatim. If the inbound prompt is a
free-text edit ("add a `health_score` field to `company`",
"rename `theme` to `topic`"), default to Mode C.

## Out of scope

- Per-plugin instructions (always/never rules) → use
  `/agntux-teach {slug}`.
- Cross-workflow preferences (action-worthy, noise, glossary) → use
  `/agntux-profile`.
- Pending `.proposed` plugin contracts and queued schema-requests
  fire automatically via `_preconditions.md` — do NOT route through
  this skill.
