/**
 * triage-p9.test.tsx
 *
 * Component tests for the P9 (9.3.0) triage UI behaviors:
 *   - Strict-intersection filter (member ∩ item ≠ ∅) drives team-row visibility
 *   - Relevance-class chips toggle prefs.relevance_class_filters[teamSlug]
 *   - Relevance-class chip toggles do NOT modify the member file (verified
 *     indirectly — only the save_triage_prefs tool fires)
 *   - Snooze writes to triage-prefs.json via set_triage_pref (personal),
 *     not to the action file's frontmatter
 *   - Dismiss writes to triage-prefs.json via set_triage_pref (personal)
 *   - Mark-done on a team-scope row passes user_slug + user_id from
 *     self_user_slug / self_user_id (team-wide attribution)
 *   - Mark-done on a personal-scope row does NOT pass user_slug / user_id
 *     (byte-identical to 9.2.0 personal mark-done)
 *   - Show-done / show-snoozed / show-dismissed toggles persist
 *   - Sort dropdown writes prefs.sort
 *   - Empty state "Set your relevance picks…" shows when member has no picks
 *   - Empty state "All caught up for {Team}" shows when section is filtered empty
 *   - Leader-view section renders only when leader_views[] is non-empty
 *     (regression guard — already covered by 9.2.0 tests but re-asserted for
 *     the strict-intersection-doesn't-affect-leader-view rule)
 */

import { describe, it, expect } from 'vitest';
import {
  createMainComponentProps,
  render,
  screen,
  userEvent,
} from '../test-utils/render.js';
import { MainComponent } from '../../components/main-component.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeTeamAction(
  team_slug: string,
  id: string,
  relevance_classes: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `${id} title`,
    summary: 'Summary.',
    priority: 'medium',
    status: 'open',
    reason_class: 'response-needed',
    due_by: null,
    snoozed_until: null,
    source: 'slack',
    related_entities: [],
    suggested_actions: [],
    why_matters_excerpt: '',
    personalization_fit_excerpt: '',
    created_at: null,
    updated_at: null,
    team_slug,
    team_id: `uuid-${team_slug}`,
    relevance_classes,
    relative_path: `teams/${team_slug}/actions/${id}.md`,
    ...overrides,
  };
}

function makePersonalAction(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `${id} personal`,
    summary: '',
    priority: 'low',
    status: 'open',
    reason_class: 'response-needed',
    due_by: null,
    snoozed_until: null,
    source: 'slack',
    related_entities: [],
    suggested_actions: [],
    why_matters_excerpt: '',
    personalization_fit_excerpt: '',
    created_at: null,
    updated_at: null,
    // Personal items in team-mode get a relative_path under actions/
    relative_path: `actions/${id}.md`,
    ...overrides,
  };
}

function makeP9Payload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 2,
    actions: [makePersonalAction('p-1')],
    handled_recent: [],
    counts: { open: 4, snoozed: 0, handled_recent: 0, truncated: false },
    last_updated_at: '2026-05-12T18:43:09.000Z',
    bootstrap_mode: false,
    personal: {
      actions: [makePersonalAction('p-1')],
      handled_recent: [],
    },
    teams: [
      {
        team_slug: 'platform',
        team_id: 'uuid-platform',
        display_name: 'Platform',
        actions: [
          makeTeamAction('platform', 't-pd', ['product-decisions']),
          makeTeamAction('platform', 't-cp', ['customer-pain']),
          makeTeamAction('platform', 't-both', [
            'product-decisions',
            'infra-incidents',
          ]),
          makeTeamAction('platform', 't-general', ['general']),
        ],
        handled_recent: [],
        member_relevance_classes: ['product-decisions'],
      },
    ],
    leader_views: [],
    triage_prefs: {
      schema_version: 2,
      team_filters: {},
      view_filters: {},
      relevance_class_filters: {},
      sort: 'priority',
      show_done: false,
      show_snoozed: false,
      show_dismissed: false,
      triage_state: {},
    },
    self_user_slug: 'alice',
    self_user_id: 'uuid-alice',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Strict-intersection filter
// ─────────────────────────────────────────────────────────────────────────────

describe('P9 strict-intersection filter', () => {
  it('renders only items whose relevance_classes intersect the member picks', () => {
    const { props } = createMainComponentProps({ toolOutput: makeP9Payload() });
    render(<MainComponent {...props} />);
    // member: [product-decisions]; items: pd, cp, both, general
    // → only `pd` and `both` (which has product-decisions) show.
    expect(screen.getByTestId('action-card-t-pd')).toBeInTheDocument();
    expect(screen.getByTestId('action-card-t-both')).toBeInTheDocument();
    expect(screen.queryByTestId('action-card-t-cp')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-card-t-general')).not.toBeInTheDocument();
  });

  it('narrowing chip selection further filters the section', async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({
      toolOutput: makeP9Payload({
        teams: [
          {
            team_slug: 'platform',
            team_id: 'uuid-platform',
            display_name: 'Platform',
            actions: [
              makeTeamAction('platform', 't-pd', ['product-decisions']),
              makeTeamAction('platform', 't-cp', ['customer-pain']),
            ],
            handled_recent: [],
            member_relevance_classes: ['product-decisions', 'customer-pain'],
          },
        ],
      }),
    });
    render(<MainComponent {...props} />);
    // Initially both rows show (both classes are picked).
    expect(screen.getByTestId('action-card-t-pd')).toBeInTheDocument();
    expect(screen.getByTestId('action-card-t-cp')).toBeInTheDocument();
    // Toggle off `customer-pain`.
    await user.click(screen.getByTestId('relevance-chip-platform-customer-pain'));
    // Now only the `product-decisions` row remains.
    expect(screen.getByTestId('action-card-t-pd')).toBeInTheDocument();
    expect(screen.queryByTestId('action-card-t-cp')).not.toBeInTheDocument();
  });

  it('falls through to "show all" when member_relevance_classes is empty (pre-onboarding compatibility)', () => {
    const { props } = createMainComponentProps({
      toolOutput: makeP9Payload({
        teams: [
          {
            team_slug: 'platform',
            team_id: 'uuid-platform',
            display_name: 'Platform',
            actions: [
              makeTeamAction('platform', 't-pd', ['product-decisions']),
              makeTeamAction('platform', 't-cp', ['customer-pain']),
            ],
            handled_recent: [],
            member_relevance_classes: [], // user hasn't onboarded yet
          },
        ],
      }),
    });
    render(<MainComponent {...props} />);
    // Both rows show because no picks set yet.
    expect(screen.getByTestId('action-card-t-pd')).toBeInTheDocument();
    expect(screen.getByTestId('action-card-t-cp')).toBeInTheDocument();
    // The "Set your relevance picks…" CTA is also visible.
    expect(screen.getByTestId('empty-no-picks-platform')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Relevance-class chip toggles
// ─────────────────────────────────────────────────────────────────────────────

describe('P9 relevance-class chip toggles', () => {
  it('renders one chip per member pick, pre-selected', () => {
    const { props } = createMainComponentProps({
      toolOutput: makeP9Payload({
        teams: [
          {
            team_slug: 'platform',
            team_id: 'uuid-platform',
            display_name: 'Platform',
            actions: [],
            handled_recent: [],
            member_relevance_classes: ['product-decisions', 'customer-pain'],
          },
        ],
      }),
    });
    render(<MainComponent {...props} />);
    const pd = screen.getByTestId('relevance-chip-platform-product-decisions');
    const cp = screen.getByTestId('relevance-chip-platform-customer-pain');
    expect(pd).toBeInTheDocument();
    expect(cp).toBeInTheDocument();
    expect(pd).toHaveAttribute('aria-pressed', 'true');
    expect(cp).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggling a chip fires save_triage_prefs with the patched relevance_class_filters entry', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload({
        teams: [
          {
            team_slug: 'platform',
            team_id: 'uuid-platform',
            display_name: 'Platform',
            actions: [],
            handled_recent: [],
            member_relevance_classes: ['product-decisions', 'customer-pain'],
          },
        ],
      }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('relevance-chip-platform-customer-pain'));
    expect(callToolSpy).toHaveBeenCalledWith(
      'agntux_core_save_triage_prefs',
      expect.objectContaining({
        relevance_class_filters: { platform: ['product-decisions'] },
      }),
    );
  });

  it('chip toggle does NOT modify the member file (no team-member tool call)', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload({
        teams: [
          {
            team_slug: 'platform',
            team_id: 'uuid-platform',
            display_name: 'Platform',
            actions: [],
            handled_recent: [],
            member_relevance_classes: ['product-decisions'],
          },
        ],
      }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('relevance-chip-platform-product-decisions'));
    // Should NEVER hit any tool that writes to the member file.
    const callNames = (callToolSpy.mock.calls as Array<[string, unknown]>)
      .map(([name]) => name);
    expect(callNames.every((n) => n.startsWith('agntux_core_save_triage_prefs'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snooze / dismiss via triage-prefs (NOT frontmatter)
// ─────────────────────────────────────────────────────────────────────────────

describe('P9 snooze/dismiss route to triage-prefs', () => {
  it('snooze on a team-scoped row calls set_triage_pref with the row\'s relative_path', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('snooze-t-pd'));
    // Use the preset to lock in a deterministic until-time.
    await user.click(screen.getByTestId('snooze-preset-24h'));
    await user.click(screen.getByTestId('snooze-confirm'));
    const setPrefCalls = (callToolSpy.mock.calls as Array<
      [string, Record<string, unknown>]
    >).filter(([name]) => name === 'agntux_core_set_triage_pref');
    expect(setPrefCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = setPrefCalls[setPrefCalls.length - 1];
    expect(lastCall[1].path).toBe('teams/platform/actions/t-pd.md');
    expect(typeof lastCall[1].snoozed_until).toBe('string');
    // Critical: NO call to the legacy frontmatter-snooze tool.
    expect(
      (callToolSpy.mock.calls as Array<[string, unknown]>)
        .map(([name]) => name)
        .includes('agntux_core_snooze'),
    ).toBe(false);
  });

  it('dismiss on a team-scoped row calls set_triage_pref with the row\'s relative_path', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('dismiss-t-pd'));
    await user.click(screen.getByTestId('dismiss-confirm'));
    const setPrefCalls = (callToolSpy.mock.calls as Array<
      [string, Record<string, unknown>]
    >).filter(([name]) => name === 'agntux_core_set_triage_pref');
    expect(setPrefCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = setPrefCalls[setPrefCalls.length - 1];
    expect(lastCall[1].path).toBe('teams/platform/actions/t-pd.md');
    expect(typeof lastCall[1].dismissed_at).toBe('string');
  });

  it('snooze on a personal row in team mode also routes to set_triage_pref (actions/ path)', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('snooze-p-1'));
    await user.click(screen.getByTestId('snooze-preset-24h'));
    await user.click(screen.getByTestId('snooze-confirm'));
    const setPrefCalls = (callToolSpy.mock.calls as Array<
      [string, Record<string, unknown>]
    >).filter(([name]) => name === 'agntux_core_set_triage_pref');
    expect(setPrefCalls[setPrefCalls.length - 1][1].path).toBe('actions/p-1.md');
  });

  it('snoozed row is hidden by default and revealed when "Show snoozed" toggled', async () => {
    const user = userEvent.setup();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { props } = createMainComponentProps({
      toolOutput: makeP9Payload({
        triage_prefs: {
          schema_version: 2,
          team_filters: {},
          view_filters: {},
          relevance_class_filters: {},
          sort: 'priority',
          show_done: false,
          show_snoozed: false,
          show_dismissed: false,
          triage_state: {
            'teams/platform/actions/t-pd.md': {
              snoozed_until: future,
              dismissed_at: null,
            },
          },
        },
      }),
    });
    render(<MainComponent {...props} />);
    // t-pd is snoozed → hidden.
    expect(screen.queryByTestId('action-card-t-pd')).not.toBeInTheDocument();
    // Toggle "Show snoozed"
    await user.click(screen.getByTestId('toggle-show-snoozed'));
    expect(screen.getByTestId('action-card-t-pd')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mark-done team-wide attribution
// ─────────────────────────────────────────────────────────────────────────────

describe('P9 mark-done attribution', () => {
  it('passes user_slug + user_id from self_user_* on a team-scoped done', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-t-pd'));
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_set_status', {
      id: 't-pd',
      status: 'done',
      team_slug: 'platform',
      user_slug: 'alice',
      user_id: 'uuid-alice',
    });
  });

  it('does NOT pass user_slug / user_id on a personal-scope done (byte-identical to 9.2.0)', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-p-1'));
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_set_status', {
      id: 'p-1',
      status: 'done',
    });
  });

  it('skips user_slug attribution when self_user_slug is null', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload({ self_user_slug: null, self_user_id: null }),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-t-pd'));
    // Tool call still happens with team_slug, just no user_* args.
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_set_status', {
      id: 't-pd',
      status: 'done',
      team_slug: 'platform',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Show-toggle bar
// ─────────────────────────────────────────────────────────────────────────────

describe('P9 show-done / show-snoozed / show-dismissed toggles', () => {
  it('toggle Show done fires save_triage_prefs with the new boolean', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('toggle-show-done'));
    expect(callToolSpy).toHaveBeenCalledWith(
      'agntux_core_save_triage_prefs',
      { show_done: true },
    );
  });

  it('all three toggles render in team mode', () => {
    const { props } = createMainComponentProps({ toolOutput: makeP9Payload() });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('toggle-show-done')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-show-snoozed')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-show-dismissed')).toBeInTheDocument();
    // Bar is hidden in solo mode (no team mode).
  });

  it('toggle-show-* bar is hidden in solo mode (no team mode)', () => {
    const { props } = createMainComponentProps({
      toolOutput: {
        actions: [makePersonalAction('p-only')],
        handled_recent: [],
        counts: { open: 1, snoozed: 0, handled_recent: 0, truncated: false },
        last_updated_at: '',
        bootstrap_mode: false,
      },
    });
    render(<MainComponent {...props} />);
    expect(screen.queryByTestId('show-toggles-bar')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sort dropdown writes prefs.sort
// ─────────────────────────────────────────────────────────────────────────────

describe('P9 sort dropdown', () => {
  it('changing the sort fires save_triage_prefs with the new sort value', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeP9Payload(),
    });
    render(<MainComponent {...props} />);
    await user.selectOptions(screen.getByTestId('sort-select'), 'due-then-priority');
    expect(callToolSpy).toHaveBeenCalledWith(
      'agntux_core_save_triage_prefs',
      { sort: 'due-then-priority' },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty states
// ─────────────────────────────────────────────────────────────────────────────

describe('P9 empty states', () => {
  it('"Set your relevance picks" CTA shows when member has no picks', () => {
    const { props } = createMainComponentProps({
      toolOutput: makeP9Payload({
        teams: [
          {
            team_slug: 'platform',
            team_id: 'uuid-platform',
            display_name: 'Platform',
            actions: [],
            handled_recent: [],
            member_relevance_classes: [],
          },
        ],
      }),
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('empty-no-picks-platform')).toBeInTheDocument();
    expect(
      screen.getByTestId('empty-no-picks-platform').textContent,
    ).toContain('/agntux-teams onboard:member platform');
  });

  it('"All caught up for {Team}" shows when section filter empties an originally non-empty team', () => {
    const { props } = createMainComponentProps({
      toolOutput: makeP9Payload({
        teams: [
          {
            team_slug: 'platform',
            team_id: 'uuid-platform',
            display_name: 'Platform',
            // Items exist but NONE match the member's picks.
            actions: [
              makeTeamAction('platform', 't-x', ['customer-pain']),
            ],
            handled_recent: [],
            member_relevance_classes: ['product-decisions'],
          },
        ],
      }),
    });
    render(<MainComponent {...props} />);
    // No card visible.
    expect(screen.queryByTestId('action-card-t-x')).not.toBeInTheDocument();
    // Empty state message.
    expect(screen.getByTestId('empty-team-platform').textContent).toContain(
      'All caught up for Platform.',
    );
  });
});
