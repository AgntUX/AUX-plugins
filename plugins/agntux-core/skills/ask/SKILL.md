---
name: ask
description: Catch-all entry point for AgntUX. Use for natural-language questions that don't match a more specific skill — entity lookups ("what do we know about Acme?", "tell me about @jane"), time-window queries ("what happened this week?"), topic queries ("what's been said about pricing?"), meeting prep ("help me prep for my 1:1 with Sam"), inline status edits ("snooze action X for 24h", "dismiss Y", "mark Z done"), and any ambiguous "I want to do something" prompt. ALSO handles every host-routed click-time prompt that begins with the literal `ux:` prefix and contains a slot placeholder — `{propose_reply}`, `{summary}`, `{draft_body}`, `{propose_comment}`, `{highlight_ids}` — drafting the slot value before the host re-dispatches. Routes all `ux: Use the {plugin-slug} plugin to ...` prompts when no more specific skill claims them.
---

# `/agntux-core:ask` — residual classifier and catch-all

Lane: anything not matched by `/agntux-core:{onboard,profile,teach,triage,schema,sync,feedback-review}`. This is the "I don't know what to type" entry point and the fallback for ambiguous natural language.

## Preconditions

Run [`_preconditions.md`](../_preconditions.md). If checks 0–4 divert, follow the redirect and stop.

## Click-time drafting (host-routed `ux:` prompts)

If the inbound prompt starts with `ux:` and contains one of the
orchestrator-authored slot placeholders — `{propose_reply}`,
`{summary}`, `{draft_body}`, `{propose_comment}`, `{highlight_ids}` —
fill the slot before routing.

1. Identify which `~/agntux-code/actions/{id}.md` the prompt belongs to
   (join key: `{ref}` token + `source_ref`). If you can't disambiguate,
   fall back to the most recently active action item.
2. Read the action item's body and frontmatter (`related_entities[]`).
3. Read `~/agntux-code/user.md` (`# Identity`, `# Glossary`, `# Auto-learned`).
4. For each entity in `related_entities[]`, read its `## Summary`.
5. Draft the slot value:
   - `{propose_reply}` — ≤2 sentences in the user's voice, matching
     the source thread's tone.
   - `{summary}` — 3–5 prose bullets recapping the source item.
   - `{draft_body}` — 1–3 paragraphs; sign with the user's first name.
   - `{propose_comment}` — short comment for the source's surface
     (Jira: terse + actionable; HubSpot: prose).
   - `{highlight_ids}` — JSON array of source-native IDs to look at
     first.
6. If you can't draft confidently, surface a one-sentence error
   ("Couldn't draft a reply automatically — open the source app and
   reply manually.") and do NOT route the prompt. No placeholder
   substitutions like "[your reply here]".
7. Substitute and route per P3 §9.2.

## Inline status edits (no subagent)

For pure mechanical edits — "snooze action X for 24h", "dismiss Y",
"mark Z done" — do the frontmatter Edit yourself.

1. Read `~/agntux-code/actions/{id}.md`. If it doesn't exist, say so in
   one sentence and stop.
2. If `status` already matches the request, tell the user and don't
   write.
3. Otherwise Edit frontmatter atomically: set `status` (one of
   `open` / `snoozed` / `done` / `dismissed`) and the matching
   timestamp (`completed_at`, `dismissed_at`, `snoozed_until`). Use
   RFC 3339 UTC. Parse durations like "24h" or "tomorrow 09:00 my-tz"
   into absolute timestamps.
4. Confirm in one short sentence ("Snoozed for 24 hours.").

## Retrieval routing

For everything else, dispatch to the **retrieval** subagent. Frame
the request in one sentence and let the host's plugin auto-routing
carry the conversation. The subagent handles patterns B–E:

- **B** — entity lookups: "what do we know about {entity}?", "tell
  me about {person}".
- **C** — time-window queries: "what happened {time-window}?".
- **D** — topic queries: "what's been said about {topic}?".
- **E** — meeting prep: "help me prep for {meeting/call}".

If you'd be doing more than `user.md` frontmatter and one action
file's worth of reading, you've drifted — engage retrieval.

## Lane disambiguation (if uncertain)

- Status edit ("snooze/dismiss/done") on a specific action ID →
  inline (above).
- "What patterns have you noticed?" / "audit my dismissals" →
  background pattern-feedback (rare — usually scheduled). Suggest
  `/agntux-core:feedback-review` if user wants to invoke directly.
- Anything that mentions a specific plugin or source ("never raise
  email from X") → suggest `/agntux-core:teach {slug}`.
- Cross-workflow preferences ("add to my glossary") → suggest
  `/agntux-core:profile`.
- Schema/data-model edits → suggest `/agntux-core:schema`.

If genuinely ambiguous, ask one short clarifying question — never
guess.

## Honesty

Honesty over completeness: an honest "I don't know" beats a
confident wrong answer. If the user's request fits no lane, say so
and offer the closest match.
