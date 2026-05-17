/**
 * Custom Vitest matchers for Apps SDK component testing
 */

import { expect } from 'vitest';
import type { TestMockAdapter } from '../test-utils/mock-adapter.js';

// =============================================================================
// MATCHER DECLARATIONS
// =============================================================================

interface CustomMatchers<R = unknown> {
  /**
   * Assert that a tool was called with specific arguments
   *
   * @example
   * ```ts
   * expect(adapter).toHaveCalledTool('my_tool');
   * expect(adapter).toHaveCalledTool('my_tool', { arg: 'value' });
   * ```
   */
  toHaveCalledTool(toolName: string, expectedArgs?: Record<string, unknown>): R;

  /**
   * Assert that the widget state matches expected values
   *
   * @example
   * ```ts
   * expect(adapter).toHaveWidgetState({ count: 5 });
   * ```
   */
  toHaveWidgetState(expected: Record<string, unknown>): R;

  /**
   * Assert that an element is accessible (basic accessibility checks)
   *
   * Checks for common accessibility issues:
   * - Buttons without accessible names
   * - Images without alt text
   * - Form inputs without labels
   *
   * @example
   * ```ts
   * expect(container.firstChild).toBeAccessible();
   * ```
   */
  toBeAccessible(): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

function isTestMockAdapter(value: unknown): value is TestMockAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getToolCallHistory' in value &&
    typeof (value as TestMockAdapter).getToolCallHistory === 'function'
  );
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

// =============================================================================
// MATCHER IMPLEMENTATIONS
// =============================================================================

/**
 * Setup custom matchers for widget testing
 *
 * Call this in your test setup file to register the matchers.
 */
export function setupWidgetMatchers(): void {
  expect.extend({
    toHaveCalledTool(
      received: unknown,
      toolName: string,
      expectedArgs?: Record<string, unknown>,
    ) {
      if (!isTestMockAdapter(received)) {
        return {
          pass: false,
          message: () =>
            `Expected a TestMockAdapter instance, but received ${typeof received}`,
        };
      }

      const history = received.getToolCallHistory();
      const calls = history.filter((call) => call.name === toolName);

      if (calls.length === 0) {
        return {
          pass: false,
          message: () => {
            const calledTools = [...new Set(history.map((c) => c.name))];
            return (
              `Expected tool "${toolName}" to be called, but it was never called.\n` +
              `Tools that were called: ${calledTools.length > 0 ? calledTools.join(', ') : 'none'}`
            );
          },
        };
      }

      if (expectedArgs !== undefined) {
        const lastCall = calls[calls.length - 1];
        const actualArgsStr = JSON.stringify(lastCall.args, null, 2);
        const expectedArgsStr = JSON.stringify(expectedArgs, null, 2);

        if (actualArgsStr !== expectedArgsStr) {
          return {
            pass: false,
            message: () =>
              `Expected tool "${toolName}" to be called with:\n${expectedArgsStr}\n\n` +
              `But was called with:\n${actualArgsStr}`,
          };
        }
      }

      return {
        pass: true,
        message: () =>
          `Expected tool "${toolName}" not to be called${expectedArgs ? ` with ${JSON.stringify(expectedArgs)}` : ''}`,
      };
    },

    toHaveWidgetState(received: unknown, expected: Record<string, unknown>) {
      if (!isTestMockAdapter(received)) {
        return {
          pass: false,
          message: () =>
            `Expected a TestMockAdapter instance, but received ${typeof received}`,
        };
      }

      const actualState = received.getWidgetState();

      // Check if all expected keys match
      const mismatches: string[] = [];
      for (const [key, expectedValue] of Object.entries(expected)) {
        const actualValue = actualState[key];
        const actualStr = JSON.stringify(actualValue);
        const expectedStr = JSON.stringify(expectedValue);

        if (actualStr !== expectedStr) {
          mismatches.push(
            `  Key "${key}": expected ${expectedStr}, got ${actualStr}`,
          );
        }
      }

      if (mismatches.length > 0) {
        return {
          pass: false,
          message: () =>
            `Widget state does not match expected values:\n${mismatches.join('\n')}\n\n` +
            `Actual state: ${JSON.stringify(actualState, null, 2)}`,
        };
      }

      return {
        pass: true,
        message: () =>
          `Widget state should not have values: ${JSON.stringify(expected)}`,
      };
    },

    toBeAccessible(received: unknown) {
      if (!isHTMLElement(received)) {
        return {
          pass: false,
          message: () =>
            `Expected an HTMLElement, but received ${typeof received}`,
        };
      }

      const issues: string[] = [];

      // Check buttons without accessible names
      const buttons = received.querySelectorAll('button');
      buttons.forEach((button, index) => {
        const hasText = button.textContent?.trim();
        const hasAriaLabel = button.getAttribute('aria-label');
        const hasAriaLabelledBy = button.getAttribute('aria-labelledby');
        const hasTitle = button.getAttribute('title');

        if (!hasText && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
          issues.push(
            `Button ${index + 1} has no accessible name (text, aria-label, aria-labelledby, or title)`,
          );
        }
      });

      // Check images without alt text
      const images = received.querySelectorAll('img');
      images.forEach((img, index) => {
        const hasAlt = img.hasAttribute('alt');
        const hasRole = img.getAttribute('role') === 'presentation';

        if (!hasAlt && !hasRole) {
          issues.push(
            `Image ${index + 1} has no alt attribute and is not marked as presentation`,
          );
        }
      });

      // Check form inputs without labels
      const inputs = received.querySelectorAll('input, textarea, select');
      inputs.forEach((input, index) => {
        const id = input.getAttribute('id');
        const hasLabel = id
          ? received.querySelector(`label[for="${id}"]`)
          : false;
        const hasAriaLabel = input.getAttribute('aria-label');
        const hasAriaLabelledBy = input.getAttribute('aria-labelledby');
        const hasPlaceholder = input.getAttribute('placeholder');
        const hasTitle = input.getAttribute('title');
        const isHidden = input.getAttribute('type') === 'hidden';

        if (
          !isHidden &&
          !hasLabel &&
          !hasAriaLabel &&
          !hasAriaLabelledBy &&
          !hasPlaceholder &&
          !hasTitle
        ) {
          issues.push(
            `Input ${index + 1} has no associated label, aria-label, aria-labelledby, placeholder, or title`,
          );
        }
      });

      if (issues.length > 0) {
        return {
          pass: false,
          message: () =>
            `Found ${issues.length} accessibility issue(s):\n${issues.map((i) => `  - ${i}`).join('\n')}`,
        };
      }

      return {
        pass: true,
        message: () => 'Element should have accessibility issues',
      };
    },
  });
}
