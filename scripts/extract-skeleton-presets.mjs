// For every shipped 骨架 preset, print the fields that actually change the
// drawing: structure classes, topic shapes, branch line class and pattern.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
function parsePayloads(text) {
  const out = [];
  const re = /JSON\.parse\('((?:[^'\\]|\\.)*)'\)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (!/^[[{]/.test(raw.trimStart())) continue;
    try { out.push(JSON.parse(raw)); } catch { /* ignore */ }
  }
  return out;
}

const short = (v) => (v ? String(v).split('.').pop() : null);

// group -> ordered preset ids (from 2907.js)
const groups = {};
for (const payload of parsePayloads(read('target/2907.js'))) {
  if (Array.isArray(payload) || typeof payload !== 'object') continue;
  for (const [name, items] of Object.entries(payload)) {
    if (!Array.isArray(items) || !items.every((i) => i && typeof i.id === 'string')) continue;
    if (!items.every((i) => Array.isArray(i.tags) && i.tags.includes(name))) continue;
    groups[name] = items.map((i) => ({ id: i.id, handDrawn: !!i.isHandDrawn }));
  }
}

// id -> full preset (from 8846.js)
const presets = new Map();
for (const payload of parsePayloads(read('target/8846.js'))) {
  for (const item of Array.isArray(payload) ? payload : Object.values(payload)) {
    if (!item || !item.id || !item.structureStyle) continue;
    presets.set(item.id, item);
  }
}

const SKELETON_GROUPS = ['Mind Map', 'Logic Chart', 'Brace Map', 'Org Chart', 'Tree Chart', 'Timeline', 'Fishbone', 'Tree Table', 'Matrix'];
const out = [];
const themes = {};
for (const group of SKELETON_GROUPS) {
  for (const card of groups[group] ?? []) {
    const preset = presets.get(card.id);
    const style = preset?.structureStyle ?? {};
    const theme = preset?.theme ?? {};
    const c = theme.centralTopic?.properties ?? {};
    const m = theme.mainTopic?.properties ?? {};
    // The shipped preset is a *three-layer* theme.  subTopic decides every
    // connector below the first level; ignoring it is why switching a 骨架
    // used to leave level 2+ lines untouched (FINDINGS §27).
    const u = theme.subTopic?.properties ?? {};
    const map = theme.map?.properties ?? {};
    themes[card.id] = theme;
    out.push({
      id: card.id,
      group,
      handDrawn: card.handDrawn,
      central: style.centralTopic ?? null,
      main: style.mainTopic ?? null,
      centralShape: short(c['shape-class']),
      centralLine: short(c['line-class']),
      mainShape: short(m['shape-class']),
      mainLine: short(m['line-class']),
      linePattern: m['line-pattern'] ?? c['line-pattern'] ?? null,
      fillPattern: m['fill-pattern'] ?? null,
      centralWidth: c['line-width'] ?? null,
      mainWidth: m['line-width'] ?? null,
      subLine: short(u['line-class']),
      subShape: short(u['shape-class']),
      subPattern: u['line-pattern'] ?? null,
      subWidth: u['line-width'] ?? null,
      subFill: u['fill-pattern'] ?? null,
      // `map/properties/line-tapered`: none | normal | tapered.
      tapered: map['line-tapered'] ?? null,
    });
  }
}
writeFileSync('research/skeleton-presets.json', JSON.stringify(out, null, 2));
writeFileSync('research/skeleton-themes.json', JSON.stringify(themes, null, 2));
for (const g of SKELETON_GROUPS) {
  const rows = out.filter((r) => r.group === g);
  console.log(`\n## ${g} (${rows.length})`);
  for (const r of rows) {
    console.log(`  ${r.handDrawn ? '✎' : ' '} c:${r.centralShape}/${r.centralLine} m:${r.mainShape}/${r.mainLine} s:${r.subShape}/${r.subLine} taper=${r.tapered} pat=${r.linePattern}/${r.subPattern}`);
  }
}
