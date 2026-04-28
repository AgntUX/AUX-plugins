---
description: Walk through the P7 §11.1 rollback runbook for a plugin
argument-hint: <slug>
allowed-tools: Bash(git log *), Bash(git show *), Bash(git diff *), Bash(cat *), Bash(npx tsx scripts/verify-canonical-hooks.ts), Read
---

You are walking a maintainer through reverting plugin `$ARGUMENTS` to its previous version per P7 §11.1.

Phase 1 — Identify the bad version

1. Run `git log --oneline plugins/$ARGUMENTS/ -10` and identify the merge commit that introduced the regression. Confirm the SHA with the maintainer before continuing.
2. Show the commit diff (`git show <sha> -- plugins/$ARGUMENTS/`) and confirm it's the right one.
3. Identify the prior version: read `plugin.json` from one commit before (`git show <sha>^:plugins/$ARGUMENTS/plugin.json`).

Phase 2 — Draft the revert

1. Output a draft revert PR title: `revert($ARGUMENTS): <previous-version> due to <reason>`.
2. Output a draft PR body referencing the bad commit, the regression cause, and the rollback target version.
3. Output the exact `git revert <sha>` command. Do NOT run it; the maintainer runs it.

Phase 3 — Pre-merge verification

After the maintainer creates the revert branch, walk them through:

1. Run `npm run lint:marketplace -- --plugin $ARGUMENTS` (must exit 0).
2. Run `npx tsx scripts/verify-canonical-hooks.ts` (must exit 0).
3. Run `npx tsx scripts/verify-version-changelog.ts --plugin $ARGUMENTS` (must exit 0).
4. Confirm CI is green on the revert branch before merging.

Phase 4 — Post-merge

After merge:

1. Confirm `regenerate-indexes.yml` fired and pushed regenerated index files back to main.
2. Confirm a new tag (`$ARGUMENTS-v<previous-version>` or a `revert-` tag per the team's convention) was created.
3. Note the auto-update timeline (P7 §8.1): users on the old version stay until SessionStart re-fetches the marketplace tree.

Stop after each phase to confirm the maintainer is ready for the next.
