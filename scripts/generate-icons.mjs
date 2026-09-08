/**
 * Generates the application icons.
 *
 * Written by hand rather than pulled from an image library because all three
 * surfaces need the same mark at different sizes and formats (PWA manifest,
 * Windows .ico, extension toolbar), and a 4x-supersampled rasteriser is both
 * smaller and more predictable than a native-binary dependency in the install.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');

const ACCENT_TOP = [0x6d, 0x6d, 0xe4];
const ACCENT_BOTTOM = [0x4a, 0x4a, 0xc2];
const MARK = [0xff, 0xff, 0xff];
const SUPERSAMPLE = 4;

/* ------------------------------------------------------------- rasteriser */

/** Signed distance from point to a line segment — used to stroke the mark. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function insideRoundedSquare(x, y, size, radius) {
  const inset = size * 0.0;
  const min = inset;
  const max = size - inset;
  if (x < min || y < min || x > max || y > max) return false;

  // Only the four corner boxes need the circular test.
  const cx = x < min + radius ? min + radius : x > max - radius ? max - radius : x;
  const cy = y < min + radius ? min + radius : y > max - radius ? max - radius : y;
  return Math.hypot(x - cx, y - cy) <= radius;
}

/**
 * The mark: a check stroke, which is the one gesture the whole product is
 * about. Coordinates are in a 0..1 space so it scales to any icon size.
 */
function insideMark(x, y, size) {
  const u = x / size;
  const v = y / size;
  const stroke = 0.085;

  const legs = [
    [0.28, 0.52, 0.435, 0.675],
    [0.435, 0.675, 0.73, 0.335],
  ];

  return legs.some(([ax, ay, bx, by]) => distanceToSegment(u, v, ax, ay, bx, by) <= stroke / 2);
}

/** Render one RGBA icon at `size`, supersampled for clean edges. */
function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const hi = size * SUPERSAMPLE;
  const radius = hi * 0.235;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const hx = x * SUPERSAMPLE + sx + 0.5;
          const hy = y * SUPERSAMPLE + sy + 0.5;
          if (!insideRoundedSquare(hx, hy, hi, radius)) continue;

          let colour;
          if (insideMark(hx, hy, hi)) {
            colour = MARK;
          } else {
            // A soft vertical gradient keeps the tile from looking flat at
            // 512px without adding any visual noise at 16px.
            const t = hy / hi;
            colour = [
              Math.round(ACCENT_TOP[0] + (ACCENT_BOTTOM[0] - ACCENT_TOP[0]) * t),
              Math.round(ACCENT_TOP[1] + (ACCENT_BOTTOM[1] - ACCENT_TOP[1]) * t),
              Math.round(ACCENT_TOP[2] + (ACCENT_BOTTOM[2] - ACCENT_TOP[2]) * t),
            ];
          }

          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const coverage = a / samples;
      const offset = (y * size + x) * 4;
      if (coverage > 0) {
        const covered = a / 255;
        pixels[offset] = Math.round(r / covered);
        pixels[offset + 1] = Math.round(g / covered);
        pixels[offset + 2] = Math.round(b / covered);
        pixels[offset + 3] = Math.round(coverage);
      }
    }
  }

  return pixels;
}

/* -------------------------------------------------------------- PNG output */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Vista-era .ico, which may embed PNGs directly rather than DIBs. */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0;
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

/* --------------------------------------------------------------- SVG output */

function svg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Recall">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6d6de4"/>
      <stop offset="1" stop-color="#4a4ac2"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#g)"/>
  <path d="M143 266l80 80 151-174" fill="none" stroke="#fff" stroke-width="44"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

/* ---------------------------------------------------------------- generate */

mkdirSync(OUT, { recursive: true });

const SIZES = [16, 32, 48, 64, 128, 192, 256, 512];
const pngs = new Map();

for (const size of SIZES) {
  const png = encodePng(size, renderIcon(size));
  pngs.set(size, png);
  writeFileSync(join(OUT, `icon-${size}.png`), png);
}

writeFileSync(
  join(OUT, 'icon.ico'),
  encodeIco([16, 32, 48, 256].map((size) => ({ size, png: pngs.get(size) }))),
);
writeFileSync(join(OUT, 'icon.svg'), svg());

console.log(`Wrote ${SIZES.length} PNGs, icon.ico and icon.svg to assets/`);
