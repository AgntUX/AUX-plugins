---
description: Apply the P7 §5.1 version-bump rubric for a plugin
argument-hint: <slug> <major|minor|patch>
allowed-tools: Bash(cat *), Bash(git diff *), Bash(git log *), Bash(npx tsx scripts/verify-version-changelog.ts), Bash(npx tsx scripts/changelog-bump-heuristic.ts), Read, Edit, Write
---

You are bumping the version of plugin `$1` by `$2` (one of `major`, `minor`, `patch`). Per P7 §5.1:

- **MAJOR** — breaking change to the user-visible surface (removed prompts, removed UI components, breaking schema changes in `listing.yaml`, license-class change requiring re-onboarding).
- **MINOR** — additive change (new prompts, new UI components, additive schema fields, copy improvements).
- **PATCH** — bug fix or cosmetic change with no surface impact.

Steps:

1. Read `plugins/$1/plugin.json` to get the current version. Compute the new version.
2. Read `plugins/$1/CHANGELOG.md` and confirm the most-recent section header matches the current `plugin.json` version. If not, surface the mismatch and STOP.
3. Run `npx tsx scripts/changelog-bump-heuristic.ts --plugin $1 --bump $2` to surface any rubric mismatches between the actual diff and the requested bump kind. If the heuristic warns, ask the maintainer whether to proceed or downgrade/upgrade the bump.
4. Show the proposed edit:
   - Update `plugin.json.version` to the new version.
   - Prepend a new section to `CHANGELOG.md` with header `## <new-version> — YYYY-MM-DD` and ask the maintainer for the bullet list (Added/Changed/Fixed). Format per Keep a Changelog conventions.
5. After the maintainer approves the proposed edit, write both files.
6. Run `npx tsx scripts/verify-version-changelog.ts --plugin $1` to confirm the version row matches.
7. Output the next steps: stage, commit with `chore($1): vX.Y.Z`, push, open PR using `.github/PULL_REQUEST_TEMPLATE.md`, and tag after merge per P7 §5.4.

Never write the changelog bullets yourself — those are the maintainer's narrative. Never tag yourself; tagging happens on `regenerate-indexes.yml` after merge.
