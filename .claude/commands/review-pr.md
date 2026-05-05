---
description: Apply the P7 §7.3 review checklist to a PR
argument-hint: [PR#]
allowed-tools: Bash(git status), Bash(git log *), Bash(git diff *), Bash(npm run lint:marketplace -- *), Bash(npx tsx scripts/verify-version-changelog.ts), Read
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

Step 3 — Apply §7.3 review checks

For each plugin touched:

1. **Bump rule fit (§5.1)**: Read the diff and the CHANGELOG entry. Does the bump match the rubric? If `changelog-bump-heuristic` warned, was it addressed?
2. **Surface stability**: If `supported_prompts` or `ui_components` (in `listing.yaml`) changed, does the change maintain backward-compat for users on the previous version? If not, is the bump MAJOR?
3. **License gate wired**: If the diff touches `plugins/<slug>/mcp-server/src/index.ts`, confirm `gate.requireValidLicense(...)` still wraps the `tools/call` handler. The `resources/read` handler must NOT call the gate (concurrency race on first-pair creation + ReadResourceResult/CallToolResult envelope-shape mismatch — see `packages/mcp-license/README.md` §"Why only tools/call"). Removing the `tools/call` gate is a release blocker; re-introducing a gate call inside the `resources/read` handler is a regression.

Step 4 — Output

Compose the review comment in this format:

```markdown
### Review — <PR title>

**Plugins touched:** <list>
**CI:** lint <PASS/FAIL>, version-check <PASS/FAIL>

**Per-plugin:**

#### <slug>
- Bump rule fit: <PASS/CONCERNS> — <one-sentence rationale>
- Surface stability: <PASS/CONCERNS> — <rationale>
- License gate wired: <PASS/FAIL/N/A>

**Overall verdict:** APPROVE | REQUEST CHANGES | COMMENT

<concerns, if any>
```

Stop after composing — never submit the review yourself. The maintainer pastes it.
