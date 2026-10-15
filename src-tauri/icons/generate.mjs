// Draws the source image the Tauri icon generator takes.
//
//   node src-tauri/icons/generate.mjs     # rewrites source.png
//   pnpm exec tauri icon src-tauri/icons/source.png --output src-tauri/icons
//
// The artwork is a placeholder: a play glyph on a dark field, in the app's colours.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const BACKGROUND = [0x10, 0x10, 0x14, 0xff];
const GLYPH = [0x7a, 0xa2, 0xf7, 0xff];

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y += 1) {
  const row = y * (1 + SIZE * 4);
  raw[row] = 0; // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    // A play triangle: apex at the right, base on the left, inset from the edges.
    const inset = 0.24 * SIZE;
    const left = inset;
    const right = SIZE - inset;
    const topAtLeft = inset * 1.1;
    const bottomAtLeft = SIZE - inset * 1.1;
    const t = (x - left) / (right - left);
    const inGlyph =
      x >= left &&
      x <= right &&
      y >= topAtLeft + t * (SIZE / 2 - topAtLeft) &&
      y <= bottomAtLeft - t * (bottomAtLeft - SIZE / 2);
    const colour = inGlyph ? GLYPH : BACKGROUND;
    const at = row + 1 + x * 4;
    raw[at] = colour[0];
    raw[at + 1] = colour[1];
    raw[at + 2] = colour[2];
    raw[at + 3] = colour[3];
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // colour type: RGBA
header[10] = 0;
header[11] = 0;
header[12] = 0;

writeFileSync(
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "source.png"),
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
