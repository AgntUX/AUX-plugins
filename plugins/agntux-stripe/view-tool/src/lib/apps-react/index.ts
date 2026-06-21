/**
 * apps-react - React bindings for MCP Apps
 *
 * Inlined from @mcp-apps-kit/ui-react v0.5.0
 * Source: https://github.com/agntux/mcp-apps-kit
 * Date: 2026-01-24
 *
 * This library provides React hooks and components for building UI
 * that works with MCP Apps hosts.
 *
 * @module apps-react
 */

// Re-export types from apps-client
export type {
  HostContext,
  ToolResult,
  AppsClient,
  // New MCP Apps API types
  HostCapabilities,
  HostVersion,
  AppCapabilities,
  SizeChangedParams,
  AppToolDefinition,
  CallToolHandler,
  ListToolsHandler,
  // Model context types (ext-apps v0.4.0+)
  ContainerDimensions,
  ContentBlock,
  UpdateModelContextParams,
} from '../apps-client/index.js';

// Context
export { AppsProvider, useAppsContext } from './context.js';
export type { AppsProviderProps } from './context.js';

// Hooks
export {
  useAppsClient,
  useToolResult,
  useToolInput,
  useHostContext,
  useWidgetState,
  useHostStyleVariables,
  useDocumentTheme,
  useDisplayMode,
  useSafeAreaInsets,
  useOnToolCancelled,
  useOnTeardown,
  // Debug logging
  useDebugLogger,
  // MCP Apps API hooks
  useOnToolInputPartial,
  useHostCapabilities,
  useHostVersion,
  useSizeChangedNotifications,
  // Model context (ext-apps v0.4.0+)
  useUpdateModelContext,
  // Resource meta (license gate, CSP, etc.)
  useResourceMeta,
} from './hooks.js';

// Re-export debug logger types from apps-client
export type {
  ClientDebugConfig,
  ClientDebugLogger,
} from '../apps-client/index.js';
