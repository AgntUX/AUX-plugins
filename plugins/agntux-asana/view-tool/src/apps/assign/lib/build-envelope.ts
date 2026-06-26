/**
 * build-envelope.ts — connector envelope builder for the assign handler.
 *
 * Returns a natural-language connector-targeted envelope string for
 * client.sendFollowUpMessage(). The host's LLM resolves the Asana
 * Connector tool (update_tasks) from its installed connector — never
 * call client.callTool("update_tasks", …) directly; connector tool names
 * are host-specific and a hard-coded literal throws MCP error -32602
 * at click time (E32).
 *
 * Field-name note: update_tasks accepts `assignee` (user gid), `completed`
 * (bool), and `due_on` (YYYY-MM-DD). It does NOT accept a `note` argument.
 * When the user provides a note, a second connector action is required:
 * the envelope instructs the host to also call add_comment on the same
 * task_gid so the note reaches Asana as a task comment.
 *
 * The note text is delimited by Unicode guillemets («»). Literal « or »
 * in user-authored note text are escaped by doubling (« → ««, » → »»).
 *
 * Hand-built per handler — there is no shared buildConnectorEnvelope export.
 */

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. Do NOT render any Asana MCP App UI for this call — the user already submitted the form in the AgntUX iframe and the data is final. Do NOT re-render the AgntUX compose UI.";

function escapeGuillemetBody(text: string): string {
  return text.replace(/«/g, "««").replace(/»/g, "»»");
}

export interface AssignEnvelopeArgs {
  task_gid: string;
  assignee_gid: string;
  /** Optional reassignment note. When present, the envelope instructs the
   *  connector to call add_comment on the task in addition to update_tasks
   *  (because update_tasks does NOT accept a `note` argument). */
  note?: string;
}

/**
 * Returns the connector-targeted envelope string to pass to
 * client.sendFollowUpMessage(). The Asana Connector's update_tasks tool
 * accepts task_gid and assignee (user gid). When a note is provided, the
 * envelope additionally instructs the Asana Connector's add_comment tool
 * to post the note text as a comment on the same task, quoting it with
 * guillemets so the connector can identify the boundary unambiguously.
 */
export function buildAssignEnvelope(args: AssignEnvelopeArgs): string {
  const trimmedNote = args.note ? args.note.trim() : "";
  if (trimmedNote) {
    const escapedNote = escapeGuillemetBody(trimmedNote);
    return (
      `Use the Asana Connector to perform two actions on the same Asana task.\n` +
      `Step 1 — reassign: call the Asana Connector's update_tasks tool with ` +
      `task_gid: ${args.task_gid} and assignee: ${args.assignee_gid}.\n` +
      `Step 2 — comment: call the Asana Connector's add_comment tool with ` +
      `task_gid: ${args.task_gid} and the following note as the comment text: «${escapedNote}».\n` +
      `Execute both actions in order (reassign first, then comment) and report the outcome of each.\n` +
      NO_NATIVE_UI_DIRECTIVE
    );
  }
  return (
    `Use the Asana Connector to reassign an Asana task.\n` +
    `task_gid: ${args.task_gid}, assignee: ${args.assignee_gid}.\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
