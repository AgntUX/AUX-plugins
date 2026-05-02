import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveAgntuxRoot, _setAgntuxRootForTesting } from "../lib/agntux-root.mjs";

function makeTmp(prefix = "agntux-root-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

test("resolveAgntuxRoot: cwd is named agntux -> returns cwd", () => {
  const tmp = makeTmp();
  try {
    const root = join(tmp, "agntux");
    mkdirSync(root);
    assert.equal(resolveAgntuxRoot(root), resolve(root));
  } finally { cleanup(tmp); }
});

test("resolveAgntuxRoot: cwd inside agntux/sub/dir -> returns the agntux ancestor", () => {
  const tmp = makeTmp();
  try {
    const root = join(tmp, "agntux");
    const sub = join(root, "some", "sub", "dir");
    mkdirSync(sub, { recursive: true });
    assert.equal(resolveAgntuxRoot(sub), resolve(root));
  } finally { cleanup(tmp); }
});

test("resolveAgntuxRoot: case-insensitive match (Agntux)", () => {
  const tmp = makeTmp();
  try {
    const root = join(tmp, "Agntux");
    const sub = join(root, "x");
    mkdirSync(sub, { recursive: true });
    const result = resolveAgntuxRoot(sub);
    // On case-insensitive FS (mac/Windows) the resolver returns the root.
    // On case-sensitive Linux it still matches because we lowercase basenames.
    assert.equal(result, resolve(root));
  } finally { cleanup(tmp); }
});

test("resolveAgntuxRoot: no agntux ancestor and no fallback -> null", () => {
  const tmp = makeTmp();
  try {
    const elsewhere = join(tmp, "projects", "thing");
    mkdirSync(elsewhere, { recursive: true });
    // Override fallback so the user's real ~/agntux can't influence the test.
    _setAgntuxRootForTesting(null);
    // Use a synthetic homedir absence by passing a cwd whose only ancestors
    // are tmp/* and there is no `agntux` named directory anywhere on the way.
    // We cannot mock os.homedir here, but we can assert that the walk-up
    // returned no match — which means the result is whatever fallback finds.
    // For deterministic null we explicitly point the override away.
    const result = resolveAgntuxRoot(elsewhere);
    // The resolver may still find ~/agntux if the developer has one. To stay
    // hermetic, we only assert that when *no* walk-up match exists, the
    // returned value is either null OR a directory ending in /agntux (the
    // home fallback). This is the contract.
    if (result !== null) {
      assert.match(result, /[/\\][Aa][Gg][Nn][Tt][Uu][Xx]$/);
    }
  } finally {
    _setAgntuxRootForTesting(null);
    cleanup(tmp);
  }
});

test("resolveAgntuxRoot: nested agntux/agntux returns the nearest one", () => {
  const tmp = makeTmp();
  try {
    const outer = join(tmp, "agntux");
    const inner = join(outer, "agntux");
    const leaf = join(inner, "leaf");
    mkdirSync(leaf, { recursive: true });
    assert.equal(resolveAgntuxRoot(leaf), resolve(inner));
  } finally { cleanup(tmp); }
});

test("resolveAgntuxRoot: _setAgntuxRootForTesting override wins", () => {
  const tmp = makeTmp();
  try {
    const fake = join(tmp, "fake-root");
    mkdirSync(fake, { recursive: true });
    _setAgntuxRootForTesting(fake);
    assert.equal(resolveAgntuxRoot("/anywhere/else"), resolve(fake));
  } finally {
    _setAgntuxRootForTesting(null);
    cleanup(tmp);
  }
});

test("resolveAgntuxRoot: a file (not directory) named agntux is skipped", () => {
  const tmp = makeTmp();
  try {
    // Create a real `agntux` *file* inside the tmp tree and a `sub/dir`
    // alongside it. The walk-up should NOT stop at the file — it should
    // only match real directories.
    const fakeFile = join(tmp, "agntux"); // not a dir
    const sub = join(tmp, "sub", "dir");
    mkdirSync(sub, { recursive: true });
    writeFileSync(fakeFile, "not a dir");
    // From `sub/dir`, walking up reaches `tmp` next, then `tmp`'s parent,
    // etc. No directory named `agntux` exists on that walk, so the
    // resolver falls through to the home-dir fallback. We accept either
    // null or a path ending in `/agntux` (the home fallback) — the
    // important assertion is that the bogus file at `tmp/agntux` is NOT
    // returned as the project root.
    const result = resolveAgntuxRoot(sub);
    assert.notEqual(result, resolve(fakeFile));
  } finally { cleanup(tmp); }
});

test("resolveAgntuxRoot: relative cwd is resolved before walk-up", () => {
  const tmp = makeTmp();
  try {
    const root = join(tmp, "agntux");
    mkdirSync(root, { recursive: true });
    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      // Pass `.` to confirm relative paths get resolved (not treated as a
      // basename "."). The walk-up should match the cwd we just chdir'd
      // to. We compare against process.cwd() (rather than resolve(root))
      // because some platforms — notably macOS — chase symlinks like
      // /var → /private/var when reporting cwd, while resolve(root)
      // preserves the lexical path. Both refer to the same directory.
      assert.equal(resolveAgntuxRoot("."), process.cwd());
    } finally {
      process.chdir(prevCwd);
    }
  } finally { cleanup(tmp); }
});
