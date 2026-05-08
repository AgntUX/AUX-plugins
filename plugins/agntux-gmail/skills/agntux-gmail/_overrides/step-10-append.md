
### Step 10.2 — Gather email-context (gmail-only)

For every action with `reason_class == response-needed` AND `related_entities` containing ≥1 `person` entity, gather a ≤500-char `context_preamble` from prior conversations with that person and persist it in the action's `## Email context` body section. Token guards (N=3 prior threads, 1 deep `MINIMAL` `get_thread` call per action, per-person 7-day cache, gated to response-needed only). Full procedure: see `reference/email-context.md`.

**Gmail-specific Step 10 wiring — `account_index` threads through.** Step 0 (sub-step 5 extension) parses `# Account / account_index` from `data/instructions/agntux-gmail.md`. Step 10 then threads it through twice: (a) the `Open in Gmail` URL build in `reference/deep-links.md` prefers the `mail/u/{account_index}/?idr=inbox/{thread_id}` form when the field is set; (b) the `## Compose payload` body section copies `account_index` into the YAML so the compose iframe's Save envelope can route the draft-creation link to the same slot. Unset → fall through to the `authuser=` form, then to omitting the row entirely; never invent a value.
