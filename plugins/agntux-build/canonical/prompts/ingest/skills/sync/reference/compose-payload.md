# Compose payload schema — Step 10 reference

Companion to `../SKILL.md` Step 10. The action item's frontmatter,
priority anchoring, and `suggested_actions` shape live in the SKILL
body. The fenced-YAML payload that the per-plugin compose iframe loads
at click time lives here so the SKILL body stays under budget.

This file is **C+O** — canonical generic + per-plugin override. Sources
with a richer payload shape (Slack's `thread_context`, Gmail's
`recipients` block) ship a wholesale `_overrides/resources/compose-
payload.md`. Sources with no UI ship none.

## Conditional body section: `## Compose payload`

REQUIRED for every action item that ships a `Draft a reply` (or
equivalent) suggested action. The block is a fenced ```yaml inside an
H2 body section so the top-level frontmatter parser's `---` collision
risk doesn't bite.

**YAML quoting reminder.** Any string scalar containing `: ` (colon-
space), a leading `-`, or starting with `{` / `[` MUST be wrapped in
double quotes — otherwise the parser interprets it as a key/value pair,
list item, or flow collection and the resulting payload is
unparseable. Concretely, `personalization_signals` bullets like
`Tone: terse — per user.md` MUST be authored as `"Tone: terse — per
user.md"`. The view tool falls back to a `compose_payload_missing`
error envelope when normalisation drops the field, surfacing the
authoring bug to the user but blocking the iframe from rendering.

Generic shape (per-plugin overrides extend `thread_context`,
`recipients`, etc. as needed):

```markdown
## Compose payload

​```yaml
drafted_body: |
  {agent-composed reply, ≤4000 chars, informed by Step 10.1 context}
personalization_signals:
  - {≤120 chars; cite which user.md / instructions rule motivated this}
  - {up to 4 bullets total}
thread_context:
  parent_id: <opaque source-native id>
  parent_author_real_name: <name>
  parent_excerpt: <≤300 chars>
  total_replies: <int>
  participants: [<≤6 names>]
generated_at: <RFC 3339 of this run>
​```
```

The compose iframe loads this section at click time via the
plugin's `*_compose_view` MCP tool — see that tool's input schema
for the canonical contract. Hand-edits to the payload block survive
the next sync run only when the action file is otherwise unchanged;
a re-raise via dedup overwrite (rare, per Step 9) regenerates them.

**For cross-source-merged actions** (Step 9 found a sibling open action
to merge into): emit the payload as `## Compose payload
({{source-slug}})` rather than `## Compose payload`. The plugin's
view tool reads either header — same shape, different namespace. This
is the contract Step 9's cross-source merge depends on.
