import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — .mjs has no .d.ts
import { transformPackageJson } from "./sync-agntux-build-toolchain.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

describe("transformPackageJson", () => {
  it("strips lifecycle scripts + devDependencies, keeps the resolution surface", () => {
    const out = JSON.parse(
      transformPackageJson(
        JSON.stringify({
          name: "@agntux/ui-primitives",
          version: "0.1.1",
          main: "dist/index.js",
          types: "dist/index.d.ts",
          exports: { ".": { import: "./dist/index.js" } },
          scripts: { build: "tsc", prepare: "tsc" },
          dependencies: { yaml: "^2" },
          peerDependencies: { react: "^18" },
          devDependencies: { typescript: "^5" },
        }),
      ),
    );
    // The dist is pre-built + shipped — a contributor's npm install of the
    // file: dep must NOT run `prepare: tsc` (the round-2 "tsc: command not
    // found" failure).
    expect(out.scripts).toBeUndefined();
    expect(out.devDependencies).toBeUndefined();
    // resolution + runtime surface preserved
    expect(out.main).toBe("dist/index.js");
    expect(out.types).toBe("dist/index.d.ts");
    expect(out.exports["."].import).toBe("./dist/index.js");
    expect(out.dependencies).toEqual({ yaml: "^2" });
    expect(out.peerDependencies).toEqual({ react: "^18" });
  });
});

describe("bundle sync guard (E1)", () => {
  it("the committed agntux-build bundle is in sync with the repo-root sources", () => {
    // The E1 guard: if a source under scripts/ | packages/ | canonical/ changed
    // without re-running `npm run sync:agntux-build-toolchain`, this fails (and
    // tells the maintainer how to fix it). Same check CI runs.
    const r = spawnSync(
      "node",
      [join(REPO_ROOT, "scripts", "sync-agntux-build-toolchain.mjs"), "--check"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(
        `agntux-build bundle has drifted — run \`npm run sync:agntux-build-toolchain\`:\n${r.stderr}`,
      );
    }
    expect(r.status).toBe(0);
  });
});
