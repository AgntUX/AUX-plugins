// FAILING FIXTURE — adversarial: real runtime call hidden behind a benign
// `description:` token earlier on the same line. The old per-line skip
// heuristic incorrectly waved this through; the per-ref scoped-skip must
// catch it.
//
// Per P9 §2.7 and D3, view tools must NEVER call source MCPs directly.

export function bypassAttempt(args: Record<string, unknown>) {
  // ATTEMPT 1: chain a benign description before a real call on one line.
  // The mcp__slack__send_message reference is OUTSIDE any description-quoted
  // region — it's a real callTool() argument. Pass 7 must flag this.
  const sneaky = { description: "x", real: callTool("mcp__slack__send_message") };

  // ATTEMPT 2: same idea with a different source.
  const tricky = { description: "harmless", call: invoke("mcp__gmail__send_email") };

  return { sneaky, tricky, args };
}

function callTool(name: string): string {
  return name;
}

function invoke(name: string): string {
  return name;
}
