// Capture the shipped XMind's geometry for every skeleton sample, so it can be
// diffed against this app's `doc_layout`. One editor tab per sample.
//
//   node scripts/capture-xmind-skeletons.mjs [names...]
//
// Output: target/verify/xmind-<name>.json
//   { root: id, zoom, nodes: [{ id, title, x, y, w, h }],
//     edges: [{ from, to, d, x, y, w, h }] }
// Node boxes are page coordinates; the diff normalises both sides to the root
// centre, so tab zoom / window offset cancel out.
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PORT = 9222;
const XMIND = 'C:/Users/DM/AppData/Local/Programs/Xmind/Xmind.exe';
const SAMPLE_DIR = resolve('target/skeleton-samples');
const OUT = resolve('target/verify');
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2);
const samples = readdirSync(SAMPLE_DIR)
  .filter((f) => f.endsWith('.xmind'))
  .map((f) => f.replace(/\.xmind$/, ''))
  .filter((name) => !only.length || only.includes(name));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every page target the running XMind exposes. */
async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return (await res.json()).filter((t) => t.type === 'page');
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ws, ready, send };
}

const CAPTURE = `(() => {
  const scope = document.querySelector('.sheet-viewer') || document.body;
  const base = scope.getBoundingClientRect();
  const num = (v) => Math.round(v * 10) / 10;
  const nodes = [];
  for (const g of document.querySelectorAll('[data-view-id^="topic-node:"]')) {
    if (!g.querySelector('foreignObject')) continue;      // skip nested dupes
    const r = g.getBoundingClientRect();
    nodes.push({
      id: g.getAttribute('data-view-id').slice('topic-node:'.length),
      title: (g.textContent || '').trim(),
      x: num(r.x - base.x), y: num(r.y - base.y),
      w: num(r.width), h: num(r.height),
    });
  }
  const edges = [];
  for (const p of document.querySelectorAll('[data-view-id^="topic-connection:"]')) {
    const vid = p.getAttribute('data-view-id');
    const rest = vid.slice('topic-connection:'.length);
    const cut = rest.indexOf(':');
    if (cut < 0) continue;
    const r = p.getBoundingClientRect();
    edges.push({
      from: rest.slice(0, cut), to: rest.slice(cut + 1),
      d: p.getAttribute('d') || '',
      x: num(r.x - base.x), y: num(r.y - base.y),
      w: num(r.width), h: num(r.height),
    });
  }
  const zoomText = [...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && /^\\d+%$/.test((e.textContent || '').trim()))
    .map((e) => e.textContent.trim())[0] || null;
  return JSON.stringify({ zoom: zoomText, nodes, edges });
})()`;

for (const name of samples) {
  const file = resolve(SAMPLE_DIR, `${name}.xmind`);
  const before = new Set((await targets()).map((t) => t.url));
  // This shell exports ELECTRON_RUN_AS_NODE / NODE_OPTIONS; inherited, Xmind.exe
  // starts as a bare Node process and dies on the .xmind argument.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  spawn(XMIND, ['--allow-file-access-from-files', file], {
    detached: true, stdio: 'ignore', env,
  }).unref();

  let page = null;
  for (let i = 0; i < 60 && !page; i += 1) {
    await wait(500);
    page = (await targets()).find((t) => !before.has(t.url)
      && /editor\.html/.test(t.url) && !/editor-frame/.test(t.url));
  }
  if (!page) { console.log(`${name}: no editor tab`); continue; }

  const { ws, ready, send } = connect(page.webSocketDebuggerUrl);
  await ready;
  let data = null;
  for (let i = 0; i < 40; i += 1) {
    const res = await send('Runtime.evaluate', { expression: CAPTURE, returnByValue: true });
    const value = res?.result?.value;
    if (value) {
      const parsed = JSON.parse(value);
      if (parsed.nodes.length > 5) { data = parsed; break; }
    }
    await wait(500);
  }
  if (data) {
    writeFileSync(resolve(OUT, `xmind-${name}.json`), JSON.stringify(data, null, 1));
    console.log(`${name}: ${data.nodes.length} nodes, ${data.edges.length} edges, zoom=${data.zoom}`);
  } else {
    console.log(`${name}: capture failed`);
  }
  ws.close();
}
console.log('done');
