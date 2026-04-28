/**
 * _gen-fixtures.mjs — Generate PNG fixture files for linter tests.
 * Run once: node scripts/_gen-fixtures.mjs
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Minimal PNG builder
// ---------------------------------------------------------------------------

function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crcData = Buffer.concat([typeB, data]);
  const crcVal = crc32(crcData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal);
  return Buffer.concat([len, typeB, data, crcBuf]);
}

function makePng(width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = width * 3;
  const raw = Buffer.alloc((rowSize + 1) * height, 0);
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0; // filter byte: none
    for (let x = 0; x < width; x++) {
      const off = y * (rowSize + 1) + 1 + x * 3;
      raw[off] = 128;
      raw[off + 1] = 128;
      raw[off + 2] = 128;
    }
  }
  const compressed = deflateSync(raw);

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Write fixtures
// ---------------------------------------------------------------------------

const base = "scripts/__fixtures__";

const icon512  = makePng(512, 512);
const icon1024 = makePng(1024, 1024);
const ss1280   = makePng(1280, 720);    // 16:9, valid screenshot
const ssBadAspect = makePng(2560, 720); // ratio 3.55, out of [1.33, 2.33]

// Valid agntux-core
writeFileSync(`${base}/valid/agntux-core/marketplace/icon.png`, icon512);
writeFileSync(`${base}/valid/agntux-core/marketplace/screenshots/01-overview.png`, ss1280);

// e01-missing-listing: no listing.yaml
writeFileSync(`${base}/invalid/e01-missing-listing/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e01-missing-listing/marketplace/screenshots/01-overview.png`, ss1280);

// e01-missing-icon: no icon.png
writeFileSync(`${base}/invalid/e01-missing-icon/marketplace/screenshots/01-overview.png`, ss1280);

// e01-missing-readme: has listing.yaml + icon, no README.md
writeFileSync(`${base}/invalid/e01-missing-readme/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e01-missing-readme/marketplace/screenshots/01-overview.png`, ss1280);

// e01-missing-changelog: has listing.yaml + icon + README, no CHANGELOG.md
writeFileSync(`${base}/invalid/e01-missing-changelog/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e01-missing-changelog/marketplace/screenshots/01-overview.png`, ss1280);

// e01-no-screenshots: screenshots dir exists but is empty (no files written)
writeFileSync(`${base}/invalid/e01-no-screenshots/marketplace/icon.png`, icon512);

// e02-icon-wrong-dims: 1024×1024 icon
writeFileSync(`${base}/invalid/e02-icon-wrong-dims/marketplace/icon.png`, icon1024);
writeFileSync(`${base}/invalid/e02-icon-wrong-dims/marketplace/screenshots/01-overview.png`, ss1280);

// e03-changelog-mismatch: plugin.json says 2.0.0, CHANGELOG says 1.0.0
writeFileSync(`${base}/invalid/e03-changelog-mismatch/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e03-changelog-mismatch/marketplace/screenshots/01-overview.png`, ss1280);

// e04-bad-category: invalid enum value
writeFileSync(`${base}/invalid/e04-bad-category/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e04-bad-category/marketplace/screenshots/01-overview.png`, ss1280);

// e05-unknown-field: listing.yaml has an unknown field
writeFileSync(`${base}/invalid/e05-unknown-field/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e05-unknown-field/marketplace/screenshots/01-overview.png`, ss1280);

// e06-missing-screenshot-ref: screenshot_order refs a non-existent file
writeFileSync(`${base}/invalid/e06-missing-screenshot-ref/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e06-missing-screenshot-ref/marketplace/screenshots/01-overview.png`, ss1280);

// e07-wrong-format: PNG bytes in a .jpg file
writeFileSync(`${base}/invalid/e07-wrong-format/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e07-wrong-format/marketplace/screenshots/01-bad-format.jpg`, icon512);

// e08-icon-too-large: we'll handle size check in test via a padded buffer
// The PNG is small; pad it to just over 512 KB
const padding = Buffer.alloc(512 * 1024 + 1, 0);
const bigIcon = Buffer.concat([icon512, padding]);
writeFileSync(`${base}/invalid/e08-icon-too-large/marketplace/icon.png`, bigIcon);
writeFileSync(`${base}/invalid/e08-icon-too-large/marketplace/screenshots/01-overview.png`, ss1280);

// e09-bad-aspect: 2560×720 (ratio 3.55, outside [1.33, 2.33])
writeFileSync(`${base}/invalid/e09-bad-aspect/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e09-bad-aspect/marketplace/screenshots/01-bad-aspect.png`, ssBadAspect);

// e10-bad-filename: screenshot with underscore (not matching NN-slug.ext)
writeFileSync(`${base}/invalid/e10-bad-filename/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e10-bad-filename/marketplace/screenshots/bad_name.png`, ss1280);

// e11-reserved-field: listing.yaml has `featured: true`
writeFileSync(`${base}/invalid/e11-reserved-field/marketplace/icon.png`, icon512);
writeFileSync(`${base}/invalid/e11-reserved-field/marketplace/screenshots/01-overview.png`, ss1280);

console.log("PNG fixtures written.");
