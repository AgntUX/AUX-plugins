/**
 * Protocol detection for auto-selecting the correct adapter
 *
 * Inlined from @mcp-apps-kit/ui v0.5.0
 * Source: https://github.com/agntux/mcp-apps-kit
 * Date: 2026-01-24
 *
 * @internal
 */

import type { DetectedProtocol } from './types.js';

/**
 * Detect the current host protocol
 *
 * Detection order:
 * 1. `window.parent !== window` (iframe) → MCP Apps
 * 2. Neither → Mock (development mode)
 *
 * @returns Detected protocol type
 *
 * @internal
 */
export function detectProtocol(): DetectedProtocol {
  // Server-side: default to mock
  if (typeof window === 'undefined') {
    return 'mock';
  }

  // Check for iframe (MCP Apps)
  if (window.parent !== window) {
    return 'mcp';
  }

  // Default to mock for development
  return 'mock';
}
