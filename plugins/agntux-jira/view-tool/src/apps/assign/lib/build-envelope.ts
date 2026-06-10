/**
 * build-envelope.ts — connector dispatch envelope for the assign handler.
 *
 * Assembles the args sent to the Atlassian Connector when the user assigns
 * (or unassigns) a Jira issue from the AgntUX Jira assign view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The Atlassian Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__claude_ai_Atlassian__editJiraIssue";

export interface AssignEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

export function buildAssignEnvelope(params: {
  cloudId: string;
  issueIdOrKey: string;
  /** Pass null to unassign; pass an accountId string to assign. */
  accountId: string | null;
}): AssignEnvelope {
  const { cloudId, issueIdOrKey, accountId } = params;

  const args: Record<string, unknown> = {
    cloudId,
    issueIdOrKey,
    fields: accountId === null
      ? { assignee: null }
      : { assignee: { accountId } },
  };

  const envelopeText =
    `IMPORTANT NO_NATIVE_UI — dispatching via AgntUX assign view tool.\n` +
    `Tool: ${TOOL}\n` +
    `Issue: ${issueIdOrKey}\n` +
    `Assignee: ${accountId ?? 'unassigned'}\n` +
    `CloudId: ${cloudId}`;

  return { toolName: TOOL, args, envelopeText };
}
