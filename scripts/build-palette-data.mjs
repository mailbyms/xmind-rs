// Extract XMind's two 配色方案 tabs (缤纷 / 经典) from the shipped renderer into
// a typed module.  Source of truth: renderer/2907.js —
//   `_ = [R.Rainbow, R.Energy, …]`             page order (vivid)
//   `F = { [R.Energy]: [6 hexes], … }`          vivid palettes
//   `A = [y.Classic, …]` / `I = { [y.Classic]: [...] }`  classic palettes
//   `L = [[3 hexes] × 6]`                       the 彩虹 card artwork
// Names come from the live panel (research/theme-palettes.json) so we keep the
// official Chinese labels and their order.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SRC = 'research/asar-src/renderer/2907.js';
const NAMES = 'research/theme-palettes.json';
const OUT = 'src/inspector/palettes.ts';

const js = readFileSync(SRC, 'utf8');
const panel = JSON.parse(readFileSync(NAMES, 'utf8'));

const between = (start, end) => {
  const i = js.indexOf(start);
  if (i < 0) throw new Error(`missing ${start}`);
  const j = js.indexOf(end, i);
  return js.slice(i, j < 0 ? undefined : j);
};

/** `{R.Energy:["#FFF",…]}` → Map('Energy' → array) */
function parseEnumMap(src) {
  const map = new Map();
  const re = /\[R\.([A-Za-z]+)\]:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) map.set(m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  return map;
}
function parseClassicMap(src) {
  const map = new Map();
  const re = /\[y\.([A-Za-z]+)\]:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) map.set(m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  return map;
}

const vividOrder = [...between('const _=[R.Rainbow,', ']').matchAll(/R\.([A-Za-z]+)/g)].map((m) => m[1]);
const classicOrder = [...between('A=[y.Classic,', ']').matchAll(/y\.([A-Za-z]+)/g)].map((m) => m[1]);
const vividColors = parseEnumMap(between('F={[R.Energy]', '};var y,T'));
const classicColors = parseClassicMap(between('I={[y.Classic]', '},S=')); 

// `L` is six rows of six swatches; the 彩虹 card paints rows with indices 0/2/4
// (measured from the live inline style: 205deg, 33% / 66% stops).
const lSrc = between('L=[["#F9423A"', '],g=[{');
const lRows = [...lSrc.matchAll(/\[([^\]]*)\]/g)]
  .map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]))
  .filter((row) => row.length === 6);
const rainbowRows = lRows.map((row) => [row[0], row[2], row[4]]);
// 彩虹 paints its branches with the full 12-hue ring (rows 0+1 of `L`), which
// is why the shipped map shows #F9423A…#4D49BE then #FA8155…#A165A8.
const rainbowCycle = [...lRows[0], ...lRows[1]];

const vividNames = panel.vivid.groups.map((g) => g.name);
const classicNames = panel.classic.groups.map((g) => g.name);
if (vividNames.length !== vividOrder.length) throw new Error(`vivid ${vividNames.length} != ${vividOrder.length}`);
if (classicNames.length !== classicOrder.length) throw new Error(`classic ${classicNames.length} != ${classicOrder.length}`);

const nrom = (hex) => {
  const v = hex.trim().toUpperCase();
  return v.startsWith('#') ? v : `#${v}`;
};
const check = (id, colors, groups, index) => {
  if (colors.length !== 6) return;
  // 彩虹's swatches are gradients, not six solid hexes — nothing to compare.
  if (groups[index].swatches[0].img.includes('linear-gradient')) return;
  const live = groups[index].swatches.slice(0, 6).map((s) => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s.bg);
    if (!m) return null;
    return `#${[1, 2, 3].map((k) => Number(m[k]).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  });
  const mine = colors.map(nrom);
  if (live.some((c) => !c)) return; // gradient row
  if (live.join(',') !== mine.join(',')) {
    console.warn(`mismatch ${id}: live ${live.join(',')} vs asar ${mine.join(',')}`);
  }
};

const vividGroups = vividOrder.map((key, index) => {
  const colors = vividColors.get(key);
  if (!colors) throw new Error(`no colors for ${key}`);
  check(key, colors, panel.vivid.groups, index);
  const group = {
    id: `vivid-${key.toLowerCase()}`,
    name: vividNames[index],
    colors: colors.map(nrom),
    ...(key === 'Rainbow'
      ? { strips: rainbowRows.map((row) => row.map(nrom)), cycle: rainbowCycle.map(nrom) }
      : {}),
    key,
  };
  return group;
});

const classicGroups = classicOrder.map((key, index) => {
  const colors = classicColors.get(key);
  if (!colors) throw new Error(`no colors for ${key}`);
  check(key, colors, panel.classic.groups, index);
  return { id: `classic-${key.toLowerCase()}`, name: classicNames[index], colors: colors.map(nrom), key };
});

// ---------------------------------------------------------------------------
// FINDINGS §39: under the 配色方案 drop-down XMind lists exactly six "quick"
// themes for whichever scheme is selected.  Each one is a single-accent theme:
// centre = one of the scheme's six swatches, other topics = neutral light grey,
// map = a pale tint.  The shipped 2907.js embeds 513 preset colour themes; the
// six visible entries whose `themeName` matches a scheme give us the exact
// accent → backdrop pairing.  Cards are ordered by the panel's six swatches.
// ---------------------------------------------------------------------------
const themeObjects = [];
for (let at = 0; (at = js.indexOf('{"id":"', at)) >= 0;) {
  let depth = 0, pos = at, quoted = false, escaped = false, closed = false;
  for (; pos < js.length; pos += 1) {
    const ch = js[pos];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) { closed = true; pos += 1; break; }
  }
  if (closed) {
    try {
      const obj = JSON.parse(js.slice(at, pos));
      if (obj.tags) themeObjects.push(obj);
    } catch { /* not a standalone JSON object */ }
  }
  at = Math.max(pos, at + 1);
}

const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? nrom(v) : null;
const accentBackdrop = new Map();
for (const obj of themeObjects) {
  if (obj.hidden) continue;
  const accent = hex(obj.theme?.centralTopic?.fillColor);
  const bg = hex(obj.theme?.map?.fillColor);
  if (!accent || !bg) continue;
  const key = accent.toUpperCase();
  if (!accentBackdrop.has(key)) accentBackdrop.set(key, bg);
}

/** Blend two hexes; t=0 keeps `a`, t=1 keeps `b`. */
function mix(a, b, t) {
  const rgb = (h) => {
    const v = h.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  const [r, g, bl] = rgb(a), [r2, g2, b2] = rgb(b);
  const part = (x, y) => Math.round(x * (1 - t) + y * t).toString(16).padStart(2, '0');
  return `#${part(r, r2)}${part(g, g2)}${part(bl, b2)}`.toUpperCase();
}

const makeVariants = (group) => group.colors.map((accent, index) => {
  const bg = accentBackdrop.get(accent.toUpperCase()) ?? mix(accent, '#FFFFFF', 0.88);
  // Six distinct same-hue tones: XMind's colour list must not collapse a
  // repeated swatch on round-trip (theme::shorten_cycle drops duplicates).
  const branches = [
    accent,
    mix(accent, '#FFFFFF', 0.22),
    mix(accent, '#FFFFFF', 0.42),
    mix(accent, '#141414', 0.18),
    mix(accent, '#141414', 0.34),
    mix(accent, '#FFFFFF', 0.62),
  ];
  return { accent, bg, ink: '#141414', center: accent, branches, index };
});

for (const g of [...vividGroups, ...classicGroups]) g.variants = makeVariants(g);
const exact = [...vividGroups, ...classicGroups]
  .flatMap((g) => g.variants.filter((v) => accentBackdrop.has(v.accent.toUpperCase()))).length;
console.log('variants:', accentBackdrop.size, 'accent→backdrop pairs,', exact, '/ 180 exact tints');

const lines = [];
lines.push('// Generated by scripts/build-palette-data.mjs — do not edit by hand.');
lines.push('//');
lines.push('// XMind ships two tabs of 配色方案.  Every group is six colours with fixed');
lines.push('// roles: 0 = canvas/backdrop, 1 = secondary surface, 2..5 = branch colours,');
lines.push('// the last one doubles as the central-topic fill.  `strips` is the special');
lines.push('// three-stop artwork XMind draws for 彩虹 (one gradient per branch row).');
lines.push('// `variants` are the six single-accent quick themes shown *below* the');
lines.push('// drop-down for that scheme (FINDINGS §39); each accent is one swatch.');
lines.push('');
lines.push('export interface PaletteVariant {');
lines.push('  /** One of the scheme\'s six swatches; also the central-topic fill. */');
lines.push('  accent: string;');
lines.push('  /** Pale map backdrop measured from the shipped colour themes. */');
lines.push('  bg: string;');
lines.push('  ink: string;');
lines.push('  center: string;');
lines.push('  /** Six same-hue tones so a saved colour list keeps its length. */');
lines.push('  branches: string[];');
lines.push('}');
lines.push('');
lines.push('export interface PaletteDef {');
lines.push('  id: string;');
lines.push('  name: string;');
lines.push('  /** Six hexes, roles as described above. */');
lines.push('  colors: string[];');
lines.push('  /** The six quick themes for this scheme, swatch order. */');
lines.push('  variants: PaletteVariant[];');
lines.push('  /** Optional 6×3 gradient stops for the 彩虹 card. */');
lines.push('  strips?: string[][];');
lines.push('  /** 彩虹 only: the 12-hue branch cycle it actually paints with. */');
lines.push('  cycle?: string[];');
lines.push('}');
lines.push('');
lines.push('export interface PaletteTab { id: \'vivid\' | \'classic\'; label: string; groups: PaletteDef[] }');
lines.push('');
lines.push('export const PALETTE_TABS: PaletteTab[] = [');
for (const [tab, label, groups] of [['vivid', '缤纷', vividGroups], ['classic', '经典', classicGroups]]) {
  lines.push(`  {`);
  lines.push(`    id: '${tab}',`);
  lines.push(`    label: '${label}',`);
  lines.push(`    groups: [`);
  for (const g of groups) {
    lines.push(`      {`);
    lines.push(`        id: '${g.id}',`);
    lines.push(`        name: '${g.name}',`);
    lines.push(`        colors: [${g.colors.map((c) => `'${c}'`).join(', ')}],`);
    lines.push(`        variants: [`);
    for (const v of g.variants) {
      lines.push(`          { accent: '${v.accent}', bg: '${v.bg}', ink: '${v.ink}',`);
      lines.push(`            center: '${v.center}',`);
      lines.push(`            branches: [${v.branches.map((c) => `'${c}'`).join(', ')}] },`);
    }
    lines.push(`        ],`);
    if (g.strips) {
      lines.push(`        strips: [`);
      for (const row of g.strips) lines.push(`          [${row.map((c) => `'${c}'`).join(', ')}],`);
      lines.push(`        ],`);
    }
    if (g.cycle) {
      lines.push(`        cycle: [`);
      for (let i = 0; i < g.cycle.length; i += 6) {
        lines.push(`          ${g.cycle.slice(i, i + 6).map((c) => `'${c}'`).join(', ')},`);
      }
      lines.push(`        ],`);
    }
    lines.push(`      },`);
  }
  lines.push(`    ],`);
  lines.push(`  },`);
}
lines.push('];');
lines.push('');
lines.push('const ALL: PaletteDef[] = PALETTE_TABS.flatMap((tab) => tab.groups);');
lines.push('');
lines.push('/** Look up by the id we persist in `Document.palette`. */');
lines.push('export function paletteById(id: string | null | undefined): PaletteDef | null {');
lines.push('  if (!id) return null;');
lines.push('  return ALL.find((entry) => entry.id === id) ?? null;');
lines.push('}');
lines.push('');
lines.push('/** The palette a document currently paints with, based on its branch cycle. */');
lines.push('export function paletteByColors(colors: string[] | null | undefined): PaletteDef | null {');
lines.push('  if (!colors || colors.length < 3) return null;');
lines.push('  const key = colors.map((c) => c.toUpperCase()).join(\',\');');
lines.push('  return ALL.find((entry) => paletteBranches(entry).map((c) => c.toUpperCase()).join(\',\') === key) ?? null;');
lines.push('}');
lines.push('');
lines.push('/** The branch paints a palette actually uses on the canvas. */');
lines.push('export function paletteBranches(entry: PaletteDef): string[] {');
lines.push('  // Six swatches, fixed roles: 0/1 are the backdrop and secondary surface,');
lines.push('  // the last one paints the central topic, so 2..len-1 cycle over branches.');
lines.push('  return entry.cycle ?? entry.colors.slice(2, -1);');
lines.push('}');
lines.push('');
lines.push('export function paletteCenter(entry: PaletteDef): string {');
lines.push('  return entry.colors[entry.colors.length - 1];');
lines.push('}');
lines.push('');
lines.push('/** The six quick themes under the drop-down for this scheme. */');
lines.push('export function paletteVariants(entry: PaletteDef | null): PaletteVariant[] {');
lines.push('  return entry?.variants ?? [];');
lines.push('}');
lines.push('');

// ---------------------------------------------------------------------------
// Mini-canvas artwork for the six quick-pick cards in the right panel.
// The shipped strip shows a whole little map per palette, not a colour strip,
// so we draw one here from the same data the canvas paints with.
// ---------------------------------------------------------------------------
const THUMB_DIR = 'public/tiles/palettes';

/** Perceived luminance → a bar colour that stays visible on `hex`. */
const inkBar = (hex) => {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? 'rgba(0,0,0,.34)' : 'rgba(255,255,255,.62)';
};

const bars = (x, y, w, fill) =>
  `<rect x="${x}" y="${y}" width="${w}" height="2.4" rx="1.2" fill="${fill}"/>`;

function paletteThumb(colors, branches) {
  const bg = colors[0];
  const center = colors[colors.length - 1];
  const cycle = branches.length ? branches : colors.slice(2, -1);
  // 144x90 = the 69x43 card ratio, so `object-fit: cover` never crops a side.
  const W = 144, H = 90;

  const nodes = [8, 37.5, 67];
  const parts = [];
  for (let i = 0; i < 3; i += 1) {
    const color = cycle[i % cycle.length];
    const y = nodes[i];
    // Connector: the same gentle elbow the canvas draws.
    parts.push(
      `<path d="M62 45 C 76 45, 78 ${y + 7.5}, 92 ${y + 7.5}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
    );
    parts.push(`<rect x="92" y="${y}" width="44" height="15" rx="4" fill="${color}"/>`);
    parts.push(bars(97, y + 4, 21, inkBar(color)));
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${bg}"/>`,
    parts.join(''),
    `<rect x="18" y="32" width="44" height="26" rx="5" fill="${center}"/>`,
    bars(25, 39, 26, inkBar(center)),
    bars(25, 46, 17, inkBar(center)),
    `</svg>`,
    '',
  ].join('');
}

mkdirSync(THUMB_DIR, { recursive: true });
for (const g of [...vividGroups, ...classicGroups]) {
  const branches = g.cycle ?? g.colors.slice(2, -1);
  writeFileSync(`${THUMB_DIR}/${g.id}.svg`, paletteThumb(g.colors, branches));
}
console.log('wrote', `${THUMB_DIR}/*.svg`, '|', vividGroups.length + classicGroups.length, 'palettes');

// One mini-map per quick theme.  The shipped cards show a pale backdrop, a
// centre plate in the accent swatch and neutral light-grey other topics.
const VARIANT_DIR = 'public/tiles/palette-variants';
function variantThumb(v) {
  const W = 144, H = 90;
  const nodes = [8, 37.5, 67];
  const parts = [];
  for (let i = 0; i < 3; i += 1) {
    const y = nodes[i];
    parts.push(
      `<path d="M62 45 C 76 45, 78 ${y + 7.5}, 92 ${y + 7.5}" fill="none" stroke="${v.accent}" stroke-width="2" stroke-linecap="round"/>`,
      `<rect x="92" y="${y}" width="44" height="15" rx="4" fill="#EEEEEE"/>`,
      bars(97, y + 4, 21, 'rgba(20,20,20,.32)'),
    );
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${v.bg}"/>`,
    parts.join(''),
    `<rect x="18" y="32" width="44" height="26" rx="5" fill="${v.center}"/>`,
    bars(25, 39, 26, inkBar(v.center)),
    bars(25, 46, 17, inkBar(v.center)),
    `</svg>`,
    '',
  ].join('');
}
mkdirSync(VARIANT_DIR, { recursive: true });
for (const g of [...vividGroups, ...classicGroups]) {
  g.variants.forEach((v, i) => {
    writeFileSync(`${VARIANT_DIR}/${g.id}-${i}.svg`, variantThumb(v));
  });
}
console.log('wrote', `${VARIANT_DIR}/*.svg`, '|', vividGroups.length + classicGroups.length, '× 6 quick themes');

writeFileSync(OUT, lines.join('\n'));
console.log('wrote', OUT, '| vivid', vividGroups.length, '| classic', classicGroups.length, '| rainbow rows', rainbowRows.length);
