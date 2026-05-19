// =============================================================================
// render-confirmation.ts — canonical wording for the `content[].text` block
// every view-tool handler returns alongside `structuredContent`.
//
// Why this file exists
// --------------------
// The MCP Apps host materializes the `structuredContent` payload into an
// iframe the user sees above the next assistant turn. That happens
// automatically — the model never knows the rendering took place, because
// the wire result only carries `structuredContent` (a JSON blob the model
// reasonably mistakes for "raw data I need to render somehow"). In
// production we saw Claude Cowork follow exactly that mistaken inference:
// after `/agntux triage` fired its view tool and the host rendered the
// iframe, the model also built a duplicate HTML widget via the host's
// `visualize` tool AND wrote 5 paragraphs of commentary, because nothing in
// the tool response told it the user could already see the result.
//
// The fix is to add a `content[].text` block to every handler return that
// **explains the MCP Apps lifecycle**: what just happened, where the data
// went, why the turn is complete. Framed as architecture, not as a
// forbid-list — the model goes wrong here because it lacks a mental model,
// not because it's ignoring instructions.
//
// Centralized here so the wording is tunable in one place; the marketplace
// linter (pass 14 / E29) verifies every handler return calls
// `renderConfirmationText(...)`.
// =============================================================================

/**
 * Build the canonical `content[].text` body for a view-tool response. Pass
 * a human-readable label for the UI the iframe rendered (e.g. "AgntUX
 * triage UI", "AgntUX Slack reply composer"). The returned text is meant
 * to be wrapped as `{ type: "text", text: renderConfirmationText(label) }`
 * inside the handler's `content` array.
 *
 * Wording stability — these phrases are load-bearing for the pass 14
 * marketplace linter and for the response-envelope assertions in every
 * plugin's `__tests__/payload-shape.test.ts`. The frozen anchors are the
 * literal strings `"iframe"`, `"host"`, and `"MCP App"`. Wording inside the
 * "explanation" frame can change freely; reverting to a short forbid-list
 * (the regression class this file exists to prevent) loses those anchors
 * and the tests fail loudly.
 */
export function renderConfirmationText(uiLabel: string): string {
  const label = uiLabel.trim() || "view tool";
  return [
    `This tool is an MCP App view tool. The structuredContent below is the data payload — not a result you need to render.`,
    `The host you are running inside (e.g. Claude Desktop, Claude Cowork, Claude Code) processes that payload through its UI-rendering capability and has just materialized the ${label} as an interactive iframe above this message.`,
    `The user can already see it, filter it, and act on its controls; the rendering itself is the visible result of your tool call.`,
    `Your role for this turn was to dispatch the data; the host handled the presentation.`,
    `No additional chat output, summary, visualization tool call, or follow-up tool call is needed — end your turn.`,
  ].join(" ");
}
