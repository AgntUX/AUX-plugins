#!/usr/bin/env node
// PreToolUse: validate Write/Edit operations on
// <agntux project root>/data/learnings/{slug}/sync.md for cursor-shape
// regressions before they hit disk. Generic across every ingest plugin —
// each `sync.md` is the canonical per-plugin sync-state file specified by
// P3a, and the cursor invariants below apply regardless of source.
//
// Generic invariants (apply to ALL plugins):
//
//   1. The `- cursor:` line carries a parseable value. If the contract
//      declares `cursor_semantics` mentioning a JSON map, the value MUST
//      parse as JSON.
//   2. `- discovery_ts:` (if present) is monotonic — the new value is not
//      strictly less than the prior on-disk value. Regressions are nearly
//      always a bug (a re-emit lost the high-water-mark) and would re-fetch
//      already-processed items.
//   3. JSON-map cursors: no key present in the prior cursor map disappears
//      from the new one without an explicit eviction log. The hook can't
//      see the eviction log directly — instead it requires that the new
//      map either preserve every prior key OR add a `slack-thread-evicted`
//      / `*-evicted` entry to the errors list with the dropped key.
//   4. JSON-map cursors: a key that had a non-null value in the prior map
//      MUST NOT regress to `null` in the new map. That's the bootstrap
//      sentinel; once advanced, it stays advanced.
//
// What this hook does NOT do (yet): enforce per-plugin shape regexes
// (e.g., slack `C…/D…/G…` channel-id format, gmail history-page integer).
// Those would need a structured `cursor_semantics_v2` field on the
// contract; today it's prose. When that lands, this hook dispatches on
// `contract.cursor_semantics_v2.key_pattern` and `value_pattern`.
//
// Failure mode: exit 2 with a stderr message that reads like a runbook —
// concrete advice the agent can act on. Same idiom as validate-schema.mjs.

import { readFileSync, existsSync } from "node:fs";
import { join, basename, dirname, sep } from "node:path";
import { resolveAgntuxRoot } from "./lib/agntux-root.mjs";

const AGNTUX_ROOT = resolveAgntuxRoot();
const LEARNINGS_ROOT = AGNTUX_ROOT ? join(AGNTUX_ROOT, "data", "learnings") : null;
const SCHEMA_CONTRACTS_DIR = AGNTUX_ROOT
  ? join(AGNTUX_ROOT, "data", "schema", "contracts")
  : null;

function readToolContext() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function pass() {
  process.exit(0);
}

function reject(reason) {
  process.stderr.write(`cursor-validator: ${reason}\n`);
  process.exit(2);
}

function inScope(filePath) {
  if (typeof filePath !== "string") return null;
  if (!LEARNINGS_ROOT) return null;
  if (basename(filePath) !== "sync.md") return null;
  if (!filePath.startsWith(LEARNINGS_ROOT + sep)) return null;
  const parent = dirname(filePath);
  if (dirname(parent) !== LEARNINGS_ROOT) return null;
  return basename(parent); // the plugin slug
}

function readPostWriteContent(ctx) {
  // Same idiom as validate-schema.mjs:readContent — derive what the file
  // body WILL be after the pending Write/Edit applies.
  const input = ctx.tool_input || {};
  if (typeof input.content === "string") return input.content;
  if (typeof input.new_string !== "string") return null;
  if (typeof input.old_string !== "string") return null;
  if (typeof input.file_path !== "string" || !existsSync(input.file_path)) {
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

// Extract the cursor / discovery_ts / errors body lines. We don't need a
// full YAML parser — the body shape is a flat top-level list of `- key:
// value` lines plus a single nested `errors:` block. Regex extraction is
// robust enough.
function extractField(content, field) {
  const re = new RegExp(`^- ${field}:\\s*(.*)$`, "m");
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function extractErrorsBlock(content) {
  // Returns concatenated error-entry text so we can search for eviction
  // markers without trying to parse the nested list properly.
  const idx = content.indexOf("\n- errors:");
  if (idx < 0) return "";
  const slice = content.slice(idx + 1);
  const next = slice.search(/\n- [a-zA-Z_][^:]*:/m);
  return next < 0 ? slice : slice.slice(0, next);
}

function readContractCursorSemantics(pluginSlug) {
  if (!SCHEMA_CONTRACTS_DIR || !pluginSlug) return null;
  const path = join(SCHEMA_CONTRACTS_DIR, `${pluginSlug}.md`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!fmMatch) return null;
    // Look for `cursor_semantics:` either as a flow scalar or quoted string.
    const m = fmMatch[1].match(/^cursor_semantics:\s*(["']?)(.*)\1\s*$/m);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function tryParseJsonObject(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(t);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function compareMonotonic(prev, next) {
  // Numeric-looking strings (Slack-style ts), ISO dates, plain ints — all
  // sort lexicographically in the right order EXCEPT mixed lengths. We
  // normalise: try parseFloat first (handles `1778161504.986099`), fall
  // back to lexicographic.
  if (prev === null || prev === undefined || prev === "") return 0;
  if (next === null || next === undefined || next === "") return 0;
  const pf = Number(prev);
  const nf = Number(next);
  if (Number.isFinite(pf) && Number.isFinite(nf)) {
    if (pf < nf) return -1;
    if (pf > nf) return 1;
    return 0;
  }
  if (String(prev) < String(next)) return -1;
  if (String(prev) > String(next)) return 1;
  return 0;
}

function main() {
  const ctx = readToolContext();
  if (!ctx) pass();
  const tool = ctx.tool_name;
  if (tool !== "Write" && tool !== "Edit") pass();

  const filePath = ctx.tool_input?.file_path;
  const pluginSlug = inScope(filePath);
  if (!pluginSlug) pass();

  const newContent = readPostWriteContent(ctx);
  if (newContent === null) pass(); // can't reason about partial edits

  const newCursorRaw = extractField(newContent, "cursor");
  const newDiscoveryRaw = extractField(newContent, "discovery_ts");

  const semantics = readContractCursorSemantics(pluginSlug) || "";
  const expectsJsonMap = /JSON\s+map|\{.*\}/i.test(semantics) || /^\{/.test(newCursorRaw || "");

  // Generic check 1: cursor value parses if a JSON map is expected.
  let newCursorMap = null;
  if (expectsJsonMap) {
    newCursorMap = tryParseJsonObject(newCursorRaw);
    if (newCursorMap === null && newCursorRaw && newCursorRaw !== "{}" && newCursorRaw !== "null") {
      reject(
        `${pluginSlug}/sync.md → cursor is not a parseable JSON object. The contract's cursor_semantics declares a JSON map. Make the cursor a single-line JSON object (use \`JSON.stringify(map)\`), then retry.`
      );
    }
  }

  // No prior file → nothing to diff against. The other generic checks
  // require the prior on-disk content.
  if (!existsSync(filePath)) pass();
  let prior;
  try {
    prior = readFileSync(filePath, "utf8");
  } catch {
    pass();
  }

  // Generic check 2: discovery_ts monotonic.
  const oldDiscoveryRaw = extractField(prior, "discovery_ts");
  if (
    oldDiscoveryRaw &&
    oldDiscoveryRaw !== "null" &&
    newDiscoveryRaw &&
    newDiscoveryRaw !== "null"
  ) {
    if (compareMonotonic(oldDiscoveryRaw, newDiscoveryRaw) > 0) {
      reject(
        `${pluginSlug}/sync.md → discovery_ts regressed from \`${oldDiscoveryRaw}\` to \`${newDiscoveryRaw}\`. The discovery low-water-mark must be monotonic — re-fetching items already covered burns API budget and re-raises auto-resolved actions. If you intentionally need to rewind (rare; a search query was wrong and missed items), surface this to the user before retrying.`
      );
    }
  }

  // Generic check 5 (C1 backstop): no cursor value is in the future.
  // Catches the permalink-extraction failure mode — most permalink-derived ts
  // values are either way-past or way-future relative to the run wall-clock.
  // The hook can't verify "ts came from a real Message_ts: field" without the
  // fetch buffer (which lives in a different process), but the future-ts
  // check costs nothing and catches the common bad-write shape.
  if (newCursorMap !== null) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Slack ts values are seconds.microseconds (e.g. "1778241733.129779").
    // Gmail historyId-style cursors are integers but typically NOT seconds-
    // since-epoch — they're opaque. Apply the future-ts check only to values
    // that look like Slack-style float-seconds.
    const slackTsLike = /^\d{10}(\.\d+)?$/;
    const future = [];
    // 5-minute clock-skew tolerance keeps NTP wobble out of the rejection set.
    const ceiling = nowSeconds + 5 * 60;
    for (const [key, value] of Object.entries(newCursorMap)) {
      if (typeof value !== "string") continue;
      if (!slackTsLike.test(value)) continue;
      if (Number(value) > ceiling) future.push({ key, value });
    }
    if (future.length > 0) {
      reject(
        `${pluginSlug}/sync.md → cursor key${future.length > 1 ? "s" : ""} ${future
          .slice(0, 3)
          .map(({ key, value }) => `\`${key}\` = \`${value}\``)
          .join(", ")}${future.length > 3 ? ` (+${future.length - 3} more)` : ""} carry future timestamps (> now() + 5 min). The most common cause is a permalink-extracted ts being written as a cursor — permalinks contain ts values from messages in OTHER channels and are not valid cursors for the current key. Per the Slack fetch override's "cursor-advance discipline": never advance to a ts not seen in a real \`Message_ts:\` field of a fetched message. Re-derive the cursor from the run's fetch buffer and retry.`
      );
    }
  }

  // Generic checks 3 + 4: JSON-map keys preserved + non-null values stay non-null.
  if (newCursorMap !== null) {
    const oldCursorRaw = extractField(prior, "cursor");
    const oldCursorMap = tryParseJsonObject(oldCursorRaw);
    if (oldCursorMap !== null) {
      const errorsBlock = extractErrorsBlock(newContent);
      const evictionMarker = /(\bevict|evicted\b)/i;
      const reasonsErrorsAcceptsEvictions = evictionMarker.test(errorsBlock);

      const dropped = [];
      const regressedToNull = [];
      for (const key of Object.keys(oldCursorMap)) {
        if (!(key in newCursorMap)) {
          dropped.push(key);
          continue;
        }
        if (oldCursorMap[key] !== null && newCursorMap[key] === null) {
          regressedToNull.push(key);
        }
      }

      if (dropped.length > 0 && !reasonsErrorsAcceptsEvictions) {
        reject(
          `${pluginSlug}/sync.md → cursor map silently dropped key${dropped.length > 1 ? "s" : ""} ${dropped
            .slice(0, 3)
            .map((k) => `\`${k}\``)
            .join(", ")}${dropped.length > 3 ? ` (+${dropped.length - 3} more)` : ""}. Either preserve every prior key in the new map, or add an entry to \`errors:\` whose text contains the word \`evicted\` so the eviction is auditable. (Slack thread eviction at 30 days inactivity is the canonical case — log a \`slack-thread-evicted\` line with the key and ts.)`
        );
      }

      if (regressedToNull.length > 0) {
        reject(
          `${pluginSlug}/sync.md → cursor key${regressedToNull.length > 1 ? "s" : ""} ${regressedToNull
            .slice(0, 3)
            .map((k) => `\`${k}\``)
            .join(", ")}${regressedToNull.length > 3 ? ` (+${regressedToNull.length - 3} more)` : ""} regressed from a non-null value to \`null\`. Once a cursor is advanced past bootstrap, it stays advanced. If the per-channel/per-thread fetch failed, leave the cursor at its prior value and log a \`source\` error — do not re-set to null.`
        );
      }
    }
  }

  pass();
}

main();
