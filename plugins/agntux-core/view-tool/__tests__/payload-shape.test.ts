// =============================================================================
// payload-shape.test.ts — regression guard for the 9.5.3 payload-trim fix.
//
// The bug: a 30-row open-actions workspace produced a ~62 KB JSON-RPC body
// that exceeded the host's max-token cap, silently breaking the iframe
// render. The fix strips `structuredContent` to the 7 fields the iframe
// actually consumes. These tests prevent a future contributor from re-adding
// heavy fields without realising why they were removed.
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
    withScope: (extra) => makeCtx(files, fixedNow),
  };
  return ctx;
}

// ── Action file builder ──────────────────────────────────────────────────────

function makeActionFile(opts: {
  id: string;
  status: "open" | "snoozed" | "done" | "dismissed";
  priority?: "high" | "medium" | "low";
  title?: string;
  why?: string;
  handledAt?: string;
}): string {
  const fm: string[] = [
    `id: ${opts.id}`,
    `status: ${opts.status}`,
    `priority: ${opts.priority ?? "medium"}`,
    `reason_class: test`,
    `reason_detail: ${opts.title ?? `Action ${opts.id}`}`,
  ];
  if (opts.status === "done") fm.push(`completed_at: ${opts.handledAt ?? "2026-05-16T10:00:00Z"}`);
  if (opts.status === "dismissed") fm.push(`dismissed_at: ${opts.handledAt ?? "2026-05-16T10:00:00Z"}`);

  const why = opts.why ?? `Why ${opts.id} matters.`;
  return `---\n${fm.join("\n")}\n---\n\n## Why this matters\n\n${why}\n`;
}

// ── The single exported ViewTool ─────────────────────────────────────────────

const triageTool = mod.viewTools[0]!;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("handleTriageView payload shape", () => {
  it("returns bootstrap_mode:true and payload under 1 KB when workspace has no actions", async () => {
    // Only the sentinel _index.md is present — no action files.
    const files = { "actions/_index.md": "# index\n" };
    const result = await triageTool.handle({}, makeCtx(files));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    expect(sc.bootstrap_mode).toBe(true);

    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(1024);
  });

  it("keeps payload under 25 KB for 30 maximally-loaded open actions and row keys match trimmed interface", async () => {
    // Each action has a max-length title (~120 chars) and a max-length
    // summary (~200 chars) — the worst-case wire size before the fix
    // hit ~62 KB; the trimmed shape must stay well under 25 KB.
    const KEPT_KEYS = new Set([
      "id",
      "title",
      "summary",
      "priority",
      "status",
      "reason_class",
      "due_by",
    ]);

    const heavyWhy = "x".repeat(500); // longer than MAX_SUMMARY_CHARS=200
    const heavyTitle = "A".repeat(200); // longer than MAX_TITLE_CHARS=120

    const files: Record<string, string> = {
      "actions/_index.md": "# index\n",
    };
    for (let i = 1; i <= 30; i++) {
      files[`actions/action-${String(i).padStart(3, "0")}.md`] = makeActionFile({
        id: `action-${String(i).padStart(3, "0")}`,
        status: "open",
        priority: "high",
        title: heavyTitle,
        why: heavyWhy,
      });
    }

    const result = await triageTool.handle({}, makeCtx(files));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    expect(sc.actions).toHaveLength(30);

    // Payload size guard — the regression this test exists to catch.
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(25 * 1024);

    // Field-shape guard: every row must have EXACTLY the kept keys.
    // Any dropped field (e.g. excerpt, related, suggested_actions) must
    // NOT appear; any added heavy field triggers this assertion.
    for (const action of sc.actions) {
      const keys = new Set(Object.keys(action));
      for (const k of keys) {
        expect(KEPT_KEYS.has(k), `unexpected key "${k}" in action row`).toBe(true);
      }
      for (const k of KEPT_KEYS) {
        expect(keys.has(k), `missing required key "${k}" in action row`).toBe(true);
      }
    }
  });

  it("handled_recent rows carry only id, title, handled_at", async () => {
    const HANDLED_KEYS = new Set(["id", "title", "handled_at"]);

    // A mix: one open action (so bootstrap_mode is false) + one done action
    // within the 7-day window so it appears in handled_recent.
    const files: Record<string, string> = {
      "actions/_index.md": "# index\n",
      "actions/open-001.md": makeActionFile({ id: "open-001", status: "open" }),
      "actions/done-001.md": makeActionFile({
        id: "done-001",
        status: "done",
        handledAt: "2026-05-16T10:00:00Z", // within 7-day window
      }),
    };

    const result = await triageTool.handle({}, makeCtx(files));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(false);
    if ("error" in sc) return;

    expect(sc.handled_recent.length).toBeGreaterThan(0);

    for (const row of sc.handled_recent) {
      const keys = new Set(Object.keys(row));
      for (const k of keys) {
        expect(HANDLED_KEYS.has(k), `unexpected key "${k}" in handled row`).toBe(true);
      }
      for (const k of HANDLED_KEYS) {
        expect(keys.has(k), `missing key "${k}" in handled row`).toBe(true);
      }
    }
  });

  it("returns structuredContent.error === actions_index_missing when _index.md is absent", async () => {
    // No files at all — the existence probe for actions/_index.md fails.
    const result = await triageTool.handle({}, makeCtx({}));
    const sc = result.structuredContent;

    expect("error" in sc).toBe(true);
    if (!("error" in sc)) return;

    expect(sc.error).toBe("actions_index_missing");
  });
});
