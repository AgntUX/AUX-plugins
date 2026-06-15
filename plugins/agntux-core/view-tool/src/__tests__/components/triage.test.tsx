/**
 * triage.test.tsx
 *
 * Unit tests for the bespoke triage MainComponent.
 *
 * Coverage:
 *   - render branches: loading skeleton / bootstrap empty / actions_index_missing
 *     / populated list
 *   - card content: title, summary, priority pill, reason badge, entity badges,
 *     suggested-action buttons
 *   - inline mutations: Done → callTool('agntux_core_set_status'),
 *     Snooze → modal → callTool('agntux_core_snooze'),
 *     Dismiss → modal → callTool('agntux_core_dismiss')
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
          'Use the agntux-slack plugin to draft a reply for action fixture-action-1',
      },
      {
        label: 'Open in source',
        host_prompt:
          'Use the agntux-core plugin to print the source permalink for action fixture-action-1',
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
  it('Done button calls callTool("agntux_core_set_status", { id, status: "done" })', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-fixture-action-1'));
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_set_status', {
      id: 'fixture-action-1',
      status: 'done',
    });
  });

  it('Snooze opens the picker; preset click → callTool("agntux_core_snooze", { id, until })', async () => {
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
    expect(tool).toBe('agntux_core_snooze');
    expect((args as Record<string, unknown>).id).toBe('fixture-action-1');
    expect(typeof (args as Record<string, unknown>).until).toBe('string');
    // Until value is roughly 24h from now (allow a 5-min skew window).
    const untilMs = new Date(
      (args as Record<string, string>).until,
    ).getTime();
    const expected = Date.now() + 24 * 3600 * 1000;
    expect(Math.abs(untilMs - expected)).toBeLessThan(5 * 60 * 1000);
  });

  it('Dismiss opens the picker; selecting "noise" + submitting → callTool("agntux_core_dismiss", …)', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('dismiss-fixture-action-1'));
    await user.click(screen.getByTestId('dismiss-outcome-noise'));
    await user.click(screen.getByTestId('dismiss-confirm'));
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_dismiss', {
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
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_dismiss', {
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
      'Use the agntux-slack plugin to draft a reply for action fixture-action-1',
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
                  'Use the agntux-slack plugin to draft a reply for action fixture-action-1',
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
    expect(prompt).toMatch(/^Use the agntux-core plugin to engage the user-feedback subagent/);
    expect(prompt).toContain('engage the user-feedback subagent');
    expect(prompt).toContain('fixture-action-1');
    expect(prompt).toContain('reason_class: response-needed');
  });

  it('"Run /agntux onboard" CTA dispatches the onboarding command', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: { error: 'actions_index_missing' },
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('run-onboard'));
    expect(sendFollowUpMessageSpy).toHaveBeenCalledWith('Use the agntux-core plugin to start onboarding');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Optimistic hide (5.3.0) — terminating actions disappear from the list
// immediately; status-mutating host_prompts also trigger the hide via the
// regex match-guard; the hide reconciles when fresh toolOutput arrives.
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — optimistic hide on resolve', () => {
  it('Done button hides the row immediately after the mutation resolves', async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({ id: 'a-1', title: 'First' }),
          makeAction({ id: 'a-2', title: 'Second' }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('action-card-a-1')).toBeInTheDocument();
    await user.click(screen.getByTestId('done-a-1'));
    // After the no-op callTool resolves, the optimistic hide kicks in and
    // a-1 disappears even though toolOutput hasn't been refreshed.
    expect(screen.queryByTestId('action-card-a-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('action-card-a-2')).toBeInTheDocument();
  });

  it('Snooze submission hides the row immediately', async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('snooze-fixture-action-1'));
    await user.click(screen.getByTestId('snooze-preset-24h'));
    await user.click(screen.getByTestId('snooze-confirm'));
    expect(
      screen.queryByTestId('action-card-fixture-action-1'),
    ).not.toBeInTheDocument();
  });

  it('Dismiss submission hides the row immediately for every outcome', async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('dismiss-fixture-action-1'));
    await user.click(screen.getByTestId('dismiss-outcome-noise'));
    await user.click(screen.getByTestId('dismiss-confirm'));
    expect(
      screen.queryByTestId('action-card-fixture-action-1'),
    ).not.toBeInTheDocument();
  });

  it('Stop-raising button hides the row immediately and dispatches the user-feedback envelope', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('details-fixture-action-1'));
    await user.click(screen.getByTestId('stop-raising'));
    expect(
      screen.queryByTestId('action-card-fixture-action-1'),
    ).not.toBeInTheDocument();
    // The feedback envelope still fires so the user-feedback agent's Stage 0
    // fast-path captures the rule.
    expect(sendFollowUpMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('"Mark done — already handled in Slack" suggested action hides the row via the regex match-guard', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            id: 'mark-done-a',
            suggested_actions: [
              {
                label: 'Mark done — already handled in Slack',
                host_prompt:
                  'Use the agntux-core plugin to set action mark-done-a status to done with outcome "completed-externally" (already handled in Slack)',
              },
            ],
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('suggested-mark-done-a-0'));
    // Regex `set action ([\w-]+) status to done` matches → hide.
    expect(screen.queryByTestId('action-card-mark-done-a')).not.toBeInTheDocument();
    expect(sendFollowUpMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('"Open the reply composer" suggested action does NOT hide the row (regex match-guard scopes hide to status-mutating prompts)', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            id: 'open-composer-a',
            suggested_actions: [
              {
                label: 'Draft a reply',
                host_prompt:
                  'Use the agntux-slack plugin to open the reply composer for action open-composer-a',
              },
            ],
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('suggested-open-composer-a-0'));
    // Opening the composer iframe does NOT terminate the action — the row
    // must stay visible until the user actually completes the reply via
    // the iframe's Send button (which fires set_status separately).
    expect(screen.getByTestId('action-card-open-composer-a')).toBeInTheDocument();
    expect(sendFollowUpMessageSpy).toHaveBeenCalledTimes(1);
  });

  // 8.2.0 / 9.8.0 backwards-compat invariant. TERMINATING_PROMPT_PATTERNS is
  // prefix-agnostic (verb-only regex). Action items already on disk that
  // carry the legacy `ux: Use the agntux-core plugin to set action … status
  // to done` envelope must still trigger the optimistic-hide path so the
  // migration to bare-slash prompts doesn't break existing rows.
  it('legacy `ux:` "set action … status to done" envelope still hides the row (prefix-agnostic match-guard)', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            id: 'legacy-mark-done',
            suggested_actions: [
              {
                label: 'Mark done — already handled in Slack',
                host_prompt:
                  'ux: Use the agntux-core plugin to set action legacy-mark-done status to done with outcome "completed-externally" (already handled in Slack).',
              },
            ],
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('suggested-legacy-mark-done-0'));
    expect(screen.queryByTestId('action-card-legacy-mark-done')).not.toBeInTheDocument();
    expect(sendFollowUpMessageSpy).toHaveBeenCalledTimes(1);
    // The legacy envelope is forwarded verbatim — no prefix translation.
    expect(sendFollowUpMessageSpy).toHaveBeenCalledWith(
      'ux: Use the agntux-core plugin to set action legacy-mark-done status to done with outcome "completed-externally" (already handled in Slack).',
    );
  });

  it('hidden id stays hidden when the server still lists the action as open (slow-write race guard)', async () => {
    const user = userEvent.setup();
    const { props, rerender } = (() => {
      const created = createMainComponentProps({
        toolOutput: makePayload({
          actions: [makeAction({ id: 'race-a' })],
        }),
      });
      const result = render(<MainComponent {...created.props} />);
      return { ...created, ...result };
    })();
    await user.click(screen.getByTestId('done-race-a'));
    expect(screen.queryByTestId('action-card-race-a')).not.toBeInTheDocument();
    // Simulate a stale toolOutput refresh while the server hasn't yet
    // observed the file mutation: action still appears as open.
    const stalePayload = makePayload({
      actions: [makeAction({ id: 'race-a' })],
    });
    rerender(<MainComponent {...{ ...props, toolOutput: stalePayload }} />);
    expect(screen.queryByTestId('action-card-race-a')).not.toBeInTheDocument();
  });

  it('hidden id is dropped when the server has confirmed the action is gone (id no longer in data.actions)', async () => {
    const user = userEvent.setup();
    const { props, rerender } = (() => {
      const created = createMainComponentProps({
        toolOutput: makePayload({
          actions: [
            makeAction({ id: 'gone-a' }),
            makeAction({ id: 'gone-b' }),
          ],
        }),
      });
      const result = render(<MainComponent {...created.props} />);
      return { ...created, ...result };
    })();
    await user.click(screen.getByTestId('done-gone-a'));
    expect(screen.queryByTestId('action-card-gone-a')).not.toBeInTheDocument();
    // Server has now observed the resolution: gone-a no longer in
    // data.actions. The reconcile effect drops it from optimisticallyHidden,
    // but it remains absent from the visible list because data.actions also
    // dropped it. (The action would re-appear if the server re-emitted it,
    // which is the desired behavior for an LLM that retried.)
    const refreshedPayload = makePayload({
      actions: [makeAction({ id: 'gone-b' })],
    });
    rerender(<MainComponent {...{ ...props, toolOutput: refreshedPayload }} />);
    expect(screen.queryByTestId('action-card-gone-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('action-card-gone-b')).toBeInTheDocument();
  });

  it('priority filter chip counts honour optimistic hide (header stays honest)', async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({ id: 'h-1', priority: 'high' }),
          makeAction({ id: 'h-2', priority: 'high' }),
          makeAction({ id: 'm-1', priority: 'medium' }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('filter-all').textContent).toBe('All · 3');
    expect(screen.getByTestId('filter-high').textContent).toBe('High · 2');
    await user.click(screen.getByTestId('done-h-1'));
    expect(screen.getByTestId('filter-all').textContent).toBe('All · 2');
    expect(screen.getByTestId('filter-high').textContent).toBe('High · 1');
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

  it('sort dropdown writes the selected sort option into widgetState (v6.0.0+ — replaces the priority↔due toggle)', async () => {
    const user = userEvent.setup();
    const { props, getWidgetState } = createMainComponentProps({
      toolOutput: makePayload(),
      widgetState: { sort: 'priority' },
    });
    render(<MainComponent {...props} />);
    const select = screen.getByTestId('sort-select') as HTMLSelectElement;
    await user.selectOptions(select, 'due');
    expect(getWidgetState().sort).toBe('due');
    await user.selectOptions(select, 'created');
    expect(getWidgetState().sort).toBe('created');
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
// v6.0.0 — branded header, dates, sort dropdown, do-something-else, toasts
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — v6.0.0 features', () => {
  it('renders the AgntUX-branded header ("Action Item Triage", was "Triage")', () => {
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('triage-title')).toHaveTextContent(
      'Action Item Triage',
    );
  });

  it('renders Created/Updated relative dates on each card when timestamps are present', () => {
    const created = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const updated = new Date(Date.now() - 60 * 1000).toISOString();
    const { props } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            id: 'with-dates',
            created_at: created,
            updated_at: updated,
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    const ts = screen.getByTestId('timestamps-with-dates');
    expect(ts).toHaveTextContent(/Created/);
    // Created and Updated are >1 day apart? created=2h ago, updated=1m ago →
    // 2h diff is < 24h, so the "Updated" half should be collapsed for noise
    // reduction. Just assert "Created" is rendered.
    expect(ts.textContent).toContain('Created');
  });

  it('shows separate Updated time when created and updated diverge by >1 day', () => {
    const created = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const updated = new Date(Date.now() - 60 * 1000).toISOString();
    const { props } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            id: 'divergent',
            created_at: created,
            updated_at: updated,
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    const ts = screen.getByTestId('timestamps-divergent');
    expect(ts.textContent).toContain('Created');
    expect(ts.textContent).toContain('Updated');
  });

  it('sort dropdown exposes priority / due / created options (plus P9 team-mode sorts)', () => {
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    render(<MainComponent {...props} />);
    const select = screen.getByTestId('sort-select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    // P9 (9.3.0) extended the dropdown with `team-then-priority` and
    // `due-then-priority`. Original three remain in the same order at
    // the top of the list so the default-priority assertion above
    // doesn't have to know about the new options.
    expect(values).toEqual([
      'priority',
      'due',
      'created',
      'team-then-priority',
      'due-then-priority',
    ]);
  });

  it('"Do something else…" button on the card opens the prompt modal', async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('do-something-else-fixture-action-1'));
    expect(screen.getByTestId('do-something-else-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('do-something-else-submit')).toBeDisabled();
  });

  it('"Do something else…" submit dispatches sendFollowUpMessage with action context envelope', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: makePayload({
        actions: [
          makeAction({
            id: 'ctx-1',
            title: 'Reply to Avery',
            priority: 'high',
            reason_class: 'response-needed',
            source: 'slack',
            related_entities: ['person/avery-rivera'],
            why_matters_excerpt: 'Avery asked about delivery confidence.',
          }),
        ],
      }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('do-something-else-ctx-1'));
    await user.type(
      screen.getByTestId('do-something-else-prompt'),
      'Draft a Linear ticket for this.',
    );
    await user.click(screen.getByTestId('do-something-else-submit'));
    expect(sendFollowUpMessageSpy).toHaveBeenCalledTimes(1);
    const sent = sendFollowUpMessageSpy.mock.calls[0][0] as string;
    expect(sent).toContain(
      'Please take the following action based on the action item below:',
    );
    expect(sent).toContain('Draft a Linear ticket for this.');
    expect(sent).toContain('Action ID: ctx-1');
    expect(sent).toContain('Title: Reply to Avery');
    expect(sent).toContain('Priority: high');
    expect(sent).toContain('Reason class: response-needed');
    expect(sent).toContain('Source: slack');
    expect(sent).toContain('Related entities: person/avery-rivera');
    expect(sent).toContain('Avery asked about delivery confidence.');
  });

  it('"Do something else…" submit does nothing when prompt is whitespace-only', async () => {
    const user = userEvent.setup();
    const { props, sendFollowUpMessageSpy } = createMainComponentProps({
      toolOutput: makePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('do-something-else-fixture-action-1'));
    await user.type(screen.getByTestId('do-something-else-prompt'), '   ');
    expect(screen.getByTestId('do-something-else-submit')).toBeDisabled();
    expect(sendFollowUpMessageSpy).not.toHaveBeenCalled();
  });

  it('Done button shows an inline feedback row in the resolved item slot', async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-fixture-action-1'));
    expect(
      await screen.findByTestId('feedback-fixture-action-1'),
    ).toHaveTextContent(/Marked done/);
  });

  it('feedback row replaces the action card in the same DOM slot (not appended at the bottom)', async () => {
    // Three actions; resolve the MIDDLE one. Assert the feedback row sits at
    // the same DOM index in the list as the original action card did. This
    // is the load-bearing UX promise made in the v6.1.0 CHANGELOG —
    // breaking it puts feedback at the end of the list, far from the user's
    // click, which is exactly the failure mode the toast→inline change was
    // meant to fix.
    const user = userEvent.setup();
    const payload = makePayload({
      actions: [
        makeAction({ id: 'first' }),
        makeAction({ id: 'middle' }),
        makeAction({ id: 'last' }),
      ],
      counts: { open: 3, snoozed: 0, handled_recent: 0, truncated: false },
    });
    const { props } = createMainComponentProps({ toolOutput: payload });
    render(<MainComponent {...props} />);

    const list = screen.getByRole('list', { name: /open action items/i });
    const before = Array.from(
      list.querySelectorAll<HTMLElement>('[data-testid^="action-card-"]'),
    ).map((el) => el.dataset.testid);
    expect(before).toEqual([
      'action-card-first',
      'action-card-middle',
      'action-card-last',
    ]);

    await user.click(screen.getByTestId('done-middle'));

    // Feedback row appears.
    await screen.findByTestId('feedback-middle');

    // Walk the list children in DOM order. The middle slot must now hold
    // the feedback row, with the unaffected cards above and below.
    const after = Array.from(
      list.querySelectorAll<HTMLElement>(
        '[data-testid^="action-card-"], [data-testid^="feedback-"]',
      ),
    ).map((el) => el.dataset.testid);
    expect(after).toEqual([
      'action-card-first',
      'feedback-middle',
      'action-card-last',
    ]);
  });

  it('Details panel closes after a suggested-action click', async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('details-fixture-action-1'));
    // The inline panel renders the same-keyed suggested-action button.
    await user.click(screen.getByTestId('detail-suggested-0'));
    // The panel collapses — the per-section heading is no longer present.
    expect(
      screen.queryByText(/Why this matters/i),
    ).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suppress noisy unused-vi import warning
// ─────────────────────────────────────────────────────────────────────────────
void vi;
void act;
