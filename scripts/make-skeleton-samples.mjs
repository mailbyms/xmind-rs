// Build one .xmind per skeleton from `example.xmind`, so the shipped XMind and
// this app can be compared on identical content.
//
//   node scripts/make-skeleton-samples.mjs
//
// `example.xmind` carries 8 topic images whose resources are *missing* from the
// archive (XMind still reserves a 64x64 box for them) and two folded branches.
// Both would mask the layout we are trying to compare, so the samples drop the
// `image` keys and the `branch:"folded"` marks, and ship only content.json /
// manifest.json / metadata.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';

const SRC = 'example.xmind';
const OUT = resolve('target/skeleton-samples');

/** Minimal zip reader: returns [{ name, data }] for every file entry. */
function readZip(buffer) {
  const entries = [];
  let i = 0;
  while ((i = buffer.indexOf(Buffer.from('PK\x03\x04'), i)) >= 0) {
    const method = buffer.readUInt16LE(i + 8);
    const csize = buffer.readUInt32LE(i + 18);
    const nlen = buffer.readUInt16LE(i + 26);
    const elen = buffer.readUInt16LE(i + 28);
    const name = buffer.slice(i + 30, i + 30 + nlen).toString('utf8');
    const start = i + 30 + nlen + elen;
    const raw = buffer.slice(start, start + csize);
    entries.push({
      name,
      data: method === 8 ? require('node:zlib').inflateRawSync(raw) : raw,
    });
    i = start + (csize || 1);
  }
  return entries;
}

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
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Minimal zip writer (deflate, no zip64 — fine for these small maps). */
function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, body);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Skeleton name → the `structureClass` XMind writes on the root topic. */
const SKELETONS = [
  ['clockwise', 'org.xmind.ui.map.clockwise'],
  ['balanced', 'org.xmind.ui.map.unbalanced'],
  ['logic-right', 'org.xmind.ui.logic.right'],
  ['logic-left', 'org.xmind.ui.logic.left'],
  ['brace-right', 'org.xmind.ui.brace.right'],
  ['org-down', 'org.xmind.ui.org-chart.down'],
  ['org-up', 'org.xmind.ui.org-chart.up'],
  ['tree-right', 'org.xmind.ui.tree.right'],
  ['tree-left', 'org.xmind.ui.tree.left'],
  ['timeline-h', 'org.xmind.ui.timeline.horizontal'],
  ['timeline-v', 'org.xmind.ui.timeline.vertical'],
  ['fishbone-left', 'org.xmind.ui.fishbone.leftHeaded'],
  ['fishbone-right', 'org.xmind.ui.fishbone.rightHeaded'],
  ['treetable', 'org.xmind.ui.treetable'],
  ['matrix', 'org.xmind.ui.spreadsheet'],
];

const zip = readZip(readFileSync(SRC));
const content = JSON.parse(zip.find((e) => e.name === 'content.json').data.toString('utf8'));

/** Drop the broken images and unfold everything so the whole map is measured. */
function sanitize(topic) {
  delete topic.image;
  if (topic.branch === 'folded') delete topic.branch;
  for (const group of Object.values(topic.children ?? {})) {
    for (const child of group) sanitize(child);
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [name, structureClass] of SKELETONS) {
  const doc = JSON.parse(JSON.stringify(content));
  const root = doc[0].rootTopic;
  root.structureClass = structureClass;
  sanitize(root);
  const files = [
    { name: 'content.json', data: Buffer.from(JSON.stringify(doc), 'utf8') },
    ...zip.filter((e) => e.name === 'metadata.json'),
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }), 'utf8') },
  ];
  writeFileSync(resolve(OUT, `${name}.xmind`), writeZip(files));
}
console.log(`wrote ${SKELETONS.length} samples to ${OUT}`);
console.log(SKELETONS.map(([name]) => name).join(', '));
