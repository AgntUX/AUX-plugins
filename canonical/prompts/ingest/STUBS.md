# TODO: Ingest Prompt Stubs

**TO BE FILLED BY T16 / T17 (P5 ingest plugin template — prompt templates)**

This directory will contain the canonical prompt templates for per-source ingest
plugins. P6's plugin generator copies these verbatim (with placeholder substitution)
when generating any ingest plugin (`gmail-ingest`, `slack-ingest`, `notes-ingest`, etc.).

## Files T16/T17 will deliver

Per P5 §3 (SKILL.md template), §4 (ingest subagent template), and the repo layout
in please-study-these-plans-fuzzy-valley.md §3.1:

```
canonical/prompts/ingest/
├── orchestrator.md        # Per-source SKILL.md template (P5 §3.2)
│                          # Frontmatter: name: {{plugin-slug}}, description: ...
│                          # Body: two-check guard (project root + user.md gate),
│                          #        freshness check, Lane A (ingest) + Lane B (UI),
│                          #        fallback, out-of-scope list
├── ingest.md              # Ingest subagent template (P5 §4.2)
│                          # Frontmatter: name: ingest, tools: Read,Write,Edit,Glob,Grep
│                          # Body: two-check guard, read-first sequence, lock protocol,
│                          #        time window, fetch loop (Steps A–E), post-loop
└── ui-handlers/
    └── _readme.md         # Explains the ui-handlers/ convention:
                           # one file per UI handler is added per plugin by T19/T20
                           # (the view-tool architecture per P5 §7.3 / P9 §4–§6).
                           # notes-ingest ships zero files here (no UI handlers).
```

## Placeholder variables these files will use

All placeholders use `{{double-curly}}` format. The generator (P6) substitutes
these from a per-source spec JSON/YAML.

| Placeholder | Example (notes-ingest) | Source |
|---|---|---|
| `{{plugin-slug}}` | `notes-ingest` | manifest name |
| `{{source-display-name}}` | `Apple Notes` | per-source spec |
| `{{source-slug}}` | `notes` | per-source spec; matches `.state/sync.md` H1 |
| `{{recommended-cadence}}` | `Daily 09:00` | per-source spec |
| `{{source-cursor-semantics}}` | `local-file modification time (RFC 3339)` | per-source spec |
| `{{source-mcp-tools}}` | `the local filesystem MCP server (read-only)` | per-source spec |
| `{{ui-handler-trigger-list}}` | `(this plugin ships no UI components — Lane B is unused)` | per-source spec |
| `{{plugin-version}}` | `1.0.0` | manifest version |

## Do not add content here

Do not add prompt content to this directory until T16/T17 land. P6's generator
reads from this directory; placeholder content would be copied into production plugins.
