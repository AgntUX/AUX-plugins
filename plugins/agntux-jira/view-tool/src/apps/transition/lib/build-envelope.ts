/**
 * build-envelope.ts — connector dispatch envelope for the transition handler.
 *
 * Assembles the args sent to the Atlassian Connector when the user moves
 * a Jira issue to a new status from the AgntUX Jira transition view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The Atlassian Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__claude_ai_Atlassian__transitionJiraIssue";

export interface TransitionEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

export function buildTransitionEnvelope(params: {
  cloudId: string;
  issueIdOrKey: string;
  transitionId: string;
  note?: string;
}): TransitionEnvelope {
  const { cloudId, issueIdOrKey, transitionId, note } = params;

  const args: Record<string, unknown> = {
    cloudId,
    issueIdOrKey,
    transition: { id: transitionId },
  };

  if (note && note.trim()) {
    args.update = { comment: [{ add: { body: note.trim() } }] };
  }

  const envelopeText =
    `IMPORTANT NO_NATIVE_UI — dispatching via AgntUX transition view tool.\n` +
    `Tool: ${TOOL}\n` +
    `Issue: ${issueIdOrKey}\n` +
    `TransitionId: ${transitionId}\n` +
    `CloudId: ${cloudId}`;

  return { toolName: TOOL, args, envelopeText };
}
