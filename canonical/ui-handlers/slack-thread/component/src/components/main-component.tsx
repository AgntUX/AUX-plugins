/**
 * main-component.tsx — Slack Thread UI handler component
 *
 * Design direction (frontend-design skill output):
 * ─────────────────────────────────────────────────
 * Aesthetic: Editorial / archival — a purpose-built "paper trail" panel, not a
 * chat window. Feels like a conversation record you'd find in a well-designed
 * internal tool. Distinctive from generic AI chat UIs through:
 *
 * Typography:
 *   - Display: "DM Serif Display" (serif, high-contrast strokes, editorial weight)
 *     for channel + thread headings
 *   - Body: "IBM Plex Mono" at 13px for message text (monospace lends a log/record
 *     feel; tight tracking; no word-wrap awkwardness in narrow panels)
 *   - UI chrome: "DM Sans" for sender names, timestamps, buttons — clean, modern
 *
 * Color palette (light mode only — single scheme per project memory rule):
 *   --st-bg:          #F7F5F0   warm off-white — like aged paper; not clinical white
 *   --st-surface:     #FFFFFF   message cards
 *   --st-border:      #E2DDD6   warm sand border
 *   --st-border-strong: #C8C0B4 heavier rule for section dividers
 *   --st-text:        #1A1714   near-black warm ink
 *   --st-text-muted:  #7A7369   warm mid-grey for metadata
 *   --st-text-faint:  #B5AFA8   lightest — timestamps, faint rule
 *   --st-accent:      #2B5CE6   cobalt blue — Send button, highlights, active states
 *   --st-accent-hover:#1E48C7   pressed Send
 *   --st-highlight:   #FFF0C2   warm amber highlight for flagged messages
 *   --st-highlight-border: #E6C84A
 *   --st-error:       #C0392B
 *   --st-success:     #1A7A4A
 *   --st-sending:     #7A7369   muted while in-flight
 *
 * Spacing: 8px grid. Generous vertical rhythm (20px between messages).
 * Micro-interactions: reply textarea grows with content (auto-resize).
 * Send button: cobalt with subtle shadow; disabled state is visibly inert.
 * Light mode only — no dark mode support per project memory rule.
 *
 * Layout: fixed-height panel with internal scroll on the thread; reply area
 * is sticky at the bottom. No 100vh / min-h-screen — 600px inline budget.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { parsePayload, type ThreadMessage, type ThreadMember } from '../lib/parse-payload';

// ── Props (matches component-template MainComponentProps shape) ───────────────

export interface MainComponentProps {
  toolOutput?: Record<string, unknown> | undefined;
  toolInput?: Record<string, unknown>;
  isStreaming?: boolean;
  widgetState: Record<string, unknown>;
  setWidgetState: (
    next:
      | Record<string, unknown>
      | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
  displayMode: string;
  availableDisplayModes: string[];
  requestDisplayMode: (mode: 'inline' | 'fullscreen' | 'pip') => Promise<void>;
  theme: string;
  locale: string;
  safeArea: { top: number; right: number; bottom: number; left: number };
  viewport: { width: number; height: number };
  platform: string;
}

// ── Send status ───────────────────────────────────────────────────────────────

type SendStatus = 'idle' | 'sending' | 'sent' | 'error';

// ── Avatar helpers ────────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic hue from user_id for distinct avatar colors.
function avatarHue(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % 360;
}

// ── Member lookup ─────────────────────────────────────────────────────────────

function buildMemberMap(members: ThreadMember[]): Map<string, ThreadMember> {
  return new Map(members.map((m) => [m.user_id, m]));
}

function displayName(userId: string, memberMap: Map<string, ThreadMember>): string {
  const m = memberMap.get(userId);
  if (!m) return userId || 'Unknown';
  return m.real_name || m.name || userId;
}

// ── Timestamp formatting ──────────────────────────────────────────────────────

function formatTs(ts: string): string {
  const epoch = parseFloat(ts);
  if (isNaN(epoch)) return ts;
  const d = new Date(epoch * 1000);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date} ${time}`;
}

// ── CSS-in-JS styles (inline styles to avoid Tailwind dependency in canonical) ──
// Light mode only — single color scheme per project memory rule.

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

  :root {
    --st-bg:             #F7F5F0;
    --st-surface:        #FFFFFF;
    --st-border:         #E2DDD6;
    --st-border-strong:  #C8C0B4;
    --st-text:           #1A1714;
    --st-text-muted:     #7A7369;
    --st-text-faint:     #B5AFA8;
    --st-accent:         #2B5CE6;
    --st-accent-hover:   #1E48C7;
    --st-accent-text:    #FFFFFF;
    --st-highlight:      #FFF0C2;
    --st-highlight-bdr:  #E6C84A;
    --st-error:          #C0392B;
    --st-error-bg:       #FDF0EF;
    --st-success:        #1A7A4A;
    --st-success-bg:     #EEF7F2;
  }

  .st-root {
    font-family: 'DM Sans', system-ui, sans-serif;
    background: var(--st-bg);
    color: var(--st-text);
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-size: 14px;
    line-height: 1.5;
  }

  /* ── Header ── */
  .st-header {
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--st-border-strong);
    flex-shrink: 0;
    background: var(--st-bg);
  }
  .st-header-eyebrow {
    font-family: 'DM Sans', sans-serif;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--st-text-faint);
    margin-bottom: 4px;
  }
  .st-header-title {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 18px;
    font-weight: 400;
    color: var(--st-text);
    line-height: 1.25;
    margin: 0;
  }
  .st-header-meta {
    margin-top: 4px;
    font-size: 12px;
    color: var(--st-text-muted);
  }

  /* ── Thread scroll area ── */
  .st-thread {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    scroll-behavior: smooth;
  }
  .st-thread::-webkit-scrollbar { width: 4px; }
  .st-thread::-webkit-scrollbar-track { background: transparent; }
  .st-thread::-webkit-scrollbar-thumb { background: var(--st-border); border-radius: 2px; }

  /* ── Message ── */
  .st-message {
    display: flex;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--st-border);
    background: var(--st-surface);
    transition: background 0.15s ease;
  }
  .st-message:last-child { border-bottom: none; }
  .st-message.highlighted {
    background: var(--st-highlight);
    border-left: 3px solid var(--st-highlight-bdr);
    padding-left: 17px;
  }

  .st-avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'DM Sans', sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: white;
    letter-spacing: 0.02em;
    user-select: none;
  }

  .st-msg-body { flex: 1; min-width: 0; }
  .st-msg-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }
  .st-sender {
    font-weight: 600;
    font-size: 13px;
    color: var(--st-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .st-timestamp {
    font-size: 11px;
    color: var(--st-text-faint);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .st-msg-text {
    font-family: 'IBM Plex Mono', 'Courier New', monospace;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--st-text);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  /* ── Divider ── */
  .st-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    background: var(--st-bg);
    border-bottom: 1px solid var(--st-border);
  }
  .st-divider-rule { flex: 1; height: 1px; background: var(--st-border-strong); }
  .st-divider-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--st-text-muted);
    white-space: nowrap;
  }

  /* ── Reply area ── */
  .st-reply-area {
    flex-shrink: 0;
    border-top: 2px solid var(--st-border-strong);
    background: var(--st-bg);
    padding: 14px 20px 16px;
  }
  .st-reply-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--st-text-muted);
    margin-bottom: 8px;
  }
  .st-textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 72px;
    max-height: 200px;
    padding: 10px 12px;
    font-family: 'IBM Plex Mono', 'Courier New', monospace;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--st-text);
    background: var(--st-surface);
    border: 1.5px solid var(--st-border-strong);
    border-radius: 6px;
    resize: none;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    display: block;
    overflow-y: auto;
  }
  .st-textarea:focus {
    border-color: var(--st-accent);
    box-shadow: 0 0 0 3px rgba(43,92,230,0.12);
  }
  .st-textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--st-bg);
  }

  .st-reply-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    gap: 12px;
  }
  .st-char-count {
    font-size: 11px;
    color: var(--st-text-faint);
    flex-shrink: 0;
  }

  /* ── Send button ── */
  .st-send-btn {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: var(--st-accent-text);
    background: var(--st-accent);
    border: none;
    border-radius: 6px;
    padding: 8px 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
    box-shadow: 0 1px 3px rgba(43,92,230,0.25);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .st-send-btn:hover:not(:disabled) {
    background: var(--st-accent-hover);
    box-shadow: 0 2px 6px rgba(43,92,230,0.35);
  }
  .st-send-btn:active:not(:disabled) { transform: translateY(1px); }
  .st-send-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    box-shadow: none;
  }
  .st-send-btn.sending {
    background: var(--st-text-muted);
    box-shadow: none;
  }

  /* ── Toast / status ── */
  .st-toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    margin: 0 20px 8px;
    flex-shrink: 0;
  }
  .st-toast.success {
    background: var(--st-success-bg);
    color: var(--st-success);
    border: 1px solid #A8D5B8;
  }
  .st-toast.error {
    background: var(--st-error-bg);
    color: var(--st-error);
    border: 1px solid #E8B4B0;
  }

  /* ── Degraded state ── */
  .st-degraded {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
    text-align: center;
    gap: 12px;
  }
  .st-degraded-icon {
    font-size: 28px;
    opacity: 0.6;
  }
  .st-degraded-title {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 16px;
    color: var(--st-text);
    margin: 0;
  }
  .st-degraded-body {
    font-size: 13px;
    color: var(--st-text-muted);
    max-width: 300px;
    line-height: 1.55;
  }
  .st-mark-done-btn {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--st-text-muted);
    background: transparent;
    border: 1.5px solid var(--st-border-strong);
    border-radius: 6px;
    padding: 7px 16px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .st-mark-done-btn:hover { border-color: var(--st-text-muted); color: var(--st-text); }

  /* ── Skeleton ── */
  .st-skeleton { flex: 1; padding: 16px 20px; display: flex; flex-direction: column; gap: 16px; }
  .st-skel-row { display: flex; gap: 12px; align-items: flex-start; }
  .st-skel-avatar { width: 32px; height: 32px; border-radius: 6px; background: var(--st-border); flex-shrink: 0; animation: st-pulse 1.4s ease-in-out infinite; }
  .st-skel-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
  .st-skel-line { height: 12px; border-radius: 4px; background: var(--st-border); animation: st-pulse 1.4s ease-in-out infinite; }

  @keyframes st-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

  /* ── Streaming indicator ── */
  .st-streaming-chip {
    position: sticky;
    top: 8px;
    right: 0;
    margin: 8px 12px 0 auto;
    width: fit-content;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(247,245,240,0.9);
    backdrop-filter: blur(4px);
    border: 1px solid var(--st-border);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--st-text-muted);
    pointer-events: none;
    z-index: 10;
  }
  .st-streaming-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--st-accent);
    animation: st-blink 1s ease-in-out infinite;
  }
  @keyframes st-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }

  /* ── Empty thread ── */
  .st-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    gap: 8px;
    color: var(--st-text-muted);
    font-size: 13px;
    text-align: center;
  }
  .st-empty-icon { font-size: 24px; opacity: 0.45; }
`;

// ── Sub-components ────────────────────────────────────────────────────────────

interface AvatarProps { userId: string; name: string; }
function Avatar({ userId, name }: AvatarProps) {
  const hue = avatarHue(userId);
  const style = {
    background: `hsl(${hue},55%,48%)`,
  };
  return (
    <div className="st-avatar" style={style} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

interface MessageRowProps {
  msg: ThreadMessage;
  memberMap: Map<string, ThreadMember>;
  isHighlighted: boolean;
}
function MessageRow({ msg, memberMap, isHighlighted }: MessageRowProps) {
  const name = displayName(msg.user_id, memberMap);
  return (
    <div className={`st-message${isHighlighted ? ' highlighted' : ''}`} data-msg-id={msg.id}>
      <Avatar userId={msg.user_id} name={name} />
      <div className="st-msg-body">
        <div className="st-msg-header">
          <span className="st-sender">{name}</span>
          <span className="st-timestamp">{formatTs(msg.ts)}</span>
        </div>
        <p className="st-msg-text">{msg.text}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MainComponent(props: MainComponentProps) {
  const { toolOutput, isStreaming, sendFollowUpMessage } = props;

  // Parse payload — safe on every input including null/undefined.
  const data = useMemo(() => parsePayload(toolOutput), [toolOutput]);

  // Build member lookup map.
  const memberMap = useMemo(() => buildMemberMap(data.thread_members), [data.thread_members]);

  // Highlighted message IDs as a Set for O(1) lookup.
  const highlightedSet = useMemo(
    () => new Set(data.highlighted_msg_ids),
    [data.highlighted_msg_ids]
  );

  // ── Reply draft state ────────────────────────────────────────────────────
  // Initialise draft from proposed_reply synchronously (useState lazy init).
  // This ensures the button is enabled on the first render when proposed_reply
  // is non-empty — no async useEffect delay.
  const [draft, setDraft] = useState<string>(() => data.proposed_reply);
  const [draftInitialised, setDraftInitialised] = useState<boolean>(
    () => !!data.proposed_reply
  );

  // When proposed_reply arrives after initial render (streaming case),
  // initialise once if still uninitialised.
  useEffect(() => {
    if (!draftInitialised && data.proposed_reply) {
      setDraft(data.proposed_reply);
      setDraftInitialised(true);
    }
  }, [data.proposed_reply, draftInitialised]);

  // Reset initialisation flag when thread_ts changes (new thread loaded).
  const prevThreadTs = useRef<string>(data.thread_ts);
  useEffect(() => {
    if (data.thread_ts && data.thread_ts !== prevThreadTs.current) {
      prevThreadTs.current = data.thread_ts;
      setDraftInitialised(false);
      setDraft('');
    }
  }, [data.thread_ts]);

  // Auto-resize textarea.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [draft]);

  // ── Send status ──────────────────────────────────────────────────────────
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle');

  // ── Send handler ─────────────────────────────────────────────────────────
  // Assembles the send-thread-reply intent per P9 §8.3 verbatim.
  const handleSend = useCallback(async () => {
    if (!draft.trim() || sendStatus !== 'idle' || isStreaming) return;

    const channelDisplay = data.channel_name ? `#${data.channel_name}` : data.channel_id || 'unknown channel';
    const intent =
      `User confirmed sending this Slack reply to thread ${data.thread_ts} in channel ${data.channel_id} (${channelDisplay}):\n` +
      `---\n` +
      `${draft.trim()}\n` +
      `---\n` +
      `After posting via mcp__slack__post_message succeeds, do ALL of the following silently:\n` +
      `1. Edit ~/agntux/actions/${data.action_id}.md — set status=done and completed_at=<ISO now> in frontmatter.\n` +
      `2. Append to body section "## Resolution log":\n` +
      `   - <ISO now> — Sent reply via slack. permalink: <permalink>\n` +
      `3. Do not emit any further tool calls or assistant text.`;

    setSendStatus('sending');
    try {
      await sendFollowUpMessage(intent);
      setSendStatus('sent');
    } catch {
      setSendStatus('error');
    }
  }, [draft, sendStatus, isStreaming, data, sendFollowUpMessage]);

  // ── Degraded state rendering ─────────────────────────────────────────────
  if (data.error) {
    const { icon, title, body } = degradedContent(data.error);
    return (
      <div className="st-root">
        <style>{CSS}</style>
        <DegradedView
          icon={icon}
          title={title}
          body={body}
          showMarkDone={data.error === 'not_found' && !!data.action_id}
          actionId={data.action_id}
          sendFollowUpMessage={sendFollowUpMessage}
        />
      </div>
    );
  }

  // ── Loading skeleton (pre-first-partial) ─────────────────────────────────
  const hasData = data.thread_messages.length > 0 || !!data.channel_name || !!data.thread_ts;
  if (!hasData) {
    return (
      <div className="st-root">
        <style>{CSS}</style>
        <LoadingSkeleton isStreaming={!!isStreaming} />
      </div>
    );
  }

  // ── Full render ──────────────────────────────────────────────────────────
  const msgCount = data.thread_messages.length;
  const channelDisplay = data.channel_name ? `#${data.channel_name}` : data.channel_id || '';
  const isSendDisabled =
    !!isStreaming ||
    !draft.trim() ||
    sendStatus === 'sending' ||
    sendStatus === 'sent';

  return (
    <div className="st-root">
      <style>{CSS}</style>

      {/* ── Header ── */}
      <header className="st-header">
        <div className="st-header-eyebrow">Slack Thread</div>
        <h1 className="st-header-title">
          {channelDisplay || 'Thread'}
        </h1>
        {msgCount > 0 && (
          <div className="st-header-meta">
            {msgCount} message{msgCount !== 1 ? 's' : ''}
            {data.highlighted_msg_ids.length > 0 && (
              <> &middot; {data.highlighted_msg_ids.length} highlighted</>
            )}
          </div>
        )}
      </header>

      {/* ── Streaming indicator ── */}
      {isStreaming && (
        <div role="status" aria-live="polite" className="st-streaming-chip" style={{ alignSelf: 'flex-end', margin: '8px 12px 0 auto' }}>
          <div className="st-streaming-dot" />
          Generating&hellip;
        </div>
      )}

      {/* ── Thread messages ── */}
      <div className="st-thread" role="log" aria-label="Slack thread messages">
        {data.thread_messages.length === 0 && !isStreaming && (
          <div className="st-empty">
            <div className="st-empty-icon">💬</div>
            <span>No messages in this thread</span>
          </div>
        )}
        {data.thread_messages.map((msg) => (
          <MessageRow
            key={msg.id || msg.ts}
            msg={msg}
            memberMap={memberMap}
            isHighlighted={highlightedSet.has(msg.id)}
          />
        ))}
      </div>

      {/* ── Toast notifications ── */}
      {sendStatus === 'sent' && (
        <div className="st-toast success" role="status" aria-live="polite">
          <span aria-hidden="true">✓</span> Reply sent
        </div>
      )}
      {sendStatus === 'error' && (
        <div className="st-toast error" role="alert">
          <span aria-hidden="true">!</span> Couldn&apos;t send — try again
        </div>
      )}

      {/* ── Reply area ── */}
      <div className="st-reply-area">
        <div className="st-divider" style={{ margin: '0 -20px 12px', padding: '0 20px' }}>
          <div className="st-divider-rule" />
          <span className="st-divider-label">Your reply</span>
          <div className="st-divider-rule" />
        </div>

        <fieldset disabled={!!isStreaming || sendStatus === 'sending' || sendStatus === 'sent'}
                  style={{ border: 'none', padding: 0, margin: 0 }}>
          <label htmlFor="st-draft" style={{ display: 'none' }}>Reply text</label>
          <textarea
            id="st-draft"
            ref={textareaRef}
            className="st-textarea"
            value={draft}
            onChange={(e) => {
              if (sendStatus === 'sent') return;
              setDraft(e.target.value);
            }}
            placeholder="Write your reply…"
            aria-label="Reply draft"
            aria-describedby={sendStatus === 'error' ? 'st-send-error' : undefined}
            rows={3}
          />
        </fieldset>

        <div className="st-reply-footer">
          <span className="st-char-count" aria-live="polite">
            {draft.length > 0 ? `${draft.length} char${draft.length !== 1 ? 's' : ''}` : ''}
          </span>
          <button
            className={`st-send-btn${sendStatus === 'sending' ? ' sending' : ''}`}
            onClick={handleSend}
            disabled={isSendDisabled}
            aria-label={sendStatus === 'sending' ? 'Sending reply…' : 'Send reply'}
            aria-busy={sendStatus === 'sending'}
            data-testid="send-button"
          >
            {sendStatus === 'sending' ? (
              <>
                <SpinnerIcon />
                Sending&hellip;
              </>
            ) : sendStatus === 'sent' ? (
              <>&#10003; Sent</>
            ) : (
              <>
                <SendIcon />
                Send
              </>
            )}
          </button>
        </div>
        {sendStatus === 'error' && (
          <p id="st-send-error" style={{ fontSize: 12, color: 'var(--st-error)', margin: '4px 0 0' }}>
            Send failed. Your draft is preserved — click Send to retry.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"
         style={{ animation: 'st-spin 0.7s linear infinite' }}>
      <style>{`@keyframes st-spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2a10 10 0 0 1 0 20" />
    </svg>
  );
}

interface DegradedViewProps {
  icon: string;
  title: string;
  body: string;
  showMarkDone: boolean;
  actionId: string;
  sendFollowUpMessage: (prompt: string) => Promise<void>;
}
function DegradedView({ icon, title, body, showMarkDone, actionId, sendFollowUpMessage }: DegradedViewProps) {
  const handleMarkDone = useCallback(async () => {
    await sendFollowUpMessage(
      `ux: Use the agntux-core plugin to mark action item ${actionId} done`
    );
  }, [actionId, sendFollowUpMessage]);

  return (
    <div className="st-degraded">
      <div className="st-degraded-icon" aria-hidden="true">{icon}</div>
      <h2 className="st-degraded-title">{title}</h2>
      <p className="st-degraded-body">{body}</p>
      {showMarkDone && (
        <button className="st-mark-done-btn" onClick={handleMarkDone}>
          Mark done
        </button>
      )}
    </div>
  );
}

function degradedContent(error: 'auth_failed' | 'not_found' | 'network'): { icon: string; title: string; body: string } {
  switch (error) {
    case 'not_found':
      return {
        icon: '🔍',
        title: 'Thread no longer available',
        body: 'That Slack thread could not be found. It may have been deleted or archived.',
      };
    case 'auth_failed':
      return {
        icon: '🔒',
        title: 'Slack connection issue',
        body: "Couldn't fetch Slack data — check your Slack MCP connection and try again.",
      };
    case 'network':
      return {
        icon: '📡',
        title: 'Connection problem',
        body: 'There was a network error fetching the Slack thread. Check your connection and retry.',
      };
  }
}

function LoadingSkeleton({ isStreaming }: { isStreaming: boolean }) {
  return (
    <>
      <header className="st-header">
        <div className="st-header-eyebrow">Slack Thread</div>
        <div style={{ height: 20, width: 160, borderRadius: 4, background: 'var(--st-border)', animation: 'st-pulse 1.4s ease-in-out infinite' }} />
      </header>
      {isStreaming && (
        <div className="st-streaming-chip" style={{ alignSelf: 'flex-end', margin: '8px 12px 0 auto' }}>
          <div className="st-streaming-dot" />
          Generating&hellip;
        </div>
      )}
      <div className="st-skeleton">
        {[0, 1, 2].map((i) => (
          <div key={i} className="st-skel-row">
            <div className="st-skel-avatar" style={{ animationDelay: `${i * 0.15}s` }} />
            <div className="st-skel-lines">
              <div className="st-skel-line" style={{ width: `${55 + i * 15}%`, animationDelay: `${i * 0.15}s` }} />
              <div className="st-skel-line" style={{ width: `${75 + i * 7}%`, animationDelay: `${i * 0.2}s` }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
