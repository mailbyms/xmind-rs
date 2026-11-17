// Regression: every shipped 骨架 must give levels 1–5 the same shapes / plates
// as the original desktop's own `sheet.theme` bytes, no matter whether the
// preset was applied before or after the topics were created.
//
//   CDP_PORT=9234 node scripts/ui-level-shapes.mjs
//
// Fact source: research/skeleton-themes.json (43 themes extracted from the
// shipped 8846.js bundle).  `research/skeleton-presets.json` supplies the
// order/ids; `src/inspector/skeletons.ts` supplies structure + layer data.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9234;
const OUT = 'target/verify/level-shapes.json';
execFileSync(process.execPath, ['scripts/probe-level-shapes.mjs', OUT], {
  stdio: 'inherit', env: { ...process.env, CDP_PORT: PORT },
});
const rows = JSON.parse(readFileSync(OUT, 'utf8'));

const ALIAS = { ellipticrectangle: 'ellipserect' };
const norm = (s) => ALIAS[s] ?? s;
const UNDERLINE = new Set(['underline', 'doubleunderline']);
// Three structures override the skeleton theme bytes on purpose; these rules
// come from the original DOM measurements in FINDINGS §24 / §12.3 / §15.5:
//   * 括号图: topics are plain text, the brace carries the structure;
//   * 树型表格: every topic is a transparent grid cell;
//   * 矩阵图: a white banner + right-aligned labels + underlined level-2 rows.
// Their fills (and, for the grids, shapes) are structural, not theme-driven.
const structuralPlate = (structure, depth) => {
  if (structure === 'braceRight' || structure === 'braceLeft') return depth >= 1 ? false : null;
  if (structure === 'treeTable') return false;
  if (structure === 'matrix') return depth === 0;
  return null;
};
const structuralGrid = (structure, depth) =>
  (structure === 'treeTable' || (structure === 'matrix' && depth > 0));

const fail = [];
let checks = 0;
const ok = (cond, name, detail = '') => {
  checks += 1;
  if (!cond) fail.push(`${name} — ${detail}`);
};

for (const row of rows) {
  const exp = row.original.map((o) => {
    const shape = norm(o.shape ?? 'roundedRect');
    const filled = !(UNDERLINE.has(shape) || o.fill === 'none' || o.fill === '#00000000');
    return { shape, filled };
  });
  for (const [flow, levels] of [['appliedFirst', row.appliedFirst], ['appliedLast', row.appliedLast]]) {
    ok(levels.length === 5, `${row.group}/${row.id.slice(0, 6)} ${flow} has 5 levels`, String(levels.length));
    for (const n of levels) {
      const e = n.depth === 0 ? exp[0] : n.depth === 1 ? exp[1] : exp[2];
      const override = structuralPlate(row.structure, n.depth);
      const wantFilled = override ?? e.filled;
      const gotFilled = n.fill !== 'none' && !n.underline;
      const tag = `${row.group}/${row.id.slice(0, 6)} ${flow} L${n.depth + 1}`;
      if (!structuralGrid(row.structure, n.depth)) {
        ok(norm(n.shape) === e.shape, `${tag} shape`, `${n.shape} ≠ ${e.shape}`);
      }
      ok(gotFilled === wantFilled, `${tag} plate`, `${n.fill}/${n.underline} wanted ${wantFilled ? 'filled' : 'no plate'}`);
    }
  }
}

const byGroup = {};
for (const f of fail) {
  const g = f.split('/')[0];
  byGroup[g] = (byGroup[g] ?? 0) + 1;
}
if (fail.length) {
  console.log(`\n${fail.length}/${checks} FAILED`);
  console.log('by group:', JSON.stringify(byGroup));
  for (const f of fail.slice(0, 30)) console.log('  -', f);
  process.exit(1);
}
console.log(`\nALL PASS — ${rows.length} presets × 2 flows × 5 levels (${checks} checks)`);
