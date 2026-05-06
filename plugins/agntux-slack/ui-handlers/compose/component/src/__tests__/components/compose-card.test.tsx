/**
 * compose-card.test.tsx
 *
 * Unit tests for the compose card component.
 *
 * Rules:
 *   - Tests that render only error/loading branches use plain render() +
 *     createMainComponentProps() — those branches don't call useAppsClient().
 *   - Tests that render the happy-path compose card use renderWithProvider()
 *     so useAppsClient() resolves from the AppsProvider context.
 *     The sendFollowUpMessage spy is captured from the adapter.
 */

import { describe, it, expect, vi } from "vitest";
import {
  render,
  renderWithProvider,
  screen,
  userEvent,
  createMainComponentProps,
} from "../test-utils/render.js";
import { MainComponent, parsePayload } from "../../components/main-component.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: "test-action-1",
    initial_verb: "draft",
    channel: { id: "C123", name: "partner-platforms", is_dm: false },
    thread: {
      parent_ts: "1234567890.000100",
      parent_author_real_name: "Alice Smith",
      parent_excerpt: "Can you confirm the delivery timeline?",
      last_reply_ts: "1234567891.000100",
      last_reply_author_real_name: "Bob Jones",
      last_reply_excerpt: "Still waiting on confirmation.",
      total_replies: 3,
      participants: ["Alice Smith", "Bob Jones"],
    },
    messages_preview: [
      { ts: "1234567890.000100", author: "Alice Smith", body_excerpt: "Can you confirm?" },
    ],
    messages_truncated: false,
    drafted_body: "Hi Alice, confirming delivery by May 15.",
    personalization_signals: ["Matches your response-needed rule"],
    proposed_send_time: null,
    slack_permalink: null,
    ...overrides,
  };
}

// ── parsePayload ──────────────────────────────────────────────────────────────

describe("parsePayload", () => {
  it("returns null when toolOutput is undefined", () => {
    expect(parsePayload(undefined)).toBeNull();
  });

  it("returns error when payload has error field", () => {
    const result = parsePayload({ error: "action_not_found" });
    expect(result?.error).toBe("action_not_found");
  });

  it("normalizes a valid flat payload", () => {
    const result = parsePayload(makePayload());
    expect(result?.error).toBeNull();
    if (!result || result.error) throw new Error("expected success");
    expect(result.action_id).toBe("test-action-1");
    expect(result.channel.name).toBe("partner-platforms");
  });

  it("unwraps relay-pattern _meta.payload envelope", () => {
    const result = parsePayload({ _meta: { payload: makePayload() } });
    expect(result?.error).toBeNull();
    if (!result || result.error) throw new Error("expected success");
    expect(result.action_id).toBe("test-action-1");
  });
});

// ── Render branches (no provider needed — no useAppsClient in these branches) ─

describe("MainComponent — render branches (no-provider)", () => {
  it("renders loading skeleton when toolOutput is undefined", () => {
    const { props } = createMainComponentProps({ toolOutput: undefined });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId("loading-skeleton")).toBeInTheDocument();
  });

  it("renders action_not_found error state", () => {
    const { props } = createMainComponentProps({
      toolOutput: { error: "action_not_found" },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId("error-action-not-found")).toBeInTheDocument();
  });

  it("renders action_already_handled error state", () => {
    const { props } = createMainComponentProps({
      toolOutput: { error: "action_already_handled" },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId("error-action-already-handled")).toBeInTheDocument();
  });

});

// ── Happy path (needs AppsProvider via renderWithProvider) ────────────────────

describe("MainComponent — compose card render (with provider)", () => {
  it("renders compose card with channel name and textarea", () => {
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    expect(screen.getByTestId("compose-card")).toBeInTheDocument();
    expect(screen.getByTestId("compose-body")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Hi Alice, confirming delivery by May 15."),
    ).toBeInTheDocument();
    // Channel name appears in both panel title and card header
    const channelRefs = screen.getAllByText(/#partner-platforms/);
    expect(channelRefs.length).toBeGreaterThanOrEqual(1);
  });

  it("textarea edit updates the displayed value", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    const textarea = screen.getByTestId("compose-body");
    await user.clear(textarea);
    await user.type(textarea, "New reply text");
    expect(screen.getByDisplayValue("New reply text")).toBeInTheDocument();
  });

  it("switching to schedule mode shows the datetime picker", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    await user.click(screen.getByTestId("mode-tab-schedule"));
    expect(screen.getByTestId("datetime-picker")).toBeInTheDocument();
  });

  it("switching to save_draft mode does not show datetime picker", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    await user.click(screen.getByTestId("mode-tab-save_draft"));
    expect(screen.queryByTestId("datetime-picker")).not.toBeInTheDocument();
  });

  it("primary button is disabled when textarea is empty", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({
      toolOutput: makePayload({ drafted_body: "" }),
    });
    renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload({ drafted_body: "" }) },
    });
    const btn = screen.getByTestId("primary-action");
    expect(btn).toBeDisabled();
    await user.type(screen.getByTestId("compose-body"), "Hello");
    expect(btn).not.toBeDisabled();
  });
});

// ── Send/discard actions (need provider for sendFollowUpMessage) ───────────────

describe("MainComponent — send actions (with provider)", () => {
  it("Send button emits a Slack-Connector-targeted envelope with channel_id + thread_ts", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    const { adapter } = renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });

    // Spy on sendMessage which is called by sendFollowUpMessage in the adapter
    const spy = vi.spyOn(adapter, "sendMessage");
    await user.click(screen.getByTestId("primary-action"));
    expect(spy).toHaveBeenCalledTimes(1);
    const [msg] = spy.mock.calls[0] as [{ type: string; text: string }];
    expect(msg.text).toMatch(/^Use the Slack Connector/);
    expect(msg.text).toContain("send a Slack message as a thread reply");
    expect(msg.text).toContain("channel_id:");
    expect(msg.text).toContain("thread_ts:");
    expect(msg.text).toContain("(action_id: test-action-1)");
    expect(msg.text).toContain("«Hi Alice, confirming delivery by May 15.»");
    expect(msg.text).not.toMatch(/agntux-slack plugin/);
  });

  it("Discard is a pure local action — does NOT send to host, shows the discarded banner", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    const { adapter } = renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    const spy = vi.spyOn(adapter, "sendMessage");
    await user.click(screen.getByTestId("discard-button"));
    expect(spy).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId("compose-discarded-banner"),
    ).toHaveTextContent(/Discarded/);
  });
});

// Suppress unused import warning
void vi;
