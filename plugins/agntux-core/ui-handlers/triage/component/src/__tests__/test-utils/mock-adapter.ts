/**
 * Test-specific mock adapter for component testing
 *
 * Extends the runtime MockAdapter with additional features for testing:
 * - Tool call history tracking
 * - Widget state inspection
 * - Controlled tool result emission
 */

import { MockAdapter } from '../../lib/apps-client/adapters/mock.js';
import type { HostContext } from '../../lib/apps-client/types.js';

/**
 * Record of a tool call made during testing
 */
export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Options for creating a test mock adapter
 */
export interface MockAdapterOptions {
  /** Initial host context values */
  initialContext?: Partial<HostContext>;
  /** Initial tool output to provide */
  initialToolOutput?: unknown;
  /** Initial widget state */
  initialWidgetState?: Record<string, unknown>;
}

/**
 * Test mock adapter that wraps MockAdapter with additional test utilities
 */
export class TestMockAdapter extends MockAdapter {
  private toolCallHistory: ToolCallRecord[] = [];
  private widgetState: Record<string, unknown> = {};
  private mockedToolResponses: Map<string, unknown> = new Map();

  constructor(options: MockAdapterOptions = {}) {
    super();

    // Apply initial context if provided
    if (options.initialContext) {
      this.setHostContext(options.initialContext);
    }

    // Apply initial tool output if provided
    if (options.initialToolOutput !== undefined) {
      this.emitToolResult(options.initialToolOutput);
    }

    // Apply initial widget state if provided
    if (options.initialWidgetState) {
      this.widgetState = { ...options.initialWidgetState };
      this.setState(this.widgetState);
    }
  }

  /**
   * Override setState to track widget state
   */
  override setState<S>(state: S): void {
    this.widgetState = state as Record<string, unknown>;
    super.setState(state);
  }

  /**
   * Get the history of all tool calls made during the test
   */
  getToolCallHistory(): ToolCallRecord[] {
    return [...this.toolCallHistory];
  }

  /**
   * Clear the tool call history
   */
  clearToolCallHistory(): void {
    this.toolCallHistory = [];
  }

  /**
   * Get the current widget state
   */
  getWidgetState(): Record<string, unknown> {
    return { ...this.widgetState };
  }

  /**
   * Check if a specific tool was called
   */
  wasToolCalled(toolName: string): boolean {
    return this.toolCallHistory.some((call) => call.name === toolName);
  }

  /**
   * Get calls for a specific tool
   */
  getCallsForTool(toolName: string): ToolCallRecord[] {
    return this.toolCallHistory.filter((call) => call.name === toolName);
  }

  /**
   * Get the last call for a specific tool
   */
  getLastCallForTool(toolName: string): ToolCallRecord | undefined {
    const calls = this.getCallsForTool(toolName);
    return calls[calls.length - 1];
  }

  /**
   * Assert that a tool was called with specific arguments
   * @throws Error if the assertion fails
   */
  assertToolCalled(
    toolName: string,
    expectedArgs?: Record<string, unknown>,
  ): void {
    const calls = this.getCallsForTool(toolName);

    if (calls.length === 0) {
      throw new Error(
        `Expected tool "${toolName}" to be called, but it was never called`,
      );
    }

    if (expectedArgs !== undefined) {
      const lastCall = calls[calls.length - 1];
      const actualArgs = JSON.stringify(lastCall.args, null, 2);
      const expected = JSON.stringify(expectedArgs, null, 2);

      if (actualArgs !== expected) {
        throw new Error(
          `Expected tool "${toolName}" to be called with:\n${expected}\n\nBut was called with:\n${actualArgs}`,
        );
      }
    }
  }

  /**
   * Set up a mock response for a specific tool
   * The next time this tool is called, it will return the provided response
   */
  mockToolResponse(toolName: string, response: unknown): void {
    this.mockedToolResponses.set(toolName, response);
  }

  /**
   * Clear a mocked tool response
   */
  clearMockedToolResponse(toolName: string): void {
    this.mockedToolResponses.delete(toolName);
  }

  /**
   * Clear all mocked tool responses
   */
  clearAllMockedToolResponses(): void {
    this.mockedToolResponses.clear();
  }

  /**
   * Override callTool to check for mocked responses
   */
  override async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    // Record the call
    this.toolCallHistory.push({
      name,
      args,
      timestamp: new Date(),
    });

    // Check for mocked response
    if (this.mockedToolResponses.has(name)) {
      return this.mockedToolResponses.get(name);
    }

    // Call parent implementation (MockAdapter.callTool)
    // We need to call the grandparent to avoid infinite recursion
    // Since MockAdapter.callTool just logs and returns a mock result,
    // we replicate that behavior here
    return {
      _mock: true,
      tool: name,
      args,
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a test mock adapter with the given options
 */
export function createTestMockAdapter(
  options: MockAdapterOptions = {},
): TestMockAdapter {
  return new TestMockAdapter(options);
}
