---
description: Apply the P7 §7.3 review checklist to a PR
argument-hint: [PR#]
allowed-tools: Bash(git status), Bash(git log *), Bash(git diff *), Bash(npm run lint:marketplace -- *), Bash(npx tsx scripts/verify-canonical-hooks.ts), Bash(npx tsx scripts/verify-version-changelog.ts), Read
---

You are helping a maintainer review a marketplace PR. PR number `$ARGUMENTS` (defaults to the currently checked-out branch if empty).

Apply P7 §7.3's three load-bearing checks plus the standard hygiene checklist. Output a structured review the maintainer can paste as a GitHub comment after approving.

Step 1 — What changed

1. List every plugin touched (`git diff main... --name-only` filtered by `plugins/*`).
2. List every file under `canonical/`, `.github/`, or `scripts/` touched. If any: flag for security/maintainer cross-review.

Step 2 — Linter + verification

For each plugin slug `<slug>` touched:

1. Run `npm run lint:marketplace -- --plugin <slug>`. Capture exit code + output.
2. Run `npx tsx scripts/verify-version-changelog.ts --plugin <slug>`. Capture exit code.
3. Run `npx tsx scripts/verify-canonical-hooks.ts`. Capture exit code (this is repo-wide, not per-plugin).

Step 3 — Apply §7.3 review checks

For each plugin touched:

1. **Bump rule fit (§5.1)**: Read the diff and the CHANGELOG entry. Does the bump match the rubric? If `changelog-bump-heuristic` warned, was it addressed?
2. **Surface stability**: If `supported_prompts` or `ui_components` (in `listing.yaml`) changed, does the change maintain backward-compat for users on the previous version? If not, is the bump MAJOR?
3. **Canonical-hook untouched**: Did the PR drift `plugins/<slug>/hooks/` from `canonical/hooks/`? (`hook-hash-check.yml` will catch this; mention as a sanity check.)

Step 4 — Output

Compose the review comment in this format:

```markdown
### Review — <PR title>

**Plugins touched:** <list>
**CI:** lint <PASS/FAIL>, hash-check <PASS/FAIL>, version-check <PASS/FAIL>

**Per-plugin:**

#### <slug>
- Bump rule fit: <PASS/CONCERNS> — <one-sentence rationale>
- Surface stability: <PASS/CONCERNS> — <rationale>
- Canonical-hook untouched: <PASS/FAIL>

**Overall verdict:** APPROVE | REQUEST CHANGES | COMMENT

<concerns, if any>
```

Stop after composing — never submit the review yourself. The maintainer pastes it.
