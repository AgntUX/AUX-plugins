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

  it("primary button emits canvas envelope via sendFollowUpMessage", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    const { adapter } = renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    const spy = vi.spyOn(adapter, "sendMessage");
    await user.click(screen.getByTestId("primary-action"));
    expect(spy).toHaveBeenCalledTimes(1);
    const [msg] = spy.mock.calls[0] as [{ type: string; text: string }];
    expect(msg.text).toMatch(/^ux: Use the agntux-slack plugin to commit the drafted canvas/);
    expect(msg.text).toContain("canvas-action-1");
    expect(msg.text).toContain("«Thread summary: Apex Phase 2»");
  });

  it("discard button emits discard envelope", async () => {
    const user = userEvent.setup();
    const { props } = createMainComponentProps({ toolOutput: makePayload() });
    const { adapter } = renderWithProvider(<MainComponent {...props} />, {
      adapterOptions: { initialToolOutput: makePayload() },
    });
    const spy = vi.spyOn(adapter, "sendMessage");
    await user.click(screen.getByTestId("discard-button"));
    expect(spy).toHaveBeenCalledTimes(1);
    const [msg] = spy.mock.calls[0] as [{ type: string; text: string }];
    expect(msg.text).toContain("discard");
    expect(msg.text).toContain("canvas-action-1");
  });
});

void vi;
