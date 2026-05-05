#!/usr/bin/env node
/**
 * Bundle size assertion for component-template.
 *
 * The component-template uses vite-plugin-singlefile, which inlines all
 * CSS + JS into a single out/index.html. We gzip the HTML and assert
 * the result is ≤ 200 KB (204_800 bytes).
 *
 * Usage:
 *   node scripts/check-bundle-size.js
 *
 * Exit codes:
 *   0 — bundle is within budget
 *   1 — bundle exceeds budget (fails CI)
 *
 * The limit can be overridden with the MAX_BUNDLE_SIZE_BYTES env var
 * (intended for CI tuning only, not production exceptions).
 */

import { createReadStream, statSync, readdirSync } from 'fs';
import { createGzip } from 'zlib';
import { join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { Writable } from 'stream';

const MAX_BYTES = Number(process.env.MAX_BUNDLE_SIZE_BYTES ?? 204_800); // 200 KB
const OUT_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../out',
);

// Locate the built artifact. vite-plugin-singlefile outputs out/index.html.
// If that isn't present, also check for a *.js chunk in out/assets/ for
// non-singlefile builds.
function findArtifact() {
  const indexHtml = join(OUT_DIR, 'index.html');
  try {
    statSync(indexHtml);
    return indexHtml;
  } catch {
    // fallback: largest JS chunk in out/assets/
    const assetsDir = join(OUT_DIR, 'assets');
    try {
      const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
      if (jsFiles.length === 0) throw new Error('No JS assets found');
      // Pick the largest one (likely the main bundle).
      let largest = { file: '', size: 0 };
      for (const f of jsFiles) {
        const s = statSync(join(assetsDir, f)).size;
        if (s > largest.size) largest = { file: f, size: s };
      }
      return join(assetsDir, largest.file);
    } catch {
      return null;
    }
  }
}

async function measureGzipSize(filePath) {
  let total = 0;
  const counter = new Writable({
    write(chunk, _enc, cb) {
      total += chunk.length;
      cb();
    },
  });
  await pipeline(createReadStream(filePath), createGzip(), counter);
  return total;
}

async function main() {
  const artifact = findArtifact();
  if (!artifact) {
    console.error(
      '[check-bundle-size] ERROR: No build artifact found in',
      OUT_DIR,
    );
    console.error('  Run `npm run build` first.');
    process.exit(1);
  }

  console.log('[check-bundle-size] Measuring:', artifact);
  const gzippedBytes = await measureGzipSize(artifact);
  const gzippedKB = (gzippedBytes / 1024).toFixed(1);
  const limitKB = (MAX_BYTES / 1024).toFixed(0);

  if (gzippedBytes > MAX_BYTES) {
    console.error(
      `[check-bundle-size] FAIL: ${gzippedKB} KB gzipped exceeds limit of ${limitKB} KB (${gzippedBytes} bytes > ${MAX_BYTES} bytes)`,
    );
    process.exit(1);
  }

  console.log(
    `[check-bundle-size] PASS: ${gzippedKB} KB gzipped (limit ${limitKB} KB, ${gzippedBytes} bytes)`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[check-bundle-size] Unexpected error:', err);
  process.exit(1);
});
