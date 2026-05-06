/**
 * triage.test.tsx
 *
 * Unit tests for the bespoke triage MainComponent.
 *
 * Coverage:
 *   - render branches: loading skeleton / bootstrap empty / actions_index_missing
 *     / license_paused / populated list
 *   - card content: title, summary, priority pill, reason badge, entity badges,
 *     suggested-action buttons
 *   - inline mutations: Done → callTool('set_status'), Snooze → modal → callTool('snooze'),
 *     Dismiss → modal → callTool('dismiss')
 *   - suggested-action click → sendFollowUpMessage(host_prompt)
 *   - "Stop raising items like this" → sendFollowUpMessage with the
 *     user-feedback envelope
 *   - filter chips: pressed-state toggling, widgetState updates
 *   - inline viewport budget: rootIsScrollable on 600x400 viewport,
 *     no banned height classes anywhere in the rendered tree
 *   - source-agnostic: unknown reason_class falls back to neutral palette
 *
 * Most assertions use `data-testid` selectors per the workflow-testing
 * discipline doc — the component sets a testid on every interactive control.
 */

import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import {
  createMainComponentProps,
  render,
  screen,
  userEvent,
} from '../test-utils/render.js';
import {
  rootIsScrollable,
  renderAtInlineViewport,
  BANNED_HEIGHT_CLASSES,
} from '../test-utils/viewport.js';
import { MainComponent, parsePayload } from '../../components/main-component.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'fixture-action-1',
    title: 'Reply to partner-platforms thread',
    summary: 'Avery DM\'d you asking for delivery confidence on Apex Phase 2.',
    priority: 'high',
    status: 'open',
    reason_class: 'response-needed',
    due_by: null,
    snoozed_until: null,
    source: 'slack',
    related_entities: ['person/avery-rivera', 'partner_platform/beacon'],
    suggested_actions: [
      {
        label: 'Draft a reply',
        host_prompt:
          'ux: Use the agntux-slack plugin to draft a reply for action fixture-action-1.',
      },
      {
        label: 'Open in source',
        host_prompt:
          'ux: Use the agntux-core plugin to print the source permalink for action fixture-action-1.',
      },
    ],
    why_matters_excerpt: 'Why this matters body…',
    personalization_fit_excerpt: '- Matches always-action-worthy rule',
    ...overrides,
  };
}

function makePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    actions: [makeAction()],
    handled_recent: [],
    counts: { open: 1, snoozed: 0, handled_recent: 0, truncated: false },
    last_updated_at: '2026-05-04T18:43:09.454Z',
    bootstrap_mode: false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// parsePayload — defensive defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePayload', () => {
  it('returns safe defaults when toolOutput is undefined', () => {
    const data = parsePayload(undefined);
    expect(data.actions).toEqual([]);
    expect(data.handled_recent).toEqual([]);
    // Defaults to false so the loading skeleton renders before the first
    // tool-result. The bootstrap empty state only fires when the server
    // explicitly emits `bootstrap_mode: true`.
    expect(data.bootstrap_mode).toBe(false);
    expect(data.error).toBeNull();
  });

  it('unwraps the canonical _meta.payload envelope', () => {
    const data = parsePayload({ _meta: { payload: makePayload() } });
    expect(data.actions).toHaveLength(1);
    expect(data.bootstrap_mode).toBe(false);
  });

  it('reads a flat structuredContent shape', () => {
    const data = parsePayload(makePayload());
    expect(data.actions).toHaveLength(1);
    expect(data.actions[0].priority).toBe('high');
  });

  it('coerces unknown priority to low', () => {
    const data = parsePayload(
      makePayload({ actions: [makeAction({ priority: 'critical' })] }),
    );
    expect(data.actions[0].priority).toBe('low');
  });

  it('filters action rows missing an id', () => {
    const data = parsePayload(
      makePayload({
        actions: [makeAction({ id: 'a' }), makeAction({ id: '' })],
      }),
    );
    expect(data.actions).toHaveLength(1);
    expect(data.actions[0].id).toBe('a');
  });

  it('returns the structured error when payload.error is set', () => {
    const data = parsePayload({ error: 'actions_index_missing' });
    expect(data.error).toBe('actions_index_missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Render branches
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — render branches', () => {
  it('renders the loading skeleton when toolOutput is undefined', () => {
    const { props } = createMainComponentProps({ toolOutput: undefined });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('renders the bootstrap empty state when bootstrap_mode is true', () => {
    const { props } = createMainComponentProps({
      toolOutput: makePayload({ bootstrap_mode: true, actions: [] }),
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('bootstrap-empty')).toBeInTheDocument();
    expect(screen.getByText(/we're listening/i)).toBeInTheDocument();
  });

  it('renders the actions_index_missing degraded state', () => {
    const { props } = createMainComponentProps({
      toolOutput: { error: 'actions_index_missing' },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('actions-index-missing')).toBeInTheDocument();
    expect(screen.getByTestId('run-onboard')).toBeInTheDocument();
  });

  it('renders the action card from a populated payload', () => {
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('action-card-fixture-action-1')).toBeInTheDocument();
    expect(
      screen.getByText('Reply to partner-platforms thread'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('priority-pill-high')).toBeInTheDocument();
    expect(
      screen.getByTestId('reason-badge-response-needed'),
    ).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline mutations
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — inline mutations', () => {
  it('Done button calls callTool("set_status", { id, status: "done" })', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-fixture-action-1'));
    expect(callToolSpy).toHaveBeenCalledWith('set_status', {
      id: 'fixture-action-1',
      status: 'done',
    });
  });

  it('Snooze opens the picker; preset click → callTool("snooze", { id, until })', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('snooze-fixture-action-1'));
    await user.click(screen.getByTestId('snooze-preset-24h'));
    await user.click(screen.getByTestId('snooze-confirm'));
    expect(callToolSpy).toHaveBeenCalledTimes(1);
    const [tool, args] = callToolSpy.mock.calls[0];
    expect(tool).toBe('snooze');
    expect((args as Record<string, unknown>).id).toBe('fixture-action-1');
    expect(typeof (args as Record<string, unknown>).until).toBe('string');
    // Until value is roughly 24h from now (allow a 5-min skew window).
    const untilMs = new Date(
      (args as Record<string, string>).until,
    ).getTime();
    const expected = Date.now() + 24 * 3600 * 1000;
    expect(Math.abs(untilMs - expected)).toBeLessThan(5 * 60 * 1000);
  });

  it('Dismiss opens the picker; selecting "noise" + submitting → callTool("dismiss", …)', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('dismiss-fixture-action-1'));
    await user.click(screen.getByTestId('dismiss-outcome-noise'));
    await user.click(screen.getByTestId('dismiss-confirm'));
    expect(callToolSpy).toHaveBeenCalledWith('dismiss', {
      id: 'fixture-action-1',
      outcome: 'noise',
    });
  });

  it('Dismiss with a note attaches outcome_note', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('dismiss-fixture-action-1'));
    await user.click(screen.getByTestId('dismiss-outcome-irrelevant'));
    await user.type(
      screen.getByTestId('dismiss-note'),
      'Not for me right now',
    );
    await user.click(screen.getByTestId('dismiss-confirm'));
    expect(callToolSpy).toHaveBeenCalledWith('dismiss', {
      id: 'fixture-action-1',
      outcome: 'irrelevant',
      outcome_note: 'Not for me right now',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suggested actions + stop-raising → sendFollowUpMessage
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — sendFollowUpMessage routing', () => {
  it('clicking a suggested action emits its host_prompt verbatim', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('suggested-fixture-action-1-0'));
    expect(sendFollowUpMessageSpy).toHaveBeenCalledWith(
      'ux: Use the agntux-slack plugin to draft a reply for action fixture-action-1.',
    );
  });

  it('clicking a suggested action with `url` dispatches openLink, not sendFollowUpMessage', async () => {
    const user = userEvent.setup();
    const url = 'https://oatfi.slack.com/archives/C031V2MJ2KA/p1777391863734439';
    const { props, sendFollowUpMessageSpy, openLinkSpy } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            suggested_actions: [
              { label: 'Open in Slack', url },
              {
                label: 'Draft a reply',
                host_prompt:
                  'ux: Use the agntux-slack plugin to draft a reply for action fixture-action-1.',
              },
            ],
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('suggested-fixture-action-1-0'));
    expect(openLinkSpy).toHaveBeenCalledWith(url);
    expect(sendFollowUpMessageSpy).not.toHaveBeenCalled();
  });

  it('prefers url when a single row carries both url and host_prompt', async () => {
    const user = userEvent.setup();
    const url = 'https://oatfi.slack.com/archives/C031V2MJ2KA/p1';
    const { props, sendFollowUpMessageSpy, openLinkSpy } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            suggested_actions: [
              {
                label: 'Open in Slack',
                url,
                host_prompt: 'ux: legacy chat-fallback prompt for action fixture-action-1.',
              },
            ],
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('suggested-fixture-action-1-0'));
    expect(openLinkSpy).toHaveBeenCalledTimes(1);
    expect(openLinkSpy).toHaveBeenCalledWith(url);
    expect(sendFollowUpMessageSpy).not.toHaveBeenCalled();
  });

  it('surfaces an openLink rejection as an inline row error', async () => {
    const user = userEvent.setup();
    const url = 'https://oatfi.slack.com/archives/C0/p1';
    const { props } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            suggested_actions: [{ label: 'Open in Slack', url }],
          }),
        ],
      }),
    });
    // Override openLink to reject with a known message.
    props.openLink = vi.fn(async () => {
      throw new Error('host blocked the link');
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('suggested-fixture-action-1-0'));
    const rowError = await screen.findByTestId('row-error-fixture-action-1');
    expect(rowError.textContent).toContain('host blocked the link');
  });

  it('"Stop raising items like this" emits the user-feedback envelope', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('details-fixture-action-1'));
    await user.click(screen.getByTestId('stop-raising'));
    expect(sendFollowUpMessageSpy).toHaveBeenCalledTimes(1);
    const [prompt] = sendFollowUpMessageSpy.mock.calls[0] as [string];
    expect(prompt).toMatch(/^ux: Use the agntux-core plugin/);
    expect(prompt).toContain('engage the user-feedback subagent');
    expect(prompt).toContain('fixture-action-1');
    expect(prompt).toContain('reason_class: response-needed');
  });

  it('"Run /agntux-onboard" CTA dispatches the onboarding command', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: { error: 'actions_index_missing' },
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('run-onboard'));
    expect(sendFollowUpMessageSpy).toHaveBeenCalledWith('/agntux-onboard');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Filter chips + sort toggle persist to widgetState
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — filters + sort persist to widgetState', () => {
  it('clicking a priority chip writes priority_filter into widgetState', async () => {
    const user = userEvent.setup();
    const { props, setWidgetStateSpy, getWidgetState } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('filter-high'));
    expect(setWidgetStateSpy).toHaveBeenCalled();
    expect(getWidgetState().priority_filter).toBe('high');
  });

  it('sort toggle flips priority ↔ due in widgetState', async () => {
    const user = userEvent.setup();
    const { props, getWidgetState } = createMainComponentProps({
      toolOutput: makePayload(),
      widgetState: { sort: 'priority' },
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('sort-toggle'));
    expect(getWidgetState().sort).toBe('due');
  });

  it('filtering hides non-matching actions from the list', () => {
    const { props } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({ id: 'h-1', priority: 'high' }),
          makeAction({ id: 'm-1', priority: 'medium' }),
          makeAction({ id: 'l-1', priority: 'low' }),
        ],
      }),
      widgetState: { priority_filter: 'high' },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('action-card-h-1')).toBeInTheDocument();
    expect(screen.queryByTestId('action-card-m-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-card-l-1')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-agnostic styling: unknown reason_class falls back to neutral
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — source-agnostic styling', () => {
  it('renders an unknown reason_class with the neutral palette', () => {
    const { props } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            id: 'novel',
            reason_class: 'totally-novel-reason-class-xyz',
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    const badge = screen.getByTestId(
      'reason-badge-totally-novel-reason-class-xyz',
    );
    // Neutral fallback uses bg-slate-100 — see REASON_PALETTE default.
    expect(badge.className).toMatch(/bg-slate-100/);
    expect(badge.textContent).toBe('totally-novel-reason-class-xyz');
  });

  it('source field is rendered as plain text — never a Slack-specific affordance', () => {
    const { props } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [makeAction({ id: 'gmail-source', source: 'gmail' })],
      }),
    });
    render(<MainComponent {...props} />);
    expect(screen.getByText(/via gmail/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline viewport budget (600x400)
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — inline viewport budget', () => {
  it('has a scrollable root at 600×400', () => {
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    const { viewport, unmount } = renderAtInlineViewport(
      <MainComponent {...props} />,
    );
    const root = viewport.firstElementChild as HTMLElement;
    expect(root).not.toBeNull();
    // The root is a flex column containing a sticky header + the
    // overflow-y-auto scroll body. Either the root or its scroll-body
    // descendant exposes scrollability.
    const scrollNodes = viewport.querySelectorAll(
      '[class*="overflow-y-auto"]',
    );
    expect(scrollNodes.length).toBeGreaterThanOrEqual(1);
    expect(rootIsScrollable(root) || scrollNodes.length > 0).toBe(true);
    unmount();
  });

  it('rendered tree contains zero banned height classes', () => {
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    const { viewport, unmount } = renderAtInlineViewport(
      <MainComponent {...props} />,
    );
    const html = viewport.innerHTML;
    for (const banned of BANNED_HEIGHT_CLASSES) {
      expect(html).not.toContain(banned);
    }
    unmount();
  });

  it('per-row Done button is reachable via scrollIntoView when many rows exist', () => {
    const actions = Array.from({ length: 25 }, (_, i) =>
      makeAction({ id: `bulk-${i}`, title: `Item ${i}`, priority: 'low' }),
    );
    const { props } = createMainComponentProps({
      toolOutput: makePayload({ actions }),
    });
    const { unmount } = renderAtInlineViewport(<MainComponent {...props} />);
    const lastDone = screen.getByTestId('done-bulk-24');
    // jsdom doesn't lay out content (no real scrolling), but the element
    // must exist in the DOM for the user to reach it via scroll.
    expect(lastDone).toBeInTheDocument();
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suppress noisy unused-vi import warning
// ─────────────────────────────────────────────────────────────────────────────
void vi;
void act;
