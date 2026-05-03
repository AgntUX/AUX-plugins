---
name: agntux-teach
description: Capture per-plugin instructions ("never raise email from notifications@*", "always raise PRs from @teammate", "ignore #random"). Source-specific imperatives go to `<agntux project root>/data/instructions/{plugin-slug}.md` — not `user.md`. Use when the user wants to teach a plugin a rule, says "teach agntux-slack about X", or runs `/agntux-teach {plugin-slug}` for an on-demand refresh of an already-onboarded plugin's instructions. (First-time install-time onboarding is owned by `/agntux-onboard`'s per-plugin interview, not by this skill.)
argument-hint: "[plugin-slug]"
---

# `/agntux-teach` — per-plugin instructions

Lane: any rule that names a specific plugin or source. Cross-workflow
preferences belong in `/agntux-profile` (writes `user.md`); rules
here live in `<agntux project root>/data/instructions/{plugin-slug}.md`.

## Schema-drift preflight

Run [`_preflight.md`](../_preflight.md). Informational nudges only —
don't block on either check.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). If checks 0–4 divert,
follow the redirect and stop. (`teach` cannot run before the schema
is bootstrapped — the data-architect's plugin contract is the
authority for which `{plugin-slug}` values are valid.)

## Dispatch

Engage the **user-feedback** subagent. Mode is auto-detected from
inbound prompt and `$ARGUMENTS`:

- **Mode B** — `/agntux-teach {plugin-slug}` runs an on-demand
  refresh interview for an already-onboarded plugin. The subagent
  reads the plugin's approved contract to know what entity kinds and
  reasons it can write, then walks the user through always-raise /
  never-raise / rewrite rules. (First-time install onboarding is
  owned by `/agntux-onboard` — re-running it picks up new plugins.)
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
