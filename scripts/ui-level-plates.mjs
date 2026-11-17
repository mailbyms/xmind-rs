// Real UI check: create a fresh canvas and add four child topics with Tab,
// then read the *rendered* SVG paths.  Every level must be a filled rounded
// rectangle (not just a Rust `style.fill`), FINDINGS §38.
//
//   CDP_PORT=9235 node scripts/ui-level-plates.mjs
import { execFileSync } from 'node:child_process';

const PORT = process.env.CDP_PORT || 9235;
execFileSync(process.execPath, ['scripts/new-doc.mjs'], {
  stdio: 'pipe', env: { ...process.env, CDP_PORT: PORT },
});

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
  return r.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  await wait(220);
};
const tab = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
  await wait(320);
};

// Wait for React to finish re-rendering the fresh document.
for (let i = 0; i < 30; i += 1) {
  const n = await ev(`document.querySelectorAll('.node').length`);
  if (n === 5) break;
  await wait(200);
}
// Select the central topic, then Tab four times (each Tab adds + selects a child).
const root = await ev(`(() => {
  const el = document.querySelector('.node');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`);
if (!root) throw new Error('canvas has no central topic');
const pos = JSON.parse(root);
await click(pos.x, pos.y);
for (let i = 0; i < 4; i += 1) await tab();

const rows = await ev(`(async () => {
  const layout = await window.__TAURI_INTERNALS__.invoke('doc_layout');
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const chain = layout.nodes.filter((n) => n.title === '新主题' || n.depth === 0);
  // Walk the newly created chain from the root's last child.
  const root = layout.nodes.find((n) => n.depth === 0);
  const out = [];
  let id = root.id;
  for (let depth = 0; depth < 5; depth += 1) {
    const n = byId.get(id);
    if (!n) break;
    const el = document.querySelector('.node[data-id="' + id + '"]');
    const path = el?.querySelector('.node-shape path');
    out.push({ depth, fill: path?.getAttribute('fill') ?? null,
      d: (path?.getAttribute('d') ?? '').slice(0, 24),
      rustFill: n.style.fill, shape: n.style.shape, underline: n.style.underline });
    const next = layout.nodes.find((k) => k.parentId === id && k.title === '新主题');
    if (!next) break;
    id = next.id;
  }
  return out;
})()`);

const fail = [];
if (rows.length !== 5) fail.push(`only ${rows.length} levels in DOM`);
for (const r of rows) {
  if (!r.fill || r.fill === 'none') fail.push(`L${r.depth + 1}: no painted fill (${r.fill})`);
  if (!r.d.startsWith('M 8 0 H')) fail.push(`L${r.depth + 1}: not a rounded-rect path (${r.d})`);
  if (r.shape !== 'roundedRect' || r.underline) fail.push(`L${r.depth + 1}: shape=${r.shape}`);
  console.log(`L${r.depth + 1}  fill=${r.fill}  rust=${r.rustFill}  path=${r.d}`);
}
ws.close();
if (fail.length) { console.log('\nFAILED:', fail.join(' | ')); process.exit(1); }
console.log('\nALL PASS — five keyboard-created levels are filled rounded rectangles');
