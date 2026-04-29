# Notes Ingest

Turn your local Markdown notes into an AgntUX knowledge store.

Notes Ingest watches a local notes directory (Obsidian vault, plain Markdown folder, or
any directory of `.md` / `.txt` files) and extracts people, companies, projects, and topics
as AgntUX entities. Action items surface deadlines, follow-ups, and open questions mentioned
in your notes so nothing falls through the cracks.

## What it does

- Reads Markdown and plain-text files from a configurable local directory (default: `~/agntux/notes/`).
- Extracts entities: people named in meeting notes, companies referenced, project codenames from your glossary, recurring topics.
- Triages action items: deadlines, response-needed signals, risk flags — per your `user.md` preferences.
- Uses filesystem mtime as the cursor so only new or modified notes are processed on each run.
- Ships no UI components — this is a pure ingest plugin. All rendering is handled by agntux-core's triage UI.

## Install

1. Install **AgntUX Core** first (`/ux` → follow setup). This plugin requires it.
2. Install **Notes Ingest** from the marketplace.
3. Create your notes directory: `mkdir -p ~/agntux/notes/`
4. Set up a scheduled task in your host with prompt body `ux:notes-ingest` at **Daily 09:00**
   (or your preferred cadence). The plugin will populate your knowledge store on the first run.

## Configuration

**Notes directory:** by default the plugin reads from `~/agntux/notes/`. To point it at a
different directory (e.g., your Obsidian vault), edit `.mcp.json` inside the plugin directory
and change the path argument to `@modelcontextprotocol/server-filesystem`.

**Bootstrap window:** on the first run the plugin ingests files modified within the last 30
days. To change this, add `bootstrap_window_days: N` to the frontmatter of `~/agntux/user.md`.
Valid range: 1–365.

**Triage preferences:** edit `~/agntux/user.md` → `# Preferences` to control which notes
generate action items. Add patterns to `## Always action-worthy` or `## Usually noise`.

## Limitations

- Processes `.md` and `.txt` files only. RTF, DOCX, PDF are skipped.
- Flat directory only by default (no recursion). Nested structures are flagged in
  `.state/notes/notes.md → ## Open questions` for future configuration.
- No OAuth or API keys required — reads directly from the local filesystem via the
  `@modelcontextprotocol/server-filesystem` MCP server.
- Ships no UI components. Action items appear in agntux-core's triage UI.

## Known canonical-hook diffs

Two files in `hooks/lib/` differ from `canonical/hooks/lib/` by design — every
diff is a documented placeholder substitution per P2 §8. Verifiers running
`shasum -c canonical/hooks/checksums.txt` from this plugin's `hooks/` directory
see these two diverge:

| File | Reason for divergence |
|---|---|
| `hooks/lib/public-key.mjs` | `{{PUBLIC_KEY_KID}}` → `agntux-license-v1`; `{{PUBLIC_KEY_SPKI_PEM}}` → real Ed25519 PEM from `canonical/kms-public-keys.json`. Substitution per P2 §8. |
| `hooks/lib/agntux-plugins.mjs` | `{{AGNTUX_PLUGIN_SLUGS}}` → `["agntux-core", "notes-ingest"]`. Substitution per P2 §8. |

All other hook files (`hooks.json`, `license-check.mjs`, `license-validate.mjs`,
`lib/{cache,device,jwt-verify,refresh,scope,ui}.mjs`) are byte-identical to canonical
and pass `shasum -c` cleanly.

Notes Ingest does NOT ship a local stdio MCP server (no UI components — Lane B
is unused). The `.mcp.json` registers only the upstream filesystem source MCP per
P5 §6.3's no-UI plugin shape.

## License

Elastic License v2 (ELv2). See the `LICENSE` file for details.

## Support

- Bugs and proposals: https://github.com/agntux/plugins/issues?q=label%3Anotes-ingest
- Email: support@agntux.ai
