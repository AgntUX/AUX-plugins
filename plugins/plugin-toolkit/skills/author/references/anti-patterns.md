# Anti-patterns

A tight list of things that will cause your PR to bounce or, worse,
silently misbehave at runtime. The orchestrator's authority table (§2)
and schema-as-runtime rule (§3) cover the underlying *why*; this is the
short-form rule list.

- **Don't pre-bake `data/instructions/{slug}.md`.** That file is owned
  by `user-feedback` and `personalization`. Your plugin reads it; never
  writes.
- **Don't write `entities/_sources.json` or any `_index.md`.** The
  PostToolUse `maintain-index.mjs` hook owns these. Your edits get
  overwritten or race the hook.
- **Don't ship your own install hook.** The architect's Mode B reads
  your `marketplace/listing.yaml → proposed_schema` block directly
  whenever an installed plugin has no approved contract yet. There is
  no `.proposed` file or host-side install side-channel; introducing
  one would break the schema-as-runtime rule.
- **Don't hard-code subtype names in the agent prompt.** Use the
  canonical template's contract-read at Step 0 and reference whatever
  the contract approved.
- **Don't pre-fill draft bodies in `host_prompt`.** The drafting
  subagent fills the body at click-time with fresh context; pre-filling
  defeats the purpose.
- **Don't use a flat `skills/{name}.md`.** Claude Code silently drops
  it. Always `skills/{name}/SKILL.md`.
- **Don't add `version` to `listing.yaml`.** Reserved field; lint code
  E11. Version lives in `plugin.json`.
- **Don't include a `mcp-server/` directory unless `listing.yaml`
  declares `ui_components`.** Empty MCP servers confuse the host's
  plugin manager and signal a half-finished UI port.
- **Don't fork the canonical 12-step ingest contract.** Substitute
  placeholders, don't restructure.
- **Don't propose duplicate or near-duplicate `action_classes`** (e.g.,
  `decision-needed` when `response-needed` covers it). The architect
  refuses them; your contract ends up with the canonical name
  regardless.
- **Don't mutate action-item frontmatter from `skills/draft/SKILL.md`
  without going through `mcp__agntux-core__set_status`** for status
  changes. Body edits via Edit are fine; frontmatter mutations are
  not.
- **Don't skip the user-attended-onboarding constraint.** If your
  source is high-volume, add an onboarding-mode initial cap so the
  first synchronous sync during personalization State A stays under a
  minute.
- **Don't replace `LICENSE`.** The ELv2 stub is intentional.
- **Don't manually regenerate `.claude-plugin/marketplace.json` or
  `marketplace/index.json`.** `regenerate-indexes.yml` owns those
  post-merge.
- **Don't push without running the local lint, byte-freeze check, and
  version-match check.** `release-checker` and `invariant-checker`
  delegate to `/lint-plugin` and the canonical `shasum -c` invocation.
