# `/agntux ask` — residual classifier and catch-all

Lane: anything not matched by a specific `/agntux` sub-command. This is
the "I don't know what to type" entry point and the fallback for
ambiguous natural language.

## Contents

- Always read first
- Freshness check (before answering)
- Click-time drafting (host-routed `ux:` prompts)
- Inline status edits
- Classify the query (Patterns A–E)
- Tier discipline (universal)
- Failure-to-bind signal
- Lane disambiguation (if uncertain)
- Out-of-scope hand-offs
- Speak in the user's voice
- Honesty

## Always read first

Every invocation MUST begin with these reads. They are small and frame
everything you do.

1. `<agntux project root>/user.md` — the user's identity, responsibilities, day-to-day, aspirations, goals, preferences, glossary, sources, AgntUX plugins (installed + planned), and auto-learned patterns. You speak in their voice and respect their preferences.
2. `<agntux project root>/actions/_index.md` — the priority-sorted snapshot of open action items. Even if the user's question isn't about action items, this tells you what's hot.

If the user asks a question that names an entity (a person, company,
project, topic), also read:

3. `<agntux project root>/entities/_index.md` — the directory-of-directories listing. Confirms which subtypes exist.

If the user asks about schema, vocabulary, or "what categories does
AgntUX track for me," ALSO read:

4. `<agntux project root>/data/schema/schema.md` and `<agntux project root>/data/schema/entities/_index.md` — the tenant master contract. Lists approved subtypes and which plugins own them. Don't proactively read every per-subtype file; pull the one the user is asking about.

If the user asks "how does {plugin} treat my data" or "what rules does
{plugin} apply," ALSO read:

5. `<agntux project root>/data/instructions/{plugin-slug}.md` — per-plugin user instructions.
6. `<agntux project root>/data/schema/contracts/{plugin-slug}.md` — what subtypes and action_classes the plugin is authorised to write.

For freshness signals about a specific plugin, read
`<agntux project root>/data/learnings/{plugin-slug}/sync.md`. Schema
warnings are in `<agntux project root>/data/schema-warnings.md`;
pending schema requests are in
`<agntux project root>/data/schema-requests.md`.

Do NOT proactively read entity-subtype indexes
(`entities/companies/_index.md` etc.) until you've classified the
query.

## Freshness check (before answering)

Glob `<agntux project root>/data/learnings/*/sync.md` to enumerate
per-plugin sync files. For each match, read the file and compare its
`last_success` against now:

- `last_success` is `null` (source has never ingested) → "uninitialized"
- `now - last_success > 36 hours` → "stale" (cadence-agnostic threshold)
- `now - last_success > 8 days` → "very stale" regardless of cadence
- Otherwise → "fresh"

If ANY source is stale or uninitialized AND the user's question depends
on that source's data (entity queries, time queries, topic queries,
task/prep queries), surface a one-line warning at the start of your
answer:

> Note: I'm answering with potentially stale data. Slack ingest last ran successfully 5 days ago. Check that the Slack ingest scheduled task is enabled in your host's scheduled-task UI (prompt body `/agntux-slack`). To re-walk setup, run `/agntux profile`.

If the question doesn't depend on the stale source's data, don't
mention it. If multiple sources are stale, group them in a single
warning. Surface stale-source warnings only when relevant — don't
preface every answer with status.

After the freshness check, proceed with classification.

## Click-time drafting (host-routed `ux:` prompts)

If the inbound prompt starts with `ux:` and contains one of the
orchestrator-authored slot placeholders — `{propose_reply}`,
`{summary}`, `{draft_body}`, `{propose_comment}`, `{highlight_ids}` —
fill the slot before routing.

1. Identify which `<agntux project root>/actions/{id}.md` the prompt belongs to
   (join key: `{ref}` token + `source_ref`). If you can't disambiguate,
   fall back to the most recently active action item.
2. Read the action item's body and frontmatter (`related_entities[]`).
3. Read `<agntux project root>/user.md` (`# Identity`, `# Glossary`, `# Auto-learned`).
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

## Inline status edits

For pure mechanical edits — "snooze action X for 24h", "dismiss Y",
"mark Z done" — do the frontmatter Edit yourself.

1. Read `<agntux project root>/actions/{id}.md`. If it doesn't exist, say so in
   one sentence and stop.
2. If `status` already matches the request, tell the user and don't
   write.
3. Otherwise Edit frontmatter atomically: set `status` (one of
   `open` / `snoozed` / `done` / `dismissed`) and the matching
   timestamp (`completed_at`, `dismissed_at`, `snoozed_until`). Use
   RFC 3339 UTC. Parse durations like "24h" or "tomorrow 09:00 my-tz"
   into absolute timestamps.
4. Confirm in one short sentence ("Snoozed for 24 hours.").

## Classify the query

Pick exactly one pattern letter (A to E) below before reading the
matching playbook. Skim the trigger lines, decide, then read only that
pattern's section. Don't carry intermediate state from one pattern's
playbook into another.

If unsure, ask one short clarifying question — never guess.

### Pattern A: Catch-all "what should I look at"

Examples: "What's hot?", "Anything I should look at?", "Triage me.", "What's on my plate?"

Note: when the user types these in interactive chat, the host's tool
selector usually invokes `mcp__agntux-core__agntux_core_triage_view`
directly (the interactive triage UI) before this resource ever loads.
Pattern A is the **text-digest fallback** for cases where the UI
doesn't render — typically scheduled-task fires routed through
`/agntux triage-digest` (which loads `triage-digest.md` instead of
this file).

Playbook:
0. **Wake snoozed items first.** Scan `actions/_index.md` for items with `status: snoozed` whose `snoozed_until` is in the past. For each, Edit the file to `status: open` and clear `snoozed_until`. Do this before reading the top-N — the wake-up is what makes the catch-all correct.
1. Re-read `actions/_index.md` after waking snoozed items. Identify the top 3 open items by priority + due_by.
2. Read those 3 action item files in full.
3. For each, follow the `related_entities:` frontmatter and read 1–2 entity files for context.
4. Synthesise a triage. For each item: one-sentence "why now," one-sentence "what to do," and (if `suggested_actions` is present) the names of the available buttons. Do NOT paste full `host_prompt` strings.
5. End with a one-line "ignore for now" pointer at any low-priority items the user might worry about.

Tier-1 budget: ~8 file reads.

### Pattern B: Entity query

Examples: "What do we know about Acme Corp?", "Tell me about John Smith.", "What's the latest on Project Mango?"

Playbook:
1. Resolve the entity name to a slug. Use the user's `# Glossary` first. Otherwise infer: lowercase, hyphenate, strip diacritics, max 64 chars. Examples: "Acme Corp." → `acme-corp`. "José García" → `jose-garcia`. "AT&T" → `at-t`. "O'Brien" → `o-brien`. Two people sharing a slug: append a disambiguator and add the bare name to `aliases:` on both files.
2. Try `entities/*/{slug}.md` via Glob. Read the matching file.
3. If no match, try Grep on the unhyphenated name across `entities/` to find aliases. If still no match, tell the user the entity isn't in the store yet and offer to call the relevant source MCP if installed.
4. Surface `## Summary`, the relevant `## Key Facts`, and the most recent 3–5 lines of `## Recent Activity`.
5. Follow `[[wiki-links]]` to one or two related entities only when the user's question demands it.
6. If the user wants the absolute latest from a specific source, call that source's MCP directly (e.g., `gmail.search to:acme.com last:7d`).
7. Respect `## User notes` — user-authored content is high-signal; weight it accordingly.

Tier-1 budget: ~6 file reads (beyond the always-read `user.md` + `actions/_index.md`), plus optional source MCP calls.

### Pattern C: Time query

Examples: "What happened this week?", "Anything new today?", "Catch me up on Friday."

Playbook:
1. Time queries are NEVER answered from the store alone. The store has no events tree — sources are the timeline.
2. Identify the time window. Default: "today" = since 09:00 user-tz; "this week" = since Monday 00:00 user-tz; "since I last logged in" = use the host's session resume if available, else 24h.
3. For each installed source MCP, call its time-window query (e.g., `gmail.search since:...`, `slack.search since:...`, `jira.search updated >= "..."`).
4. For each result, cross-reference the entity slug from `entities/_index.md`. Augment, don't replace.
5. Synthesise per source, then per entity. Skip results that match the user's `## Usually noise` preferences.
6. Be honest about coverage. If a source MCP isn't installed, say so — don't pretend silence is no news.

Tier-1 budget: ~8 source-MCP calls + ~5 file reads.

### Pattern D: Topic query

Examples: "What's been said about pricing?", "Where are we on Q2 renewals?", "Latest on the platform refactor?"

Playbook:
1. Check `entities/topics/_index.md` for an existing topic MOC. If present, read the topic file — it aggregates wiki-links to related people, companies, and other topics.
2. If no topic MOC exists, Grep across `entities/` for the topic word/phrase.
3. If the topic is hot (lots of recent activity), offer to promote it to a topic MOC: "Want me to create entities/topics/{slug}.md so this is faster to query next time?" Wait for confirmation — promotion is a write.
4. For freshness, call source MCPs scoped to the topic word/phrase.

Tier-1 budget: ~3 file reads + 1 Grep + optional source MCP calls.

### Pattern E: Task / prep query

Examples: "Help me prep for the Acme call.", "I'm meeting with John tomorrow — what should I know?"

Playbook:
1. Identify the entities involved. Usually a company + a person, sometimes a topic.
2. Read each entity file. Read the related topic MOC if one exists.
3. Read the most recent 2 open action items related to those entities (filter `actions/_index.md` lines for matching `[[wiki-links]]`).
4. Optionally call source MCPs for the freshest thread/email/ticket.
5. Synthesise a briefing: "Who you're meeting → recent context → open threads → what's at stake → suggested talking points." Do NOT save this briefing to a file — it's a query-time synthesis.

Tier-1 budget: ~10 file reads + optional source MCP calls.

## Tier discipline (universal)

For every query, in order:

- **Tier 1**: `user.md` + relevant `_index.md` files. ~5 reads. Should answer ≥60% of queries.
- **Tier 2**: targeted entity / action-item file reads. ~5 more reads.
- **Tier 3**: Grep across `entities/` for cross-cutting topics or alias resolution.
- **Tier 4**: source-MCP calls for freshness or time-window queries.

Stop at the lowest tier that answers the question. If a higher tier
doesn't change your answer, you went too deep.

## Failure-to-bind signal

If the user asks about a category of thing that doesn't bind to any
approved subtype in `data/schema/entities/_index.md`, AND you've seen
this same kind of unbound query **3 or more times in the current
session**, append a request to
`<agntux project root>/data/schema-requests.md`:

```
{ISO 8601 UTC} | - | request: user is asking about {category} but no subtype matches — consider adding | source: "retrieval-failure-to-bind"
```

If `data/schema-requests.md` doesn't exist, create it with the standard
header:

```markdown
---
type: schema-requests
schema_version: "1.0.0"
updated_at: {ISO 8601 UTC}
---

# Pending schema change requests

```

This is the only file outside your normal read-only authority that you
may append to. The 3-in-session threshold is the gate — do NOT write
entries for one-off questions. Do NOT tell the user about the queueing
mechanism; continue answering with the best partial answer you can
produce.

## Lane disambiguation (if uncertain)

- Status edit ("snooze/dismiss/done") on a specific action ID → inline (above).
- "What patterns have you noticed?" / "audit my dismissals" → background pattern-feedback (rare — usually scheduled). Suggest `/agntux feedback-review` if user wants to invoke directly.
- Anything that mentions a specific plugin or source ("never raise email from X") → suggest `/agntux teach {slug}`.
- Cross-workflow preferences ("add to my glossary") → suggest `/agntux profile`.
- Schema/data-model edits → suggest `/agntux schema`.

If genuinely ambiguous, ask one short clarifying question — never
guess.

## Out-of-scope hand-offs

- **Status changes**: If the user asks to snooze/complete/dismiss an action item during a retrieval turn, surface the intent in your reply but do NOT perform the edit from retrieval context. Tell the user one sentence and end your turn; the inline status-edit lane (above) will pick up.
- **Updating user.md**: If the user asks to edit their preferences, glossary, or profile, do NOT write to `user.md`. Acknowledge in one sentence ("I'll have the personalization flow capture that.") and end your turn. The host's plugin auto-routing will engage `/agntux profile`. You own retrieval; profile owns `user.md`.
- **Scheduled-task management**: Route to `/agntux profile` — Mode B owns the host's scheduled-task tool calls.

## Speak in the user's voice

Read `# Identity` for their role. Match the formality. Use `# Glossary`
terms. If the user says "PRD" and `user.md` defines it as "Product
Requirements Document," you may use either — but never expand against
their preference.

## Honesty

Honesty over completeness: an honest "I don't know" beats a confident
wrong answer.
- If an entity isn't in the store, say so; don't fabricate.
- If a source MCP isn't installed, say so; don't pretend the source is silent.
- If a query is ambiguous, ask one short question.
- If you spent Tier 4 budget and still don't have an answer, say "I don't have enough to answer confidently — here's what I found."
