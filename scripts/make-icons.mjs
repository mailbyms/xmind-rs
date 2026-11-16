// Generates the app icon without any native/image dependency.
// A PNG is written with zlib (Node builtin) and the ICO simply embeds that PNG,
// which Windows has supported since Vista.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const buf = Buffer.alloc(SIZE * SIZE * 4);

function blend(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a === 0) return;
  const i = (y * SIZE + x) * 4;
  const srcA = a / 255;
  const dstA = buf[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  buf[i] = Math.round((r * srcA + buf[i] * dstA * (1 - srcA)) / outA);
  buf[i + 1] = Math.round((g * srcA + buf[i + 1] * dstA * (1 - srcA)) / outA);
  buf[i + 2] = Math.round((b * srcA + buf[i + 2] * dstA * (1 - srcA)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}

// Diagonal indigo -> violet background with a rounded corner mask.
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * SIZE);
    const r = Math.round(43 + t * 62);
    const g = Math.round(86 + t * 22);
    const b = Math.round(226 - t * 32);
    const radius = 54;
    const dx = Math.max(radius - x, x - (SIZE - 1 - radius), 0);
    const dy = Math.max(radius - y, y - (SIZE - 1 - radius), 0);
    const inside = dx * dx + dy * dy <= radius * radius || (dx === 0 && dy === 0);
    if (inside) blend(x, y, [r, g, b, 255]);
  }
}

function circle(cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) blend(x, y, color);
    }
  }
}

function line(x0, y0, x1, y1, width, color) {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / len2));
      const d = Math.hypot(x - (x0 + t * vx), y - (y0 + t * vy));
      if (d <= width / 2) blend(x, y, color);
    }
  }
}

const white = [255, 255, 255, 255];
const soft = [226, 233, 255, 220];
const branches = [
  [78, 66], [72, 132], [84, 202],
  [190, 62], [198, 130], [186, 200],
];
for (const [bx, by] of branches) {
  line(128, 128, bx, by, 7, soft);
  circle(bx, by, 15, white);
}
circle(128, 128, 27, white);
circle(128, 128, 11, [79, 110, 246, 255]);

// --- PNG encoding ---
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// --- ICO embedding the PNG ---
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0;   // 256 -> encoded as 0
entry[1] = 0;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);  // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([icoHeader, entry, png]);

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/icons');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'icon.png'), png);
writeFileSync(resolve(outDir, 'icon.ico'), ico);
writeFileSync(resolve(outDir, '32x32.png'), png); // Tauri only needs the two above
console.log(`wrote icon.png (${png.length} B) and icon.ico (${ico.length} B)`);
