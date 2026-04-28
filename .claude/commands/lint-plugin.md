---
description: Run the P15 marketplace linter against one plugin and explain results
argument-hint: <slug>
allowed-tools: Bash(npm run lint:marketplace -- *), Bash(cat *), Bash(ls *), Read
---

Run `npm run lint:marketplace -- --plugin $ARGUMENTS` and explain the output.

For each finding:

1. Show the raw line (`code`, `severity`, `file`, `line`, `message`).
2. Look up the error code in `/Users/johnjordan/.claude/plans/p15-marketplace-metadata.md` §5 and explain in plain language what the rule enforces and why.
3. Suggest the smallest possible fix — point at the field/file/line that needs to change. DO NOT mutate files yourself; the user will run the fix command after agreeing.
4. If the finding is a warning (`W01`/`W02`), say so: warnings don't block CI but should be addressed in the same PR when possible.

After explaining all findings, summarize: "X errors, Y warnings, exit code Z." If exit code is 0, congratulate the maintainer and remind them to also run `npm run lint:marketplace` (no flags) to confirm the whole repo lints clean.

If the linter itself crashes (exit code other than 0 or 1), surface the stack trace and ask the maintainer whether to file a bug under the `linter` label.

Do not run the linter against other plugins unless the user explicitly asks.
