// =============================================================================
// build-canvas-envelope.ts — pure function that produces the committed
// host_prompt string for the canvas card's "Create canvas + post link" action.
//
// Encoding contract (load-bearing — draft-flow-author must implement the
// matching parser):
//
//   Delimiter: Unicode guillemets «» surround each field value.
//
//   Scalar fields (action_id, title, tldr, followup_message): each value's
//   literal `«` is doubled to `««`, literal `»` to `»»`, before wrapping in
//   the outer `«…»`. Decode: extract content between the outermost `«` and
//   `»`, then replace `««`→`«` and `»»`→`»`.
//
//   The decoder regex (skills/draft/SKILL.md Step 6.5) captures scalar fields
//   with `(?:[^»]|»»)*`, NOT `[\s\S]*?`. Because every literal » is doubled,
//   the closing delimiter is always a single un-paired ». The tightened
//   pattern makes the match unambiguous even when a scalar contains a
//   substring like `», tldr «` or `», decisions «` — a copy-paste hazard
//   the prior `[\s\S]*?` capture was vulnerable to. DO NOT change the
//   encoder's doubling rule without coordinating the decoder regex.
//
//   List fields (decisions, open_questions): the array is JSON-stringified
//   into the value slot. The `«…»` outer wrapper still applies, but the inner
//   contents are a valid JSON array literal — no custom escape rules. Decode:
//   `JSON.parse(capturedGroup)`. JSON natively handles all string content
//   (including `|`, `«`, `»`, newlines, and quotes), so no doubling is
//   needed and no item-level character is reserved.
//
//   Worked example: decisions ["A|B", "say «hi»", "with \"quotes\""] →
//     JSON: `["A|B","say «hi»","with \"quotes\""]`
//     envelope fragment: `decisions «["A|B","say «hi»","with \"quotes\""]»`
//     decode: capture between outermost `«»` → `["A|B","say «hi»","with
//     \"quotes\""]`, then JSON.parse → original array, byte-for-byte.
//
//   Why JSON for lists (not the prior `||`-doubling/join scheme): the
//   doubling scheme had a single-pipe correctness gap. An item containing a
//   single literal `|` (e.g., a markdown table fragment "vendor A | vendor B")
//   would encode to "vendor A || vendor B" and, when joined with the `||`
//   item separator, produce a string the decoder could not reliably split.
//   JSON sidesteps this entirely.
//
//   Shape (full):
//     ux: Use the agntux-slack plugin to commit the drafted canvas for action
//     {action_id} with title «{title}», tldr «{tldr}», decisions
//     «{JSON.stringify(decisions)}», open_questions
//     «{JSON.stringify(open_questions)}», followup_message
//     «{proposed_followup_message}».
// =============================================================================

/**
 * Escape guillemets in a single string value by doubling them.
 * Used for scalar text fields only.
 */
function escapeGuillemets(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

/**
 * Encode a string list for embedding between guillemets.
 * Uses JSON.stringify so the inner contents are unambiguous regardless of
 * the characters in each item — there is no reserved item-level character
 * to escape, and `JSON.parse` is the inverse.
 */
function encodeList(items: string[]): string {
  return JSON.stringify(items);
}

/**
 * Build the committed host_prompt envelope for a canvas creation action.
 *
 * @param action_id                  - The action slug (no .md suffix).
 * @param title                      - Canvas title (may contain «»; will be escaped).
 * @param tldr                       - Canvas TL;DR (may contain «»; will be escaped).
 * @param decisions                  - Array of decision strings (JSON-encoded).
 * @param open_questions             - Array of open question strings (JSON-encoded).
 * @param proposed_followup_message  - The follow-up reply body.
 */
export function buildCanvasEnvelope(
  action_id: string,
  title: string,
  tldr: string,
  decisions: string[],
  open_questions: string[],
  proposed_followup_message: string,
): string {
  return (
    `ux: Use the agntux-slack plugin to commit the drafted canvas for action ${action_id}` +
    ` with title «${escapeGuillemets(title)}»` +
    `, tldr «${escapeGuillemets(tldr)}»` +
    `, decisions «${encodeList(decisions)}»` +
    `, open_questions «${encodeList(open_questions)}»` +
    `, followup_message «${escapeGuillemets(proposed_followup_message)}».`
  );
}
