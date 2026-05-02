/**
 * main-component.test.tsx — vitest + @testing-library/react
 *
 * Scenarios covered:
 *   (a) parsePayload defaulting — null/undefined/malformed → fully-formed defaults
 *   (b) disabled-while-streaming — Send button is disabled when isStreaming=true
 *   (c) Send intent assembly — matches P9 §8.3 verbatim (exact host_prompt shape)
 *   (d) edit capture across re-renders — user types, re-render with same
 *       structuredContent prop, edit survives
 *   (e) component renders without crashing on empty structuredContent={}
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import { parsePayload } from '../lib/parse-payload';
import { MainComponent, type MainComponentProps } from '../components/main-component';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeProps(overrides: Partial<MainComponentProps> = {}): MainComponentProps {
  return {
    toolOutput: undefined,
    toolInput: undefined,
    isStreaming: false,
    widgetState: {},
    setWidgetState: vi.fn(),
    callTool: vi.fn().mockResolvedValue({}),
    sendFollowUpMessage: vi.fn().mockResolvedValue(undefined),
    displayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    requestDisplayMode: vi.fn().mockResolvedValue(undefined),
    theme: 'light',
    locale: 'en-US',
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    viewport: { width: 400, height: 600 },
    platform: 'web',
    ...overrides,
  };
}

const THREAD_OUTPUT: Record<string, unknown> = {
  thread_ts: '1714043640.001200',
  channel_id: 'C09ABCDEF',
  channel_name: 'acme-renewal',
  action_id: '2026-04-25-acme-friday-call',
  proposed_reply: 'Sounds great — Friday 2pm works.',
  thread_messages: [
    { id: 'msg_001', ts: '1714043640.001200', user_id: 'U001', text: 'Are you available Friday 2pm?' },
    { id: 'msg_002', ts: '1714043700.001300', user_id: 'U002', text: 'Let me check and get back to you.' },
  ],
  thread_members: [
    { user_id: 'U001', name: 'alice', real_name: 'Alice Smith' },
    { user_id: 'U002', name: 'bob',   real_name: 'Bob Jones' },
  ],
  highlighted_msg_ids: ['msg_001'],
};

// ── (a) parsePayload defaulting ───────────────────────────────────────────────

describe('parsePayload defaulting', () => {
  it('returns fully-formed defaults for null input', () => {
    const result = parsePayload(null);
    expect(result.thread_messages).toEqual([]);
    expect(result.thread_members).toEqual([]);
    expect(result.highlighted_msg_ids).toEqual([]);
    expect(result.proposed_reply).toBe('');
    expect(result.action_id).toBe('');
    expect(result.channel_id).toBe('');
    expect(result.channel_name).toBe('');
    expect(result.thread_ts).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('returns fully-formed defaults for undefined input', () => {
    const result = parsePayload(undefined);
    expect(result.thread_messages).toEqual([]);
    expect(result.proposed_reply).toBe('');
    expect(result.action_id).toBe('');
  });

  it('returns fully-formed defaults for empty object', () => {
    const result = parsePayload({});
    expect(result.thread_messages).toEqual([]);
    expect(result.thread_members).toEqual([]);
    expect(result.highlighted_msg_ids).toEqual([]);
    expect(result.proposed_reply).toBe('');
  });

  it('returns fully-formed defaults for malformed thread_messages (not an array)', () => {
    const result = parsePayload({ thread_messages: 'not-an-array' as unknown as never });
    expect(result.thread_messages).toEqual([]);
  });

  it('returns fully-formed defaults for malformed thread_members (object instead of array)', () => {
    const result = parsePayload({ thread_members: { user_id: 'X' } as unknown as never });
    expect(result.thread_members).toEqual([]);
  });

  it('parses flat structuredContent correctly', () => {
    const result = parsePayload(THREAD_OUTPUT);
    expect(result.thread_messages).toHaveLength(2);
    expect(result.thread_members).toHaveLength(2);
    expect(result.proposed_reply).toBe('Sounds great — Friday 2pm works.');
    expect(result.channel_id).toBe('C09ABCDEF');
    expect(result.channel_name).toBe('acme-renewal');
    expect(result.action_id).toBe('2026-04-25-acme-friday-call');
    expect(result.thread_ts).toBe('1714043640.001200');
    expect(result.highlighted_msg_ids).toEqual(['msg_001']);
  });

  it('unwraps relay envelope (_meta.payload) correctly', () => {
    const relayEnvelope = { _meta: { payload: THREAD_OUTPUT } };
    const result = parsePayload(relayEnvelope);
    expect(result.thread_messages).toHaveLength(2);
    expect(result.proposed_reply).toBe('Sounds great — Friday 2pm works.');
  });

  it('handles partial message objects gracefully (missing fields default to empty string)', () => {
    const result = parsePayload({
      thread_messages: [{ id: 'x' }],
    });
    expect(result.thread_messages[0].ts).toBe('');
    expect(result.thread_messages[0].user_id).toBe('');
    expect(result.thread_messages[0].text).toBe('');
  });

  it('parses error field for auth_failed', () => {
    const result = parsePayload({ error: 'auth_failed' });
    expect(result.error).toBe('auth_failed');
  });

  it('parses error field for not_found', () => {
    const result = parsePayload({ error: 'not_found' });
    expect(result.error).toBe('not_found');
  });

  it('ignores unknown error values', () => {
    const result = parsePayload({ error: 'something_else' });
    expect(result.error).toBeUndefined();
  });

  it('does not throw on non-object input (number)', () => {
    expect(() => parsePayload(42 as unknown as Record<string, unknown>)).not.toThrow();
  });

  it('does not throw on non-object input (array)', () => {
    expect(() => parsePayload([] as unknown as Record<string, unknown>)).not.toThrow();
  });
});

// ── (b) disabled-while-streaming ─────────────────────────────────────────────

describe('disabled while streaming', () => {
  it('Send button is disabled when isStreaming=true', () => {
    const props = makeProps({
      toolOutput: THREAD_OUTPUT,
      isStreaming: true,
    });
    render(<MainComponent {...props} />);
    const btn = screen.getByTestId('send-button');
    expect(btn).toBeDisabled();
  });

  it('Send button is enabled when isStreaming=false and draft is non-empty', async () => {
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false });
    render(<MainComponent {...props} />);
    // proposed_reply pre-fills textarea; button enables once draft is non-empty
    await waitFor(() => {
      const btn = screen.getByTestId('send-button');
      expect(btn).not.toBeDisabled();
    });
  });

  it('Send button is disabled when draft is empty string', async () => {
    const outputWithNoReply = { ...THREAD_OUTPUT, proposed_reply: '' };
    const props = makeProps({ toolOutput: outputWithNoReply, isStreaming: false });
    render(<MainComponent {...props} />);
    const btn = await screen.findByTestId('send-button');
    expect(btn).toBeDisabled();
  });
});

// ── (c) Send intent assembly — P9 §8.3 verbatim ──────────────────────────────

describe('Send intent assembly (P9 §8.3)', () => {
  it('assembles the exact P9 §8.3 host_prompt on Send click', async () => {
    const user = userEvent.setup();
    const sendFollowUpMessage = vi.fn().mockResolvedValue(undefined);
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false, sendFollowUpMessage });
    render(<MainComponent {...props} />);

    const btn = await screen.findByTestId('send-button');
    await waitFor(() => expect(btn).not.toBeDisabled());
    await user.click(btn);

    await waitFor(() => expect(sendFollowUpMessage).toHaveBeenCalledOnce());

    const sentText: string = sendFollowUpMessage.mock.calls[0][0] as string;

    // Line 1 — dispatch trigger (P9 §8.3)
    expect(sentText).toMatch(
      /^User confirmed sending this Slack reply to thread 1714043640\.001200 in channel C09ABCDEF \(#acme-renewal\):/
    );
    // Fenced reply body
    expect(sentText).toContain('---\nSounds great — Friday 2pm works.\n---');
    // Silent persistence instruction (P9 §8.3, verbatim last line)
    expect(sentText).toContain('3. Do not emit any further tool calls or assistant text.');
    // Action item edit step
    expect(sentText).toContain('Edit ~/agntux-code/actions/2026-04-25-acme-friday-call.md');
    expect(sentText).toContain('status=done');
    expect(sentText).toContain('completed_at=<ISO now>');
    // Resolution log
    expect(sentText).toContain('## Resolution log');
    expect(sentText).toContain('Sent reply via slack. permalink: <permalink>');
    // mcp__slack__post_message reference
    expect(sentText).toContain('mcp__slack__post_message');
  });

  it('uses the user-edited text (not the original proposed_reply) in the intent', async () => {
    const user = userEvent.setup();
    const sendFollowUpMessage = vi.fn().mockResolvedValue(undefined);
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false, sendFollowUpMessage });
    render(<MainComponent {...props} />);

    const textarea = await screen.findByLabelText('Reply draft');
    await waitFor(() => expect(textarea).not.toBeDisabled());

    // Clear and type new text
    await user.clear(textarea);
    await user.type(textarea, 'Actually, Thursday works better.');

    const btn = screen.getByTestId('send-button');
    await waitFor(() => expect(btn).not.toBeDisabled());
    await user.click(btn);

    await waitFor(() => expect(sendFollowUpMessage).toHaveBeenCalledOnce());
    const sentText: string = sendFollowUpMessage.mock.calls[0][0] as string;
    expect(sentText).toContain('Actually, Thursday works better.');
    expect(sentText).not.toContain('Sounds great — Friday 2pm works.');
  });

  it('disables Send button after successful send (idempotency — P9 §8.5)', async () => {
    const user = userEvent.setup();
    const sendFollowUpMessage = vi.fn().mockResolvedValue(undefined);
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false, sendFollowUpMessage });
    render(<MainComponent {...props} />);

    const btn = await screen.findByTestId('send-button');
    await waitFor(() => expect(btn).not.toBeDisabled());
    await user.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    expect(sendFollowUpMessage).toHaveBeenCalledOnce();
  });

  it('re-enables Send button on error and does not call sendFollowUpMessage twice', async () => {
    const user = userEvent.setup();
    const sendFollowUpMessage = vi.fn().mockRejectedValue(new Error('network error'));
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false, sendFollowUpMessage });
    render(<MainComponent {...props} />);

    const btn = await screen.findByTestId('send-button');
    await waitFor(() => expect(btn).not.toBeDisabled());
    await user.click(btn);

    // After error, button re-enables for retry
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(sendFollowUpMessage).toHaveBeenCalledOnce();
  });
});

// ── (d) edit capture across re-renders ───────────────────────────────────────

describe('edit capture across re-renders', () => {
  it('preserves user edits when toolOutput prop re-renders with same data', async () => {
    const user = userEvent.setup();
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false });
    const { rerender } = render(<MainComponent {...props} />);

    const textarea = await screen.findByLabelText('Reply draft') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea).not.toBeDisabled());

    // User edits the textarea
    await user.clear(textarea);
    await user.type(textarea, 'My edited reply text');
    expect(textarea.value).toBe('My edited reply text');

    // Re-render with the same structuredContent (simulates streaming re-render)
    rerender(<MainComponent {...props} toolOutput={{ ...THREAD_OUTPUT }} />);

    // Edit must survive
    expect(textarea.value).toBe('My edited reply text');
  });

  it('resets draft when a completely new thread_ts arrives', async () => {
    const user = userEvent.setup();
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false });
    const { rerender } = render(<MainComponent {...props} />);

    const textarea = await screen.findByLabelText('Reply draft') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea).not.toBeDisabled());

    await user.clear(textarea);
    await user.type(textarea, 'Some edit that belongs to the old thread');

    // New thread arrives (different thread_ts)
    const newOutput = {
      ...THREAD_OUTPUT,
      thread_ts: '9999999999.000001',
      proposed_reply: 'New proposed reply for new thread',
      action_id: 'new-action-id',
    };
    rerender(<MainComponent {...makeProps({ toolOutput: newOutput, isStreaming: false })} />);

    // Draft resets to new proposed_reply
    await waitFor(() => {
      expect(textarea.value).toBe('New proposed reply for new thread');
    });
  });
});

// ── (e) renders without crashing on empty structuredContent ──────────────────

describe('render without crashing', () => {
  it('renders without crashing on empty structuredContent={}', () => {
    const props = makeProps({ toolOutput: {}, isStreaming: false });
    expect(() => render(<MainComponent {...props} />)).not.toThrow();
  });

  it('renders without crashing when toolOutput is undefined', () => {
    const props = makeProps({ toolOutput: undefined, isStreaming: false });
    expect(() => render(<MainComponent {...props} />)).not.toThrow();
  });

  it('renders without crashing when toolOutput is undefined and isStreaming=true', () => {
    const props = makeProps({ toolOutput: undefined, isStreaming: true });
    expect(() => render(<MainComponent {...props} />)).not.toThrow();
  });

  it('renders degraded state for error=not_found without crashing', () => {
    const props = makeProps({ toolOutput: { error: 'not_found', action_id: 'test-id' }, isStreaming: false });
    expect(() => render(<MainComponent {...props} />)).not.toThrow();
    expect(screen.getByText(/Thread no longer available/i)).toBeInTheDocument();
  });

  it('renders degraded state for error=auth_failed without crashing', () => {
    const props = makeProps({ toolOutput: { error: 'auth_failed' }, isStreaming: false });
    expect(() => render(<MainComponent {...props} />)).not.toThrow();
    expect(screen.getByText(/Slack connection issue/i)).toBeInTheDocument();
  });

  it('renders degraded state for error=network without crashing', () => {
    const props = makeProps({ toolOutput: { error: 'network' }, isStreaming: false });
    expect(() => render(<MainComponent {...props} />)).not.toThrow();
    expect(screen.getByText(/Connection problem/i)).toBeInTheDocument();
  });

  it('shows Mark done button for not_found with action_id', () => {
    const props = makeProps({ toolOutput: { error: 'not_found', action_id: 'my-action' }, isStreaming: false });
    render(<MainComponent {...props} />);
    expect(screen.getByText('Mark done')).toBeInTheDocument();
  });

  it('does NOT show Mark done button for auth_failed', () => {
    const props = makeProps({ toolOutput: { error: 'auth_failed', action_id: 'my-action' }, isStreaming: false });
    render(<MainComponent {...props} />);
    expect(screen.queryByText('Mark done')).not.toBeInTheDocument();
  });

  it('renders thread messages correctly', async () => {
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false });
    render(<MainComponent {...props} />);
    expect(await screen.findByText('Are you available Friday 2pm?')).toBeInTheDocument();
    expect(screen.getByText('Let me check and get back to you.')).toBeInTheDocument();
  });

  it('renders member names from thread_members', async () => {
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false });
    render(<MainComponent {...props} />);
    expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('pre-fills textarea with proposed_reply', async () => {
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: false });
    render(<MainComponent {...props} />);
    const textarea = await screen.findByLabelText('Reply draft') as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toBe('Sounds great — Friday 2pm works.');
    });
  });
});

// ── Additional streaming tests ─────────────────────────────────────────────────

describe('streaming partial renders', () => {
  it('shows streaming indicator when isStreaming=true', () => {
    const props = makeProps({ toolOutput: THREAD_OUTPUT, isStreaming: true });
    render(<MainComponent {...props} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders skeleton for relay envelope with empty payload', () => {
    const relayEnvelope = { _meta: { payload: {} } };
    const props = makeProps({ toolOutput: relayEnvelope, isStreaming: true });
    expect(() => render(<MainComponent {...props} />)).not.toThrow();
  });
});
