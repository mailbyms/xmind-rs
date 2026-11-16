// Extract the shipped skeleton presets: group -> [{id, structureStyle, handDrawn}].
// Sources (already dumped from app.asar):
//   target/2907.js  -> the grouped library (group name -> preset ids)
//   target/8846.js  -> per-preset structureStyle + theme
// Writes src/inspector/skeletons.json.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

/** Pull every `JSON.parse('…')` payload out of a bundle and return parsed arrays. */
function parsePayloads(text) {
  const out = [];
  const re = /JSON\.parse\('((?:[^'\\]|\\.)*)'\)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (!/^[[{]/.test(raw.trimStart())) continue;
    try { out.push(JSON.parse(raw)); } catch { /* not JSON we care about */ }
  }
  return out;
}

const groups = {};
for (const payload of parsePayloads(read('target/2907.js'))) {
  if (Array.isArray(payload) || typeof payload !== 'object') continue;
  for (const [name, items] of Object.entries(payload)) {
    if (!Array.isArray(items) || !items.every((i) => i && typeof i.id === 'string')) continue;
    groups[name] = items.map((i) => ({ id: i.id, handDrawn: !!i.isHandDrawn }));
  }
}

const presets = new Map();
for (const payload of parsePayloads(read('target/8846.js'))) {
  const list = Array.isArray(payload) ? payload : Object.values(payload);
  for (const item of list) {
    if (!item || !item.id || !item.structureStyle) continue;
    presets.set(item.id, item.structureStyle);
  }
}

const result = Object.entries(groups).map(([group, items]) => ({
  group,
  items: items.map((i) => ({
    id: i.id,
    handDrawn: i.handDrawn,
    central: presets.get(i.id)?.centralTopic ?? null,
    main: presets.get(i.id)?.mainTopic ?? null,
  })),
}));

writeFileSync('src/inspector/skeletons.json', JSON.stringify(result, null, 2));
console.log('groups:', result.map((g) => `${g.group}(${g.items.length})`).join(' '));
const unresolved = result.flatMap((g) => g.items.filter((i) => !i.central || !i.main));
console.log('unresolved:', unresolved.length);
const combos = new Map();
for (const g of result) for (const i of g.items) {
  const key = `${i.central} + ${i.main}${i.handDrawn ? ' [hand]' : ''}`;
  combos.set(key, (combos.get(key) ?? 0) + 1);
}
for (const [k, v] of combos) console.log(String(v).padStart(2), k);
