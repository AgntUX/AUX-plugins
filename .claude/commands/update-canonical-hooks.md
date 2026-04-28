---
description: Walk through the P7 §11.3 canonical-hook update runbook
argument-hint:
allowed-tools: Bash(shasum *), Bash(cat *), Bash(ls *), Bash(git status), Bash(git diff *), Bash(npx tsx scripts/verify-canonical-hooks.ts), Read
---

You are helping a maintainer update the byte-frozen `canonical/hooks/` bundle. This is a security-sensitive operation; the bytes are pinned by sha256 and every plugin in `plugins/*/hooks/` must match. Drift causes the `hook-hash-check.yml` workflow to fail.

Phase 1 — Confirm the change is necessary

1. Ask the maintainer: what triggered this update? (security patch, license-protocol change, KMS key rotation, etc.)
2. Confirm the change is approved by `@agntux/security` (canonical/ ownership per CODEOWNERS).

Phase 2 — Update the canonical bytes

1. Show the current `canonical/hooks/checksums.txt`.
2. The maintainer applies the change directly under `canonical/hooks/` (you can suggest specific edits but never write the hook bytes yourself; the security team owns the signed prose).
3. Recompute checksums:
   ```bash
   cd canonical/hooks && find . -type f -not -name checksums.txt -exec shasum -a 256 {} + | sort > checksums.txt
   ```
4. Run `npx tsx scripts/verify-canonical-hooks.ts` and confirm exit 0.

Phase 3 — Bump every plugin's hook copy

1. List every plugin under `plugins/*/`. For each:
   a. Copy `canonical/hooks/` over `plugins/<slug>/hooks/` byte-for-byte.
   b. Bump `plugins/<slug>/plugin.json.version` (PATCH minimum; MINOR if the hook change adds capability; MAJOR if it removes capability).
   c. Append a CHANGELOG entry citing the canonical-hook update.
2. Show the maintainer the consolidated diff before staging.

Phase 4 — PR composition

1. Title: `chore(canonical): update hooks to <version> + bump all plugins`.
2. Body cites the change reason, the new checksums.txt diff, and the per-plugin version bumps.
3. Reviewer routing: `@agntux/security` AND `@agntux/marketplace-maintainers` must approve.

Phase 5 — Post-merge tracking

After merge, open one tracking issue per plugin under the `canonical-hook-rollout` label so the team can monitor user adoption via the auto-update timeline (P7 §8.1).

Stop after each phase to confirm.
