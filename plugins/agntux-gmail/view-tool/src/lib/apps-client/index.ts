/**
 * apps-client - Unified client SDK for MCP Apps
 *
 * Inlined from @mcp-apps-kit/ui v0.5.0
 * Source: https://github.com/agntux/mcp-apps-kit
 * Date: 2026-01-24
 *
 * This library provides a unified API for building UI components that work
 * with MCP Apps hosts.
 *
 * @module apps-client
 */

// =============================================================================
// Client Factory
// =============================================================================

export { createClient } from './client.js';

// =============================================================================
// Types
// =============================================================================

export type {
  // Host context
  HostContext,
  Viewport,
  ContainerDimensions,
  SafeAreaInsets,
  DeviceCapabilities,
  HostStyles,
  // Tool types
  ToolDefs,
  InferToolInputs,
  InferToolOutputs,
  ToolMethods,
  ToolResult,
  ResourceContent,
  // Host information
  HostCapabilities,
  HostVersion,
  AppCapabilities,
  // Size notifications
  SizeChangedParams,
  // Bidirectional tools
  AppToolDefinition,
  CallToolHandler,
  ListToolsHandler,
  // Model context
  ContentBlock,
  UpdateModelContextParams,
  // Client interface
  AppsClient,
  CreateClientOptions,
  DetectedProtocol,
} from './types.js';

// =============================================================================
// Adapters (for advanced use cases)
// =============================================================================

export type {
  ProtocolAdapter,
  AdapterType,
  AdapterFactory,
} from './adapters/types.js';
export { McpAdapter } from './adapters/mcp.js';
export type { McpAdapterOptions } from './adapters/mcp.js';
export { MockAdapter } from './adapters/mock.js';

// =============================================================================
// Detection
// =============================================================================

export { detectProtocol } from './detection.js';

// =============================================================================
// Debug Logging
// =============================================================================

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
} from './debug/index.js';

// =============================================================================
// Utilities
// =============================================================================

export { applyDocumentTheme, getDocumentTheme } from './utils/theme.js';
export type { Theme } from './utils/theme.js';
export {
  applyHostStyleVariables,
  applyHostFonts,
  removeHostFonts,
  clearHostStyleVariables,
} from './utils/styles.js';

// =============================================================================
// Configuration
// =============================================================================

export { getMcpServerConfig, getMcpServerBaseUrl } from './config.js';
export type { McpServerConfig } from './config.js';

// =============================================================================
// Constants
// =============================================================================

export {
  LATEST_PROTOCOL_VERSION,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from './constants.js';

// =============================================================================
// Errors
// =============================================================================

export { UIError, UIErrorCode } from './errors.js';
export type { UIErrorCodeType } from './errors.js';
