# Quickstart — scaffold a new ingest plugin

The fastest path to a working `agntux-{source}` ingest plugin is to
clone the in-repo reference (today: `plugins/agntux-slack/` for a
comprehensive example) as the structural baseline and replace the
source-specific bits. Walking through it for a hypothetical
`agntux-linear` (every AgntUX plugin slug starts with `agntux-`; the
legacy `-ingest` suffix is retired):

1. **Create the directory tree.** Required files:
   ```
   plugins/agntux-linear/
   ├── .claude-plugin/plugin.json
   ├── CHANGELOG.md
   ├── LICENSE                       (ELv2 stub — copy from agntux-slack, do NOT modify)
   ├── README.md
   ├── package.json                  (vitest test harness)
   ├── vitest.config.ts
   ├── agents/
   │   └── ingest.md                 (substituted from canonical/prompts/ingest/agents/ingest.md)
   ├── skills/
   │   └── sync/SKILL.md             (substituted from canonical/prompts/ingest/skills/orchestrator.md)
   ├── hooks/                        (copy byte-for-byte from canonical/hooks/, with two substitutions)
   ├── marketplace/
   │   ├── icon.png                  (512×512 PNG ≤ 512 KB)
   │   ├── listing.yaml
   │   └── screenshots/00-*.png      (≥ 1, ≤ 8)
   └── __tests__/
       ├── cold-start.test.ts
       └── (per-source tests as needed)
   ```
2. **Fill in `plugin.json`** (delegate to `manifest-author`). Set
   `version: "0.1.0"` and `recommended_ingest_cadence` to one of the
   documented cadence shapes.
3. **Fill in `listing.yaml`** (delegate to `manifest-author`). Use the
   canonical six action classes. Don't invent fields; the linter
   rejects unknowns (E05) and reserved (E11).
4. **Substitute `agents/ingest.md`** from
   `canonical/prompts/ingest/agents/ingest.md` (delegate to
   `ingest-prompt-author`). The 12-step procedure is canonical — don't
   fork it.
5. **Substitute `skills/sync/SKILL.md`** from
   `canonical/prompts/ingest/skills/orchestrator.md` (delegate to
   `ingest-prompt-author`). Watch for the directory-shape trap — Claude
   Code silently drops `skills/{name}.md` flat files.
6. **Copy `hooks/`** byte-for-byte from `canonical/hooks/` (delegate to
   `invariant-checker` for verification). Substitute
   `lib/public-key.mjs` and `lib/agntux-plugins.mjs`. Verify with
   `shasum -a 256 -c canonical/hooks/checksums.txt`.
7. **Drop in placeholder icon and screenshots.** Real assets before
   launch; placeholders are fine for the initial PR.
8. **Write `cold-start.test.ts`** (delegate to `tests-author`). Asserts
   manifest shape, hook wiring, prompt substitution.
9. **Lint locally** (delegate to `release-checker`):
   `npm run lint:marketplace -- --plugin agntux-linear`. Exit code 0
   means CI will pass.
10. **Open a PR.** Use `.github/PULL_REQUEST_TEMPLATE.md`.

The `/scaffold-plugin {slug} {source-name}` command at
`.claude/commands/scaffold-plugin.md` automates steps 1, 5, 6, and 7.
You still author the listing fields, the agent prompt substitution,
and the tests by hand because each requires source-specific judgment —
and each has a specialist agent.
