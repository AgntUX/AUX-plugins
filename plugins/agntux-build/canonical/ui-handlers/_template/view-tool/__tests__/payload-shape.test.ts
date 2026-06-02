// =============================================================================
// payload-shape.test.ts — payload-shape regression guard.
//
// Why this test exists: a view-tool's `structuredContent` is the JSON-RPC
// body the host returns to the chat model after rendering the iframe. The
// host caps that body at ~64 KB (varies by client). If your handler ships
// large per-row excerpts, full arrays of related entities, or unused
// metadata that the iframe never binds to JSX, you can quietly blow past
// the cap on saturated workspaces and the iframe will fail to render with
// a `result exceeds maximum allowed tokens` error from the host.
//
// See plugins/agntux-core/CHANGELOG.md → 9.5.3 for the bug class this
// test catches and why every plugin under `plugins/` should ship it.
//
// Pass 11 (E24/E25) of the marketplace linter checks that this file
// exists in every plugin with a `view-tool/` directory and that it
// contains a `Buffer.byteLength`/`JSON.stringify` byte-size assertion
// paired with a `.toBeLessThan` matcher. Both conditions must be met.
//
// Customise this file when scaffolding a new plugin:
//   1. Update the `KEPT_KEYS` set to match the fields your iframe
//      actually renders. Strip anything the iframe doesn't bind to JSX.
//      Derive KEPT_KEYS from what `viewTool.handle()` actually returns
//      below — NEVER add assertions that grep the prose of `fetch.md` /
//      `sync.md` (a different agent owns those; that couples this test to
//      wording it can't see and fails on a phantom contract).
//   2. Update the `PAYLOAD_BUDGET_BYTES` cap to match your shape:
//      - single-row views (compose, thread): 30 KB is a defensible upper
//        bound (e.g. drafted_body + email_context + participants list).
//      - list views (triage, inbox, calendar): use 25 KB or less because
//        the per-row size multiplies by N.
//   3. Update the in-memory fixture to match what your handler reads
//      from `ctx.fs`. The default `makeActionFile` builds an action-file
//      shape; non-action shapes need their own builder.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ViewToolContext,
  ViewToolFs,
  ListWithMetaEntry,
  ViewToolScope,
} from "@agntux/plugin-runtime";
// VALUE import (not type-only): the missing-file fixture throws the real
// ViewToolFsError("not-found", …) to simulate a realistic absent action file.
// The handler degrades via a catch-ALL — it does NOT branch on
// `instanceof ViewToolFsError` — so any thrown error (this one, or a plain
// Error from a different fs backend) resolves to the placeholder payload
// instead of escaping as an HTTP 500. See the "render-harness contract" block.
import { ViewToolFsError } from "@agntux/plugin-runtime";
import mod from "../src/{{ui-name}}-view.js";

// ── Tunable knobs (CHANGE THESE FOR YOUR PLUGIN) ─────────────────────────────

/**
 * Hard cap on the JSON-stringified structuredContent size. The host cap is
 * ~64 KB but the bug class is long-tail saturation, so set this well below
 * the host limit. 30 KB suits single-row views; list views should be
 * tighter (e.g. 25 KB). Picked per-plugin — there is no universal default.
 */
const PAYLOAD_BUDGET_BYTES = 30 * 1024;

/**
 * The set of keys your iframe binds to JSX. Strip everything else. A row
 * whose Object.keys don't exactly match this set fails the test — the
 * symptom is "someone added a heavy field back without updating the
 * iframe to render it." If your iframe is a list view, scope this to a
 * single row; if it's a single-row view, scope it to the whole payload.
 */
const KEPT_KEYS = new Set(["action_id", "title", "body"]);

// ── In-memory fs ─────────────────────────────────────────────────────────────

function inMemoryFs(files: Record<string, string>): ViewToolFs {
  return {
    async readFile(path: string) {
      const content = files[path];
      // Throw the real ViewToolFsError("not-found", …) to simulate a missing
      // action file. The handler's catch-all degrades it to the placeholder
      // payload; the "render-harness contract" block below also covers the
      // non-ViewToolFsError throw a narrow `instanceof` guard would 500 on.
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
      return Object.keys(files).filter((k) => k.startsWith(prefix)).sort();
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
  const fixedNow = now ?? new Date("2026-01-01T00:00:00Z");
  const ctx: ViewToolContext = {
    fs: inMemoryFs(files),
    scope: FIXED_SCOPE,
    now: () => fixedNow,
    log: () => undefined,
    withScope: () => makeCtx(files, fixedNow),
  };
  return ctx;
}

// ── Action-file builder ──────────────────────────────────────────────────────

function makeActionFile(opts: {
  id: string;
  title?: string;
  body?: string;
}): string {
  const fm = [
    `id: ${opts.id}`,
    `title: ${opts.title ?? `Action ${opts.id}`}`,
  ].join("\n");
  const body = opts.body ?? "Default body.";
  return `---\n${fm}\n---\n\n${body}\n`;
}

// ── The view-tool under test ─────────────────────────────────────────────────

const viewTool = mod.viewTools[0]!;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("{{view-tool-name}} payload-shape regression guard", () => {
  it("returns a payload under the byte budget for a max-loaded happy path", async () => {
    // NOTE (template authors): `makeActionFile` seeds `title` in the YAML
    // frontmatter and `body` as the markdown prose below the `---` fence.
    // The handler reads `parsed.frontmatter.title` for the `title` field.
    // If your handler exposes a `body` field via `parseActionFile`, note
    // that `ParsedAction` does NOT expose the raw markdown body directly
    // (it exposes named sections like `why_matters`). The template handler
    // uses `parsed.body ?? ""` which resolves to `""` because `parsed.body`
    // is not part of the `ParsedAction` interface. This means the heavy
    // `heavyBody` below does NOT inflate the wire payload in the template
    // handler — the size guard here catches saturation from `title` (which
    // IS forwarded). When you customise the handler to forward the right
    // fields, update this fixture to exercise your actual heavy paths — and
    // if you change which frontmatter field feeds `title`, update the
    // `expect(sc.title).toBe(heavyTitle)` assertion below to match (it is
    // grounded in handler output, so it silently breaks if the source moves).
    const heavyTitle = "T".repeat(2000); // exercise long-string path
    const heavyBody = "B".repeat(8000);
    const files = {
      "actions/test-action.md": makeActionFile({
        id: "test-action",
        title: heavyTitle,
        body: heavyBody,
      }),
    };

    const result = await viewTool.handle(
      { action_id: "test-action" },
      makeCtx(files),
    );
    const sc = result.structuredContent;

    // Size guard — the regression this test exists to catch.
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);

    // Sanity-check that the heavy title was actually forwarded (so the size
    // guard is exercising a non-trivial payload, not an empty object).
    expect((sc as Record<string, unknown>).title).toBe(heavyTitle);
  });

  it("returns structuredContent with exactly the iframe-rendered keys", async () => {
    const files = {
      "actions/k-1.md": makeActionFile({ id: "k-1" }),
    };

    const result = await viewTool.handle({ action_id: "k-1" }, makeCtx(files));
    const sc = result.structuredContent as Record<string, unknown>;

    const keys = new Set(Object.keys(sc));
    // No unexpected fields — guards against a future contributor adding a
    // heavy field to structuredContent without binding it to JSX.
    for (const k of keys) {
      expect(KEPT_KEYS.has(k), `unexpected key "${k}" in structuredContent`)
        .toBe(true);
    }
    // No missing fields — guards against a refactor that drops a key the
    // iframe still depends on.
    for (const k of KEPT_KEYS) {
      expect(keys.has(k), `missing required key "${k}" in structuredContent`)
        .toBe(true);
    }
  });

  it("returns a sensible fallback when the underlying file is missing", async () => {
    // No files seeded — the handler's not-found branch fires.
    const result = await viewTool.handle(
      { action_id: "does-not-exist" },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;

    // Whatever the empty/error shape is, it MUST stay under the cap and
    // MUST NOT throw. Re-enable per-field assertions per your handler's
    // documented fallback shape.
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
  });
});

// =============================================================================
// Render-harness contract — the headless render check invokes every view with
// EMPTY args `{}` (cold first paint), so `action_id` arrives undefined. The
// handler MUST render a placeholder payload and MUST NOT throw — a thrown error
// surfaces to the iframe as `tool-call HTTP 500`. This is the 2026-06-01
// calendar-build regression (`{"error":"not-found: actions/undefined.md"}`) that
// cost three validate rounds; these two assertions lock it at the template.
// =============================================================================

describe("{{view-tool-name}} render-harness contract", () => {
  it("renders a placeholder for empty args {} (cold render) without throwing", async () => {
    const result = await viewTool.handle(
      {} as { action_id: string },
      makeCtx({}),
    );
    const sc = result.structuredContent as Record<string, unknown>;
    // Placeholder ships only the iframe-rendered keys — never builds
    // `actions/undefined.md`.
    for (const k of Object.keys(sc)) {
      expect(KEPT_KEYS.has(k), `unexpected key "${k}" in placeholder`).toBe(true);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("degrades to a placeholder when ctx.fs throws a NON-ViewToolFsError", async () => {
    // A different fs backend / the render harness can surface a plain Error
    // rather than a ViewToolFsError. A handler that narrows on
    // `instanceof ViewToolFsError` rethrows it → 500. The catch-all absorbs it.
    const ctx = makeCtx({});
    ctx.fs.readFile = async () => {
      throw new Error("boom: backend unavailable");
    };
    const result = await viewTool.handle({ action_id: "anything" }, ctx);
    const sc = result.structuredContent as Record<string, unknown>;
    const payloadBytes = Buffer.byteLength(JSON.stringify(sc), "utf8");
    expect(payloadBytes).toBeLessThan(PAYLOAD_BUDGET_BYTES);
    expect(Array.isArray(result.content)).toBe(true);
  });
});

// =============================================================================
// Response envelope guard — every handler return (success AND error) must
// ship a `content[]` block alongside `structuredContent` that explains the
// MCP Apps lifecycle to the model. Frozen anchor strings: `iframe`, `host`,
// `MCP App` (frozen because the wording is centralized in
// `@agntux/plugin-runtime/render-confirmation.ts`).
//
// The pass-14 / E29 marketplace linter additionally greps for
// `renderConfirmationText(` calls in `view-tool/src/*-view.ts`. Both layers
// (test + linter) defend against the silent-regression class where a
// future contributor refactors the handler and drops the block.
// =============================================================================

describe("{{view-tool-name}} response envelope guard", () => {
  function assertEnvelope(content: unknown) {
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0].type).toBe("text");
    const text = content[0].text as string;
    expect(text).toContain("iframe");
    expect(text).toContain("host");
    expect(text).toContain("MCP App");
  }

  it("success path ships the canonical content[] explanation", async () => {
    const files = {
      "actions/env-1.md": makeActionFile({ id: "env-1" }),
    };
    const result = await viewTool.handle(
      { action_id: "env-1" },
      makeCtx(files),
    );
    assertEnvelope(result.content);
  });

  it("missing-file error branch also ships the canonical content[] explanation", async () => {
    const result = await viewTool.handle(
      { action_id: "missing" },
      makeCtx({}),
    );
    assertEnvelope(result.content);
  });
});
