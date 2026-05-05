// Re-export the AgntUX project-root resolver from the orchestrator MCP server
// subpath export. This is intentionally NOT a vendor-copy — it reuses the
// canonical resolver so agntux-slack and agntux-core stay in sync on root
// resolution logic across upgrades.
//
// The subpath export `./agntux-root` was added to @agntux/orchestrator-mcp-server
// in v1.1.0. Verify it resolves by running `npm run lint` (tsc --noEmit) after
// `npm install`.
export { resolveAgntuxRoot, expectedAgntuxRoot } from "@agntux/orchestrator-mcp-server/agntux-root";
//# sourceMappingURL=agntux-root.js.map