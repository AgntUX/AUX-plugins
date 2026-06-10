/**
 * build-envelope.ts — connector dispatch envelope for the edit handler.
 *
 * Assembles the args sent to the Atlassian Connector when the user saves
 * field edits (summary / priority / labels) from the AgntUX Jira edit view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The Atlassian Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__claude_ai_Atlassian__editJiraIssue";

export interface EditEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

export function buildEditEnvelope(params: {
  cloudId: string;
  issueIdOrKey: string;
  /** Only include fields that have actually changed. */
  fields: Record<string, unknown>;
}): EditEnvelope {
  const { cloudId, issueIdOrKey, fields } = params;

  const args: Record<string, unknown> = {
    cloudId,
    issueIdOrKey,
    fields,
  };

  const changedKeys = Object.keys(fields).join(', ') || 'none';

  const envelopeText =
    `IMPORTANT NO_NATIVE_UI — dispatching via AgntUX edit view tool.\n` +
    `Tool: ${TOOL}\n` +
    `Issue: ${issueIdOrKey}\n` +
    `Changed fields: ${changedKeys}\n` +
    `CloudId: ${cloudId}`;

  return { toolName: TOOL, args, envelopeText };
}
