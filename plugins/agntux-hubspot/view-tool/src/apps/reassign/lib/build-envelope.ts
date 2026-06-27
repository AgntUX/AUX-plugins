/**
 * build-envelope.ts — connector dispatch envelope for the reassign handler.
 *
 * Assembles the args sent to the HubSpot Connector when the user reassigns
 * a CRM record to a new owner from the AgntUX HubSpot reassign view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The HubSpot Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__hubspot__manage_crm_objects";

export interface ReassignEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

/**
 * Updates hubspot_owner_id on the given record.
 * recordType should be the HubSpot object type, e.g. "DEAL", "TICKET", "CONTACT".
 */
export function buildReassignEnvelope(params: {
  recordId: string;
  recordType: string;
  ownerId: string;
}): ReassignEnvelope {
  const { recordId, recordType, ownerId } = params;

  // Normalise type to uppercase for HubSpot API
  const objectType = recordType.toUpperCase();

  const args: Record<string, unknown> = {
    objectType,
    operation: "update",
    objectId: recordId,
    properties: {
      hubspot_owner_id: ownerId,
    },
  };

  const NO_NATIVE_UI_DIRECTIVE =
    `IMPORTANT: Execute manage_crm_objects programmatically and return the result ` +
    `as plain text. Do NOT render HubSpot's own MCP App UI for this call — the user ` +
    `has already selected the new owner in the AgntUX iframe and the payload is final. ` +
    `Do NOT re-render the AgntUX reassign UI either; the action is complete.`;

  const envelopeText =
    `Use the HubSpot Connector to update the owner of a HubSpot ${objectType} record.\n` +
    `objectType: ${objectType}, operation: update, objectId: ${recordId}, properties.hubspot_owner_id: ${ownerId}.\n` +
    `\n` +
    NO_NATIVE_UI_DIRECTIVE;

  return { toolName: TOOL, args, envelopeText };
}
