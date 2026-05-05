import { describe, it, expect } from 'vitest';
import { handler } from '../tools/_example.js';
import type { ToolContext } from '../types.js';

const mockContext: ToolContext = {
  secrets: { MY_API_KEY: 'test-key' },
  appId: 'test-app',
  componentId: 'test-component',
};

describe('example handler', () => {
  it('returns expected data', async () => {
    const result = await handler({}, mockContext);
    expect(result).toBeDefined();
  });
});
