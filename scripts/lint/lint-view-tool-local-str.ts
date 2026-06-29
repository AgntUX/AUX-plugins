/**
 * lint-view-tool-local-str.ts — pass 23: a view-tool must NOT re-author a local
 * `str()` / `strArr()` coercer. Read every payload field through the shared,
 * dependency-free accessors scaffolded at `view-tool/src/lib/payload.js`
 * (`str`, `idStr`, `strArr`, `isOpenableUrl`).
 *
 * Why this exists
 * ---------------
 * The recurring "fully-enabled button that silently does nothing" bug
 * (agntux-posthog, 2026-06) was a re-authored, string-only coercer:
 *
 *     function str(v: unknown): string {
 *       return typeof v === "string" ? v : "";   // drops a numeric id → ""
 *     }
 *
 * A source id written unquoted in YAML (`issue_id: 789`) parses as a JS number,
 * `str()` throws it away, the id arrives `""`, the click handler's
 * `if (!id) return` bails, and the button looks clickable but does nothing. The
 * canonical template now ships `idStr()` (number→string) precisely for id
 * fields; the fix is to IMPORT the shared accessors, not hand-roll a narrow
 * `str()` in every view file. This pass makes "import, never re-author"
 * structural instead of advisory.
 *
 * Findings
 * --------
 *   E38 (warning) — a view-tool source file declares its own
 *     `str` / `strArr` function or const. Import `{ str, idStr, strArr,
 *     isOpenableUrl }` from the scaffolded `./lib/payload.js`
 *     (handler depth) / `../lib/payload.js` (component depth) instead, and use
 *     `idStr()` for every identifier field.
 *
 * Severity rationale
 * ------------------
 * Warning, not error: several already-shipping plugins (apple-notes, docusign,
 * hubspot, dropbox, calendly, google-calendar, posthog) still define a local
 * `str()`, so an immediate error would break their builds before they migrate.
 * Warning-first surfaces the gap on every PR without blocking, and matches the
 * E24/E25/E35 promotion pattern. Promote to error once every plugin under
 * `plugins/` imports the shared accessors and no local `str()`/`strArr()`
 * remains.
 *
 * Scope
 * -----
 *   - Any plugin with a `view-tool/src/` directory; recurses `.ts`/`.tsx`,
 *     EXCLUDING `lib/` (the accessors live at `lib/payload.ts` and legitimately
 *     define `str`), `__tests__/`, test utilities, and `*.d.ts`.
 *   - Detects a DECLARATION of `str`/`strArr` (function/const/let), never a call
 *     site (`const x = str(v)` does not match — the declared name there is `x`),
 *     and never `idStr` (a different identifier). Comment-scrubbed so a mention
 *     in prose doesn't trip it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  plugin: string;
  file: string;
  line?: number;
  col?: number;
  message: string;
}

const VIEW_TOOL_SRC_REL = "view-tool/src";

// A DECLARATION of `str` or `strArr` at any indent:
//   function str(… / function strArr(…
//   const str = / let str: / const strArr =
// The trailing `\b` pins the name to the whole identifier, so `idStr`,
// `strArray`, `stripComments`, etc. do NOT match. A call site like
// `const title = str(v)` does not match (the declared name is `title`).
const LOCAL_STR_DECL =
  /^\s*(?:export\s+)?(?:function\s+(str|strArr)\b\s*\(|(?:const|let|var)\s+(str|strArr)\b\s*[:=])/;

/** Replace comments with spaces, preserving string contents + newlines. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  let inStr: string | null = null;
  while (i < len) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      if (c === "\\") {
        out += c + (next ?? "");
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < len && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function isExcluded(relFromSrc: string): boolean {
  const parts = relFromSrc.split(path.sep);
  if (parts.includes("lib")) return true;
  if (parts.includes("__tests__")) return true;
  if (parts.some((p) => p === "test-utils")) return true;
  const base = parts[parts.length - 1];
  if (base.endsWith(".d.ts")) return true;
  if (base === "setup.ts") return true;
  return false;
}

function collectSources(dir: string, srcRoot: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectSources(abs, srcRoot, acc);
      continue;
    }
    if (!e.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const relFromSrc = path.relative(srcRoot, abs);
    if (isExcluded(relFromSrc)) continue;
    acc.push(abs);
  }
}

export function pass23ViewToolLocalStr(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  const srcDir = path.join(pluginDir, VIEW_TOOL_SRC_REL);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return;

  const files: string[] = [];
  collectSources(srcDir, srcDir, files);
  files.sort();

  for (const abs of files) {
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = stripComments(body).split("\n");
    const relFile = path.join(VIEW_TOOL_SRC_REL, path.relative(srcDir, abs));
    for (let li = 0; li < lines.length; li++) {
      const m = LOCAL_STR_DECL.exec(lines[li]);
      if (m) {
        const name = m[1] ?? m[2] ?? "str";
        findings.push({
          code: "E38",
          severity: "warning",
          plugin: pluginSlug,
          file: relFile,
          line: li + 1,
          col: (m.index ?? 0) + 1,
          message:
            `View-tool source re-authors a local \`${name}()\` coercer. A ` +
            `hand-rolled string-only \`str()\` drops a numeric id (an unquoted ` +
            `YAML \`issue_id: 789\` parses as a number) → the id arrives "" → ` +
            `the button that reads it silently no-ops (the posthog dead-button ` +
            `incident). Import \`{ str, idStr, strArr, isOpenableUrl }\` from the ` +
            `scaffolded \`./lib/payload.js\` (handler) / \`../lib/payload.js\` ` +
            `(component) and use \`idStr()\` for every identifier field. See the ` +
            `accessors at plugins/agntux-build/canonical/ui-handlers/_template/` +
            `view-tool/src/lib/payload.ts.`,
        });
      }
    }
  }
}
