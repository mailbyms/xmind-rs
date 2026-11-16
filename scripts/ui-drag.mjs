// Verify two display-area fixes: XMind-shaped 曲线 connectors, and drag-to-
// reparent with a predictive line. Drives the real app over CDP.
// Usage: node scripts/ui-drag.mjs [outdir]
import { writeFileSync, mkdirSync } from 'node:fs';

const outdir = process.argv[2] || 'target/drag';
const PORT = process.env.CDP_PORT || 9223;
mkdirSync(outdir, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outdir}/${name}.png`, Buffer.from(res.data, 'base64'));
  console.log('  shot', name);
};
const key = async (k, code, vk) => {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
  await wait(300);
};
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
});

await new Promise((r) => ws.addEventListener('open', r));
// Pin a deterministic viewport: the desktop window may be tiny (or huge), and
// a box-selection rectangle / toolbar click must stay inside the visible canvas.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 0, mobile: false,
}).catch(() => {});

await send('Page.bringToFront').catch(() => {});
await key('Escape', 'Escape', 27);
// Fresh document, so repeated runs start from the same map.
await evaluate(`window.__TAURI_INTERNALS__.invoke('doc_new')`);
await wait(600);

const boxes = () => evaluate(`(() => {
  return [...document.querySelectorAll('.node')].map((n) => {
    const r = n.getBoundingClientRect();
    return { id: n.getAttribute('data-id'), t: (n.querySelector('.node-title')?.textContent || '').trim(),
      x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
      top: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) };
  });
})()`);

// ------------------------------------------------------------ 1. 曲线 geometry
const curveRows = () => evaluate(`(() => {
  const rows = [];
  for (const p of document.querySelectorAll('.edges path')) {
    const d = p.getAttribute('d') || '';
    const segments = (d.match(/ L /g) || []).length;
    const cubic = /^M [\\d.-]+ [\\d.-]+ C /.test(d);
    rows.push({ kind: cubic ? 'cubic' : (d.endsWith('Z') ? 'wedge' : 'other'), segments });
  }
  return rows;
})()`);

// ------------------------------------------------------- 2. build a small tree
await evaluate(`(() => {
  const root = [...document.querySelectorAll('.node')].find((n) => (n.querySelector('.node-title')?.textContent || '').trim() === '中心主题');
  if (!root) return 'no root';
  const r = root.getBoundingClientRect();
  root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 }));
  root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 }));
  root.click();
  return 'ok';
})()`);
await wait(250);
await key('Tab', 'Tab', 9);
await key('Enter', 'Enter', 13);
await key('Enter', 'Enter', 13);
await wait(400);
let nodes = await boxes();
console.log('tree:', nodes.map((n) => n.t).join(' | '));

const curves = await curveRows();
console.log('connectors:', JSON.stringify(curves.slice(0, 5)));
const sampled = curves.filter((c) => c.kind === 'wedge' && c.segments >= 20).length;
console.log(curves.length === 0 ? 'no connectors yet'
  : sampled === curves.length
    ? `OK: all ${curves.length} connectors are sampled curves (curved spines, not straight wedges)`
    : `MISMATCH: ${JSON.stringify(curves.filter((c) => c.segments < 20))}`);
await shot('00-curves');

// --------------------------------------------- 3. drag branch 1 onto branch 3
const byTitle = (title) => nodes.find((n) => n.t === title);
const drag = async (from, to, name, steps = 12) => {
  await mouse('mousePressed', from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await wait(45);
    await mouse('mouseMoved', from.x + (to.x - from.x) * (i / steps), from.y + (to.y - from.y) * (i / steps));
  }
  await wait(450);
  const chrome = await evaluate(`(() => {
    const curve = document.querySelector('.drop-curve')?.getAttribute('d') || null;
    const ghost = document.querySelector('.drag-ghost')?.getBoundingClientRect();
    const target = document.querySelector('.node.drop-target .node-title')?.textContent || null;
    const bar = document.querySelector('.drop-bar')?.getBoundingClientRect() || null;
    return { curve, target, ghost: ghost ? [Math.round(ghost.x), Math.round(ghost.y), Math.round(ghost.width), Math.round(ghost.height)] : null,
      bar: bar ? [Math.round(bar.x), Math.round(bar.y), Math.round(bar.width), Math.round(bar.height)] : null };
  })()`);
  console.log(`  preview@${name}:`, JSON.stringify(chrome));
  await shot(name);
  await mouse('mouseReleased', to.x, to.y);
  await wait(900);
};
const structure = () => evaluate(`(async () => {
  const layout = await window.__TAURI_INTERNALS__.invoke('doc_layout');
  const byId = new Map(layout.nodes.map((n) => [n.id, n.title]));
  return layout.nodes.map((n) => (n.parentId ? byId.get(n.parentId) : '(root)') + ' > ' + n.title);
})()`);

await drag(byTitle('分支主题 1'), byTitle('分支主题 3'), '01-drag-as-child');
console.log('  after child drop:', JSON.stringify(await structure()));

// ------------------------------------------- 4. reorder: drop above a sibling
nodes = await boxes();
const src = nodes.find((n) => n.t === '分支主题 3');
const dstNode = nodes.find((n) => n.t === '分支主题 2');
if (src && dstNode) {
  await drag(src, { x: dstNode.x, y: dstNode.top + 3 }, '02-drag-before', 12);
  console.log('  after sibling drop:', JSON.stringify(await structure()));
}

// ------------------------------------------------- 5. Escape cancels the drag
const before = await structure();
const victim = (await boxes()).find((n) => n.t === '分支主题 4');
if (victim) {
  await mouse('mousePressed', victim.x, victim.y);
  for (let i = 1; i <= 6; i++) { await wait(40); await mouse('mouseMoved', victim.x - i * 30, victim.y - i * 20); }
  await wait(200);
  await key('Escape', 'Escape', 27);
  await mouse('mouseReleased', victim.x - 180, victim.y - 120);
  await wait(500);
  const after = await structure();
  console.log('  escape cancel keeps tree:', JSON.stringify(before) === JSON.stringify(after) ? 'yes' : 'NO');
}

// ---------------------------------------------------- 5. undo back to a clean map
await evaluate(`window.__TAURI_INTERNALS__.invoke('doc_undo')`);
await wait(500);
await evaluate(`window.__TAURI_INTERNALS__.invoke('doc_undo')`);
await wait(500);
console.log('  after undo:', JSON.stringify(await structure()));
await shot('03-after-undo');
ws.close();
