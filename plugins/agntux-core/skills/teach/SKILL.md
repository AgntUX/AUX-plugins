---
name: teach
description: Capture per-plugin instructions ("never raise email from notifications@*", "always raise PRs from @teammate", "ignore #random"). Source-specific imperatives go to `<agntux project root>/data/instructions/{plugin-slug}.md` — not `user.md`. Use when the user wants to teach a plugin a rule, says "teach notes-ingest about X", or runs `/agntux-core:teach {plugin-slug}` for the install-time / on-demand interview.
argument-hint: "[plugin-slug]"
---

# `/agntux-core:teach` — per-plugin instructions

Lane: any rule that names a specific plugin or source. Cross-workflow
preferences belong in `/agntux-core:profile` (writes `user.md`); rules
here live in `<agntux project root>/data/instructions/{plugin-slug}.md`.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). If checks 0–4 divert,
follow the redirect and stop. (`teach` cannot run before the schema
is bootstrapped — the data-architect's plugin contract is the
authority for which `{plugin-slug}` values are valid.)

## Dispatch

Engage the **user-feedback** subagent. Mode is auto-detected from
inbound prompt and `$ARGUMENTS`:

- **Mode B** — `/agntux-core:teach {plugin-slug}` runs the full
  install-time / on-demand teach interview for that plugin. The
  subagent reads `data/schema/contracts/{plugin-slug}.md` to know
  what subtypes/action_classes the plugin can write, then walks the
  user through always-raise / never-raise / rewrite rules.
- **Mode A** — user said an imperative without invoking the slash
  command ("never flag email from notifications@*", "always raise
  PRs from @teammate"). Subagent infers the plugin from the
  imperative and captures the rule.
- **Mode C** — user asked for something structural ("track sentiment
  per company") that isn't a per-plugin instruction. Subagent
  escalates to `<agntux project root>/data/schema-requests.md` for the
  data-architect to handle on the next dispatch.

Pass `$ARGUMENTS` through verbatim. If `$ARGUMENTS` is missing and
the inbound prompt names no plugin, ask "Which plugin?" in one
sentence — never guess.
