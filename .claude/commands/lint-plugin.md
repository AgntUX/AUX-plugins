---
description: Run the P15 marketplace linter, hook byte-freeze check, and version-match check against one plugin and explain results
argument-hint: <slug>
allowed-tools: Bash(npm run lint:marketplace -- *), Bash(cat *), Bash(ls *), Bash(shasum *), Bash(npx tsx scripts/verify-version-changelog.ts *), Bash(cd *), Read
---

Run THREE checks against `plugins/$ARGUMENTS/` — the same three that CI
runs in `lint.yml`, `hook-hash-check.yml`, and `version-check.yml`. All
three must exit clean for the PR to merge.

## Check 1 — Marketplace metadata linter

```
npm run lint:marketplace -- --plugin $ARGUMENTS
```

For each finding:

1. Show the raw line (`code`, `severity`, `file`, `line`, `message`).
2. Look up the error code in `.claude/skills/plugin-author/SKILL.md` §18.1
   and explain in plain language what the rule enforces and why. Cross-reference
   `/Users/johnjordan/.claude/plans/p15-marketplace-metadata.md` §5 if you
   need the deeper spec.
3. Suggest the smallest possible fix — point at the field/file/line that
   needs to change. DO NOT mutate files yourself; the user will run the
   fix command after agreeing.
4. If the finding is a warning (`W01`/`W02`/`W03`), say so: warnings don't
   block CI but should be addressed in the same PR when possible.

If the linter itself crashes (exit code other than 0 or 1), surface the
stack trace and ask the maintainer whether to file a bug under the `linter`
label.

## Check 2 — Hook byte-freeze check

```
cd plugins/$ARGUMENTS/hooks && shasum -a 256 -c ../../../canonical/hooks/checksums.txt
```

Expected output: every file reports `OK` except `lib/public-key.mjs` and
`lib/agntux-plugins.mjs`, which report `FAILED` (this is the documented
substitution per SKILL.md §10.1 and the plugin's README "Known canonical-hook
diffs" section).

Findings to surface:

- **Any other `FAILED` line** — the plugin has drifted from canonical hooks.
  This will fail CI's `hook-hash-check.yml`. Tell the user to restore from
  `canonical/hooks/`. Do NOT mutate files yourself.
- **`lib/public-key.mjs` reports `OK` instead of `FAILED`** — the placeholder
  substitution wasn't applied. Tell the user to substitute `{{PUBLIC_KEY_KID}}`
  and `{{PUBLIC_KEY_SPKI_PEM}}` from `canonical/kms-public-keys.json`.
- **`lib/agntux-plugins.mjs` reports `OK` instead of `FAILED`** — same.
  The placeholder `{{AGNTUX_PLUGIN_SLUGS}}` should be substituted with
  `["agntux-core", "$ARGUMENTS"]`.

## Check 3 — Version-match check

```
npx tsx scripts/verify-version-changelog.ts --plugin $ARGUMENTS
```

Confirms `plugins/$ARGUMENTS/.claude-plugin/plugin.json`'s `version` field
matches the most-recent `## [X.Y.Z] — YYYY-MM-DD` header in
`plugins/$ARGUMENTS/CHANGELOG.md`.

Findings to surface:

- **Mismatch** — show both values, point at the file that needs updating.
  Bump rule: change CHANGELOG to match the new version OR vice versa
  depending on which one represents the actual release intent. SKILL.md
  §15.3 has the bump rubric (MAJOR / MINOR / PATCH).

## Summary

After all three checks, summarize:

> Lint: X errors, Y warnings, exit code Z.
> Hook byte-freeze: clean | <N> unexpected diffs.
> Version match: ok | mismatch (plugin.json: X, CHANGELOG: Y).

If all three are clean, congratulate the author and remind them they can
also run `npm run lint:marketplace` (no flags) to confirm the whole repo
lints clean.

If any check failed, list the priority fix order (lint errors first,
then hook drift, then version mismatch — version mismatch is usually a
30-second fix that's easy to forget).

Do not run the linter against other plugins unless the user explicitly
asks.
