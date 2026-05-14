/**
 * agntux-build MCP server.
 *
 * Ships exactly one tool — `agntux_build_publish_to_team` — that the
 * build skill's Stage 12 calls when the build is happening inside a
 * team context (teams.json present, user picked a team). The tool POSTs
 * the built plugin tree to the team-private marketplace publish endpoint
 * at app.agntux.ai.
 *
 * Solo Stage-12 behavior (mailto submission) does not invoke this tool;
 * the runtime gate is the build skill body, not this server.
 */
export {};
