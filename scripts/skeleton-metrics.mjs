// Derive the *spacing constants* the shipped XMind actually uses, from the
// captures in target/verify, and print them next to ours.
//
//   node scripts/skeleton-metrics.mjs [names...]
//
// For every parent it measures:
//   levelX  = child.x - (parent.x + parent.width)      (horizontal level gap)
//   levelY  = child.y - (parent.y + parent.height)     (vertical level gap)
//   sibGap  = next.y - (prev.y + prevSubtreeHeight)    (vertical sibling gap)
//   sibGapX = next.x - (prev.x + prevSubtreeWidth)     (horizontal sibling gap)
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('target/verify')
    .filter((f) => f.startsWith('xmind-'))
    .map((f) => f.slice(6, -5))
    .sort();

const round = (v) => Math.round(v * 10) / 10;

function load(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  // Both shapes: `ours-*.json` is a Layout, `xmind-*.json` a capture.
  const nodes = (raw.nodes ?? []).map((n) => ({
    id: n.id, title: n.title, parentId: n.parentId ?? null,
    x: n.x, y: n.y, w: n.width ?? n.w, h: n.height ?? n.h,
  }));
  const parentOf = new Map();
  for (const e of raw.edges ?? []) parentOf.set(e.to, e.from);
  for (const n of nodes) if (!n.parentId && parentOf.has(n.id)) n.parentId = parentOf.get(n.id);
  const kids = new Map();
  for (const n of nodes) {
    if (!n.parentId) continue;
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId).push(n);
  }
  return { nodes, kids };
}

/** Bounding box of a topic and everything below it. */
function subtreeBox(kids, node) {
  let minX = node.x, minY = node.y, maxX = node.x + node.w, maxY = node.y + node.h;
  for (const kid of kids.get(node.id) ?? []) {
    const box = subtreeBox(kids, kid);
    minX = Math.min(minX, box.minX); minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX); maxY = Math.max(maxY, box.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function metrics(file) {
  const { nodes, kids } = load(file);
  const levelX = [], levelY = [], sibY = [], sibX = [];
  for (const parent of nodes) {
    const list = kids.get(parent.id);
    if (!list?.length) continue;
    for (const kid of list) {
      if (kid.x >= parent.x + parent.w) levelX.push(kid.x - (parent.x + parent.w));
      if (kid.y >= parent.y + parent.h) levelY.push(kid.y - (parent.y + parent.h));
    }
    const byY = [...list].sort((a, b) => a.y - b.y);
    for (let i = 1; i < byY.length; i += 1) {
      const prev = subtreeBox(kids, byY[i - 1]);
      if (Math.abs(byY[i].x - byY[i - 1].x) < 6) sibY.push(byY[i].y - prev.maxY);
    }
    const byX = [...list].sort((a, b) => a.x - b.x);
    for (let i = 1; i < byX.length; i += 1) {
      const prev = subtreeBox(kids, byX[i - 1]);
      if (Math.abs(byX[i].y - byX[i - 1].y) < 6) sibX.push(byX[i].x - prev.maxX);
    }
  }
  const stat = (list) => {
    if (!list.length) return '-';
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    return `n=${list.length} med=${round(mid)} [${round(sorted[0])}..${round(sorted[sorted.length - 1])}]`;
  };
  return { levelX: stat(levelX), levelY: stat(levelY), sibY: stat(sibY), sibX: stat(sibX) };
}

for (const name of names) {
  const theirs = existsSync(`target/verify/xmind-${name}.json`) ? metrics(`target/verify/xmind-${name}.json`) : null;
  const ours = existsSync(`target/verify/ours-${name}.json`) ? metrics(`target/verify/ours-${name}.json`) : null;
  if (!theirs || !ours) continue;
  console.log(`\n=== ${name} ===`);
  for (const key of ['levelX', 'levelY', 'sibY', 'sibX']) {
    console.log(`  ${key.padEnd(7)} xmind ${theirs[key]}`);
    console.log(`  ${''.padEnd(7)} ours  ${ours[key]}`);
  }
}
