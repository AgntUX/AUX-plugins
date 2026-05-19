// Append an `## Outcome` section to an action file's body.
//
// Used by `dismiss` and `set-status` when the caller supplies an
// `outcome` (and optionally an `outcome_note`). pattern-feedback reads
// these to distinguish positive dismissals ("completed-elsewhere")
// from negative ("noise"). The section is always appended below any
// existing outcome, never rewritten.

export function appendOutcomeSection(
  fileBody: string,
  outcome: string,
  outcomeNote: string | undefined,
  nowIso: string,
): string {
  const trimmed = fileBody.trimEnd();
  const noteSuffix = outcomeNote ? ` — ${outcomeNote}` : "";
  return `${trimmed}\n\n## Outcome\n${outcome} — ${nowIso}${noteSuffix}\n`;
}
