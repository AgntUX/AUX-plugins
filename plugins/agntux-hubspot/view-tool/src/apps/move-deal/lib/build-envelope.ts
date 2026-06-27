/**
 * build-envelope.ts — connector dispatch envelope for the move-deal handler.
 *
 * Assembles the args sent to the HubSpot Connector when the user moves
 * a deal to a new pipeline stage from the AgntUX HubSpot move-deal view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The HubSpot Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__hubspot__manage_crm_objects";

export interface MoveDealEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

export function buildMoveDealEnvelope(params: {
  dealId: string;
  stageId: string;
}): MoveDealEnvelope {
  const { dealId, stageId } = params;

  const args: Record<string, unknown> = {
    objectType: "DEAL",
    operation: "update",
    objectId: dealId,
    properties: {
      dealstage: stageId,
    },
  };

  const NO_NATIVE_UI_DIRECTIVE =
    `IMPORTANT: Execute manage_crm_objects programmatically and return the result ` +
    `as plain text. Do NOT render HubSpot's own MCP App UI for this call — the user ` +
    `has already selected the stage in the AgntUX iframe and the payload is final. ` +
    `Do NOT re-render the AgntUX move-deal UI either; the action is complete.`;

  const envelopeText =
    `Use the HubSpot Connector to update a HubSpot deal's pipeline stage.\n` +
    `objectType: DEAL, operation: update, objectId: ${dealId}, properties.dealstage: ${stageId}.\n` +
    `\n` +
    NO_NATIVE_UI_DIRECTIVE;

  return { toolName: TOOL, args, envelopeText };
}
