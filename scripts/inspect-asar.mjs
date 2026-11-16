// Inspect an Electron app.asar without extracting hundreds of MB.
// Usage:
//   node scripts/inspect-asar.mjs tree
//   node scripts/inspect-asar.mjs cat  <archive-relative-path>
//   node scripts/inspect-asar.mjs grep <regex> [--max N]
//   node scripts/inspect-asar.mjs extract <regex> <out-dir> [--max-bytes N]
import { openSync, readSync, readFileSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const ARCHIVE = 'C:/Users/DM/AppData/Local/Programs/Xmind/resources/app.asar';
const UNPACKED = 'C:/Users/DM/AppData/Local/Programs/Xmind/resources/app.asar.unpacked';

const fd = openSync(ARCHIVE, 'r');
const first = Buffer.alloc(8);
readSync(fd, first, 0, 8, 0);
const headerPickleSize = first.readUInt32LE(4);
const pickle = Buffer.alloc(headerPickleSize);
readSync(fd, pickle, 0, headerPickleSize, 8);
// Chromium Pickle iterator skips the 4-byte payload-size header, so the
// string length lives at +4 and the string itself at +8.
const jsonLength = pickle.readUInt32LE(4);
const header = JSON.parse(pickle.subarray(8, 8 + jsonLength).toString('utf8'));
const DATA_START = 8 + headerPickleSize;

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.files) {
      out.push({ path, size: 0, dir: true, entry });
      walk(entry, path, out);
    } else {
      out.push({ path, size: entry.size || 0, dir: false, entry });
    }
  }
}
const entries = [];
walk(header, '', entries);

function readEntrySync(item) {
  const { entry } = item;
  if (entry.unpacked) return readFileSync(join(UNPACKED, item.path));
  const buf = Buffer.alloc(entry.size);
  readSync(fd, buf, 0, entry.size, DATA_START + Number(entry.offset));
  return buf;
}

const [, , command, ...args] = process.argv;
if (command === 'tree') {
  const lines = entries.map((e) => `${e.dir ? 'D' : 'F'}\t${e.size}\t${e.path}`);
  const out = resolve('research/asar-tree.txt');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n'));
  console.log(`wrote ${lines.length} entries -> ${out}`);
  const top = new Map();
  for (const e of entries) {
    const root = e.path.split('/')[0];
    const stat = top.get(root) || { count: 0, bytes: 0 };
    stat.count++;
    stat.bytes += e.size;
    top.set(root, stat);
  }
  for (const [name, stat] of top) console.log(`  ${name}: ${stat.count} files, ${(stat.bytes / 1048576).toFixed(1)} MB`);
} else if (command === 'cat') {
  const wanted = args[0];
  const item = entries.find((e) => e.path === wanted);
  if (!item) { console.error('not found:', wanted); process.exit(1); }
  process.stdout.write(readEntrySync(item).toString('utf8'));
} else if (command === 'grep') {
  const re = new RegExp(args[0], 'i');
  const max = Number(args[args.indexOf('--max') + 1]) || 40;
  let hits = 0;
  for (const item of entries) {
    if (item.dir || item.size > 8 * 1024 * 1024) continue;
    if (!/\.(js|json|html|css|ts|md|txt|svg)$/.test(item.path)) continue;
    let text;
    try { text = readEntrySync(item).toString('utf8'); } catch { continue; }
    if (re.test(text)) {
      const line = text.split('\n').findIndex((l) => re.test(l));
      const snippet = text.split('\n')[Math.max(0, line)].slice(0, 220);
      console.log(`${item.path}:${line + 1}  ${snippet}`);
      if (++hits >= max) break;
    }
  }
  console.log(`(${hits} files matched)`);
} else if (command === 'extract') {
  const re = new RegExp(args[0]);
  const outDir = resolve(args[1]);
  const maxBytes = Number(args[args.indexOf('--max-bytes') + 1]) || 4 * 1024 * 1024;
  let count = 0;
  for (const item of entries) {
    if (item.dir || item.size > maxBytes || !re.test(item.path)) continue;
    const target = join(outDir, item.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readEntrySync(item));
    count++;
  }
  console.log(`extracted ${count} files -> ${outDir}`);
} else {
  console.log(`archive: ${ARCHIVE}
header JSON: ${jsonLength} bytes, data starts at ${DATA_START}
entries: ${entries.length}
commands: tree | cat <path> | grep <regex> | extract <regex> <out-dir>`);
}
closeSync(fd);
