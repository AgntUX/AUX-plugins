// create-project-directory — create the AgntUX project root at `~/agntux`
// (no-op if it already exists) and return its absolute path.
//
// Why this tool exists:
//   In Claude Cowork, onboarding (`/agntux onboard` Stage 0) needs an
//   `agntux` project directory to exist before it can ask the host for
//   working permission via `request_cowork_directory`. But Cowork's
//   security guardrail won't let the agent create a directory until it
//   already has permission to work in the parent — and it isn't allowed
//   to request permission for the user's *home* directory. So `~/agntux`
//   can never be created the normal way, and onboarding used to fall back
//   to asking the user to run a terminal command.
//
//   This local stdio MCP server runs outside that cwd guardrail (it's the
//   same HOME-scoped seam `sync-installed-plugins` uses to write
//   `~/.agntux/`), so it CAN create `~/agntux` directly. Onboarding calls
//   this tool, gets the absolute path back, and hands that path to
//   `request_cowork_directory` — no terminal command required.
//
//   The target is hardcoded to `<home>/agntux`: the tool deliberately
//   takes no caller-supplied path so it can't be used as a general-purpose
//   arbitrary-`mkdir` primitive. It mirrors the canonical resolver's
//   home-fallback location (`canonical/hooks/lib/agntux-root.mjs`).

import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AGNTUX_DIR_NAME = "agntux";

// Resolve the user's home directory. `AGNTUX_HOME_OVERRIDE` is the test
// seam (matches sync-installed-plugins.ts): vitest's runtime resolves
// `os.homedir()` via libuv's passwd-db lookup and ignores HOME, so we let
// tests redirect the writes to a tmpdir without touching the real
// `~/agntux`.
function resolveHomeRoot(): string {
  return process.env.AGNTUX_HOME_OVERRIDE ?? homedir();
}

function projectRootPath(): string {
  return join(resolveHomeRoot(), AGNTUX_DIR_NAME);
}

type Inspection =
  | { state: "directory" }
  | { state: "file" }
  | { state: "missing" }
  | { state: "error"; message: string };

// Classify the target path. `statSync` *follows* symlinks (uses `stat`, not
// `lstat`) — this is intentional: a user who symlinks `~/agntux` to a
// cloud-synced folder is a legitimate setup, so a symlink-to-directory must
// read as "directory" (no-op) and a symlink-to-file as "file" (refuse). The
// only attacker-planted-symlink concern (redirecting writes) presupposes
// write access to `$HOME`, which already implies full compromise. We only
// special-case ENOENT (genuinely missing → safe to create); any other errno
// (EACCES, ELOOP, …) surfaces as a structured error rather than being
// silently bucketed as "missing" and then throwing at mkdir.
function inspect(path: string): Inspection {
  try {
    return statSync(path).isDirectory()
      ? { state: "directory" }
      : { state: "file" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return { state: "missing" };
    return { state: "error", message: (err as Error)?.message ?? String(err) };
  }
}

function errorEnvelope(path: string, error: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    structuredContent: { ok: false, path, created: false, error },
  };
}

export const createProjectDirectoryTool = {
  description:
    "Create the AgntUX project root directory at `~/agntux` and return its absolute path. No-op (does not recreate or modify) if `~/agntux` already exists. This is the Cowork-safe way to make the project folder: the local MCP server runs outside Cowork's cwd permission guardrail, so onboarding calls this to create `~/agntux`, then passes the returned absolute path to the host's `request_cowork_directory` tool to obtain working permission. Takes no arguments — the target is always `~/agntux`.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
  async handler(_args: Record<string, unknown>) {
    const path = projectRootPath();
    const inspection = inspect(path);

    if (inspection.state === "file") {
      return errorEnvelope(
        path,
        "path-is-file",
        `Cannot create the AgntUX project directory: ${path} already exists and is not a directory. Move or remove that file, then retry.`,
      );
    }
    if (inspection.state === "error") {
      return errorEnvelope(
        path,
        "stat-failed",
        `Cannot inspect the AgntUX project directory at ${path}: ${inspection.message}`,
      );
    }

    // `inspection.state` is "missing" or "directory" here. A check-then-act
    // race exists between inspect() and mkdir, but it's benign: the target
    // is fixed (not caller-influenced) and recursive mkdir is idempotent for
    // an existing directory, so the worst case is a slightly stale `created`
    // flag — never a wrong path or clobbered data.
    const created = inspection.state === "missing";
    if (created) {
      try {
        // recursive:true is idempotent and creates intermediate dirs (e.g.
        // when AGNTUX_HOME_OVERRIDE points at a not-yet-created tmpdir tree).
        // It still throws if the final component is a dangling symlink
        // (EEXIST) or the parent isn't writable (EACCES) — caught below so
        // the host always sees a structured envelope, never a raw throw.
        mkdirSync(path, { recursive: true });
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        return errorEnvelope(
          path,
          "mkdir-failed",
          `Failed to create the AgntUX project directory at ${path}: ${message}`,
        );
      }
    }

    const text = created
      ? `Created the AgntUX project directory at ${path}.`
      : `AgntUX project directory already exists at ${path}.`;
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { ok: true, path, created },
    };
  },
};
