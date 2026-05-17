import { describe, it, expect } from 'vitest';
import { McpAdapter } from '../../lib/apps-client/adapters/mcp.js';

type ExtractToolOutput = (result: unknown) => Record<string, unknown>;

function getExtractor(adapter: McpAdapter): ExtractToolOutput {
  const method = (
    adapter as unknown as { extractToolOutput: ExtractToolOutput }
  ).extractToolOutput;
  return method.bind(adapter);
}

describe('McpAdapter.extractToolOutput', () => {
  it('preserves both structuredContent fields and raw content[] as _content', () => {
    const adapter = new McpAdapter();
    const extract = getExtractor(adapter);

    const content = [{ type: 'text', text: 'hello file text' }];
    const result = {
      structuredContent: {
        path: 'notes.md',
        total_lines: 1,
        returned_lines: 1,
        offset: 0,
        limit: 1000,
        truncated: false,
      },
      content,
    };

    const output = extract(result);

    expect(output.path).toBe('notes.md');
    expect(output.total_lines).toBe(1);
    expect(output.returned_lines).toBe(1);
    expect(output.offset).toBe(0);
    expect(output.limit).toBe(1000);
    expect(output.truncated).toBe(false);
    expect(output._content).toEqual(content);
  });

  it('does not add _content key when content[] is empty or absent', () => {
    const adapter = new McpAdapter();
    const extract = getExtractor(adapter);

    const emptyContentOutput = extract({
      structuredContent: { ok: true },
      content: [],
    });
    expect('_content' in emptyContentOutput).toBe(false);
    expect(emptyContentOutput.ok).toBe(true);

    const missingContentOutput = extract({
      structuredContent: { ok: true },
    });
    expect('_content' in missingContentOutput).toBe(false);
    expect(missingContentOutput.ok).toBe(true);
  });

  it('does not clobber a user-space _content field in structuredContent', () => {
    const adapter = new McpAdapter();
    const extract = getExtractor(adapter);

    const userSpaceContent = { note: 'user wins' };
    const rawContent = [{ type: 'text', text: 'should not overwrite' }];

    const output = extract({
      structuredContent: { _content: userSpaceContent, other: 1 },
      content: rawContent,
    });

    expect(output._content).toEqual(userSpaceContent);
    expect(output.other).toBe(1);
  });

  it('still preserves _content alongside the JSON-text fallback hoist', () => {
    const adapter = new McpAdapter();
    const extract = getExtractor(adapter);

    const content = [{ type: 'text', text: '{"foo":"bar","n":42}' }];
    const output = extract({ content });

    expect(output.foo).toBe('bar');
    expect(output.n).toBe(42);
    expect(output._content).toEqual(content);
  });

  it('preserves raw content[] when it is plain text that is not JSON-parseable', () => {
    const adapter = new McpAdapter();
    const extract = getExtractor(adapter);

    const content = [{ type: 'text', text: 'plain file contents, not json' }];
    const output = extract({ content });

    expect(output._content).toEqual(content);
    expect(Object.keys(output).filter((k) => k !== '_content')).toEqual([]);
  });

  it('preserves non-text content blocks (image/audio/resource) in _content', () => {
    const adapter = new McpAdapter();
    const extract = getExtractor(adapter);

    const content = [
      { type: 'image', data: 'base64...', mimeType: 'image/png' },
      { type: 'resource', resource: { uri: 'file:///a', text: 'a' } },
    ];
    const output = extract({
      structuredContent: { status: 'ok' },
      content,
    });

    expect(output.status).toBe('ok');
    expect(output._content).toEqual(content);
  });

  it('preserves _meta alongside _content', () => {
    const adapter = new McpAdapter();
    const extract = getExtractor(adapter);

    const content = [{ type: 'text', text: 'hi' }];
    const output = extract({
      structuredContent: { ok: true },
      content,
      _meta: { traceId: 'abc123' },
    });

    expect(output.ok).toBe(true);
    expect(output._content).toEqual(content);
    expect(output._meta).toEqual({ traceId: 'abc123' });
  });

  it('returns _content-only object when structuredContent is absent and content is not parseable', () => {
    const adapter = new McpAdapter();
    const extract = getExtractor(adapter);

    const content = [{ type: 'image', data: 'xxx', mimeType: 'image/png' }];
    const output = extract({ content });

    expect(output._content).toEqual(content);
    expect(Object.keys(output)).toEqual(['_content']);
  });
});
