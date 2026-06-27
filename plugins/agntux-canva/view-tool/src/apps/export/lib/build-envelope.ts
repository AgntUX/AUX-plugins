/**
 * build-envelope.ts — connector envelope builder for the export handler.
 *
 * Returns a natural-language connector-targeted envelope string for
 * client.sendFollowUpMessage(). The host's LLM resolves the Canva
 * Connector tool (export-design) from its installed connector — never
 * call client.callTool("export-design", …) directly; connector tool names
 * are host-specific (UUID-prefixed in local agent mode) and a hard-coded
 * literal throws MCP error -32602 at click time (E32).
 *
 * There is no shared buildConnectorEnvelope export — this is hand-built
 * per handler per the agent definition.
 *
 * Connector write tool: export-design
 * Args:
 *   design_id (string)
 *   format: { type: string (one of pdf|png|jpg|pptx|gif|mp4|csv), pages?: number[] }
 */

const NO_NATIVE_UI_DIRECTIVE =
  "Execute the connector tool programmatically and return its success or error to chat as plain text. " +
  "Do NOT render any Canva MCP App UI for this call — " +
  "the user has already reviewed and confirmed the export settings via the AgntUX iframe and the data is final. " +
  "Do NOT re-render the AgntUX export UI either; the action is complete.";

export interface ExportEnvelopeArgs {
  /** Canva design ID */
  design_id: string;
  /** Export format type: one of pdf | png | jpg | pptx | gif | mp4 | csv */
  format_type: string;
  /** Optional 1-based page numbers to export; omit to export all pages */
  pages?: number[];
}

/**
 * buildExportEnvelope — returns the connector-targeted envelope string.
 *
 * Shape (connector tool: export-design):
 *   Use the Canva Connector to export a design to a file.
 *   design_id: {design_id}
 *   format: {"type":"{format_type}"}               — all pages
 *   format: {"type":"{format_type}","pages":[...]} — page subset only
 *
 * The `format` arg is passed as a JSON object so the host LLM constructs
 * the nested { type, pages? } structure the export-design tool expects,
 * rather than flat dot-notation keys that could be misread as literal
 * key names.
 */
export function buildExportEnvelope(args: ExportEnvelopeArgs): string {
  const { design_id, format_type, pages } = args;
  const formatObj: { type: string; pages?: number[] } = { type: format_type };
  if (pages && pages.length > 0) {
    formatObj.pages = pages;
  }
  const formatJson = JSON.stringify(formatObj);
  return (
    `Use the Canva Connector to export a design to a file.\n` +
    `design_id: ${design_id}\n` +
    `format: ${formatJson}\n` +
    NO_NATIVE_UI_DIRECTIVE
  );
}
