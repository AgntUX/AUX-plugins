/**
 * triage-team.test.tsx
 *
 * Team-mode rendering tests for the bespoke triage MainComponent
 * (P3 v2 §1 / 9.2.0). The single load-bearing invariant is that the
 * solo render path stays byte-identical to 9.0.0 when the payload
 * carries no team-mode keys; everything else here exercises the
 * three-section / filter-chip / row-decoration additions.
 *
 * Coverage:
 *   - parsePayload detects team mode when `personal`/`teams`/`leader_views`
 *     keys (or schema_version: 2) are present, and stays in solo mode
 *     when they're not.
 *   - Section headers render for "My items" plus each team / leader view
 *     when team mode is on; never when it's off (solo regression guard).
 *   - Team-name chip + relevance ribbon appear on team-scoped rows;
 *     absent on personal rows.
 *   - Mute chips toggle widgetState AND call agntux_core_save_triage_prefs
 *     with the projected next state.
 *   - Mutator routing: Done on a team-scoped row calls set_status with
 *     `team_slug`; Done on a leader-view row passes `view_slug`; Done
 *     on a personal row passes neither (byte-identical mutator call).
 */

import { describe, it, expect } from 'vitest';
import {
  createMainComponentProps,
  render,
  screen,
  userEvent,
} from '../test-utils/render.js';
import { MainComponent, parsePayload } from '../../components/main-component.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makePersonalAction(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'personal-1',
    title: 'A personal item',
    summary: 'Some personal summary.',
    priority: 'medium',
    status: 'open',
    reason_class: 'response-needed',
    due_by: null,
    snoozed_until: null,
    source: 'slack',
    related_entities: [],
    suggested_actions: [],
    why_matters_excerpt: 'because.',
    personalization_fit_excerpt: 'fits.',
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function makeTeamAction(
  team_slug: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `team-${team_slug}-1`,
    title: `A ${team_slug} team item`,
    summary: `Team summary for ${team_slug}.`,
    priority: 'high',
    status: 'open',
    reason_class: 'risk',
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
    member_relevance_class: 'incidents',
    ...overrides,
  };
}

function makeTeamModePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 2,
    actions: [makePersonalAction()],
    handled_recent: [],
    counts: { open: 2, snoozed: 0, handled_recent: 0, truncated: false },
    last_updated_at: '2026-05-12T18:43:09.000Z',
    bootstrap_mode: false,
    personal: {
      actions: [makePersonalAction()],
      handled_recent: [],
    },
    teams: [
      {
        team_slug: 'platform',
        team_id: 'uuid-platform',
        display_name: 'Platform Team',
        actions: [makeTeamAction('platform')],
        handled_recent: [],
      },
    ],
    leader_views: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// parsePayload
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePayload — team mode detection', () => {
  it('reports team_mode=false for a 9.0.0-shape payload', () => {
    const data = parsePayload({
      actions: [makePersonalAction()],
      handled_recent: [],
      counts: { open: 1, snoozed: 0, handled_recent: 0, truncated: false },
      last_updated_at: '',
      bootstrap_mode: false,
    });
    expect(data.team_mode).toBe(false);
    expect(data.teams).toEqual([]);
    expect(data.leader_views).toEqual([]);
    // Solo rows must NOT have scope_kind attached.
    expect(data.actions[0].scope_kind).toBeUndefined();
  });

  it('reports team_mode=true and surfaces personal / teams / leader_views when keys present', () => {
    const data = parsePayload(makeTeamModePayload());
    expect(data.team_mode).toBe(true);
    expect(data.teams).toHaveLength(1);
    expect(data.teams[0].team_slug).toBe('platform');
    expect(data.teams[0].display_name).toBe('Platform Team');
    expect(data.teams[0].actions[0].scope_kind).toBe('team');
    expect(data.teams[0].actions[0].scope_slug).toBe('platform');
    // Personal rows in team-mode payload get scope decoration too.
    expect(data.actions[0].scope_kind).toBe('personal');
  });

  it('reports team_mode=true when only leader_views is non-empty', () => {
    const data = parsePayload({
      actions: [],
      handled_recent: [],
      counts: { open: 0, snoozed: 0, handled_recent: 0, truncated: false },
      last_updated_at: '',
      bootstrap_mode: false,
      teams: [],
      leader_views: [
        {
          view_slug: 'all-eng',
          view_id: 'uuid-view',
          display_name: 'All Engineering',
          actions: [],
          handled_recent: [],
        },
      ],
    });
    expect(data.team_mode).toBe(true);
    expect(data.leader_views).toHaveLength(1);
  });

  it('extracts team_slug / team_id / member_relevance_class from row JSON', () => {
    const data = parsePayload(makeTeamModePayload());
    const row = data.teams[0].actions[0];
    expect(row.team_slug).toBe('platform');
    expect(row.team_id).toBe('uuid-platform');
    expect(row.member_relevance_class).toBe('incidents');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — team-mode sections', () => {
  it('renders no section headers in solo mode (byte-identical regression guard)', () => {
    const { props } = createMainComponentProps({
      toolOutput: {
        actions: [makePersonalAction()],
        handled_recent: [],
        counts: { open: 1, snoozed: 0, handled_recent: 0, truncated: false },
        last_updated_at: '',
        bootstrap_mode: false,
      },
    });
    render(<MainComponent {...props} />);
    // No "My items" / team / leader section headers must render in solo
    // mode. If a future change accidentally promotes the section layout
    // into solo, this catches it.
    expect(screen.queryByTestId('section-header-personal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('team-filter-bar')).not.toBeInTheDocument();
  });

  it('renders My items + team section headers in team mode', () => {
    const { props } = createMainComponentProps({
      toolOutput: makeTeamModePayload(),
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('section-header-personal')).toBeInTheDocument();
    expect(screen.getByTestId('section-header-team-platform')).toBeInTheDocument();
    // Display name is rendered in both the mute chip and the section
    // header. Assert on the section header specifically via its testid
    // so the test stays stable as more chrome lands on the chip bar.
    expect(screen.getByTestId('section-header-team-platform')).toHaveTextContent(
      'Platform Team',
    );
  });

  it('renders leader-view section headers when leader_views is non-empty', () => {
    const payload = makeTeamModePayload({
      leader_views: [
        {
          view_slug: 'all-eng',
          view_id: 'uuid-view',
          display_name: 'All Engineering',
          actions: [makePersonalAction({ id: 'lv-1' })],
          handled_recent: [],
        },
      ],
    });
    const { props } = createMainComponentProps({ toolOutput: payload });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('section-header-leader-all-eng')).toBeInTheDocument();
    // "All Engineering" appears twice — once in the mute chip header bar
    // and once in the section header. getAllByText covers both; we
    // assert the section header carries the label specifically via the
    // testid below.
    expect(screen.getAllByText('All Engineering').length).toBeGreaterThan(0);
    expect(screen.getByTestId('section-header-leader-all-eng')).toHaveTextContent(
      'All Engineering',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Row decoration
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — team row decoration', () => {
  it('renders team chip and relevance ribbon on a team-scoped row', () => {
    const { props } = createMainComponentProps({
      toolOutput: makeTeamModePayload(),
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId('team-chip-platform')).toBeInTheDocument();
    expect(
      screen.getByTestId('relevance-ribbon-team-platform-1'),
    ).toBeInTheDocument();
  });

  it('does NOT render team chip on a personal row', () => {
    const { props } = createMainComponentProps({
      toolOutput: makeTeamModePayload(),
    });
    render(<MainComponent {...props} />);
    // Personal row has no team_slug set, so no chip; check by absence of
    // the chip's testid (which uses the team_slug suffix).
    expect(screen.queryByTestId('team-chip-personal')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mute chips
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — team mute chips', () => {
  it('toggles widgetState and calls save_triage_prefs when a team chip is clicked', async () => {
    const user = userEvent.setup();
    const { props, setWidgetStateSpy, callToolSpy, getWidgetState } =
      createMainComponentProps({
        toolOutput: makeTeamModePayload(),
      });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('team-mute-platform'));

    // 1. widgetState is updated functionally (the setter receives a fn).
    expect(setWidgetStateSpy).toHaveBeenCalled();
    expect(getWidgetState().muted_team_slugs).toEqual(['platform']);

    // 2. save_triage_prefs is invoked with the next muted list.
    expect(callToolSpy).toHaveBeenCalledWith(
      'agntux_core_save_triage_prefs',
      expect.objectContaining({
        muted_team_slugs: ['platform'],
        muted_view_slugs: [],
      }),
    );
  });

  it('hides a team section when muted_team_slugs contains its slug', () => {
    const { props } = createMainComponentProps({
      toolOutput: makeTeamModePayload(),
      widgetState: { muted_team_slugs: ['platform'] },
    });
    render(<MainComponent {...props} />);
    expect(
      screen.queryByTestId('section-header-team-platform'),
    ).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutator scope routing
// ─────────────────────────────────────────────────────────────────────────────

describe('MainComponent — mutator scope routing', () => {
  it('Done on a personal row calls set_status with NO team_slug or view_slug', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeTeamModePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-personal-1'));
    // Personal row → mutator call shape is byte-identical to 9.0.0.
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_set_status', {
      id: 'personal-1',
      status: 'done',
    });
  });

  it('Done on a team-scoped row routes the mutator with team_slug', async () => {
    const user = userEvent.setup();
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: makeTeamModePayload(),
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-team-platform-1'));
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_set_status', {
      id: 'team-platform-1',
      status: 'done',
      team_slug: 'platform',
    });
  });

  it('Done on a leader-view row routes the mutator with view_slug', async () => {
    const user = userEvent.setup();
    const payload = makeTeamModePayload({
      leader_views: [
        {
          view_slug: 'all-eng',
          view_id: 'uuid-view',
          display_name: 'All Engineering',
          actions: [
            makePersonalAction({
              id: 'lv-1',
              title: 'Cross-team item',
            }),
          ],
          handled_recent: [],
        },
      ],
    });
    const { props, callToolSpy } = createMainComponentProps({
      toolOutput: payload,
    });
    render(<MainComponent {...props} />);
    await user.click(screen.getByTestId('done-lv-1'));
    expect(callToolSpy).toHaveBeenCalledWith('agntux_core_set_status', {
      id: 'lv-1',
      status: 'done',
      view_slug: 'all-eng',
    });
  });
});
