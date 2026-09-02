#!/usr/bin/env node
/**
 * Generates the PWA icons. DESIGN_SPEC §6.
 *
 * The mark is a pencil nib quartered into the four tier inks — one glyph that
 * carries the name and the four-tier structure, and stays legible at 48px.
 *
 * Written as a raw PNG encoder rather than pulling in an image library, because
 * package.json `dependencies` stays empty and a build-time dependency is still a
 * dependency somebody has to audit. Node ships zlib; a PNG is a header, one
 * deflated block of scanlines, and a CRC.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INK = {
  easy: [0x1f, 0x8a, 0x54],
  moderate: [0x1a, 0x6b, 0xb0],
  hard: [0xc2, 0x52, 0x1c],
  god: [0x8e, 0x2a, 0x6b],
};
const BG = [0xf1, 0xf4, 0xf7];
const SAMPLES = 4;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param size    pixels square
 * @param scale   nib radius as a fraction of the canvas. Maskable icons keep the
 *                mark inside the safe zone, because Android will crop a circle
 *                out of the middle and a nib with its points shaved off is not
 *                the mark.
 * @param opaque  fill the background; transparent otherwise.
 */
function draw(size, scale, opaque) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const r = size * scale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hit = 0;
      const acc = [0, 0, 0];

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + (sx + 0.5) / SAMPLES - c;
          const py = y + (sy + 0.5) / SAMPLES - c;
          if (Math.abs(px) / r + Math.abs(py) / r > 1) continue;

          // Quartered along both diagonals, clockwise from the top.
          const ink =
            Math.abs(px) > Math.abs(py)
              ? px > 0
                ? INK.moderate
                : INK.god
              : py < 0
                ? INK.easy
                : INK.hard;
          acc[0] += ink[0];
          acc[1] += ink[1];
          acc[2] += ink[2];
          hit += 1;
        }
      }

      const total = SAMPLES * SAMPLES;
      const coverage = hit / total;
      const i = (y * size + x) * 4;

      if (hit === 0) {
        rgba[i] = BG[0];
        rgba[i + 1] = BG[1];
        rgba[i + 2] = BG[2];
        rgba[i + 3] = opaque ? 255 : 0;
        continue;
      }

      const mark = [acc[0] / hit, acc[1] / hit, acc[2] / hit];
      const alpha = opaque ? 1 : coverage;
      // Composite over the ground so edges stay clean at 48px instead of
      // fringing against whatever the platform puts behind them.
      for (let k = 0; k < 3; k += 1) {
        rgba[i + k] = Math.round(
          opaque ? mark[k] * coverage + BG[k] * (1 - coverage) : mark[k],
        );
      }
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  return png(size, size, rgba);
}

const OUT = 'public';
const files = [
  ['icon-192.png', draw(192, 0.4, true)],
  ['icon-512.png', draw(512, 0.4, true)],
  // Maskable: full bleed ground, mark inside the 80% safe zone.
  ['icon-maskable-512.png', draw(512, 0.3, true)],
  ['apple-touch-icon.png', draw(180, 0.4, true)],
];

for (const [name, buffer] of files) {
  writeFileSync(join(OUT, name), buffer);
  console.log(`  ${name.padEnd(24)} ${(buffer.length / 1024).toFixed(1)} KB`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#F1F4F7"/>
  <path d="M50 10 90 50 50 50Z" fill="#1F8A54"/>
  <path d="M90 50 50 90 50 50Z" fill="#1A6BB0"/>
  <path d="M50 90 10 50 50 50Z" fill="#C2521C"/>
  <path d="M10 50 50 10 50 50Z" fill="#8E2A6B"/>
</svg>
`;
writeFileSync(join(OUT, 'favicon.svg'), svg);
console.log(`  favicon.svg              ${(svg.length / 1024).toFixed(1)} KB\n`);
