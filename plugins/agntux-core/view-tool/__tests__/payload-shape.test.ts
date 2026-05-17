// =============================================================================
// payload-shape.test.ts — regression guard for the triage_view wire payload.
//
// Context lineage:
//   9.5.3 — Trimmed the row to 7 fields when the iframe was a slim placeholder
//           because a 30-row payload with full excerpts hit ~62 KB and was
//           rejected by the host's max-tokens cap.
//   9.6.0 — Restored the rich React tree (~3,477 LoC main-component.tsx) but
//           left the trimmed wire shape in place — the UI rendered but the
//           Details panel, "via {source}" line, related-entity badges, and
//           suggested-action CTAs all stayed empty.
//   9.7.0 — Restored the rich row fields and tuned MAX_EXCERPT_CHARS from
//           600 → 220 and MAX_SUGGESTED_ACTIONS from 6 → 4 to keep
//           worst-case 30-row payload under 55 KB (~15 % headroom vs the
//           host's ~64 KB max-tokens cap) while filling in the data the
//           rich UI binds.
//
// What this file guards against:
//
//   1. Total payload size for a worst-case 30-row workspace stays well
//      under the host's ~64 KB max-tokens cap. (Budget: 55 KB.)
//
//   2. Action rows carry the full rich-UI key set — accidental future
//      trimming that lands the same regression class as 9.6.0 will fail
//      a positive `has key X` assertion per kept field.
//
//   3. Handled rows carry priority/status/outcome so the Dismissed badge
//      and outcome subline can render.
//
//   4. Empty-workspace and actions_index_missing error paths still emit
//      the structured shape the UI expects.
//
// Drives `handleTriageView` (via the exported ViewTool) directly with a
// hand-rolled in-memory fs. No node:fs — all I/O is faked via `inMemoryFs`.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
import mod from "../src/agntux-core-view.js";

// ── In-memory fs factory ─────────────────────────────────────────────────────

function inMemoryFs(files: Record<string, string>): ViewToolFs {
  return {
    async readFile(path: string) {
      const content = files[path];
      if (content == null) throw new Error(`not-found: ${path}`);
      return Buffer.from(content, "utf8");
    },
    async readMany(paths: string[]) {
      return paths.map((p) => {
        const content = files[p];
        return content != null ? Buffer.from(content, "utf8") : null;
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
  const fixedNow = now ?? new Date("2026-05-17T12:00:00Z");
  const ctx: ViewToolContext = {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: (_extra) => makeCtx(files, fixedNow),
  };
  return ctx;
}

// ── Action file builder ──────────────────────────────────────────────────────

interface ActionFileOpts {
  id: string;
  status: "open" | "snoozed" | "done" | "dismissed";
  priority?: "high" | "medium" | "low";
  title?: string;
  why?: string;
  fit?: string;
  source?: string;
  due_by?: string;
  snoozed_until?: string;
  created_at?: string;
  updated_at?: string;
  related_entities?: string[];
  suggested_actions?: { label: string; host_prompt: string; url?: string }[];
  handledAt?: string;
}

function makeActionFile(opts: ActionFileOpts): string {
  const fm: string[] = [
    `id: ${opts.id}`,
    `status: ${opts.status}`,
    `priority: ${opts.priority ?? "medium"}`,
    `reason_class: test`,
    `reason_detail: ${opts.title ?? `Action ${opts.id}`}`,
  ];
  if (opts.source) fm.push(`source: ${opts.source}`);
  if (opts.due_by) fm.push(`due_by: ${opts.due_by}`);
  if (opts.snoozed_until) fm.push(`snoozed_until: ${opts.snoozed_until}`);
  if (opts.created_at) fm.push(`created_at: ${opts.created_at}`);
  if (opts.updated_at) fm.push(`updated_at: ${opts.updated_at}`);
  if (opts.related_entities && opts.related_entities.length) {
    fm.push("related_entities:");
    for (const e of opts.related_entities) fm.push(`  - ${e}`);
  }
  if (opts.suggested_actions && opts.suggested_actions.length) {
    fm.push("suggested_actions:");
    for (const sa of opts.suggested_actions) {
      fm.push(`  - label: ${JSON.stringify(sa.label)}`);
      fm.push(`    host_prompt: ${JSON.stringify(sa.host_prompt)}`);
      if (sa.url) fm.push(`    url: ${JSON.stringify(sa.url)}`);
    }
  }
  if (opts.status === "done")
    fm.push(`completed_at: ${opts.handledAt ?? "2026-05-16T10:00:00Z"}`);
  if (opts.status === "dismissed")
    fm.push(`dismissed_at: ${opts.handledAt ?? "2026-05-16T10:00:00Z"}`);

  const why = opts.why ?? `Why ${opts.id} matters.`;
  const fit = opts.fit ?? "";
  const body =
    `## Why this matters\n\n${why}\n` +
    (fit ? `\n## Personalization fit\n\n${fit}\n` : "");
  return `---\n${fm.join("\n")}\n---\n\n${body}`;
}

// ── The single exported ViewTool ─────────────────────────────────────────────

const triageTool = mod.viewTools[0]!;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("handleTriageView payload shape", () => {
  it("returns bootstrap_mode:true and payload under 1 KB when workspace has no actions", async () => {
    const files = { "actions/_index.md": "# index\n" };
    const result = await triageTool.handle({}, makeCtx(files));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    expect(sc.bootstrap_mode).toBe(true);

    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(1024);
  });

  it("keeps payload under 55 KB for 30 maximally-loaded open actions and row keys match rich-UI interface", async () => {
    // Worst-case row: max-length title (~120 chars), max-length why
    // (drives summary 200 + why_matters_excerpt 220), max-length
    // personalization_fit (drives personalization_fit_excerpt 220), 6
    // related entities and 4 suggested actions (the per-row caps the
    // handler enforces). Pre-trim hit ~62 KB and broke the host cap;
    // restored shape with the 220-char excerpt + 4-action caps lands
    // around 53–54 KB at synthetic max. 55 KB is the defensive ceiling
    // — ~15 % under the host's ~64 KB max-tokens cap, ~30 % over the
    // pre-trim breaking point. Real workspaces typically land at
    // 25–40 KB (most rows don't have 6 entities AND 4 actions AND
    // maxed-out excerpts simultaneously).
    const KEPT_KEYS = new Set([
      "id",
      "title",
      "summary",
      "priority",
      "status",
      "reason_class",
      "due_by",
      "snoozed_until",
      "source",
      "related_entities",
      "suggested_actions",
      "why_matters_excerpt",
      "personalization_fit_excerpt",
      "created_at",
      "updated_at",
    ]);

    const heavyWhy = "x".repeat(800); // longer than MAX_EXCERPT_CHARS=220
    const heavyFit = "y".repeat(800);
    const heavyTitle = "A".repeat(200); // longer than MAX_TITLE_CHARS=120
    // 10 entities so the MAX_RELATED_ENTITIES=6 slice cap is exercised.
    const manyEntities = Array.from(
      { length: 10 },
      (_, i) => `entity-slug-${String(i).padStart(3, "0")}`,
    );
    // 10 suggested actions so the MAX_SUGGESTED_ACTIONS=4 slice cap is
    // exercised. Each row includes a representative URL + host_prompt.
    const manySuggested = Array.from({ length: 10 }, (_, i) => ({
      label: `Suggested action ${i}`,
      host_prompt: `Run suggested action ${i} for this item with extra context`,
      url: `https://example.test/action/${i}`,
    }));

    const files: Record<string, string> = {
      "actions/_index.md": "# index\n",
    };
    for (let i = 1; i <= 30; i++) {
      files[`actions/action-${String(i).padStart(3, "0")}.md`] =
        makeActionFile({
          id: `action-${String(i).padStart(3, "0")}`,
          status: "open",
          priority: "high",
          title: heavyTitle,
          why: heavyWhy,
          fit: heavyFit,
          source: "exampleSource",
          due_by: "2026-06-01",
          created_at: "2026-05-10T10:00:00Z",
          updated_at: "2026-05-15T10:00:00Z",
          related_entities: manyEntities,
          suggested_actions: manySuggested,
        });
    }

    const result = await triageTool.handle({}, makeCtx(files));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    expect(sc.actions).toHaveLength(30);

    // Payload size guard — the regression this test exists to catch.
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(55 * 1024);

    // Field-shape guard: every row must have EXACTLY the kept keys.
    // Trimming any kept field (the 9.6.0-class regression) trips the
    // "missing required key" assertion. Adding a new heavy field without
    // updating this list trips the "unexpected key" assertion.
    for (const action of sc.actions) {
      const keys = new Set(Object.keys(action));
      for (const k of keys) {
        expect(KEPT_KEYS.has(k), `unexpected key "${k}" in action row`).toBe(
          true,
        );
      }
      for (const k of KEPT_KEYS) {
        expect(keys.has(k), `missing required key "${k}" in action row`).toBe(
          true,
        );
      }
    }

    // Per-row caps were applied — the 10 input entities / suggested
    // actions are trimmed to MAX_RELATED_ENTITIES=6 / MAX_SUGGESTED_ACTIONS=4.
    for (const action of sc.actions) {
      expect(action.related_entities.length).toBeLessThanOrEqual(6);
      expect(action.suggested_actions.length).toBeLessThanOrEqual(4);
      // Excerpts are bounded by MAX_EXCERPT_CHARS=220.
      expect(action.why_matters_excerpt.length).toBeLessThanOrEqual(220);
      expect(action.personalization_fit_excerpt.length).toBeLessThanOrEqual(
        220,
      );
    }
  });

  it("populates rich fields from frontmatter when present", async () => {
    // Positive assertion: the handler doesn't just emit empty strings /
    // empty arrays — it actually reads the frontmatter and surfaces the
    // values the UI binds. This catches the 9.6.0-class regression where
    // the shape was right but the data was missing.
    const files: Record<string, string> = {
      "actions/_index.md": "# index\n",
      "actions/rich-001.md": makeActionFile({
        id: "rich-001",
        status: "open",
        priority: "high",
        title: "Investigate billing anomaly",
        why: "Customer reported double-charge after the 2026-05-15 invoice run.",
        fit: "User asked to be the point of contact for billing escalations.",
        source: "stripe-webhook",
        due_by: "2026-05-20",
        created_at: "2026-05-15T10:00:00Z",
        updated_at: "2026-05-16T14:00:00Z",
        related_entities: ["customer-acme", "invoice-2026-05-15"],
        suggested_actions: [
          {
            label: "Open in Stripe",
            host_prompt: "Open the Stripe dashboard for invoice 2026-05-15",
            url: "https://stripe.example/invoice/2026-05-15",
          },
          {
            label: "Draft refund reply",
            host_prompt: "Draft a refund-confirmation email to customer-acme",
          },
        ],
      }),
    };

    const result = await triageTool.handle({}, makeCtx(files));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    expect(sc.actions).toHaveLength(1);
    const row = sc.actions[0]!;
    expect(row.id).toBe("rich-001");
    expect(row.priority).toBe("high");
    expect(row.source).toBe("stripe-webhook");
    expect(row.due_by).toBe("2026-05-20");
    expect(row.created_at).toBe("2026-05-15T10:00:00Z");
    expect(row.updated_at).toBe("2026-05-16T14:00:00Z");
    expect(row.related_entities).toEqual([
      "customer-acme",
      "invoice-2026-05-15",
    ]);
    expect(row.suggested_actions).toHaveLength(2);
    expect(row.suggested_actions[0]!.label).toBe("Open in Stripe");
    expect(row.suggested_actions[0]!.url).toBe(
      "https://stripe.example/invoice/2026-05-15",
    );
    expect(row.suggested_actions[1]!.url).toBeNull();
    expect(row.why_matters_excerpt).toContain("double-charge");
    expect(row.personalization_fit_excerpt).toContain(
      "point of contact",
    );

    // last_updated_at is the max-of-row updated_at across the scan.
    expect(sc.last_updated_at).toBe("2026-05-16T14:00:00Z");
  });

  it("snoozed action carries snoozed_until on the wire", async () => {
    const files: Record<string, string> = {
      "actions/_index.md": "# index\n",
      "actions/snz-001.md": makeActionFile({
        id: "snz-001",
        status: "snoozed",
        snoozed_until: "2026-06-01T00:00:00Z",
        title: "Snoozed item",
        why: "Reminder for next month.",
      }),
    };
    const result = await triageTool.handle({}, makeCtx(files));
    const sc = result.structuredContent;
    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    expect(sc.counts.snoozed).toBe(1);
    expect(sc.actions[0]!.status).toBe("snoozed");
    expect(sc.actions[0]!.snoozed_until).toBe("2026-06-01T00:00:00Z");
  });

  it("handled rows carry priority, status, handled_at, outcome", async () => {
    const HANDLED_KEYS = new Set([
      "id",
      "title",
      "priority",
      "status",
      "handled_at",
      "outcome",
    ]);

    const files: Record<string, string> = {
      "actions/_index.md": "# index\n",
      "actions/open-001.md": makeActionFile({
        id: "open-001",
        status: "open",
      }),
      "actions/done-001.md": makeActionFile({
        id: "done-001",
        status: "done",
        priority: "high",
        handledAt: "2026-05-16T10:00:00Z",
      }),
      "actions/dismiss-001.md": makeActionFile({
        id: "dismiss-001",
        status: "dismissed",
        priority: "medium",
        handledAt: "2026-05-16T11:00:00Z",
      }),
    };

    const result = await triageTool.handle({}, makeCtx(files));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    expect(sc.handled_recent.length).toBe(2);

    for (const row of sc.handled_recent) {
      const keys = new Set(Object.keys(row));
      for (const k of keys) {
        expect(HANDLED_KEYS.has(k), `unexpected key "${k}" in handled row`).toBe(
          true,
        );
      }
      for (const k of HANDLED_KEYS) {
        expect(keys.has(k), `missing key "${k}" in handled row`).toBe(true);
      }
    }

    // Both done and dismissed rows should be represented — the rich UI's
    // Dismissed badge depends on this. Sorted desc by handled_at, so the
    // dismissed (11:00) row sorts ahead of done (10:00).
    expect(sc.handled_recent.map((r) => r.status)).toEqual([
      "dismissed",
      "done",
    ]);
    expect(sc.handled_recent[0]!.priority).toBe("medium");
    expect(sc.handled_recent[1]!.priority).toBe("high");
    // Outcome is currently always emitted as null (parse-action.ts does
    // not yet expose an `outcome` frontmatter field). The wire shape is
    // stable so the UI's `?? null` read works either way.
    expect(sc.handled_recent[0]!.outcome).toBeNull();
    expect(sc.handled_recent[1]!.outcome).toBeNull();
  });

  it("returns structuredContent.error === actions_index_missing when _index.md is absent", async () => {
    const result = await triageTool.handle({}, makeCtx({}));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(true);
    if (!("error" in sc)) return;

    expect(sc.error).toBe("actions_index_missing");
  });
});
