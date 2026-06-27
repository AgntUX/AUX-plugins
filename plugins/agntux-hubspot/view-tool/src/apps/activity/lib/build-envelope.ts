/**
 * build-envelope.ts — connector dispatch envelope for the activity handler.
 *
 * Assembles the args sent to the HubSpot Connector when the user logs
 * a note on a CRM record from the AgntUX HubSpot activity view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The HubSpot Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__hubspot__manage_crm_objects";

export interface ActivityEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

/**
 * Creates a NOTE engagement associated to the given record.
 * associatedObjectType should be the HubSpot object type in uppercase,
 * e.g. "CONTACT", "COMPANY", "DEAL", "TICKET".
 */
export function buildLogNoteEnvelope(params: {
  recordId: string;
  recordType: string;
  noteBody: string;
}): ActivityEnvelope {
  const { recordId, recordType, noteBody } = params;

  // Normalise type to uppercase for HubSpot API
  const objectType = recordType.toUpperCase();

  const args: Record<string, unknown> = {
    objectType: "NOTE",
    operation: "create",
    properties: {
      hs_note_body: noteBody,
      hs_timestamp: String(Date.now()),
    },
    associations: [
      {
        to: { id: recordId },
        types: [
          {
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: 1,
          },
        ],
        toObjectType: objectType,
      },
    ],
  };

  const NO_NATIVE_UI_DIRECTIVE =
    `IMPORTANT: Execute manage_crm_objects programmatically and return the result ` +
    `as plain text. Do NOT render HubSpot's own MCP App UI for this call — the user ` +
    `has already authored the note in the AgntUX iframe and the payload is final. ` +
    `Do NOT re-render the AgntUX activity UI either; the action is complete.`;

  const envelopeText =
    `Use the HubSpot Connector to create a NOTE engagement associated with a HubSpot ${objectType} record.\n` +
    `objectType: NOTE, operation: create, associations[0].toObjectType: ${objectType}, associations[0].to.id: ${recordId}.\n` +
    `Body: «${noteBody.replace(/«/g, "««").replace(/»/g, "»»")}».\n` +
    `\n` +
    NO_NATIVE_UI_DIRECTIVE;

  return { toolName: TOOL, args, envelopeText };
}
