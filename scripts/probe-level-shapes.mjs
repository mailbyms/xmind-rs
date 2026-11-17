// Probe every shipped skeleton's topic shapes down to level 5, both when the
// skeleton is applied before and after the topics are created.  The result is
// compared with the original desktop's own theme bytes in
// `research/skeleton-themes.json` (43 presets extracted from bundle 8846.js).
//
//   CDP_PORT=9234 node scripts/probe-level-shapes.mjs [out.json]
import { readFileSync, writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9234;
const OUT = process.argv[2] || 'target/verify/level-shapes.json';
const themes = JSON.parse(readFileSync('research/skeleton-themes.json', 'utf8'));
const presets = JSON.parse(readFileSync('research/skeleton-presets.json', 'utf8'));
// skeletons.ts is generated data: read its JSON literal for structure + the
// original theme's three depth layers.
const ts = readFileSync('src/inspector/skeletons.ts', 'utf8');
const groups = JSON.parse(ts.match(/export const SKELETON_GROUPS: SkeletonGroup\[\] = (\[[\s\S]*?\]);/)[1]);
const byId = new Map(groups.flatMap((g) => g.items).map((p) => [p.id, p]));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};
const invoke = (cmd, args = {}) => ev(
  `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`,
);

/** Create a fresh document with one straight chain root → L1 → L2 → L3 → L4. */
async function buildChain(applyFirst, preset) {
  let state = await invoke('doc_new');
  if (applyFirst) state = await invoke('doc_apply_skeleton', preset);
  let parent = state.layout.nodes.find((n) => n.depth === 0).id;
  const levels = [parent];
  for (let i = 0; i < 4; i += 1) {
    const next = await invoke('doc_add_child', { id: parent, title: `L${i + 1}` });
    const before = new Set(state.layout.nodes.map((n) => n.id));
    const added = next.layout.nodes.find((n) => !before.has(n.id));
    if (!added) throw new Error(`level ${i + 1}: no new node`);
    levels.push(added.id);
    parent = added.id;
    state = next;
  }
  if (!applyFirst) state = await invoke('doc_apply_skeleton', preset);
  return { levels, state };
}

/** A new canvas with no skeleton click: XMind's default is 思维导图 1. */
async function freshChain() {
  let state = await invoke('doc_new');
  let parent = state.layout.nodes.find((n) => n.depth === 0).id;
  const levels = [parent];
  for (let i = 0; i < 4; i += 1) {
    const next = await invoke('doc_add_child', { id: parent, title: `L${i + 1}` });
    const before = new Set(state.layout.nodes.map((n) => n.id));
    const added = next.layout.nodes.find((n) => !before.has(n.id));
    levels.push(added.id);
    parent = added.id;
    state = next;
  }
  return { levels, state };
}

const presetArgs = (p) => ({
  structure: byId.get(p.id)?.structure ?? 'clockwise',
  central: p.central,
  main: p.main ?? null,
  shape: p.centralShape ?? 'roundedRect',
  mainShape: p.mainShape ?? 'roundedRect',
  line: p.mainLine ?? 'curve',
  centralLine: p.centralLine ?? 'curve',
  pattern: p.linePattern ?? 'solid',
  fillPattern: p.fillPattern ?? 'solid',
  subLine: p.subLine ?? null,
  subShape: p.subShape ?? null,
  subPattern: p.subPattern ?? null,
  subWidth: p.subWidth ?? null,
  subFill: p.subFill ?? null,
  mainWidth: p.mainWidth ?? null,
  centralWidth: p.centralWidth ?? null,
  tapered: p.tapered ?? null,
  layers: byId.get(p.id)?.layers ?? [
    { shape: 'roundedRect', filled: true, border: 0 },
    { shape: 'roundedRect', filled: true, border: 0 },
    { shape: 'roundedRect', filled: true, border: 0 },
  ],
});

const read = (snap, levels) => levels.map((nodeId, depth) => {
  const n = snap.layout.nodes.find((x) => x.id === nodeId);
  const s = n?.style ?? {};
  return {
    depth,
    shape: s.shape,
    fill: s.fill,
    underline: s.underline,
    cell: n?.cell,
    color: s.color,
    font: s.fontSize,
    radius: s.radius,
    shapeClosed: n?.shapeClosed,
    d: (n?.shapePath ?? '').slice(0, 60),
  };
});

const result = [];
for (const p of presets) {
  const args = presetArgs(p);
  const after = await buildChain(false, args);
  const before = await buildChain(true, args);
  const th = themes[p.id] ?? {};
  const layer = (k) => (th[k]?.properties ?? {});
  const short = (v) => (v ? v.split('.').pop() : null);
  result.push({
    id: p.id,
    group: p.group,
    structure: args.structure,
    original: ['centralTopic', 'mainTopic', 'subTopic'].map((k) => ({
      shape: short(layer(k)['shape-class']),
      fill: layer(k)['svg:fill'] ?? null,
      fillPattern: layer(k)['fill-pattern'] ?? null,
    })),
    appliedLast: read(after.state, after.levels),
    appliedFirst: read(before.state, before.levels),
  });
}
const fresh = await freshChain();
const plate = { shape: 'roundedRect', fill: null, fillPattern: 'solid' };
result.push({
  id: 'default-new',
  group: 'Default',
  structure: 'clockwise',
  original: [plate, plate, plate],
  appliedFirst: read(fresh.state, fresh.levels),
  appliedLast: read(fresh.state, fresh.levels),
});
writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log('wrote', OUT, result.length, 'presets');
ws.close();
