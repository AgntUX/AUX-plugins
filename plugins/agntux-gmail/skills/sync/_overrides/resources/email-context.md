# Gmail email-context — Step 10.2 procedure

Companion to `../SKILL.md` Step 10. Gmail-only sub-step that surfaces
"context from prior conversations with this person" so the drafted reply
already reflects what the user has said and the recipient knows.

## Scope

Run only when:

- `reason_class == response-needed`, AND
- `related_entities` contains ≥1 `person` entity.

Skip otherwise. Skipped entirely for `knowledge-update` / `risk` /
`opportunity` / `deadline` / `other` actions.

## Token guards (all enforced)

- Maximum **N=3 prior threads** referenced per action.
- Maximum **1 deep `get_thread` MINIMAL** call per action.
- Per-person **7-day cache** at
  `<agntux project root>/data/learnings/agntux-gmail/email-context-cache/{person-slug}.md`.
  If the file exists with `cached_at` within the last 7 days, use the
  cached preamble and skip the search. Storing the cache here (not on
  the person entity) avoids colliding with the Step 7 section-preservation
  rule, which captures `## User notes` to EOF and would otherwise
  overwrite an agent-authored cache section on the next run.
- Hard cap of **10 actions × 1 deep call = 10 extra MCP calls per run**.

## Mechanism (per related person, when cache is stale or missing)

1. **Cheap pass — snippets only**:
   - `search_threads("from:<person_email> OR to:<person_email> newer_than:90d -in:trash", pageSize: 5)`. Result includes thread headers + snippets, no bodies.
   - Drop the current thread itself.
   - If the action has project/topic entities, run a second search with
     keywords drawn from those entities' aliases:
     `search_threads("(<keyword1> OR <keyword2>) newer_than:90d -in:trash", pageSize: 5)`.
2. **Filter & rank**: cap at the 3 most recent unique threads.
3. **Optional deep pass**: for the **top-1 most relevant** thread, call
   `get_thread(threadId, messageFormat: "MINIMAL")` (headers + snippets,
   no full bodies). One extra MCP call total per action.
4. **Synthesize** a ≤500-char `context_preamble` from snippets — what was
   discussed, what the user said last, what's outstanding.
5. **Cache** at
   `<agntux project root>/data/learnings/agntux-gmail/email-context-cache/{person-slug}.md`.
   Use this exact body shape (frontmatter + body):

   ```markdown
   ---
   cached_at: {RFC 3339 UTC}
   referenced_thread_ids:
     - {thread_id_1}
     - {thread_id_2}
     - {thread_id_3}
   ---

   # Email context cache for [[{person-slug}]]

   {≤500-char context_preamble synthesised from the snippets above}
   ```

   Atomic write (temp + rename). Survives across sync runs; invalidates
   after 7 days (next read sees `cached_at` is stale and re-synthesises).
   Per-plugin learnings directory is owned by this plugin — no
   cross-plugin contention.

6. **Persist** in the action body as `## Email context`:

   ```markdown
   ## Email context
   {≤500-char context_preamble}

   _Drawn from {N} recent thread(s) with this person; cached {YYYY-MM-DD}._
   ```

   The compose iframe surfaces this as a "Prior conversations"
   disclosure.

The `drafted_body` in `## Compose payload` is informed by
`context_preamble` so the reply doesn't repeat or contradict prior
conversation.
