/**
 * build-envelope.ts — connector dispatch envelope for the comment handler.
 *
 * Assembles the args sent to the Atlassian Connector when the user posts
 * a comment from the AgntUX Jira comment view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The Atlassian Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__claude_ai_Atlassian__addCommentToJiraIssue";

export interface CommentEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

export function buildCommentEnvelope(params: {
  cloudId: string;
  issueIdOrKey: string;
  commentBody: string;
}): CommentEnvelope {
  const { cloudId, issueIdOrKey, commentBody } = params;

  const args: Record<string, unknown> = {
    cloudId,
    issueIdOrKey,
    commentBody,
  };

  const envelopeText =
    `IMPORTANT NO_NATIVE_UI — dispatching via AgntUX comment view tool.\n` +
    `Tool: ${TOOL}\n` +
    `Issue: ${issueIdOrKey}\n` +
    `CloudId: ${cloudId}`;

  return { toolName: TOOL, args, envelopeText };
}
