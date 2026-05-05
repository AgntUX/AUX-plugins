// =============================================================================
// license.ts — read the render-token from the local AgntUX license cache.
//
// The license-check hook (canonical/hooks/license-check.mjs) populates
// ~/.agntux/.license on session start. The MCP server reads it here at
// `resources/read` time, attaching `{ token, kid }` to the resource's `_meta`
// so the iframe-side gate can verify the JWT before mounting the bundle.
//
// Returns `undefined` (not throw) when:
//   - the cache file is missing or unreadable
//   - the JSON is malformed
//   - the `render_token` field is absent or non-string
//   - process.env.AGNTUX_DEV_MODE === "1" (development bypass)
//
// Extracted from the deleted `s3-fetch.ts` so the bundle distribution model
// (build-time embed) and the licensing model (render-token JWT) stay in
// independent files going forward.
// =============================================================================
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const LICENSE_PATH = join(homedir(), ".agntux", ".license");
export function readRenderTokenFromLicense() {
    if (process.env.AGNTUX_DEV_MODE === "1")
        return undefined;
    try {
        const cached = JSON.parse(readFileSync(LICENSE_PATH, "utf8"));
        if (typeof cached?.render_token === "string") {
            return { token: cached.render_token, kid: "agntux-render-v1" };
        }
    }
    catch {
        // cache missing or corrupt — fail closed
    }
    return undefined;
}
//# sourceMappingURL=license.js.map