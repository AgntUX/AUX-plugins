// Tiny flag parser for agntux-build-test.
//
// - `--key value` → { key: 'value' }
// - `--multi-word value` → { multiWord: 'value' }
// - For flags listed in `schema.boolean`, presence sets true.
// - `-h` / `--help` are always parsed as `{ help: true }`.
// - Throws on positional args or missing values.
//
// Lifted from agntux-plugin-dev/plugins/plugin-toolkit/test-harness/src/parse-flags.mjs.

export function parseFlags(args, schema = {}) {
  const out = {};
  const booleans = new Set(schema.boolean ?? []);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${a}`);
    }
    let key = a.slice(2);
    let negated = false;
    if (key.startsWith("no-")) {
      negated = true;
      key = key.slice(3);
    }
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (booleans.has(camel)) {
      out[camel] = !negated;
      continue;
    }
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    if (next === "") {
      throw new Error(`empty value for --${key}`);
    }
    out[camel] = next;
    i++;
  }
  return out;
}

export function required(flags, key) {
  const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (flags[camel] === undefined || flags[camel] === "") {
    throw new Error(`missing required flag: --${key}`);
  }
  return flags[camel];
}

export function parseIntFlag(value, name, fallback) {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`--${name} must be an integer (got '${value}')`);
  }
  return n;
}
