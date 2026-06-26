/**
 * build-envelope.ts — connector envelope builder for the create handler.
 *
 * Returns a natural-language connector-targeted envelope string for
 * client.sendFollowUpMessage(). The host's LLM resolves the Asana
 * Connector tool (create_tasks) from its installed connector — never
 * call client.callTool("create_tasks", …) directly; connector tool names
 * are host-specific and a hard-coded literal throws MCP error -32602
 * at click time (E32).
 *
 * create_tasks accepts: name (required), assignee (user gid, optional),
 * due_on (YYYY-MM-DD, optional), projects (array of project gids,
 * optional), notes (plain-text description, optional).
 *
 * Hand-built per handler — there is no shared buildConnectorEnvelope export.
 */

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. Do NOT render any Asana MCP App UI for this call — the user already submitted the form in the AgntUX iframe and the data is final. Do NOT re-render the AgntUX compose UI.";

export interface CreateEnvelopeArgs {
  name: string;
  assignee_gid?: string;
  due_on?: string;
  project_gid?: string;
}

/**
 * Returns the connector-targeted envelope string to pass to
 * client.sendFollowUpMessage(). The Asana Connector's create_tasks tool
 * accepts name, assignee (gid), due_on, and projects (array of gids).
 */
export function buildCreateEnvelope(args: CreateEnvelopeArgs): string {
  const optionalFields: string[] = [];
  if (args.assignee_gid) {
    optionalFields.push(`assignee: ${args.assignee_gid}`);
  }
  if (args.due_on) {
    optionalFields.push(`due_on: ${args.due_on}`);
  }
  if (args.project_gid) {
    optionalFields.push(`projects: [${args.project_gid}]`);
  }
  const fieldsClause =
    optionalFields.length > 0 ? ` ${optionalFields.join(", ")}.` : "";
  return (
    `Use the Asana Connector to create an Asana task.\n` +
    `name: «${args.name}».${fieldsClause}\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
