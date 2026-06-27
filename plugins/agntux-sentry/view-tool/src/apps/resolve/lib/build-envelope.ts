// build-envelope.ts — connector envelope builder for agntux-sentry resolve.
//
// Targets: update_issue via the Sentry Connector.
// Shape per connector-envelopes.md §"The shape" and §"There is no envelope-builder export".
// This is a hand-built local helper — do NOT import this from any package.

export interface ResolveEnvelopeParams {
  /** Full Sentry issue URL — preferred over org+id split. */
  issueUrl: string;
  /** Whether to resolve in next release rather than immediately. */
  resolveInNextRelease: boolean;
}

// Native-UI suppression directive. The AgntUX resolve iframe has already
// collected every field the user cared about, so the host should call the
// Sentry Connector tool programmatically and return its result as plain
// chat text — NOT render the Sentry Connector's own MCP App UI (which
// would duplicate the form the user just used). Appended verbatim to
// every resolve envelope.
const NO_NATIVE_UI_DIRECTIVE =
  " Execute the Sentry Connector tool programmatically and return its " +
  "success/error to chat as plain text — do NOT render any Sentry " +
  "Connector MCP App UI for this call (the user has already used the " +
  "AgntUX resolve UI and the data is final), and do NOT re-render the " +
  "AgntUX resolve UI either; the action is complete.";

/**
 * Build a connector-targeted envelope instructing the Sentry Connector to
 * resolve the issue. The iframe Send click is the authorisation gate.
 *
 * Status values:
 *   - 'resolved'               — resolve immediately
 *   - 'resolvedInNextRelease'  — resolve when the next release ships
 */
export function buildEnvelope(params: ResolveEnvelopeParams): string {
  const { issueUrl, resolveInNextRelease } = params;
  const status = resolveInNextRelease ? "resolvedInNextRelease" : "resolved";

  const lines: string[] = [
    `Use the Sentry Connector to resolve the Sentry issue as ${resolveInNextRelease ? "resolved in the next release" : "resolved now"}.`,
    `issue_url: ${issueUrl}, status: ${status}.`,
    `Call update_issue.`,
  ];

  return lines.join("\n") + NO_NATIVE_UI_DIRECTIVE;
}
