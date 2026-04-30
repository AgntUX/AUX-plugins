---
name: feedback-review
description: Daily pattern-detection pass over recently done and dismissed action items. Appends observations to `user.md → # Auto-learned` and tags graduation candidates for the personalization subagent. Background flow — fired by a scheduled task whose prompt body is `/agntux-core:feedback-review`. Users can also invoke directly to audit dismissals on demand.
disable-model-invocation: true
---

# `/agntux-core:feedback-review` — daily pattern detection

Lane: read-only pattern detection over the user's done + dismissed
action items in the last 30 days. Background flow — Claude must NOT
auto-invoke this skill from natural language. The user (or a
scheduled task) explicitly fires it.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). For scheduled-task
fires where the user is not present, exit cleanly with no message if
any precondition diverts — don't write spurious status; the next
user-initiated session will surface and fix.

## Dispatch

Engage the **pattern-feedback** subagent. The subagent reads
`user.md` (current preferences and existing `# Auto-learned`),
`actions/_index.md` (catalogue), and the done + dismissed action
files within the 30-day window. It appends new pattern observations
to `user.md → # Auto-learned` and tags graduation candidates with
`[graduation-candidate]` for the personalization subagent's Mode C
review.

Recommended scheduled-task cadence: `Daily 16:00`.

## Out of scope

- Conversational graduation review ("any patterns to approve?") →
  use `/agntux-core:profile`. That dispatches personalization Mode C,
  which reads the candidates this skill has tagged.
- Per-plugin instruction capture → `/agntux-core:teach {slug}`.
- Cross-workflow preference edits → `/agntux-core:profile`.
