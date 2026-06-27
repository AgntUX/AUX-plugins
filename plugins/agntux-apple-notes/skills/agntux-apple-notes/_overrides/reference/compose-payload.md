# Apple Notes compose payload — Step 10 reference

Wholesale override for the canonical `compose-payload.md`.

Documents the `## Compose payload` body section written into every
{{source-display-name}} action file at Step 10. The view tool lifts this
section from disk at click time to pre-fill the note composer without
re-fetching {{source-display-name}} content.

---

## `## Compose payload` body section shape

Every action file whose `suggested_actions` opens a note view MUST include a
`## Compose payload` section. Both the create-note and update-note views read
the **same** `## Compose payload` header — the field set differs by which
view the action opens. Write the matching shape below; omit the fields that
belong to the other mode.

**YAML quoting reminder.** Any string scalar containing `: ` (colon-space),
a leading `-`, or starting with `{` / `[` MUST be wrapped in double quotes —
otherwise the parser interprets it as a key/value pair, list item, or flow
collection. The view tool falls back to a `compose_payload_missing` error
envelope when normalisation drops a field, blocking the iframe from rendering.

---

## Create-note mode

For actions whose `suggested_actions` opens the create-note view
(`agntux_apple_notes_create_note`):

```markdown
## Compose payload

```yaml
source_context: "{1–2 sentences: what prompted this note — the source item, message, or task that triggered the create-note action}"
draft_title: "{agent-composed note title, ≤80 chars, in the user's voice}"
draft_body: |
  {agent-composed note body, ≤4000 chars, in the user's voice,
   grounded in the source content that triggered the action;
   use markdown for headings/bullets if the content calls for it}
target_folder: "{best-matching Apple Notes folder name seen during ingest; use 'Notes' when no specific folder is apparent}"
available_folders:
  - "{folder name observed during this ingest run, from list_notes folder field}"
  - "{include all distinct folder names seen across the notes fetched this run}"
```
```

### Field rules

**`source_context`**: 1–2 sentences explaining what triggered the create-note
action. Grounds the user in why AgntUX suggested this note.

**`draft_title`**: Agent-composed title, ≤80 chars, written in the user's
voice (no "Re:", no template brackets). Make it specific enough to find later.

**`draft_body`**: The pre-composed note body. Ground it in the actual source
content — do not paraphrase or speculate beyond what the source clearly states.
Write in first person as the user. ≤4000 chars; append `…` if truncated.

**`target_folder`**: The Apple Notes folder the user most likely wants this
note to land in, based on the content. Default `Notes` when no preference is
apparent. Must match a folder name the connector can write to.

**`available_folders`**: List of distinct folder names seen across all notes
fetched during this ingest run (from the `folder` field of `list_notes`
results). Gives the compose iframe its folder picker. Always include at least
`Notes`.

---

## Update-note mode

For actions whose `suggested_actions` opens the update-note view
(`agntux_apple_notes_update_note`):

```markdown
## Compose payload

```yaml
source_context: "{1–2 sentences: what prompted this update — why this note needs editing now}"
note_name: "{name of the existing note being updated, as returned by list_notes}"
note_id: "{stable note identifier — the x-coredata:// URI from the connector, or the note name when the stable id is unavailable}"
folder: "{folder the note lives in, as returned by list_notes}"
current_content: |
  {verbatim current note body text as returned by get_note_content,
   ≤4000 chars; truncate with '…' if longer}
draft_body: |
  {agent-composed revised body or addition to append, ≤4000 chars,
   in the user's voice, grounded in current_content and the triggering
   source content}
is_checklist: {true when the note contains checklist markers ('- [ ]' / '- [x]' lines); false otherwise}
checklist_items:
  - text: "{checklist item text}"
    checked: {true | false}
```
```

### Field rules

**`source_context`**: 1–2 sentences: what changed or what task prompted
the update.

**`note_name`**: Exact note name from `list_notes` — the view uses this to
display the note title and may pass it back on save.

**`note_id`**: The stable `x-coredata://...` URI returned by the connector for
this note. Pass the raw value verbatim. If the connector does not expose a
stable id on this path, use `note_name` as a fallback.

**`folder`**: The folder containing the note, as reported by `list_notes`.

**`current_content`**: Verbatim text from `get_note_content`. Truncate to
4000 chars with `…` if longer. The view shows this as the before-state context
and pre-seeds the draft field.

**`draft_body`**: Agent-composed revision or addition. If the note needs a
new section appended, include the full existing content plus the addition. If
only part of the content needs updating, include the full revised body so the
iframe's save action can replace the whole note.

**`is_checklist`**: Set `true` when the note body contains at least one
`- [ ]` or `- [x]` line. The view renders a checklist interface when true.

**`checklist_items`**: Required (may be `[]`) when `is_checklist: true`. One
entry per checklist item in document order. Parsed from `current_content` by
the view tool as a fallback, but authoring it here avoids parse ambiguity on
complex note formats.

For non-checklist notes, omit `checklist_items` or write it as `[]`.

---

## Cross-source-merged actions

When Step 9 finds a sibling open action to merge into, emit the payload as
`## Compose payload (apple-notes)` rather than `## Compose payload`. The
view tools read either header — same shape, different namespace. This is the
contract Step 9's cross-source merge depends on.
