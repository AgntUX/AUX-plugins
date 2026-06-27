// build-envelope.ts — connector envelope builder for agntux-sentry ignore.
//
// Targets: update_issue via the Sentry Connector.
// Shape per connector-envelopes.md §"The shape" and §"There is no envelope-builder export".
// This is a hand-built local helper — do NOT import this from any package.

export type IgnoreMode =
  | 'untilEscalating'
  | 'forever'
  | 'forDuration'
  | 'untilOccurrenceCount';

export interface IgnoreEnvelopeParams {
  /** Full Sentry issue URL. */
  issueUrl: string;
  /** Ignore mode selected by the user. */
  ignoreMode: IgnoreMode;
  /** Duration in minutes (only used when ignoreMode === 'forDuration'). */
  ignoreDurationMinutes?: number;
  /** Occurrence count threshold (only used when ignoreMode === 'untilOccurrenceCount'). */
  ignoreCount?: number;
}

const MODE_LABELS: Record<IgnoreMode, string> = {
  untilEscalating: 'until it escalates again',
  forever: 'forever',
  forDuration: 'for a set duration',
  untilOccurrenceCount: 'until it reaches an occurrence count threshold',
};

// Native-UI suppression directive. The AgntUX ignore iframe has already
// collected every field the user cared about, so the host should call the
// Sentry Connector tool programmatically and return its result as plain
// chat text — NOT render the Sentry Connector's own MCP App UI (which
// would duplicate the form the user just used). Appended verbatim to
// every ignore envelope.
const NO_NATIVE_UI_DIRECTIVE =
  " Execute the Sentry Connector tool programmatically and return its " +
  "success/error to chat as plain text — do NOT render any Sentry " +
  "Connector MCP App UI for this call (the user has already used the " +
  "AgntUX ignore UI and the data is final), and do NOT re-render the " +
  "AgntUX ignore UI either; the action is complete.";

/**
 * Build a connector-targeted envelope instructing the Sentry Connector to
 * ignore the issue. The iframe Send click is the authorisation gate.
 */
export function buildEnvelope(params: IgnoreEnvelopeParams): string {
  const { issueUrl, ignoreMode, ignoreDurationMinutes, ignoreCount } = params;

  const modeLabel = MODE_LABELS[ignoreMode] ?? ignoreMode;

  const lines: string[] = [
    `Use the Sentry Connector to ignore the Sentry issue ${modeLabel}.`,
    `issue_url: ${issueUrl}, status: ignored, ignoreMode: ${ignoreMode}.`,
  ];

  if (ignoreMode === 'forDuration' && ignoreDurationMinutes && ignoreDurationMinutes > 0) {
    lines.push(`ignoreDurationMinutes: ${ignoreDurationMinutes}.`);
  }
  if (ignoreMode === 'untilOccurrenceCount' && ignoreCount && ignoreCount > 0) {
    lines.push(`ignoreCount: ${ignoreCount}.`);
  }

  lines.push('Call update_issue.');

  return lines.join('\n') + NO_NATIVE_UI_DIRECTIVE;
}
