// Diff this app's layout against the shipped XMind's, per skeleton.
//
//   node scripts/compare-skeletons.mjs            # all captured samples
//   node scripts/compare-skeletons.mjs org-down    # one
//
// Requires the app on CDP 9223 and `target/verify/xmind-<name>.json`
// (scripts/capture-xmind-skeletons.mjs). Writes target/verify/ours-<name>.json
// and prints a per-skeleton table of the numbers that actually differ.
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const VERIFY = resolve('target/verify');
const SAMPLES = resolve('target/skeleton-samples');
mkdirSync(VERIFY, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: done, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : done(m.result);
  }
});
const send = (method, params = {}) => new Promise((done, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve: done, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? ''));
  return res.result.value;
};
const invoke = (cmd, args = {}) =>
  ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const only = process.argv.slice(2);
const names = readdirSync(VERIFY)
  .filter((f) => f.startsWith('xmind-') && f.endsWith('.json'))
  .map((f) => f.slice('xmind-'.length, -'.json'.length))
  .filter((n) => !only.length || only.includes(n))
  .sort();

const round = (v) => Math.round(v * 10) / 10;

/** Root-centred view of one layout, in the same shape for both sides.
 *  Accepts both this app's `{width,height}` and the capture's `{w,h}`. */
function normalise(nodes, edges) {
  const w = (n) => n.width ?? n.w;
  const h = (n) => n.height ?? n.h;
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  const cx = root.x + w(root) / 2;
  const cy = root.y + h(root) / 2;
  const map = new Map();
  for (const n of nodes) {
    map.set(n.id, {
      id: n.id, title: n.title, parentId: n.parentId ?? null,
      x: round(n.x - cx), y: round(n.y - cy), w: round(w(n)), h: round(h(n)),
    });
  }
  return { root: map.get(root.id), nodes: map, edges: edges ?? [] };
}

/** What a skeleton actually looks like, as a handful of numbers. */
function profile(norm, parentId) {
  const kids = [...norm.nodes.values()].filter((n) => n.parentId === parentId
    || norm.edges.some((e) => e.from === parentId && e.to === n.id));
  const parent = norm.nodes.get(parentId);
  if (!parent) return null;
  const offsets = kids.map((k) => ({
    title: k.title,
    dx: round(k.x - parent.x), dy: round(k.y - parent.y),
    sameRow: Math.abs((k.y + k.h / 2) - (parent.y + parent.h / 2)) < 4,
    sameCol: Math.abs((k.x + k.w / 2) - (parent.x + parent.w / 2)) < 4,
  }));
  const xs = [...new Set(offsets.map((o) => o.dx))].sort((a, b) => a - b);
  const ys = [...new Set(offsets.map((o) => o.dy))].sort((a, b) => a - b);
  const pitch = ys.length > 1
    ? round((ys[ys.length - 1] - ys[0]) / (ys.length - 1))
    : xs.length > 1 ? round((xs[xs.length - 1] - xs[0]) / (xs.length - 1)) : 0;
  return {
    count: kids.length,
    first: offsets[0] ?? null,
    distinctX: xs.length, distinctY: ys.length,
    pitch,
  };
}

const rows = [];
for (const name of names) {
  const sample = resolve(SAMPLES, `${name}.xmind`);
  const xmindPath = resolve(VERIFY, `xmind-${name}.json`);
  if (!existsSync(sample) || !existsSync(xmindPath)) continue;
  const theirs = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(xmindPath, 'utf8')));

  await invoke('doc_open', { path: sample });
  await wait(260);
  const layout = await invoke('doc_layout');
  writeFileSync(resolve(VERIFY, `ours-${name}.json`), JSON.stringify(layout, null, 1));

  // XMind's capture has no parentId; rebuild it from the connection list.
  const parentOf = new Map();
  for (const e of theirs.edges) parentOf.set(e.to, e.from);
  const theirNodes = theirs.nodes.map((n) => ({ ...n, parentId: parentOf.get(n.id) ?? null }));
  const mine = normalise(layout.nodes, layout.edges);
  const theirNorm = normalise(theirNodes, theirs.edges);

  // Compare on the two-level sample: root + its first child.
  const rootTheir = theirNorm.root;
  const rootMine = mine.root;
  const firstOf = (norm) => [...norm.nodes.values()].find((n) => n.parentId === norm.root?.id);
  const offset = (norm) => {
    const kid = firstOf(norm);
    const root = norm.root;
    if (!kid || !root) return null;
    return [round(kid.x - root.x), round(kid.y - root.y), kid.w, kid.h];
  };

  const bbox = (norm) => {
    const list = [...norm.nodes.values()];
    return {
      w: round(Math.max(...list.map((n) => n.x + n.w)) - Math.min(...list.map((n) => n.x))),
      h: round(Math.max(...list.map((n) => n.y + n.h)) - Math.min(...list.map((n) => n.y))),
    };
  };

  const row = {
    name,
    nodes: [theirs.nodes.length, layout.nodes.length],
    root: [rootTheir?.w, rootTheir?.h, rootMine?.w, rootMine?.h],
    bbox: [bbox(theirNorm), bbox(mine)],
    rootKids: profile(theirNorm, rootTheir?.id),
    rootKidsMine: profile(mine, rootMine?.id),
    firstChildOffset: offset(theirNorm),
    firstChildOffsetMine: offset(mine),
  };
  rows.push(row);
  console.log(`\n=== ${name} ===`);
  console.log(`  nodes        xmind ${row.nodes[0]} / ours ${row.nodes[1]}`);
  console.log(`  root box     xmind ${row.root[0]}x${row.root[1]} / ours ${row.root[2]}x${row.root[3]}`);
  console.log(`  bbox         xmind ${row.bbox[0].w}x${row.bbox[0].h} / ours ${row.bbox[1].w}x${row.bbox[1].h}`);
  console.log(`  root kids    xmind n=${row.rootKids?.count} dX=${row.rootKids?.distinctX} dY=${row.rootKids?.distinctY} pitch=${row.rootKids?.pitch}`);
  console.log(`               ours  n=${row.rootKidsMine?.count} dX=${row.rootKidsMine?.distinctX} dY=${row.rootKidsMine?.distinctY} pitch=${row.rootKidsMine?.pitch}`);
  console.log(`  1st child    xmind ${JSON.stringify(row.firstChildOffset)} / ours ${JSON.stringify(row.firstChildOffsetMine)}`);
}
writeFileSync(resolve(VERIFY, 'skeleton-diff.json'), JSON.stringify(rows, null, 1));
console.log('\nwrote target/verify/skeleton-diff.json');
ws.close();
