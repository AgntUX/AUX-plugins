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
export declare function renderConfirmationText(uiLabel: string): string;
