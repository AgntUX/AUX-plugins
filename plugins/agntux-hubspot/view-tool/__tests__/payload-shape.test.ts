// =============================================================================
// payload-shape.test.ts — payload-shape regression guard for agntux-hubspot.
//
// Exercises all 4 view tools via their TypeScript handler module (loaded from
// src/agntux-hubspot-view.js via the compiled ESM import). All I/O goes
// through an in-memory fs shim; no real filesystem is touched.
//
// structuredContent key sets derived verbatim from the handler interfaces and
// the payload reference files:
//   - view-tool/src/agntux-hubspot-view.ts: MoveDealPayloadOk
//   - view-tool/src/agntux-hubspot-view.ts: TaskPayloadOk
//   - view-tool/src/agntux-hubspot-view.ts: ActivityPayloadOk
//   - view-tool/src/agntux-hubspot-view.ts: ReassignPayloadOk
//
// KEPT_KEYS sets are the verbatim key names from those interfaces. No phantom
// keys, no invented fields.
//
// PAYLOAD_BUDGET_BYTES = 30 KB (single-row CRM views; well below 64 KB cap).
//
// Pass 11 (E24/E25) of the marketplace linter requires a Buffer.byteLength +
// JSON.stringify + toBeLessThan assertion in this file.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/agntux-hubspot-view.js";

// ── Budget ────────────────────────────────────────────────────────────────────

// 30 KB per single-row CRM view — comfortable well below the 64 KB host cap.
const PAYLOAD_BUDGET_BYTES = 30 * 1024;

// ── structuredContent key sets (derived verbatim from agntux-hubspot-view.ts) ─

// From MoveDealPayloadOk interface:
const MOVE_DEAL_KEYS = new Set([
  "deal_url",
  "deal_id",
  "deal_name",
  "pipeline_label",
  "current_stage",
  "available_stages",
  "amount",
  "currency_code",
  "close_date",
]);

// From TaskPayloadOk interface:
const TASK_KEYS = new Set([
  "task_url",
  "task_id",
  "task_title",
  "due_date",
  "status",
  "associated_record_name",
  "modes",
]);

// From ActivityPayloadOk interface:
const ACTIVITY_KEYS = new Set([
  "record_url",
  "record_id",
  "record_type",
  "record_name",
  "draft_body",
  "personalization_signals",
]);

// From ReassignPayloadOk interface:
const REASSIGN_KEYS = new Set([
  "record_url",
  "record_id",
  "record_type",
  "record_name",
  "current_owner",
  "candidate_owners",
]);

// ── In-memory fs ─────────────────────────────────────────────────────────────

function inMemoryFs(files: Record<string, string>): ViewToolFs {
  return {
    async readFile(path: string) {
      const content = files[path];
      if (content == null) throw new ViewToolFsError("not-found", path);
      return Buffer.from(content, "utf8");
    },
    async readMany(paths: string[]) {
      return paths.map((p) => {
        const c = files[p];
        return c != null ? Buffer.from(c, "utf8") : null;
      });
    },
    async list(prefix: string) {
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .sort();
    },
    async listWithMeta(prefix: string): Promise<ListWithMetaEntry[]> {
      return Object.keys(files)
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((path) => ({ path, meta: null }));
    },
    async exists(path: string) {
      return Object.prototype.hasOwnProperty.call(files, path);
    },
  };
}

// ── Context factory ──────────────────────────────────────────────────────────

const FIXED_SCOPE: ViewToolScope = {
  user_id: "test-user",
  organization_id: "test-org",
};

function makeCtx(files: Record<string, string>, now?: Date): ViewToolContext {
  const fixedNow = now ?? new Date("2026-06-26T12:00:00Z");
  return {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: () => makeCtx(files, fixedNow),
  };
}

// ── Action file builders ──────────────────────────────────────────────────────

function makeMoveDealActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: hubspot
---

## Why this matters

Deal has not moved in 9 business days.

## Move-deal payload

\`\`\`yaml
deal_id: "12345"
deal_url: "https://app.hubspot.com/contacts/98765432/deal/12345"
deal_name: "Acme Corp Enterprise License"
pipeline_label: "Sales Pipeline"
current_stage: "Appointment Scheduled"
available_stages:
  - id: "appointmentscheduled"
    label: "Appointment Scheduled"
  - id: "qualifiedtobuy"
    label: "Qualified to Buy"
  - id: "presentationscheduled"
    label: "Presentation Scheduled"
  - id: "closedwon"
    label: "Closed Won"
  - id: "closedlost"
    label: "Closed Lost"
amount: "25000"
currency_code: "USD"
close_date: "2026-07-15"
\`\`\`
`;
}

function makeTaskActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: high
type: action-item
schema_version: "1.0.0"
source: hubspot
---

## Why this matters

Task is overdue by 2 days.

## Task payload

\`\`\`yaml
task_id: "67890"
task_url: "https://app.hubspot.com/contacts/98765432/task/67890"
task_title: "Follow up with Acme Corp after demo"
due_date: "2026-06-24"
status: "NOT_STARTED"
associated_record_name: "Acme Corp Enterprise License"
modes:
  - complete
  - reschedule
\`\`\`
`;
}

function makeActivityActionFile(actionId: string, draftBody = "Following up on our demo call."): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: hubspot
---

## Why this matters

Meeting was completed with next steps to follow up.

## Activity payload

\`\`\`yaml
record_id: "22222"
record_url: "https://app.hubspot.com/contacts/98765432/contact/22222"
record_type: "CONTACT"
record_name: "Jane Smith"
draft_body: |
  ${draftBody}
personalization_signals:
  - "Meeting completed with action items discussed"
\`\`\`
`;
}

function makeReassignActionFile(actionId: string): string {
  return `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: hubspot
---

## Why this matters

Deal needs to be reassigned to the right team member.

## Reassign payload

\`\`\`yaml
record_id: "12345"
record_url: "https://app.hubspot.com/contacts/98765432/deal/12345"
record_type: "DEAL"
record_name: "Acme Corp Enterprise License"
current_owner: "John Jordan"
candidate_owners:
  - ownerId: "11111111"
    name: "Alice Wong"
  - ownerId: "22222222"
    name: "Bob Chen"
\`\`\`
`;
}

// ── Exported ViewTool entries ─────────────────────────────────────────────────

// mod.viewTools order mirrors listing.yaml ui_components order:
//   [0] agntux_hubspot_move_deal_view
//   [1] agntux_hubspot_task_view
//   [2] agntux_hubspot_activity_view
//   [3] agntux_hubspot_reassign_view
const moveDealTool = mod.viewTools[0]!;
const taskTool = mod.viewTools[1]!;
const activityTool = mod.viewTools[2]!;
const reassignTool = mod.viewTools[3]!;

// ── Helper: key-set assertions ────────────────────────────────────────────────

function assertKeySet(
  sc: Record<string, unknown>,
  expected: Set<string>,
  label: string,
) {
  const keys = new Set(Object.keys(sc));
  for (const k of keys) {
    expect(expected.has(k), `unexpected key "${k}" in ${label} payload`).toBe(true);
  }
  for (const k of expected) {
    expect(keys.has(k), `missing required key "${k}" in ${label} payload`).toBe(true);
  }
}

function assertEnvelope(content: unknown) {
  expect(Array.isArray(content)).toBe(true);
  if (!Array.isArray(content)) return;
  expect(content[0].type).toBe("text");
  const text = content[0].text as string;
  expect(text).toContain("iframe");
  expect(text).toContain("host");
  expect(text).toContain("MCP App");
}

// =============================================================================
// MOVE-DEAL VIEW
// =============================================================================

describe("agntux_hubspot_move_deal_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await moveDealTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns move_deal_payload_missing when action has no ## Move-deal payload section", async () => {
    const files = {
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\ntype: action-item\n---\n\n## Why this matters\n\nNo payload section here.\n`,
    };
    const result = await moveDealTool.handle(
      { action_id: "no-payload" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("move_deal_payload_missing");
  });

  it("returns well-shaped MoveDealPayloadOk for a valid open action", async () => {
    const actionId = "hubspot-move-deal-001";
    const files = { [`actions/${actionId}.md`]: makeMoveDealActionFile(actionId) };
    const result = await moveDealTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, MOVE_DEAL_KEYS, "move-deal");
    expect((sc as Record<string, unknown>).deal_id).toBe("12345");
    expect((sc as Record<string, unknown>).currency_code).toBe("USD");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("available_stages is an array with {id, label} entries", async () => {
    const actionId = "hubspot-move-deal-002";
    const files = { [`actions/${actionId}.md`]: makeMoveDealActionFile(actionId) };
    const result = await moveDealTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    if ("error" in sc) return;
    const stages = (sc as Record<string, unknown>).available_stages;
    expect(Array.isArray(stages)).toBe(true);
    if (Array.isArray(stages) && stages.length > 0) {
      const first = stages[0] as Record<string, unknown>;
      expect(typeof first.id).toBe("string");
      expect(typeof first.label).toBe("string");
    }
  });

  it("returns action_already_handled for a done action", async () => {
    const files = {
      "actions/done.md": `---\nid: done\nstatus: done\ntype: action-item\n---\n\n## Move-deal payload\n\n\`\`\`yaml\ndeal_id: "x"\n\`\`\`\n`,
    };
    const result = await moveDealTool.handle({ action_id: "done" }, makeCtx(files));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_already_handled");
  });

  it("returns action_already_handled for a dismissed action", async () => {
    const files = {
      "actions/dismissed.md": `---\nid: dismissed\nstatus: dismissed\ntype: action-item\n---\n\n## Move-deal payload\n\n\`\`\`yaml\ndeal_id: "x"\n\`\`\`\n`,
    };
    const result = await moveDealTool.handle({ action_id: "dismissed" }, makeCtx(files));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_already_handled");
  });
});

// =============================================================================
// TASK VIEW
// =============================================================================

describe("agntux_hubspot_task_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await taskTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns task_payload_missing when action has no ## Task payload section", async () => {
    const files = {
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\ntype: action-item\n---\n\n## Why this matters\n\nNo task payload.\n`,
    };
    const result = await taskTool.handle(
      { action_id: "no-payload" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("task_payload_missing");
  });

  it("returns well-shaped TaskPayloadOk for a valid open action", async () => {
    const actionId = "hubspot-task-001";
    const files = { [`actions/${actionId}.md`]: makeTaskActionFile(actionId) };
    const result = await taskTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, TASK_KEYS, "task");
    expect((sc as Record<string, unknown>).task_id).toBe("67890");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("modes is an array containing 'complete' and 'reschedule'", async () => {
    const actionId = "hubspot-task-002";
    const files = { [`actions/${actionId}.md`]: makeTaskActionFile(actionId) };
    const result = await taskTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    if ("error" in sc) return;
    const modes = (sc as Record<string, unknown>).modes as string[];
    expect(Array.isArray(modes)).toBe(true);
    expect(modes).toContain("complete");
    expect(modes).toContain("reschedule");
  });

  it("returns action_already_handled for a done action", async () => {
    const files = {
      "actions/done.md": `---\nid: done\nstatus: done\ntype: action-item\n---\n\n## Task payload\n\n\`\`\`yaml\ntask_id: "x"\n\`\`\`\n`,
    };
    const result = await taskTool.handle({ action_id: "done" }, makeCtx(files));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_already_handled");
  });
});

// =============================================================================
// ACTIVITY VIEW
// =============================================================================

describe("agntux_hubspot_activity_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await activityTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns activity_payload_missing when action has no ## Activity payload section", async () => {
    const files = {
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\ntype: action-item\n---\n\n## Why this matters\n\nNo activity payload.\n`,
    };
    const result = await activityTool.handle(
      { action_id: "no-payload" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("activity_payload_missing");
  });

  it("returns well-shaped ActivityPayloadOk for a valid open action", async () => {
    const actionId = "hubspot-activity-001";
    const files = { [`actions/${actionId}.md`]: makeActivityActionFile(actionId) };
    const result = await activityTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, ACTIVITY_KEYS, "activity");
    expect((sc as Record<string, unknown>).record_type).toBe("CONTACT");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("personalization_signals is an array", async () => {
    const actionId = "hubspot-activity-002";
    const files = { [`actions/${actionId}.md`]: makeActivityActionFile(actionId) };
    const result = await activityTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    if ("error" in sc) return;
    const signals = (sc as Record<string, unknown>).personalization_signals;
    expect(Array.isArray(signals)).toBe(true);
  });

  it("draft_body is truncated to 2000 chars when the stored value is longer", async () => {
    // The handler clips draft_body at 2000 chars (DRAFT_BODY_MAX constant)
    const actionId = "hubspot-activity-long";
    const longBody = "x".repeat(3000);
    const files = {
      [`actions/${actionId}.md`]: makeActivityActionFile(actionId, longBody),
    };
    const result = await activityTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    const draft = (sc as Record<string, unknown>).draft_body as string;
    expect(draft.length).toBeLessThanOrEqual(2000);
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("returns action_already_handled for a done action", async () => {
    const files = {
      "actions/done.md": `---\nid: done\nstatus: done\ntype: action-item\n---\n\n## Activity payload\n\n\`\`\`yaml\nrecord_id: "x"\n\`\`\`\n`,
    };
    const result = await activityTool.handle({ action_id: "done" }, makeCtx(files));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_already_handled");
  });

  it("cross-source fallback: reads activity fields from ## Compose payload (hubspot) when ## Activity payload is absent", async () => {
    // Regression guard for the cross-source-merge path: Step 9 ("Draft a hubspot
    // reply") writes ## Compose payload (hubspot) onto a sibling plugin's action
    // file (e.g. Gmail). The section MUST carry activity-payload fields, not the
    // generic compose shape — the view reads ## Compose payload (hubspot) as a
    // fallback and expects record_url/record_id/record_type/record_name/
    // draft_body/personalization_signals. Without this path the activity view
    // renders blank on cross-source merged actions.
    const actionId = "cross-source-gmail-001";
    const files = {
      [`actions/${actionId}.md`]: `---
id: ${actionId}
status: open
priority: medium
type: action-item
schema_version: "1.0.0"
source: gmail
---

## Why this matters

Step 9 merge drafted a HubSpot note from a Gmail thread.

## Compose payload (hubspot)

\`\`\`yaml
record_id: "33333"
record_url: "https://app.hubspot.com/contacts/98765432/contact/33333"
record_type: "CONTACT"
record_name: "Bob Martinez"
draft_body: "Following up on your recent email regarding the Q3 proposal."
personalization_signals:
  - "Email received 2 days ago"
  - "Deal in Proposal Sent stage"
\`\`\`
`,
    };
    const result = await activityTool.handle({ action_id: actionId }, makeCtx(files));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, ACTIVITY_KEYS, "activity (cross-source fallback)");
    expect((sc as Record<string, unknown>).record_id).toBe("33333");
    expect((sc as Record<string, unknown>).record_type).toBe("CONTACT");
    expect((sc as Record<string, unknown>).record_name).toBe("Bob Martinez");
    expect((sc as Record<string, unknown>).draft_body).toContain("Q3 proposal");
    const signals = (sc as Record<string, unknown>).personalization_signals as string[];
    expect(Array.isArray(signals)).toBe(true);
    expect(signals.length).toBe(2);
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });
});

// =============================================================================
// REASSIGN VIEW
// =============================================================================

describe("agntux_hubspot_reassign_view payload shape", () => {
  it("returns action_not_found when action file is absent", async () => {
    const result = await reassignTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_not_found");
  });

  it("returns reassign_payload_missing when action has no ## Reassign payload section", async () => {
    const files = {
      "actions/no-payload.md": `---\nid: no-payload\nstatus: open\ntype: action-item\n---\n\n## Why this matters\n\nNo reassign payload.\n`,
    };
    const result = await reassignTool.handle(
      { action_id: "no-payload" },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("reassign_payload_missing");
  });

  it("returns well-shaped ReassignPayloadOk for a valid open action", async () => {
    const actionId = "hubspot-reassign-001";
    const files = { [`actions/${actionId}.md`]: makeReassignActionFile(actionId) };
    const result = await reassignTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;
    assertKeySet(sc as Record<string, unknown>, REASSIGN_KEYS, "reassign");
    expect((sc as Record<string, unknown>).record_type).toBe("DEAL");
    const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });

  it("candidate_owners is an array with {ownerId, name} entries", async () => {
    const actionId = "hubspot-reassign-002";
    const files = { [`actions/${actionId}.md`]: makeReassignActionFile(actionId) };
    const result = await reassignTool.handle(
      { action_id: actionId },
      makeCtx(files),
    );
    const sc = result.structuredContent;
    if ("error" in sc) return;
    const owners = (sc as Record<string, unknown>).candidate_owners as Array<Record<string, unknown>>;
    expect(Array.isArray(owners)).toBe(true);
    if (Array.isArray(owners) && owners.length > 0) {
      const first = owners[0];
      expect(typeof first.ownerId).toBe("string");
      expect(typeof first.name).toBe("string");
    }
  });

  it("returns action_already_handled for a done action", async () => {
    const files = {
      "actions/done.md": `---\nid: done\nstatus: done\ntype: action-item\n---\n\n## Reassign payload\n\n\`\`\`yaml\nrecord_id: "x"\n\`\`\`\n`,
    };
    const result = await reassignTool.handle({ action_id: "done" }, makeCtx(files));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(true);
    if ("error" in sc) expect(sc.error).toBe("action_already_handled");
  });
});

// =============================================================================
// Render-harness contract — all 4 handlers must survive {} args (cold render)
// =============================================================================

describe("render-harness contract — all handlers survive empty args {}", () => {
  const TOOLS = [
    { name: "agntux_hubspot_move_deal_view", tool: moveDealTool },
    { name: "agntux_hubspot_task_view", tool: taskTool },
    { name: "agntux_hubspot_activity_view", tool: activityTool },
    { name: "agntux_hubspot_reassign_view", tool: reassignTool },
  ];

  for (const { name, tool } of TOOLS) {
    it(`${name}: renders a placeholder for empty args {} without throwing`, async () => {
      const result = await tool.handle(
        {} as { action_id: string },
        makeCtx({}),
      );
      const sc = result.structuredContent as Record<string, unknown>;
      const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
      expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
      expect(Array.isArray(result.content)).toBe(true);
    });

    it(`${name}: degrades to a placeholder when ctx.fs throws a non-ViewToolFsError`, async () => {
      const ctx = makeCtx({});
      ctx.fs.readFile = async () => {
        throw new Error("boom: backend unavailable");
      };
      const result = await tool.handle({ action_id: "anything" }, ctx);
      const sc = result.structuredContent as Record<string, unknown>;
      const bytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
      expect(bytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
      expect(Array.isArray(result.content)).toBe(true);
    });
  }
});

// =============================================================================
// Response envelope guard — all handlers must ship content[] with iframe/host/MCP App
// =============================================================================

describe("response envelope guard — all handlers ship canonical content[] explanation", () => {
  it("agntux_hubspot_move_deal_view success path", async () => {
    const actionId = "env-move-deal-001";
    const files = { [`actions/${actionId}.md`]: makeMoveDealActionFile(actionId) };
    const result = await moveDealTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("agntux_hubspot_move_deal_view missing-file error path", async () => {
    const result = await moveDealTool.handle({ action_id: "missing" }, makeCtx({}));
    assertEnvelope(result.content);
  });

  it("agntux_hubspot_task_view success path", async () => {
    const actionId = "env-task-001";
    const files = { [`actions/${actionId}.md`]: makeTaskActionFile(actionId) };
    const result = await taskTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("agntux_hubspot_task_view missing-file error path", async () => {
    const result = await taskTool.handle({ action_id: "missing" }, makeCtx({}));
    assertEnvelope(result.content);
  });

  it("agntux_hubspot_activity_view success path", async () => {
    const actionId = "env-activity-001";
    const files = { [`actions/${actionId}.md`]: makeActivityActionFile(actionId) };
    const result = await activityTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("agntux_hubspot_reassign_view success path", async () => {
    const actionId = "env-reassign-001";
    const files = { [`actions/${actionId}.md`]: makeReassignActionFile(actionId) };
    const result = await reassignTool.handle({ action_id: actionId }, makeCtx(files));
    assertEnvelope(result.content);
  });

  it("agntux_hubspot_move_deal_view action_already_handled error path", async () => {
    const files = {
      "actions/done.md": `---\nid: done\nstatus: done\ntype: action-item\n---\n\n## Move-deal payload\n\n\`\`\`yaml\ndeal_id: "x"\n\`\`\`\n`,
    };
    const result = await moveDealTool.handle({ action_id: "done" }, makeCtx(files));
    assertEnvelope(result.content);
  });
});
