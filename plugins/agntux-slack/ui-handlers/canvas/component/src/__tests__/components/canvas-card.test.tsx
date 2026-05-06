/**
 * canvas-card.test.tsx
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

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: "canvas-action-1",
    channel: { id: "C456", name: "eng-leads" },
    thread: { parent_ts: "ts", total_replies: 5, participants: ["Alice", "Bob"] },
    drafted_canvas: {
      title: "Thread summary: Apex Phase 2",
      tldr: "Team agreed on May 15 delivery.",
      decisions: ["Scope freeze May 10", "Delivery May 15"],
      open_questions: ["Who owns QA?"],
      participants: ["Alice", "Bob", "Carol"],
    },
    proposed_followup_message: "Posted a thread summary.",
    ...overrides,
  };
}

// ── parsePayload ──────────────────────────────────────────────────────────────

describe("parsePayload", () => {
  it("returns null for undefined input", () => {
    expect(parsePayload(undefined)).toBeNull();
  });

  it("returns error for error payload", () => {
    const result = parsePayload({ error: "action_not_found" });
    expect(result?.error).toBe("action_not_found");
  });

  it("normalizes a valid canvas payload", () => {
    const result = parsePayload(makePayload());
    expect(result?.error).toBeNull();
    if (!result || result.error) throw new Error("expected success");
    expect(result.action_id).toBe("canvas-action-1");
    expect(result.drafted_canvas.decisions).toHaveLength(2);
  });
});

// ── Render branches (no provider needed) ──────────────────────────────────────

describe("MainComponent — render branches (no-provider)", () => {
  it("renders loading skeleton when toolOutput is undefined", () => {
    const { props } = createMainComponentProps({ toolOutput: undefined });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId("loading-skeleton")).toBeInTheDocument();
  });

  // 5.1.2 regression guards. Mirrors the compose-card streaming-skeleton
  // tests. App.tsx synthesizes a partial-shaped toolOutput envelope while
  // tool-input-partial notifications stream; if the streaming-skeleton
  // check doesn't fire first, CanvasCard mounts with the partial-derived
  // payload and useState(title) / useState(tldr) / useState(decisions) /
  // useState(openQuestions) latch the empty values, ignoring the real
  // payload when it arrives.
  it("renders streaming skeleton when isStreaming is true even with a synthesized partial envelope", () => {
    const partialInput = { action_id: "test-action-1" };
    const { props } = createMainComponentProps({
      toolOutput: { _meta: { payload: partialInput } },
      isStreaming: true,
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId("streaming-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-card")).not.toBeInTheDocument();
  });

  it("renders streaming skeleton when isStreaming is true and toolOutput is undefined", () => {
    const { props } = createMainComponentProps({
      toolOutput: undefined,
      isStreaming: true,
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId("streaming-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("loading-skeleton")).not.toBeInTheDocument();
  });

  it("renders action_not_found error state", () => {
    const { props } = createMainComponentProps({
      toolOutput: { error: "action_not_found" },
    });
    render(<MainComponent {...props} />);
    expect(screen.getByTestId("error-action-not-found")).toBeInTheDocument();
  });

});

// ── Happy path (needs provider) ───────────────────────────────────────────────

describe("MainComponent — canvas card render (with provider)", () => {
  it("renders canvas card with title input and decisions", () => {
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    expect(screen.getByTestId("canvas-card")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-title")).toBeInTheDocument();
    expect(screen.getByTestId("decisions-editor")).toBeInTheDocument();
  });

  it("switching to preview tab shows canvas-preview", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    await user.click(screen.getByTestId("canvas-tab-preview"));
    expect(screen.getByTestId("canvas-preview")).toBeInTheDocument();
  });

  it("add button in decisions editor appends a row", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    const addBtn = screen.getByTestId("decisions-editor-add");
    await user.click(addBtn);
    expect(screen.getByTestId("decisions-editor-item-2")).toBeInTheDocument();
  });

  it("primary button emits a Slack-Connector-targeted envelope with channel + thread context", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    const { adapter } = renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    const spy = vi.spyOn(adapter, "sendMessage");
    await user.click(screen.getByTestId("primary-action"));
    expect(spy).toHaveBeenCalledTimes(1);
    const [msg] = spy.mock.calls[0] as [{ type: string; text: string }];
    expect(msg.text).toMatch(/^Use the Slack Connector/);
    expect(msg.text).toContain("Create a Slack canvas");
    expect(msg.text).toContain("post it as a thread reply");
    expect(msg.text).toContain("channel_id:");
    expect(msg.text).toContain("thread_ts:");
    expect(msg.text).toContain("(action_id: canvas-action-1)");
    expect(msg.text).toContain("«Thread summary: Apex Phase 2»");
    expect(msg.text).not.toMatch(/agntux-slack plugin/);
  });

  it("discard is a pure local action — does NOT send to host, shows the discarded banner", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    const { adapter } = renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    const spy = vi.spyOn(adapter, "sendMessage");
    await user.click(screen.getByTestId("discard-button"));
    expect(spy).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId("canvas-discarded-banner"),
    ).toHaveTextContent(/Discarded/);
  });
});

void vi;
