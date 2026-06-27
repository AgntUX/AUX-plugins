// build-envelope.ts — connector envelope builder for agntux-sentry assign.
//
// Targets: update_issue via the Sentry Connector.
// Shape per connector-envelopes.md §"The shape" and §"There is no envelope-builder export".
// This is a hand-built local helper — do NOT import this from any package.

export type AssigneeKind = 'user' | 'team';

export interface AssignEnvelopeParams {
  /** Full Sentry issue URL. */
  issueUrl: string;
  /** Selected assignee id. */
  assigneeId: string;
  /** Selected assignee label (for human-readable envelope). */
  assigneeLabel: string;
  /** Whether the assignee is a user or a team. */
  assigneeKind: AssigneeKind;
}

// Native-UI suppression directive. The AgntUX assign iframe has already
// collected every field the user cared about, so the host should call the
// Sentry Connector tool programmatically and return its result as plain
// chat text — NOT render the Sentry Connector's own MCP App UI (which
// would duplicate the form the user just used). Appended verbatim to
// every assign envelope.
const NO_NATIVE_UI_DIRECTIVE =
  " Execute the Sentry Connector tool programmatically and return its " +
  "success/error to chat as plain text — do NOT render any Sentry " +
  "Connector MCP App UI for this call (the user has already used the " +
  "AgntUX assign UI and the data is final), and do NOT re-render the " +
  "AgntUX assign UI either; the action is complete.";

/**
 * Build a connector-targeted envelope instructing the Sentry Connector to
 * assign the issue. The iframe Send click is the authorisation gate.
 *
 * assignedTo format per Sentry update_issue API:
 *   - user: 'user:{userId}'
 *   - team: 'team:{teamSlug}'  — Sentry requires the slug, not a numeric id
 */
export function buildEnvelope(params: AssignEnvelopeParams): string {
  const { issueUrl, assigneeId, assigneeLabel, assigneeKind } = params;
  const assignedTo = `${assigneeKind}:${assigneeId}`;

  const lines: string[] = [
    `Use the Sentry Connector to assign the Sentry issue to ${assigneeLabel}.`,
    `issue_url: ${issueUrl}, assignedTo: ${assignedTo}.`,
    `Call update_issue.`,
  ];

  return lines.join('\n') + NO_NATIVE_UI_DIRECTIVE;
}
