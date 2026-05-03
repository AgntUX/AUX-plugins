---
description: Scaffold a new AgntUX ingest plugin from canonical templates with placeholder substitution
argument-hint: <slug> <source-display-name>
allowed-tools: Bash(cp *), Bash(mkdir *), Bash(ls *), Bash(cat *), Bash(shasum *), Read, Write, Edit
---

You are scaffolding a new AgntUX ingest plugin. The slug and source display
name are in `$ARGUMENTS` — expected format: `<slug> <Source Display Name>`,
e.g. `agntux-linear Linear` or `agntux-gmail Gmail`.

Read `plugins/plugin-toolkit/skills/author/SKILL.md` end-to-end before doing
anything that mutates the tree. That skill is the spec for what you're
about to scaffold; this command is its automation half.

## Parse arguments

1. Split `$ARGUMENTS` on the first whitespace: `{slug} {display_name}`.
2. Validate the slug:
   - Matches `^[a-z][a-z0-9-]*[a-z0-9]$` (PluginSlugRe).
   - Starts with `agntux-` (per the marketplace convention; lint code E14
     fires on `proposed_schema` for this slug shape).
   - The implicit `{source-slug}` is the slug minus the `agntux-` prefix.
3. Validate the display name:
   - 1–40 chars (`requires_source_mcp.display_name` constraint).
   - Title case typical (e.g., `Linear`, `Gmail`, `Slack`, `Notes`).

If either is malformed, ask the user to re-supply and stop.

## Confirm slug is fresh

Before mutating anything, verify:

1. `plugins/{slug}/` does not exist.
2. The slug is not already listed in `.claude-plugin/marketplace.json`
   (read the file, check the `plugins[]` array).

If either check fails, tell the user the plugin already exists and stop.
Suggest `/lint-plugin {slug}` if they meant to work on the existing plugin.

## Confirm intent

Tell the user what you're about to do:

> I'll scaffold `plugins/{slug}/` based on `plugins/agntux-slack/` (the
> minimal reference). Source-specific bits — sync skill placeholders,
> action class proposals, suggested actions — get sensible defaults you'll
> need to refine before opening a PR. Continue?

Wait for explicit "yes" / "continue" / "go". Don't proceed on silence.

## Scaffold the directory tree

Mirror `plugins/agntux-slack/` minus the source-specific files. For each
target file below, prefer Read-then-Write (so you see what you're copying).
For the byte-frozen hooks, use Bash `cp` to preserve bytes exactly.

There is **no `agents/` directory**. The ingest and (optional) drafting
flows are top-level skills with `context: fork` + `agent: general-purpose`,
not sub-agents. The legacy sub-agent pattern is retired (Cowork blocks
the dispatch-time `tools:` edit it required for UUID-prefixed connector
tools).

### Step 1 — Directory skeleton

```
mkdir -p plugins/{slug}/{.claude-plugin,skills/sync,hooks/lib,marketplace/screenshots,__tests__}
```

If the source has write tools (you'll add `skills/draft/SKILL.md` in
Step 7), also `mkdir -p plugins/{slug}/skills/draft`.

### Step 2 — `.claude-plugin/plugin.json`

Write `plugins/{slug}/.claude-plugin/plugin.json`:

```json
{
  "name": "{slug}",
  "version": "0.1.0",
  "description": "{Display Name} integration for AgntUX. Ingests data from {Display Name} into your knowledge store.",
  "author": { "name": "AgntUX", "email": "support@agntux.ai" },
  "license": "ELv2",
  "recommended_ingest_cadence": "Daily 04:00"
}
```

Tell the user: "`recommended_ingest_cadence` is free-form descriptive
text — replace `Daily 04:00` with whatever phrasing best matches when
your source actually produces signal the user cares about. Examples:
`Hourly` (only if overnight signal is load-bearing — incident channels,
security feeds), `Every 30 min, 7am–10pm weekdays only` (chat during
work hours; quiet otherwise; conserves tokens), `Weekly Friday 16:00`
(low-volume weekly summary), `0,30 7-22 * * 1-5` (cron syntax). See
`plugins/plugin-toolkit/agents/manifest-author.md` for the rubric."

### Step 3 — `LICENSE`

Copy `plugins/agntux-slack/LICENSE` byte-for-byte to
`plugins/{slug}/LICENSE`. **Do NOT modify.** This is the per-plugin ELv2
stub pointing to the root LICENSE.

```
cp plugins/agntux-slack/LICENSE plugins/{slug}/LICENSE
```

### Step 4 — `package.json` and `vitest.config.ts`

Copy both from `plugins/agntux-slack/`:

```
cp plugins/agntux-slack/package.json plugins/{slug}/package.json
cp plugins/agntux-slack/vitest.config.ts plugins/{slug}/vitest.config.ts
```

Then Edit `plugins/{slug}/package.json` to swap the `name` field from
`@agntux/agntux-slack-plugin` to `@agntux/{slug}-plugin`. Leave version,
type, scripts, devDependencies untouched.

### Step 5 — `hooks/` (byte-frozen)

Copy every file from `canonical/hooks/` to `plugins/{slug}/hooks/`,
preserving bytes:

```
cp -R canonical/hooks/. plugins/{slug}/hooks/
```

Then substitute the two exempt files (per `canonical/README.md`):

**`plugins/{slug}/hooks/lib/public-key.mjs`** — Read
`canonical/kms-public-keys.json` to get the current `kid` and `spki_pem`.
Edit the placeholders:
- `{{PUBLIC_KEY_KID}}` → `agntux-license-v1` (current kid).
- `{{PUBLIC_KEY_SPKI_PEM}}` → the real Ed25519 PEM string from the JSON.

**`plugins/{slug}/hooks/lib/agntux-plugins.mjs`** — Edit:
- `["{{AGNTUX_PLUGIN_SLUGS}}"]` → `["agntux-core", "{slug}"]` (replace
  the entire bracketed expression with a JSON array literal — see
  `canonical/README.md` for the array-bracketed substitution rule).

After substitution, verify the rest of `hooks/` matches canonical:

```
cd plugins/{slug}/hooks && shasum -a 256 -c ../../../canonical/hooks/checksums.txt
```

Every file should report `OK` except `lib/public-key.mjs` and
`lib/agntux-plugins.mjs` which report `FAILED` (expected and documented).

### Step 6 — `skills/sync/SKILL.md` (substituted from canonical)

Read `canonical/prompts/ingest/skills/sync/SKILL.md`. Substitute these
placeholders and write to `plugins/{slug}/skills/sync/SKILL.md`:

| Placeholder | Substitute with |
|---|---|
| `{{plugin-slug}}` | `{slug}` (e.g., `agntux-linear`) |
| `{{plugin-version}}` | `0.1.0` |
| `{{source-display-name}}` | `{Display Name}` (e.g., `Linear`) |
| `{{source-slug}}` | `{slug}` minus the `agntux-` prefix (e.g., `linear`) |
| `{{recommended-cadence}}` | The same value you set in `plugin.json` (Step 2) |
| `{{source-cursor-semantics}}` | **Stub: `<TODO: copy verbatim from canonical/prompts/ingest/cursor-strategies.md for your source; if your source isn't documented there, add a section in the same shape and coordinate with maintainers>`** |
| `{{source-mcp-tools}}` | **Stub: `<TODO: comma-list of source MCP tool root names your skill calls; e.g. linear_list_issues, linear_get_issue, linear_list_projects — these are documentation only, not a tools: whitelist; the general-purpose agent inherits all tools at runtime>`** |

Single-curly tokens (`{ref}`, `{N hours/days}`, `{imperative}`) are
runtime-filled — leave them alone.

The skill's frontmatter MUST end up with `context: fork` and
`agent: general-purpose` and **no `tools:` line** (the canonical
template already has the right shape; just substitute the placeholders).

**Important:** the directory shape is `skills/sync/SKILL.md` (the file
inside a `sync/` directory). A flat `skills/sync.md` is silently dropped
by Claude Code's plugin spec.

Tell the user: "Two placeholders in `skills/sync/SKILL.md` are stubs
marked TODO — `{{source-cursor-semantics}}` and `{{source-mcp-tools}}`.
You must fill these before the cold-start test will pass.
`canonical/prompts/ingest/cursor-strategies.md` (if present) explains
the cursor strategies catalogue."

### Step 7 — `skills/draft/SKILL.md` (only if the source has write tools)

Skip this step for read-only sources (notes folders, analytics
dashboards, any source without write tools).

If the source has write tools (Slack send, Gmail send, Linear comment,
HubSpot note, Jira transition, etc.), copy
`plugins/plugin-toolkit/skills/author/templates/draft-subagent.md` (the
fenced markdown block) into `plugins/{slug}/skills/draft/SKILL.md` and
substitute the placeholders (`{plugin-slug}`, `{source-display-name}`,
source-specific tool names per Step 2 of the skeleton).

The drafting skill's frontmatter MUST end up with `context: fork` +
`agent: general-purpose` + **no `tools:` line** (same shape as the sync
skill). The chat-confirmation gate at Step 4 of the skeleton is the
safety property — never weaken it.

### Step 8 — `marketplace/listing.yaml` (stub for the user to complete)

Write `plugins/{slug}/marketplace/listing.yaml` with this scaffold. The
TODO comments are the user's prompts to fill in:

```yaml
tagline: "TODO: one-sentence pitch (1–80 chars). Example: \"{Display Name} integration for your AgntUX knowledge store.\""
description: |
  TODO: long-form prose for the detail page (1–500 chars; markdown allowed).
  Describe what the plugin does, who it's for, and what data it ingests.
categories:
  # TODO: pick 1–3 from: productivity, communication, crm, project-management,
  # developer-tools, analytics, notes-knowledge. (`meta` is reserved for agntux-core.)
  - TODO
keywords:
  # TODO: 1–10 entries; each lowercase, digits, hyphens; 2–32 chars.
  - {source-slug}
  - TODO
available_on:
  - trial
  - pro
  - team
  - enterprise
data_ingested:
  # TODO: up to 12 entries describing what the plugin reads.
  - "TODO: e.g. {Source} items you're assigned to or watching"
supported_prompts:
  - prompt: "/{slug}:sync"
    purpose: "Run a {Display Name} sync now (manual) or on schedule. TODO: describe your recommended cadence in plain language (≤200 chars)."
support:
  url: "https://github.com/AgntUX/AUX-plugins/issues?q=label%3A{slug}"
  email: "support@agntux.ai"
requires_plugins:
  - agntux-core
requires_source_mcp:
  # TODO: pick connector (preferred) or npm.
  source: connector
  connector_slug: {source-slug}
  display_name: "{Display Name}"
developer:
  name: "AgntUX"
  github_handle: "agntux"
proposed_schema:
  # TODO: see manifest-author for guidance.
  # entity_subtypes: propose person, company, project, topic unless your source
  #   genuinely needs different shapes. Don't propose source-specific subtypes
  #   like {source-slug}-channel — those are conversational artefacts, not entities.
  # action_classes: use the canonical six (deadline, response-needed,
  #   knowledge-update, risk, opportunity, other). Don't propose duplicates.
  entity_subtypes:
    - subtype: person
      description: "TODO: individuals encountered in {Display Name} data."
      required_frontmatter:
        - id
        - type
        - schema_version
        - subtype
        - aliases
        - sources
        - created_at
        - updated_at
        - last_active
        - deleted_upstream
    - subtype: company
      description: "TODO: organisations referenced in {Display Name} data."
      required_frontmatter: [id, type, schema_version, subtype, aliases, sources, created_at, updated_at, last_active, deleted_upstream]
    - subtype: project
      description: "TODO: workstreams/codenames referenced in {Display Name} data."
      required_frontmatter: [id, type, schema_version, subtype, aliases, sources, created_at, updated_at, last_active, deleted_upstream]
    - subtype: topic
      description: "TODO: recurring conversation themes from {Display Name}."
      required_frontmatter: [id, type, schema_version, subtype, aliases, sources, created_at, updated_at, last_active, deleted_upstream]
  action_classes:
    - class: deadline
      description: "Explicit due date or deadline mentioned in {Display Name} data."
    - class: response-needed
      description: "TODO: source-specific signals — DM, mention, assigned-to-you, etc."
    - class: knowledge-update
      description: "TODO: source-specific signals — pinned message, decision log, doc update."
    - class: risk
      description: "TODO: source-specific signals — incident, blocker, security flag."
    - class: opportunity
      description: "TODO: source-specific signals — competitor, lead, market signal."
    - class: other
      description: "Escape hatch — requires reason_detail."
  cursor_semantics: "TODO: see canonical/prompts/ingest/cursor-strategies.md for your source."
  source_id_format: "TODO: describe the unique identifier shape, e.g. <channel_id>#<thread_ts>."
```

### Step 9 — `marketplace/icon.png` (placeholder)

Copy agntux-slack's icon as a placeholder:

```
cp plugins/agntux-slack/marketplace/icon.png plugins/{slug}/marketplace/icon.png
```

Tell the user: "Icon is a agntux-slack placeholder for now. Commission a
real 512×512 PNG (≤512 KB) before launch."

### Step 10 — `marketplace/screenshots/00-placeholder.png`

Copy one agntux-slack screenshot as a placeholder so lint Pass 1 doesn't
fail on missing screenshots:

```
cp plugins/agntux-slack/marketplace/screenshots/$(ls plugins/agntux-slack/marketplace/screenshots/ | head -1) plugins/{slug}/marketplace/screenshots/00-placeholder.png
```

Tell the user: "Screenshot is a placeholder. Capture 1–3 real screenshots
(1280×720 to 2560×1440, aspect 1.33–2.33, ≤2 MB each) before launch."

### Step 11 — `README.md` (stub)

Write `plugins/{slug}/README.md`:

```markdown
# {Display Name}

TODO: one-paragraph elevator pitch. Replace this with what your plugin does.

## What it does

- TODO: bulleted list of capabilities.
- Reads {Display Name} data via the source MCP.
- Extracts entities (people, companies, projects, topics) into your AgntUX knowledge store.
- Triages action items (deadlines, response-needed, knowledge updates, risks, opportunities).

## Install

1. Install **AgntUX Core** first and run `/agntux-onboard`. This plugin requires it.
2. Install **{Display Name}** from the marketplace.
3. Authorise the {Display Name} connector in your host's **Customize → Connectors**.
4. Re-run `/agntux-onboard` (or run it for the first time) — the architect's Mode B reads our schema proposal directly from `marketplace/listing.yaml → proposed_schema`, walks you through it in plain language, and writes the approved contract.
5. Set up a scheduled task in your host with prompt body `/{slug}:sync`. Cadence per your `recommended_ingest_cadence`.
6. To trigger a sync manually, run `/{slug}:sync` (or `/agntux-sync {slug}` from the core namespace).

## Configuration

TODO: any user-tunable settings (e.g., `bootstrap_window_days` overrides,
per-source filters, channel allow/deny lists). If your plugin has none,
say so and remove this section.

## Limitations

- TODO: what the plugin doesn't do.

## Known canonical-hook diffs

Two files in `hooks/lib/` differ from `canonical/hooks/lib/` by design — every
diff is a documented placeholder substitution. Verifiers running
`shasum -c canonical/hooks/checksums.txt` from this plugin's `hooks/` directory
see these two diverge:

| File | Reason for divergence |
|---|---|
| `hooks/lib/public-key.mjs` | `{{PUBLIC_KEY_KID}}` → `agntux-license-v1`; `{{PUBLIC_KEY_SPKI_PEM}}` → real Ed25519 PEM from `canonical/kms-public-keys.json`. |
| `hooks/lib/agntux-plugins.mjs` | `["{{AGNTUX_PLUGIN_SLUGS}}"]` → `["agntux-core", "{slug}"]`. |

All other hook files are byte-identical to canonical and pass `shasum -c`
cleanly.

## License

Elastic License v2 (ELv2). See the `LICENSE` file for details.

## Support

- Bugs and proposals: https://github.com/AgntUX/AUX-plugins/issues?q=label%3A{slug}
- Email: support@agntux.ai
```

### Step 12 — `CHANGELOG.md`

Write `plugins/{slug}/CHANGELOG.md`:

```markdown
# Changelog

All notable changes to {slug} are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — {YYYY-MM-DD today}

### Added
- Initial release.
```

Use today's date (the agent should resolve this from the system clock).

### Step 13 — `__tests__/cold-start.test.ts`

Write `plugins/{slug}/__tests__/cold-start.test.ts` using this skeleton,
substituted for the slug:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(__dirname, "..");

describe("manifest", () => {
  it("plugin.json has required fields", () => {
    const m = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf-8"));
    expect(m.name).toBe("{slug}");
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    // recommended_ingest_cadence is free-form descriptive text.
    expect(m.recommended_ingest_cadence).toBeTruthy();
    expect(typeof m.recommended_ingest_cadence).toBe("string");
  });
});

describe("hooks wiring", () => {
  it("SessionStart license-check + PreToolUse license-validate, no PostToolUse", () => {
    const h = JSON.parse(readFileSync(join(PLUGIN_ROOT, "hooks/hooks.json"), "utf-8"));
    expect(h.hooks.SessionStart).toBeDefined();
    expect(h.hooks.PreToolUse).toBeDefined();
    expect(h.hooks.PostToolUse).toBeUndefined();
  });
});

describe("skill shape", () => {
  it("legacy agents/ directory is absent (top-level-skill pattern)", () => {
    expect(existsSync(join(PLUGIN_ROOT, "agents"))).toBe(false);
  });

  it("skills/sync/SKILL.md exists with no unsubstituted placeholders", () => {
    const p = readFileSync(join(PLUGIN_ROOT, "skills/sync/SKILL.md"), "utf-8");
    const matches = p.match(/\{\{[a-z-]+\}\}/g);
    expect(matches).toBeNull();
  });

  it("sync skill uses context: fork + general-purpose (no tools: whitelist)", () => {
    const p = readFileSync(join(PLUGIN_ROOT, "skills/sync/SKILL.md"), "utf-8");
    const fmMatch = p.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmMatch?.[1] ?? "";
    expect(fm).toMatch(/^context: fork$/m);
    expect(fm).toMatch(/^agent: general-purpose$/m);
    expect(fm).not.toMatch(/^tools:/m);
  });
});
```

If your source has threads (Slack, Gmail, Notion comments, Linear comments,
HubSpot deal notes), also stub `thread-association.test.ts` — leave the
assertions as TODO comments for the user to fill in once the example
fixture exists.

If your source has write tools (the chat-confirm-then-write pattern),
also stub `draft-flow.test.ts` asserting `skills/draft/SKILL.md` exists,
uses the same `context: fork` + `agent: general-purpose` shape with no
`tools:` whitelist, and contains the literal "Send this now? (yes / no
/ edit)" confirmation prompt.

## Confirm + summarise next steps

After all 13 steps complete, tell the user (concise — under 200 words):

> Scaffolded `plugins/{slug}/`. The structure is in place; source-specific
> bits need your input before the linter passes:
>
> 1. **`skills/sync/SKILL.md`** — fill `{{source-cursor-semantics}}` and
>    `{{source-mcp-tools}}` placeholders (search for `<TODO:` in the file).
> 2. **`marketplace/listing.yaml`** — every `TODO:` comment marks a field
>    that needs a real value. Pay special attention to `categories`,
>    `keywords`, `data_ingested`, `proposed_schema`.
> 3. **`README.md`** — replace TODO sections with your plugin's actual pitch
>    and capabilities.
> 4. **`marketplace/icon.png`** and **`marketplace/screenshots/00-placeholder.png`**
>    are agntux-slack placeholders. Replace before launch (placeholders are
>    fine for the initial draft PR).
> 5. If the source has write tools, also fill in `skills/draft/SKILL.md`
>    (Step 7 created the stub if applicable).
>
> Once filled in, run `/lint-plugin {slug}` to verify.
>
> Coordinated agntux-core changes: add an entry to
> `plugins/agntux-core/data/plugin-suggestions.json`. I haven't done this
> automatically — that's a separate plugin's territory and you should
> review the addition deliberately.

Do NOT commit, push, or run the linter. Leave that to the user.

## What this command does NOT do

- Doesn't run the linter (use `/lint-plugin {slug}` after filling in TODOs).
- Doesn't run `npm install` or `npm test` (do this manually after the
  TODOs are addressed).
- Doesn't touch `plugins/agntux-core/` (the `plugin-suggestions.json` and
  `agntux-plugins.mjs` updates are separate, deliberate edits).
- Doesn't open a PR or commit.
- Doesn't substitute `bin/` (some plugins need it for cross-platform
  filesystem paths; most ingest plugins don't).
- Doesn't author UI handlers (those depend on source-specific decisions
  you make after scaffolding).
