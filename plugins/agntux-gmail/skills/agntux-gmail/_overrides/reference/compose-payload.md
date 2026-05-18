# Gmail compose payload — Step 10 reference

Companion to `../SKILL.md` Step 10. The action item's frontmatter
and priority anchoring live in the SKILL body. The two suggested-
action rows that emit the `Draft a reply` button + `Open in Gmail`
deep-link, and the fenced-YAML payload that the gmail compose iframe
loads at click time, live here so the SKILL body stays under budget.

## suggested_actions — the two standard buttons

Default ship is **2 buttons**: `Draft a reply` and `Open in Gmail` (1
button when `gmail_thread_url` is null — Gmail has no schedule-send
tool, so there is no `Schedule a reply` row). Emit them at Step 10
verbatim:

```yaml
suggested_actions:
  - label: "Draft a reply"
    host_prompt: "/agntux-gmail open the reply composer for action {id}"
  # Include the next row ONLY IF gmail_thread_url is non-null. Drop both
  # lines if null.
  - label: "Open in Gmail"
    url: "{gmail_thread_url}"
```

The host's tool selector matches each `host_prompt` against the
`agntux_gmail_compose_view` tool's `description` (which carries the
trigger phrases inline). The Draft button also accepts the
alternative phrasings that the view tool's description lists
("/agntux-gmail draft an email reply for action {id}",
"/agntux-gmail open the email composer for action {id}", etc.). Emit
the row above; do NOT vary the wording per action.

**Prefix history.** Prior to agntux-gmail 4.2.0 these prompts used the
legacy `"ux: Use the agntux-gmail plugin to …"` shape. The bare
slash-command form (`"/agntux-gmail …"`, 4.0.0+ schema) is the
going-forward shape; the view-tool `description` still recognises the
legacy form for backwards compatibility with action items written
before the migration.

The `Open in Gmail` URL itself is constructed by the deep-links
reference shape (account-index ladder → `authuser=` fallback →
omit-the-row when nothing is known).

## Gmail action frontmatter notes

For Gmail action items, the frontmatter `source_ref` carries the
**parent thread identifier**, never a per-message id:

```yaml
source: gmail
source_ref: "<thread_id>"
```

This is the same identifier used as the cursor map key (Step 11) and as
the `_sources.json` lookup key (Step 6). A new reply on a thread that
already raised an action does not raise a second one — Step 9's dedup
keys on `source_ref`.

**Never pre-fill the draft body in the ingest agent's `host_prompt`.**
The drafted reply lives in the `## Compose payload` body section below;
the `host_prompt` carries only the view-tool routing intent
(`/agntux-gmail open the email composer for action {id}`). The compose
iframe lifts the payload at click time.

## Conditional body section: `## Compose payload`

REQUIRED for every gmail action item that ships a `Draft a reply`
suggested action. The block is a fenced ```yaml inside an H2 body
section so the top-level frontmatter parser's `---` collision risk
doesn't bite.

**YAML quoting reminder.** Any string scalar containing `: ` (colon-
space), a leading `-`, or starting with `{` / `[` MUST be wrapped in
double quotes — otherwise the parser interprets it as a key/value pair,
list item, or flow collection and the resulting payload is
unparseable. Concretely, `personalization_signals` bullets like
`Tone: terse — per user.md` MUST be authored as `"Tone: terse — per
user.md"`. The view tool falls back to a `compose_payload_missing`
error envelope when normalisation drops the field, surfacing the
authoring bug to the user but blocking the iframe from rendering.

## Gmail-specific shape

```markdown
## Compose payload

​```yaml
drafted_body: |
  {agent-composed reply, ≤4000 chars, informed by Step 10.1 + 10.2 context}
personalization_signals:
  - {≤120 chars; cite which user.md / instructions rule motivated this}
  - {up to 4 bullets total}
thread_context:
  thread_id: <gmail_thread_id>
  subject: <≤200 chars>
  parent_message_id: <gmail_message_id>
  parent_author_real_name: <name>
  parent_author_email: <email>
  parent_excerpt: <≤300 chars>
  last_message_id: <gmail_message_id>
  last_author_real_name: <name>
  last_author_email: <email>
  last_excerpt: <≤300 chars>
  total_messages: <int>
  participants:
    - real_name: <name>
      email: <email>
recipients:
  to:
    - <email>
  cc:
    - <email>
  bcc: []
reply_to_message_id: <gmail_message_id of message we're replying to>
gmail_thread_url: <url | null>
account_index: <int | null>   # mirrors data/instructions/agntux-gmail.md → # Account / account_index;
                              # the compose iframe lifts this so the draft-creation link
                              # opens in the right Gmail account slot
generated_at: <RFC 3339 of this run>
​```
```

The compose iframe loads this section at click time via
`mcp__agntux-gmail__agntux_gmail_compose_view` — see that tool's input
schema for the canonical contract. Hand-edits to the payload block
survive the next sync run only when the action file is otherwise
unchanged; a re-raise via dedup overwrite (rare, per Step 9)
regenerates them.

## Cross-source-merged actions

When Step 9 finds a sibling open action to merge into, emit the payload
as `## Compose payload (gmail)` rather than `## Compose payload`. The
agntux-gmail view tool reads either header — same shape, different
namespace. This is the contract Step 9's cross-source merge depends on.
