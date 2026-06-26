/**
 * build-envelope.ts — connector envelope builder for the complete handler.
 *
 * Returns a natural-language connector-targeted envelope string for
 * client.sendFollowUpMessage(). The host's LLM resolves the Asana
 * Connector tool (update_tasks) from its installed connector — never
 * call client.callTool("update_tasks", …) directly; connector tool names
 * are host-specific and a hard-coded literal throws MCP error -32602
 * at click time (E32).
 *
 * Hand-built per handler — there is no shared buildConnectorEnvelope export.
 */

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. Do NOT render any Asana MCP App UI for this call — the user already submitted the form in the AgntUX iframe and the data is final. Do NOT re-render the AgntUX compose UI.";

export interface CompleteEnvelopeArgs {
  task_gid: string;
  completed: boolean;
  due_on: string;
}

/**
 * Returns the connector-targeted envelope string to pass to
 * client.sendFollowUpMessage(). The Asana Connector's update_tasks tool
 * accepts task_gid, completed (bool), and due_on (YYYY-MM-DD).
 */
export function buildCompleteEnvelope(args: CompleteEnvelopeArgs): string {
  const fields: string[] = [`completed: ${args.completed}`];
  if (args.due_on) {
    fields.push(`due_on: ${args.due_on}`);
  }
  return (
    `Use the Asana Connector to update an Asana task.\n` +
    `task_gid: ${args.task_gid}.\n` +
    `Fields to set: ${fields.join(", ")}.\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
