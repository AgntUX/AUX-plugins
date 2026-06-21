/**
 * Debug Logging Module for Client UI
 *
 * Inlined from @mcp-apps-kit/ui v0.5.0
 * Source: https://github.com/agntux/mcp-apps-kit
 * Date: 2026-01-24
 *
 * Provides debug logging functionality for MCP Apps client UIs.
 *
 * @module debug
 */

export {
  // Types
  type DebugLogLevel,
  type DebugTransport,
  type LogEntry,
  type ClientDebugConfig,
  // Utilities
  shouldLog,
  safeSerialize,
  safeStringify,
  // Logger
  ClientDebugLogger,
  // Global instance
  clientDebugLogger,
} from './logger.js';
