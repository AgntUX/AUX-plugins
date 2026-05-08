
### Step 10.2 — Gather email-context (gmail-only)

For every action with `reason_class == response-needed` AND `related_entities` containing ≥1 `person` entity, gather a ≤500-char `context_preamble` from prior conversations with that person and persist it in the action's `## Email context` body section. Token guards (N=3 prior threads, 1 deep `MINIMAL` `get_thread` call per action, per-person 7-day cache, gated to response-needed only). Full procedure: see `reference/email-context.md`.
