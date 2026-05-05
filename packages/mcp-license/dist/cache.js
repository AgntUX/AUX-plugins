// Cache for the AgntUX license record at `~/.agntux/.license`.
// File mode 0600, parent dir 0700. Atomic writes via temp-file + rename.
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, chmodSync, unlinkSync, } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
let OVERRIDE_DIR = null;
let OVERRIDE_FILE = null;
export function _setCachePathsForTesting(dir, file) {
    OVERRIDE_DIR = dir;
    OVERRIDE_FILE = file;
}
function cacheDir() {
    return OVERRIDE_DIR ?? join(homedir(), ".agntux");
}
export function cachePath() {
    return OVERRIDE_FILE ?? join(cacheDir(), ".license");
}
function ensureDir() {
    const dir = cacheDir();
    try {
        const st = statSync(dir);
        if (st.isDirectory()) {
            const mode = st.mode & 0o777;
            if (mode !== 0o700) {
                try {
                    chmodSync(dir, 0o700);
                }
                catch { /* best-effort */ }
            }
            return;
        }
    }
    catch (e) {
        if (e.code !== "ENOENT")
            throw e;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
}
export function readLicenseCache() {
    let raw;
    try {
        raw = readFileSync(cachePath(), "utf8");
    }
    catch (e) {
        if (e.code === "ENOENT")
            return null;
        return { _corrupt: true, error: e.message };
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { _corrupt: true, error: "not an object" };
        }
        if (typeof parsed.token !== "string") {
            return { _corrupt: true, error: "missing token" };
        }
        return parsed;
    }
    catch (e) {
        return { _corrupt: true, error: e.message };
    }
}
export function writeLicenseCache(record) {
    if (record === null || typeof record !== "object") {
        throw new TypeError("writeLicenseCache: record must be an object");
    }
    ensureDir();
    const target = cachePath();
    const suffix = randomBytes(6).toString("hex");
    const tmp = `${target}.tmp.${process.pid}.${suffix}`;
    const json = JSON.stringify(record, null, 2);
    writeFileSync(tmp, json, { mode: 0o600 });
    try {
        chmodSync(tmp, 0o600);
        renameSync(tmp, target);
    }
    catch (e) {
        try {
            unlinkSync(tmp);
        }
        catch { /* ignore */ }
        throw e;
    }
    try {
        chmodSync(target, 0o600);
    }
    catch { /* best-effort */ }
}
