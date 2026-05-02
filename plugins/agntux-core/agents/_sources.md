---
description: Helper reminder for ingest agents — lookup-before-write protocol for entities/_sources.json (P3.AMEND.2/3). Not a routable subagent; imported as inline context by ingest plugin prompts. Filename leading underscore signals system-managed; the host's plugin discovery skips files without a `name:` field.
---

# `entities/_sources.json` — lookup-before-write reminder

The orchestrator (`agntux-core`) maintains `<agntux project root>/entities/_sources.json` as a
derived lookup table that maps `(subtype, source, source_id)` triples to entity
slugs. Every ingest plugin MUST consult this file before creating a new entity to
avoid the duplicate-entity failure mode where two plugins each create separate
files for the same real-world entity.

## File shape (P3 §3.6.1)

```json
{
  "version": "1.0.0",
  "generated_at": "2026-04-28T14:22:00Z",
  "entries": [
    { "subtype": "company",  "source": "hubspot", "source_id": "14729384",       "slug": "acme-corp" },
    { "subtype": "company",  "source": "slack",   "source_id": "C09ABCDEF",      "slug": "acme-corp" },
    { "subtype": "person",   "source": "gmail",   "source_id": "john@acme.com",  "slug": "john-smith-acme" },
    { "subtype": "person",   "source": "slack",   "source_id": "U07ABCDEF",      "slug": "john-smith-acme" }
  ]
}
```

A single entity slug MAY appear multiple times — one entry per source/id pair.
No two entries may share `(subtype, source, source_id)` — the PostToolUse hook
enforces uniqueness on every write. `source_id` is always a JSON string even when
the source natively emits an integer.

## Lookup-before-write (P3 §3.6.4 — normative for ALL ingest plugins)

Before creating a new entity file, an ingest agent MUST:

1. `Read(<agntux project root>/entities/_sources.json)` — or note its absence (empty tree is fine).
2. Search `entries` for a row matching `(subtype, source, source_id)`.
3. **Match found** → open the existing entity at `entities/{subtype}/{slug}.md` and
   merge updates:
   - Append to `## Recent Activity` (newest entry first).
   - Refresh `sources.{source}` in frontmatter if the source_id changed.
   - Preserve `## User notes` verbatim — never overwrite it.
   - Do NOT create a new file.
4. **No direct match** → search secondary identifiers:
   - Check `aliases:` on candidate entities for a display-name match.
   - Check `sources.email_domains` for domain-level email matches.
   - On match, merge (same rules as step 3).
5. **Still no match** → create a fresh entity file with a derived slug per P3 §2.4.
6. **Do NOT write `_sources.json` directly.** The orchestrator's PostToolUse
   `maintain-index` hook (P4.AMEND.2) updates it automatically after every
   entity write. Ingest plugins own entity files; the hook owns the index.

## Recovery

If `_sources.json` is lost or suspected stale, the user can rebuild it:

```
/agntux-ask "rebuild the entity sources index"
```

The orchestrator walks every `entities/**/*.md` file, reads `sources:` frontmatter,
and re-derives `_sources.json` from scratch. Ingest plugins do not need to trigger
this themselves — it is a user-initiated recovery command only.

## What this file is NOT

- Not a subagent. Not routable. Not dispatched by the orchestrator classifier.
- Not a source of truth. `_sources.json` is **derived** from the entity files
  themselves; the entity files are the canonical record.
- Not user-authored. The leading underscore signals system-managed; users do not
  edit it.
