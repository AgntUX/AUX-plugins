/**
 * build-envelope.ts — connector dispatch envelope for the task handler.
 *
 * Assembles the args sent to the HubSpot Connector when the user completes
 * or reschedules a task from the AgntUX HubSpot task view tool.
 *
 * IMPORTANT NO_NATIVE_UI — this envelope targets the AgntUX view-tool render
 * path. The HubSpot Connector's own MCP App UI must NOT be rendered; the
 * AgntUX iframe is the authoritative UI surface for this action.
 */

const TOOL = "mcp__hubspot__manage_crm_objects";

export interface TaskEnvelope {
  toolName: string;
  args: Record<string, unknown>;
  envelopeText: string;
}

export function buildCompleteTaskEnvelope(params: {
  taskId: string;
}): TaskEnvelope {
  const { taskId } = params;

  const args: Record<string, unknown> = {
    objectType: "TASK",
    operation: "update",
    objectId: taskId,
    properties: {
      hs_task_status: "COMPLETED",
    },
  };

  const NO_NATIVE_UI_DIRECTIVE =
    `IMPORTANT: Execute manage_crm_objects programmatically and return the result ` +
    `as plain text. Do NOT render HubSpot's own MCP App UI for this call — the user ` +
    `has already confirmed the action in the AgntUX iframe and the payload is final. ` +
    `Do NOT re-render the AgntUX task UI either; the action is complete.`;

  const envelopeText =
    `Use the HubSpot Connector to mark a HubSpot task as complete.\n` +
    `objectType: TASK, operation: update, objectId: ${taskId}, properties.hs_task_status: COMPLETED.\n` +
    `\n` +
    NO_NATIVE_UI_DIRECTIVE;

  return { toolName: TOOL, args, envelopeText };
}

export function buildRescheduleTaskEnvelope(params: {
  taskId: string;
  /** ISO 8601 date string for the new due date, e.g. "2026-07-01" */
  newDueDate: string;
}): TaskEnvelope {
  const { taskId, newDueDate } = params;

  // HubSpot expects hs_timestamp as a Unix epoch millisecond integer.
  // We accept an ISO date string and convert to ms.
  const ts = new Date(newDueDate).getTime();
  const hsTimestamp = Number.isFinite(ts) ? String(ts) : newDueDate;

  const args: Record<string, unknown> = {
    objectType: "TASK",
    operation: "update",
    objectId: taskId,
    properties: {
      hs_timestamp: hsTimestamp,
    },
  };

  const NO_NATIVE_UI_DIRECTIVE =
    `IMPORTANT: Execute manage_crm_objects programmatically and return the result ` +
    `as plain text. Do NOT render HubSpot's own MCP App UI for this call — the user ` +
    `has already selected the new due date in the AgntUX iframe and the payload is final. ` +
    `Do NOT re-render the AgntUX task UI either; the action is complete.`;

  const envelopeText =
    `Use the HubSpot Connector to reschedule a HubSpot task to a new due date.\n` +
    `objectType: TASK, operation: update, objectId: ${taskId}, properties.hs_timestamp: ${hsTimestamp} (epoch ms for ${newDueDate}).\n` +
    `\n` +
    NO_NATIVE_UI_DIRECTIVE;

  return { toolName: TOOL, args, envelopeText };
}
