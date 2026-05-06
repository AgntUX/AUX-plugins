// Re-export the AgntUX project-root resolver from the orchestrator MCP server
// subpath export. This is intentionally NOT a vendor-copy — it reuses the
// canonical resolver so agntux-gmail and agntux-core stay in sync on root
// resolution logic across upgrades.
export { resolveAgntuxRoot, expectedAgntuxRoot } from "@agntux/orchestrator-mcp-server/agntux-root";
