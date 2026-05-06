import { describe, it, expect } from 'vitest';
import { detectErrorEnvelope } from '../../lib/detect-error-envelope.js';

describe('detectErrorEnvelope', () => {
  it('returns null for undefined input (no tool result yet)', () => {
    expect(detectErrorEnvelope(undefined)).toBeNull();
  });

  it('returns null for an empty object (degenerate result)', () => {
    expect(detectErrorEnvelope({})).toBeNull();
  });

  it('returns null when the streaming-partial envelope is present (only _meta)', () => {
    expect(
      detectErrorEnvelope({ _meta: { payload: { canvas: null } } }),
    ).toBeNull();
  });

  it('returns the text of a license-gate error envelope', () => {
    const text =
      'agntux-slack requires pairing before this tool can run.\n\n' +
      'Pair this device → https://app.agntux.ai/connect/abc123';
    expect(
      detectErrorEnvelope({ _content: [{ type: 'text', text }] }),
    ).toBe(text);
  });

  it('returns the text when the envelope also carries _meta alongside _content', () => {
    expect(
      detectErrorEnvelope({
        _meta: { license: { ok: false } },
        _content: [{ type: 'text', text: 'Trial expired.' }],
      }),
    ).toBe('Trial expired.');
  });

  it('returns null when toolOutput has any payload-shaped key (real tool result)', () => {
    expect(
      detectErrorEnvelope({
        action_id: 'a-1',
        canvas: { title: 't', body: '' },
        _content: [{ type: 'text', text: 'should not be surfaced' }],
      }),
    ).toBeNull();
  });

  it('returns null when _content is empty', () => {
    expect(detectErrorEnvelope({ _content: [] })).toBeNull();
  });

  it('returns null when _content is not an array', () => {
    expect(
      detectErrorEnvelope({ _content: 'not an array' as unknown as never[] }),
    ).toBeNull();
  });

  it('returns null when the first content block is not a text block', () => {
    expect(
      detectErrorEnvelope({
        _content: [{ type: 'image', data: 'base64...' }],
      }),
    ).toBeNull();
  });

  it('returns null when the text field is empty', () => {
    expect(
      detectErrorEnvelope({ _content: [{ type: 'text', text: '' }] }),
    ).toBeNull();
  });

  it('returns null when the text field is not a string', () => {
    expect(
      detectErrorEnvelope({
        _content: [{ type: 'text', text: 42 as unknown as string }],
      }),
    ).toBeNull();
  });

  it('preserves whitespace and newlines in the surfaced text', () => {
    const text = 'Headline.\n\nLine 1\nLine 2';
    expect(
      detectErrorEnvelope({ _content: [{ type: 'text', text }] }),
    ).toBe(text);
  });
});
