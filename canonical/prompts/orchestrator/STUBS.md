# TODO: Orchestrator Prompt Stubs

**TO BE FILLED BY T15 (P4 orchestrator plugin — prompt templates)**

This directory will contain the canonical prompt templates for the `agntux-core`
orchestrator plugin. P6's plugin generator copies these verbatim (with placeholder
substitution) when generating the orchestrator plugin.

## Files T15 will deliver

Per P4 §3 (orchestration skill) and the repo layout in please-study-these-plans-fuzzy-valley.md §3.1:

```
canonical/prompts/orchestrator/
├── orchestrator.md        # The /ux entry-point SKILL.md template (P4 §3.2)
│                          # Frontmatter: name: ux, description: ...
│                          # Body: first-run check, lane classifier (A–D),
│                          #        routing mechanics, out-of-scope list
├── retrieval.md           # Retrieval subagent template (P4 §4.2)
│                          # Frontmatter: name: retrieval, tools: Read,Glob,Grep,Edit
│                          # Body: patterns A–E, tier discipline, freshness check
├── feedback.md            # Feedback subagent template (P4 §5.2)
│                          # Frontmatter: name: feedback, tools: Read,Glob,Edit
│                          # Body: scope, pattern dimensions, graduation tagging
└── personalization.md     # Personalization subagent template (P4 §8)
                           # Frontmatter: name: personalization, tools: Read,Write,Edit
                           # Body: Mode A (first-run interview), Mode B (cadence),
                           #       Mode C (graduation review)
```

## Placeholder variables these files will use

The orchestrator prompts carry no build-time substitutions — they are fixed for
all deployments of `agntux-core`. P6 copies them verbatim.

| Build-time placeholder (P6 substitutes) | Substituted value | Substituted by |
|---|---|---|
| None at MVP | — | — |

**Runtime slot tokens (single-curly, host-filled per P3 §9.2; NOT P6-substituted):**
The orchestrator skill emits the following tokens in `host_prompt` strings; the
host's click-time drafting flow fills them before re-dispatch (per P9 §9.1, now
inlined into `skills/orchestrator.md`). Maintainers must NOT strip or escape them:

- `{propose_reply}` — short conversational reply
- `{summary}` — 3–5 bullets recapping a source item
- `{draft_body}` — longer email body
- `{propose_comment}` — Jira/HubSpot comment text
- `{highlight_ids}` — JSON array of source-native message IDs
- `{ref}` — the action-item ID join key

## Do not add content here

Do not add prompt content to this directory until T15 lands. P6's generator reads
from this directory; placeholder content would be copied into production plugins.
