/**
 * build-envelope.ts — connector dispatch envelope for the log-work handler.
 *
 * Assembles the args sent to the Atlassian Connector when the user submits
 * a worklog entry from the AgntUX Jira log-work view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The Atlassian Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__claude_ai_Atlassian__addWorklogToJiraIssue";

export interface LogWorkEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

export function buildLogWorkEnvelope(params: {
  cloudId: string;
  issueIdOrKey: string;
  timeSpent: string;
  started: string;
  commentBody?: string;
}): LogWorkEnvelope {
  const { cloudId, issueIdOrKey, timeSpent, started, commentBody } = params;

  const args: Record<string, unknown> = {
    cloudId,
    issueIdOrKey,
    timeSpent,
    started,
  };

  if (commentBody && commentBody.trim()) {
    args.commentBody = commentBody.trim();
  }

  const envelopeText =
    `IMPORTANT NO_NATIVE_UI — dispatching via AgntUX log-work view tool.\n` +
    `Tool: ${TOOL}\n` +
    `Issue: ${issueIdOrKey}\n` +
    `TimeSpent: ${timeSpent}\n` +
    `CloudId: ${cloudId}`;

  return { toolName: TOOL, args, envelopeText };
}
