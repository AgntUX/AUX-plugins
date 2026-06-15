/**
 * lint-host-prompt-slash.ts — pass 18: a plugin must never hand the host a
 * SLASH COMMAND programmatically. Suggested-action `host_prompt` envelopes,
 * hardcoded `sendFollowUpMessage(...)` calls, and view-tool description
 * "trigger phrases" must all be NATURAL-LANGUAGE descriptions
 * (`Use the <plugin-slug> plugin to …`).
 *
 * Why this exists
 * ---------------
 * The host only fires a slash command when the USER manually types `/` and
 * picks it from the menu. A slash command sent programmatically — dispatched by
 * agntux-core's hub via `client.sendFollowUpMessage(host_prompt)`, or matched by
 * the host's tool selector against a description's trigger phrases — is inert
 * text the host cannot route, so the button silently does nothing (the
 * 2026-06-15 "clicking a Jira action does nothing" class). The fix is to
 * describe the action; the host's LLM then routes it to the right view tool.
 *
 * Findings
 * --------
 *   E33 (error) — a slash-command host prompt. One of:
 *     - a `host_prompt:` value beginning with `/` in any skills markdown file
 *       (rendered tree or `_overrides/` source), or
 *     - a string literal beginning with `/agntux` (space- or hyphen-terminated)
 *       inside a view-tool component — i.e. a `sendFollowUpMessage("/agntux …")`
 *       argument or a backticked `/agntux …` trigger phrase in a `description`.
 *
 * Scope / non-flags
 * -----------------
 *   - view-tool/src only (excludes lib/, __tests__/, *.d.ts, setup.ts), comment-
 *     scrubbed and string-preserving (same scrubber as passes 16/17) so a slash
 *     mentioned only in a `//` comment does not trip.
 *   - Requires a quote/backtick IMMEDIATELY before `/agntux`, so it does NOT
 *     flag: resource URIs (`ui://agntux-core/triage` — the slash is mid-string),
 *     or bare JSX display text that tells the user what to type
 *     (`Run /agntux onboard`, `/agntux-teams onboard:member` — no opening quote).
 *   - skills markdown flags ONLY `host_prompt:` values, never prose that
 *     references a user-typed command (e.g. "re-run `/agntux-slack`").
 *   - listing.yaml `supported_prompts` (the host's user-typed slash surface) is
 *     never scanned — it is required to be slash form.
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
const SKILLS_REL = "skills";

// Programmatic-slash shapes flagged in view-tool components. Scanned against
// the whole comment-scrubbed file (not line-by-line) so a wrapped
// `sendFollowUpMessage(` whose argument is on the next line is still caught.
//
//   (1) a slash literal handed to sendFollowUpMessage — `/agntux …` or any
//       other slash command — which the host can't route, or
//   (2) a hyphenated plugin-slug slash command literal (`/agntux-slack …`,
//       `/agntux-jira …`) in any string/backtick. This form only ever appears
//       as programmatic suggested-action / trigger-phrase text, so it is
//       ALWAYS a defect in a component — flagged regardless of context.
//
// Both require a quote/backtick immediately before the slash, so mid-string
// slashes (`ui://agntux-…`) never match. The BARE `/agntux ` form
// (e.g. `/agntux triage`) is the user-typed skill surface and is NOT flagged on
// its own (a description may say "when the user types `/agntux triage`"); the
// bare form is only a defect inside a sendFollowUpMessage arg, which (1) catches.
const SEND_SLASH = /sendFollowUpMessage\s*\(\s*['"`]\s*\//g;
const SLUG_SLASH = /['"`]\/agntux-[a-z]/g;

// A YAML `host_prompt:` key (at line start / indented) whose value begins with a
// slash — quoted, unquoted, or with a leading space. Anchored to the key so doc
// prose like `the host_prompt: "/x" example is wrong` (key not at line start) is
// not flagged. A block-scalar `host_prompt: |` with the slash on a following
// line is a nonsensical shape for a short prompt and is intentionally unhandled.
const SLASH_HOST_PROMPT = /^\s*host_prompt:\s*["'`]?\s*\//;

/** 1-based {line, col} of a character offset in `body`. */
function posOf(body: string, index: number): { line: number; col: number } {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < index; i++) {
    if (body[i] === "\n") {
      line++;
      lastNl = i;
    }
  }
  return { line, col: index - lastNl };
}

/** Strip comments, preserve string contents + newlines (see pass 17). */
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

function isExcludedSrc(relFromSrc: string): boolean {
  const parts = relFromSrc.split(path.sep);
  if (parts.includes("lib")) return true;
  if (parts.includes("__tests__")) return true;
  if (parts.some((p) => p === "test-utils")) return true;
  const base = parts[parts.length - 1];
  if (base.endsWith(".d.ts")) return true;
  if (base === "setup.ts") return true;
  return false;
}

function collect(
  dir: string,
  root: string,
  match: RegExp,
  acc: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      collect(abs, root, match, acc);
      continue;
    }
    if (!e.isFile()) continue;
    if (!match.test(e.name)) continue;
    acc.push(abs);
  }
}

export function pass18HostPromptSlash(
  pluginSlug: string,
  pluginDir: string,
  _repoRoot: string,
  findings: Finding[],
): void {
  // (a) view-tool components — sendFollowUpMessage args + description trigger phrases.
  const srcDir = path.join(pluginDir, VIEW_TOOL_SRC_REL);
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    const files: string[] = [];
    collect(srcDir, srcDir, /\.(ts|tsx)$/, files);
    files.sort();
    for (const abs of files) {
      const relFromSrc = path.relative(srcDir, abs);
      if (isExcludedSrc(relFromSrc)) continue;
      let body: string;
      try {
        body = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const scrubbed = stripComments(body);
      const relFile = path.join(VIEW_TOOL_SRC_REL, relFromSrc);
      // Whole-file scan (handles multiline calls); one finding per offending line.
      const flaggedLines = new Set<number>();
      for (const re of [SEND_SLASH, SLUG_SLASH]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(scrubbed)) !== null) {
          const { line, col } = posOf(scrubbed, m.index);
          if (flaggedLines.has(line)) continue;
          flaggedLines.add(line);
          findings.push({
            code: "E33",
            severity: "error",
            plugin: pluginSlug,
            file: relFile,
            line,
            col,
            message:
              `Slash-command prompt in a view-tool component. The host only ` +
              `fires a slash command when the user manually types "/"; one sent ` +
              `programmatically (sendFollowUpMessage arg, or a description ` +
              `"trigger phrase" the host matches against) is inert text the host ` +
              `cannot route, so the button does nothing. Use a natural-language ` +
              `description instead: "Use the ${pluginSlug} plugin to …" (see ` +
              `plugins/agntux-build/canonical/prompts/agntux-core-hub-contract.md ` +
              `and agents/ingest-prompt-author.md).`,
          });
        }
      }
    }
  }

  // (b) skills markdown — host_prompt: values must not be slash commands.
  const skillsDir = path.join(pluginDir, SKILLS_REL);
  if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
    const mdFiles: string[] = [];
    collect(skillsDir, skillsDir, /\.md$/, mdFiles);
    mdFiles.sort();
    for (const abs of mdFiles) {
      let body: string;
      try {
        body = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const lines = body.split("\n");
      const relFile = path.join(SKILLS_REL, path.relative(skillsDir, abs));
      for (let li = 0; li < lines.length; li++) {
        const m = SLASH_HOST_PROMPT.exec(lines[li]);
        if (m) {
          findings.push({
            code: "E33",
            severity: "error",
            plugin: pluginSlug,
            file: relFile,
            line: li + 1,
            col: (m.index ?? 0) + 1,
            message:
              `host_prompt is a slash command. Suggested-action host_prompts are ` +
              `dispatched verbatim by agntux-core via sendFollowUpMessage, so a ` +
              `slash command silently fails to route. Write a natural-language ` +
              `description: host_prompt: "Use the ${pluginSlug} plugin to ` +
              `{imperative} for action {id}". (Edit the _overrides/ source, then ` +
              `re-render — do not hand-edit the rendered reference tree.)`,
          });
        }
      }
    }
  }
}
