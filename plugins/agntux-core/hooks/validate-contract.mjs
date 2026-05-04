#!/usr/bin/env node
// PreToolUse: validate Write/Edit operations on per-plugin contract files
// (`<agntux project root>/data/schema/contracts/*.md`).
//
// The contract is the architect's authored permit for a plugin. The runtime
// validator (`validate-schema.mjs`) enforces frontmatter + enum membership at
// action/entity write time, but does NOT see the contract markdown until much
// later — by then the plugin has already tried to write rejected actions.
// This hook closes the upstream gap: a contract authored with the broken
// "## reason_class additions" framing (sub-tags listed per action_class) is
// rejected at PR / authoring time so the broken values never reach a real
// sync run.
//
// Rules enforced (Plan §1.D.2):
//   1. The contract MUST NOT contain a top-level `## reason_class additions`
//      header. That section listed sub-tags (`dm`, `mention`, `escalation`,
//      ...) as if they were `reason_class` values; they are not. The fix is
//      to rename the section `## reason_detail prefixes`.
//   2. If the contract has a `## reason_class enum` block, every backticked
//      value in that block MUST be in `schema.lock.json → action_classes`.
//      Anything else is a stale or invented value the validator will reject.
//   3. Any header containing the substring `reason_class` followed by a
//      `value-by-action_class` pattern (`H3` like `For **\`<class>\`**:` then
//      bullets) is the same defect under a renamed header — flag it.
//
// On rejection, exits with code 2 and writes a one-line reason to stderr;
// the host shows it to the agent so it can correct and retry. Pre-bootstrap
// (no schema.lock.json) passes through silently.

import { readFileSync, existsSync } from "node:fs";
import { join, basename, sep } from "node:path";
import { readSchemaLock } from "./lib/schema-lock.mjs";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";

const AGNTUX_ROOT = resolveAgntuxRoot();
const CONTRACTS_ROOT = AGNTUX_ROOT
  ? join(AGNTUX_ROOT, "data", "schema", "contracts")
  : null;

function readToolContext() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function reject(reason) {
  process.stderr.write(`contract-validator: ${reason}\n`);
  process.exit(2);
}

function pass() {
  process.exit(0);
}

function inScope(filePath) {
  if (typeof filePath !== "string") return false;
  if (!CONTRACTS_ROOT) return false;
  if (!filePath.startsWith(CONTRACTS_ROOT + sep)) return false;
  if (!filePath.endsWith(".md")) return false;
  return true;
}

function readContent(ctx) {
  // Same merge logic as validate-schema.mjs: PreToolUse runs BEFORE the write,
  // so for Edit we must reconstruct the post-write body.
  const input = ctx.tool_input || {};
  if (typeof input.content === "string") return input.content;
  if (typeof input.new_string !== "string") return null;
  if (typeof input.old_string !== "string") return null;
  if (typeof input.file_path !== "string" || !existsSync(input.file_path)) {
    if (input.new_string.startsWith("---\n")) return input.new_string;
    return null;
  }
  try {
    const current = readFileSync(input.file_path, "utf8");
    if (input.replace_all) {
      return current.split(input.old_string).join(input.new_string);
    }
    return current.replace(input.old_string, input.new_string);
  } catch {
    return null;
  }
}

// Strip Markdown fenced code blocks (```...```) so a documentation example of
// the broken framing inside a code fence does not trigger the linter on the
// contract file itself.
function stripFences(content) {
  return content.replace(/```[\s\S]*?```/g, "");
}

// Note: leading indent uses `[ \t]` (horizontal whitespace) rather than `\s`
// because `\s` matches newlines, which causes the regex to consume the newline
// before a heading and shifts `match.index` off the heading character. That
// then breaks "slice from after this header to next header" walks.
const REASON_CLASS_ADDITIONS_RE = /^[ \t]{0,3}#{1,6}[ \t]+reason_class[ \t]+additions\b/im;
const REASON_CLASS_ENUM_RE = /^[ \t]{0,3}#{1,6}[ \t]+reason_class[ \t]+enum\b/im;
const REASON_CLASS_HEADER_RE = /^[ \t]{0,3}#{1,6}[ \t]+([^\n]*reason_class[^\n]*)$/gim;

// Detect a `For **`<class>`**:` style line followed by a bullet list — the
// broken value-by-action_class shape.
const VALUE_BY_CLASS_HEADING_RE = /^[ \t]{0,3}For\s+\*\*`[a-z][a-z0-9-]*`\*\*\s*:\s*$/m;

function checkBrokenAdditionsHeader(content) {
  if (REASON_CLASS_ADDITIONS_RE.test(content)) {
    return (
      "contract contains a `## reason_class additions` section — that framing is broken. " +
      "Sub-tags like `dm`, `mention`, `escalation` are NOT valid `reason_class` values; " +
      "they belong inside `reason_detail`. Rename the section to `## reason_detail prefixes` " +
      "and put the tags in square brackets (e.g. `[dm]`). See `agents/data-architect.md → ## reason_class discipline`."
    );
  }
  return null;
}

function checkValueByClassPatternUnderReasonClassHeader(content) {
  // Walk every header that mentions `reason_class`. For each, capture its body
  // (until the next header) and look for `For **`<class>`**:` followed by a
  // bullet list. That's the broken value-by-action_class shape regardless of
  // the renamed header text — catches drift like `## reason_class extras`.
  const headers = [];
  let m;
  REASON_CLASS_HEADER_RE.lastIndex = 0;
  while ((m = REASON_CLASS_HEADER_RE.exec(content)) !== null) {
    headers.push({ index: m.index, text: m[1] });
  }
  if (headers.length === 0) return null;

  // The `## reason_class enum` header is the legitimate one; sub-tag patterns
  // under it would be a different defect (caught by the enum-membership check).
  const sectionRe = /^[ \t]{0,3}#{1,6}[ \t]+/m;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (/reason_class\s+enum\b/i.test(h.text)) continue;
    // Skip past the header line (search starts AFTER the newline that ends it)
    // so the same header doesn't match itself as the next section boundary.
    const headerLineEnd = content.indexOf("\n", h.index);
    const sliceStart = headerLineEnd === -1 ? content.length : headerLineEnd + 1;
    const after = content.slice(sliceStart);
    const nextHeaderRel = after.search(sectionRe);
    const body = nextHeaderRel === -1 ? after : after.slice(0, nextHeaderRel);
    if (VALUE_BY_CLASS_HEADING_RE.test(body) && /\n\s*-\s+`/.test(body)) {
      return (
        `contract section \`${h.text.trim()}\` uses the broken value-by-action_class shape ` +
        `(\`For **\`<class>\`**:\` followed by sub-tag bullets). Those sub-tags are NOT ` +
        `valid \`reason_class\` values — \`reason_class\` is the closed action_class enum. ` +
        `Move them to \`## reason_detail prefixes\` with square-bracket tags. See ` +
        `\`agents/data-architect.md → ## reason_class discipline\`.`
      );
    }
  }
  return null;
}

function checkReasonClassEnumMembership(content, lock) {
  if (!lock || !Array.isArray(lock.action_classes)) return null;
  if (!REASON_CLASS_ENUM_RE.test(content)) return null;

  // Extract the body of the `## reason_class enum` section (until the next
  // header). Slice from after the header line so the same header doesn't
  // match itself when searching for the next section boundary.
  const headerMatch = content.match(REASON_CLASS_ENUM_RE);
  if (!headerMatch) return null;
  const headerStart = content.indexOf(headerMatch[0]);
  const headerLineEnd = content.indexOf("\n", headerStart);
  const sliceStart = headerLineEnd === -1 ? content.length : headerLineEnd + 1;
  const after = content.slice(sliceStart);
  const nextHeaderRel = after.search(/^[ \t]{0,3}#{1,6}[ \t]+/m);
  const body = nextHeaderRel === -1 ? after : after.slice(0, nextHeaderRel);

  const allowed = new Set(lock.action_classes);
  // Pull every backticked single-token value from the body.
  const tokens = [...body.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]);
  // Filter to tokens that look like action_class candidates. `reason_class`,
  // `reason_detail`, `schema.lock.json`, `action_classes`, etc. are
  // doc-references, not enum values; skip them.
  const reservedRefs = new Set([
    "reason_class",
    "reason_detail",
    "action_classes",
    "schema",
    "lock",
    "json",
    "schema.lock.json",
    "validate-schema.mjs",
    "validate-contract.mjs",
    "marketplace",
    "listing.yaml",
    "proposed_schema",
  ]);
  const candidates = tokens.filter((t) => !reservedRefs.has(t));
  const offenders = candidates.filter((t) => !allowed.has(t));
  if (offenders.length > 0) {
    const unique = [...new Set(offenders)];
    return (
      `contract \`## reason_class enum\` lists value(s) not in \`schema.lock.json → action_classes\`: ` +
      `${unique.map((s) => "`" + s + "`").join(", ")}. ` +
      `Allowed: ${lock.action_classes.map((s) => "`" + s + "`").join(", ")}. ` +
      `Either remove the offending value(s) or add them to \`proposed_schema.action_classes\` ` +
      `and re-run \`/agntux-schema review\` so the architect lands them in the lock.`
    );
  }
  return null;
}

function main() {
  const ctx = readToolContext();
  if (!ctx) pass();
  const tool = ctx.tool_name;
  if (tool !== "Write" && tool !== "Edit") pass();

  const filePath = ctx.tool_input?.file_path;
  if (!inScope(filePath)) pass();

  const content = readContent(ctx);
  if (content === null) pass();
  const stripped = stripFences(content);

  // Rule 1 — broken `## reason_class additions` header.
  const r1 = checkBrokenAdditionsHeader(stripped);
  if (r1) reject(`${basename(filePath)}: ${r1}`);

  // Rule 3 — value-by-action_class shape under any reason_class-named header
  // (catches drift from a rename without a real fix).
  const r3 = checkValueByClassPatternUnderReasonClassHeader(stripped);
  if (r3) reject(`${basename(filePath)}: ${r3}`);

  // Rule 2 — every value in `## reason_class enum` MUST be in the lock.
  // Skip when the lock is unreadable / pre-bootstrap; the runtime validator
  // would surface that separately and we don't want to double-block.
  let lock = null;
  try {
    lock = readSchemaLock();
  } catch {
    // malformed lock — let validate-schema.mjs handle that diagnostic; pass here.
  }
  if (lock) {
    const r2 = checkReasonClassEnumMembership(stripped, lock);
    if (r2) reject(`${basename(filePath)}: ${r2}`);
  }

  pass();
}

main();
