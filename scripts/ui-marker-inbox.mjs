// Regression for in-box markers + one-marker-per-group (2026-11-17).
//
//   node scripts/ui-marker-inbox.mjs [outdir]
//   CDP_PORT=9223, running against a clean document.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const OUT = resolve(process.argv[2] || 'target/verify/marker-inbox');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: ok, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : ok(m.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok, rej) => {
  const id = ++seq;
  pending.set(id, { resolve: ok, reject: rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const invoke = (cmd, args = {}) =>
  ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
const waitFor = async (expression, label, timeout = 8000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await ev(expression)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for ${label}`);
};

const waitMarkers = async (expected, label) => {
  const until = Date.now() + 6000;
  while (Date.now() < until) {
    const current = (await invoke('doc_layout')).nodes.find((n) => n.id === root?.id)?.markers;
    if (JSON.stringify(current) === JSON.stringify(expected)) return current;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for markers ${label}`);
};

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log('PASS', label); }
  else { fail++; console.log('FAIL', label, detail); }
};
const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
  const r = e.getBoundingClientRect(); return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1) }; })()`);

await send('Page.reload', { ignoreCache: true });
await waitFor(`!!document.querySelector('.node')`, 'first React frame', 30000);
const root = await invoke('doc_layout').then((l) => l.nodes.find((n) => n.depth === 0));
check(Boolean(root), 'central topic exists');
const baseWidth = root.width;

const pick = async (id, expected) => {
  await ev(`document.querySelector('.tool-pop-marker [data-marker-id=${JSON.stringify(id)}]').click()`);
  return waitMarkers(expected, id);
};

// Drive the real toolbar flow: the direct invoke would update Rust but bypass
// React's snapshot state, so the canvas would not repaint.
await ev(`document.querySelector('.node[data-id=${JSON.stringify(root.id)}]').click()`);
await ev(`document.querySelector('[data-tool-pop="marker"]').click()`);
await waitFor(`!!document.querySelector('.tool-pop-marker [data-marker-id="tag-red"]')`, 'marker panel');
await pick('tag-red', ['tag-red']);
await pick('priority-1', ['tag-red', 'priority-1']);
const layout = await invoke('doc_layout');
const node = layout.nodes.find((n) => n.id === root.id);
// The icon is the topic's own font size, its ring a sixth of that, and slots
// overlap by a fixed 8px (FINDINGS §62).  Assert the DOM against the layout
// instead of hard-coding a size: a fresh 30px central topic gets 30px icons.
const iconSize = node.markerSize;
const slotSize = iconSize + 2 * (node.markerRing ?? iconSize / 6);
const expectedWidth = 2 * slotSize - 8 + 10;
check(Math.abs(node.markerWidth - expectedWidth) < 0.01,
  `markerWidth matches 2 icons at ${iconSize}px`, `${node.markerWidth} vs ${expectedWidth}`);
check(Math.abs(node.width - (baseWidth + node.markerWidth)) < 0.01,
  'topic box grows by the marker row', `${baseWidth} -> ${node.width}`);
check(node.lines === root.lines, 'label wrap unchanged');

const info = await ev(`(() => {
  const n = document.querySelector(${JSON.stringify(`.node[data-id="${root.id}"]`)});
  const row = n.querySelector('.node-markers');
  const chips = [...row.querySelectorAll('.marker-chip')];
  const title = n.querySelector('.node-title');
  const r = (e) => { const b = e.getBoundingClientRect(); return { x:+b.x.toFixed(1), y:+b.y.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1) }; };
  const img = row.querySelector('img');
  return {
    order: [...n.children].map((c) => c.className),
    row: r(row), chips: chips.map(r), title: r(title), node: r(n),
    icon: img ? r(img) : null,
    iconShadow: img ? getComputedStyle(img).boxShadow : '',
  };
})()`);
console.log('DOM', JSON.stringify(info));
check(info.chips.length === 2, 'two chips rendered');
check(info.chips.length === 2 && info.chips.every((c) => Math.abs(c.w - slotSize) < 0.1),
  `marker slots ${slotSize}px wide`, JSON.stringify(info.chips));
check(info.chips.length === 2
  && Math.abs((info.chips[1].x - info.chips[0].x) - node.markerStep) < 0.1,
  `slots advance ${node.markerStep}px (8px overlap)`, JSON.stringify(info.chips));
check(info.icon && Math.abs(info.icon.w - iconSize) < 0.1, `${iconSize}px official icon`, JSON.stringify(info.icon));
check(/255, 255, 255/.test(info.iconShadow), 'white ring around icon', info.iconShadow);
check(info.row.x >= info.node.x && info.row.x + info.row.w <= info.node.x + info.node.w + 1, 'marker row inside topic box');
check(info.title.x >= info.row.x + info.row.w - 2, 'markers sit left of the label', `${info.row.x + info.row.w} vs ${info.title.x}`);
check(Math.abs((info.row.y + info.row.h / 2) - (info.title.y + info.title.h / 2)) < 2, 'markers share the label row');

// Click a marker from the same group: it must replace, not append.
let markers = await pick('tag-orange', ['tag-orange', 'priority-1']);
check(JSON.stringify(markers) === JSON.stringify(['tag-orange', 'priority-1']),
  'same-group click replaces tag-red', JSON.stringify(markers));

markers = await pick('priority-2', ['tag-orange', 'priority-2']);
check(JSON.stringify(markers) === JSON.stringify(['tag-orange', 'priority-2']),
  'same-group click replaces priority-1', JSON.stringify(markers));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'inbox.png'), Buffer.from(shot.data, 'base64'));
writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ info, markers, pass, fail }, null, 1));
console.log(`RESULT ${pass} pass / ${fail} fail`);
ws.close();
if (fail) process.exitCode = 1;
