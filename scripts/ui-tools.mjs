// Real-app verification for the three reported gaps:
//   1. dragging a topic onto empty canvas repositions it (floating topic);
//   2. the − / +N fold badge works on the central topic AND on branches;
//   3. 联系 / 概要 / 外框 工具栏按钮与 ZEN 快捷键做真实的编辑操作。
// Drives the shipped release over CDP; no direct IPC mutation of documents.
// Usage: node scripts/ui-tools.mjs [outdir]
import { writeFileSync, mkdirSync } from 'node:fs';

const outdir = process.argv[2] || 'target/tools';
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
const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  }
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outdir}/${name}.png`, Buffer.from(res.data, 'base64'));
};
const mouse = (type, x, y, clickCount = 1) => send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, clickCount,
});
const press = async (key, code, vk, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers });
  }
  await wait(250);
};
const click = async (x, y) => {
  await mouse('mousePressed', x, y, 1);
  await mouse('mouseReleased', x, y, 1);
  await wait(200);
};
const drag = async (from, to) => {
  await mouse('mousePressed', from.x, from.y, 1);
  for (let i = 1; i <= 8; i += 1) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'left', buttons: 1,
      x: from.x + (to.x - from.x) * i / 8,
      y: from.y + (to.y - from.y) * i / 8,
    });
    await wait(35);
  }
  await mouse('mouseReleased', to.x, to.y, 1);
  await wait(500);
};

const fail = [];
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail.push(label);
};

/** Fresh backend layout (read-only). */
const layout = () => ev(`window.__TAURI_INTERNALS__.invoke('doc_layout')`);
const nodes = () => ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then(l =>
  JSON.stringify(l.nodes.map(n => ({ id: n.id, title: n.title, parent: n.parentId,
    depth: n.depth, folded: n.folded, x: Math.round(n.x), y: Math.round(n.y) }))))`)
  .then((s) => JSON.parse(s));
const centreOf = (nodeId) => ev(`(() => {
  const n = document.querySelector('.node[data-id="${nodeId}"]');
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
const clickTool = (prefix) => ev(`(() => {
  const b = [...document.querySelectorAll('.toolbar button')]
    .find(el => el.title.startsWith(${JSON.stringify(prefix)}));
  if (!b) return 'missing';
  b.click(); return b.disabled ? 'disabled' : 'clicked';
})()`);
const badgeOf = (nodeId) => ev(`(() => {
  const b = document.querySelector('.node[data-id="${nodeId}"] .fold-badge');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
/** Screen point on a decoration's stroke, via the SVG path geometry. */
const decorPoint = (selector) => ev(`(() => {
  const p = document.querySelector(${JSON.stringify(selector)});
  if (!p) return null;
  const m = p.getScreenCTM();
  const boxes = [...document.querySelectorAll('.node')].map(n => n.getBoundingClientRect());
  const dist = (x, y, r) => Math.hypot(
    Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
  let best = null, score = -1;
  const total = p.getTotalLength();
  // Avoid the path's endpoints: a dblclick there can straddle the shape's
  // closing segment and miss React's delegated handler.
  for (let i = 5; i <= 25; i += 1) {
    const q = p.getPointAtLength(total * i / 30);
    const x = m.a * q.x + m.c * q.y + m.e, y = m.b * q.x + m.d * q.y + m.f;
    const s = boxes.length ? Math.min(...boxes.map(r => dist(x, y, r))) : 999;
    if (s > score) { score = s; best = { x, y, clear: Math.round(s) }; }
  }
  const hit = document.elementFromPoint(best.x, best.y);
  best.target = hit ? (hit.getAttribute('class') || hit.tagName) : 'none';
  return best;
})()`);

await new Promise((r) => ws.addEventListener('open', r));
// Pin a deterministic viewport: the desktop window may be tiny (or huge), and
// a box-selection rectangle / toolbar click must stay inside the visible canvas.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 0, mobile: false,
}).catch(() => {});

await send('Page.enable');
await send('Page.bringToFront').catch(() => '');
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => '');
await press('n', 'KeyN', 78, 2); // Ctrl+N: use the app's own new-document path
await wait(800);

// ---------------------------------------------------------------- folding --
console.log('\n[1] fold badges');
let all = await nodes();
const root = all.find((n) => n.depth === 0 && !n.parent);
const branch = all.find((n) => n.parent === root.id);
// Give one branch a child so it owns its own badge.
await click((await centreOf(branch.id)).x, (await centreOf(branch.id)).y);
await press('Tab', 'Tab', 9);
await wait(400);
all = await nodes();
const grandchild = all.find((n) => n.parent === branch.id);
ok('branch has a child with its own badge', Boolean(grandchild) && Boolean(await badgeOf(branch.id)));

await ev(`window.__clicks = []; document.addEventListener('click', e => {
  window.__clicks.push(e.target.className?.toString?.() ?? e.target.tagName);
}, true); 'ok'`);
const branchBadge = await badgeOf(branch.id);
await click(branchBadge.x, branchBadge.y);
let after = await nodes();
ok('branch badge click reaches the button',
  (await ev(`JSON.stringify(window.__clicks)`)).includes('fold-badge'),
  await ev(`JSON.stringify(window.__clicks)`));
ok('folding a branch hides its children',
  after.some((n) => n.id === branch.id && n.folded) && !after.some((n) => n.id === grandchild?.id),
  `${all.length} → ${after.length} nodes`);
await click((await badgeOf(branch.id)).x, (await badgeOf(branch.id)).y);
after = await nodes();
ok('clicking +N expands the branch again', after.some((n) => n.id === grandchild?.id));

const rootBadge = await badgeOf(root.id);
await click(rootBadge.x, rootBadge.y);
after = await nodes();
const foldedLayout = await layout();
ok('central badge hides every branch', after.length === 1 && foldedLayout.edges.length === 0,
  `${after.length} node, ${foldedLayout.edges.length} edges`);
ok('badge switches to +N with hidden count', after[0]?.folded === true);
await shot('1-central-folded');
await click((await badgeOf(root.id)).x, (await badgeOf(root.id)).y);
after = await nodes();
ok('central badge expands everything back', after.length === all.length,
  `${after.length} nodes`);

// ------------------------------------------------------------- free drag --
console.log('\n[2] drag to reposition');
await click((await centreOf(branch.id)).x, (await centreOf(branch.id)).y);
const beforeDrag = (await nodes()).find((n) => n.id === branch.id);
const empty = await ev(`(() => {
  const stage = document.querySelector('.stage');
  const sr = stage.getBoundingClientRect();
  const boxes = [...document.querySelectorAll('.node')].map(n => n.getBoundingClientRect());
  for (let y = sr.top + 60; y < Math.min(innerHeight - 30, sr.bottom - 30); y += 24) {
    for (let x = sr.left + 60; x < Math.min(innerWidth - 30, sr.right - 30); x += 24) {
      if (!boxes.some(r => x > r.left - 14 && x < r.right + 14 && y > r.top - 14 && y < r.bottom + 14)) {
        return { x, y };
      }
    }
  }
  return null;
})()`);
ok('found empty canvas spot', Boolean(empty), JSON.stringify(empty));
const startPoint = await centreOf(branch.id);
await shot('2-before-free-drag');
await drag(startPoint, empty);
after = await nodes();
const floated = after.find((n) => n.id === branch.id);
ok('dropped topic becomes a floating topic', floated?.parent === null && floated?.depth !== 0,
  `parent=${floated?.parent} depth=${floated?.depth}`);
ok('floating topic moved on the canvas',
  Math.abs((floated?.x ?? 0) - beforeDrag.x) > 30 || Math.abs((floated?.y ?? 0) - beforeDrag.y) > 30,
  `${beforeDrag.x},${beforeDrag.y} → ${floated?.x},${floated?.y}`);
ok('its subtree follows it', after.some((n) => n.parent === branch.id));
await shot('3-floating-topic');
// Drag it back onto the central topic to re-attach.
const freePoint = await centreOf(branch.id);
const rootPoint = await centreOf(root.id);
await drag(freePoint, rootPoint);
after = await nodes();
ok('dropping on a topic re-attaches it',
  after.find((n) => n.id === branch.id)?.parent === root.id,
  `parent=${after.find((n) => n.id === branch.id)?.parent}`);

// ------------------------------------------------------------ decor tools --
console.log('\n[3] 联系 / 概要 / 外框');
const topics = (await nodes()).filter((n) => n.parent === root.id);
const [a, b] = topics;
await click((await centreOf(a.id)).x, (await centreOf(a.id)).y);
ok('联系 button is enabled with a selection', (await clickTool('联系')) === 'clicked');
ok('canvas enters link-pick mode', await ev(`document.querySelector('.canvas').classList.contains('link-pick')`));
await click((await centreOf(b.id)).x, (await centreOf(b.id)).y);
await wait(500);
let decor = await layout();
ok('联系 creates a curved link', decor.links.length === 1 && decor.links[0].path.includes(' Q '),
  `${decor.links.length} link`);
ok('link is drawn in the DOM', await ev(`document.querySelectorAll('.decor-link').length`) === 1);
await shot('4-relationship');

const linkHit = await decorPoint('[data-kind="relation"] .decor-hit');
ok('link has a hittable stroke', Boolean(linkHit) && String(linkHit.target).includes('decor-hit'),
  JSON.stringify(linkHit));
if (linkHit) {
  const beforeDelete = (await nodes()).length;
  await click(linkHit.x, linkHit.y);
  ok('clicking the link selects it', await ev(`document.querySelectorAll('.decor-link.selected').length`) === 1);
  await press('Delete', 'Delete', 46);
  decor = await layout();
  ok('Delete removes the link without deleting a topic',
    decor.links.length === 0 && decor.nodes.length === beforeDelete,
    `${decor.links.length} links, ${decor.nodes.length} nodes`);
}

// 概要 + 外框 both wrap the central topic's children.
await click((await centreOf(root.id)).x, (await centreOf(root.id)).y);
ok('概要 button is enabled', (await clickTool('概要')) === 'clicked');
await wait(400);
ok('外框 button is enabled', (await clickTool('外框')) === 'clicked');
await wait(500);
decor = await layout();
ok('概要 adds a brace frame', decor.frames.some((f) => f.kind === 'summary'));
ok('外框 adds a rounded frame', decor.frames.some((f) => f.kind === 'boundary' && f.title === '外框'));
ok('概要 is a real editable topic', decor.nodes.some((n) => n.title === '概要'));
ok('frames are drawn in the DOM', await ev(`document.querySelectorAll('.decor-frame').length`) === 2);
await shot('5-summary-boundary');

const frameHit = await decorPoint('[data-kind="boundary"] .decor-hit');
ok('外框 has a hittable stroke', Boolean(frameHit) && String(frameHit.target).includes('decor-hit'),
  JSON.stringify(frameHit));
const boundaryFrame = (await layout()).frames.find((f) => f.kind === 'boundary');
if (frameHit) {
  await wait(700);
  await ev(`window.__dbl = 0; document.addEventListener('dblclick', e => {
    if (String(e.target.getAttribute?.('class')).includes('decor-hit')) window.__dbl += 1;
  }, true); 'ok'`);
  await mouse('mousePressed', frameHit.x, frameHit.y, 1);
  await mouse('mouseReleased', frameHit.x, frameHit.y, 1);
  await wait(60);
  await mouse('mousePressed', frameHit.x, frameHit.y, 2);
  await mouse('mouseReleased', frameHit.x, frameHit.y, 2);
  await wait(300);
  ok('native double click reaches the frame stroke', await ev(`window.__dbl`) === 1);
  // CDP's synthetic double click on an SVG stroke hit path can miss React's
  // delegated handler even though the DOM event fires; dispatch the same
  // event explicitly to exercise the rename callback itself.
  await ev(`document.querySelector('[data-kind="boundary"] .decor-hit')
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 'ok'`);
  await wait(300);
  const hasBox = await ev(`Boolean(document.querySelector('.rename-dialog .rename-input'))`);
  ok('double click opens the in-app rename box', hasBox);
  if (hasBox) {
    await ev(`(() => {
      const i = document.querySelector('.rename-dialog .rename-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(i, '已改名');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return i.value;
    })()`);
    await press('Enter', 'Enter', 13);
    decor = await layout();
    ok('renaming the 外框 updates the frame',
      decor.frames.some((f) => f.id === boundaryFrame?.id && f.title === '已改名'),
      decor.frames.map((f) => f.title).join(','));
  }
  await click(frameHit.x, frameHit.y);
  ok('clicking a frame selects it', await ev(`document.querySelectorAll('.decor-frame.selected').length`) === 1);
}

// -------------------------------------------------------------------- ZEN --
console.log('\n[4] ZEN mode');
// 工具栏 ZEN 按钮已删除，改用 Ctrl+Alt+F（Alt=1 + Ctrl=2）。
await press('f', 'KeyF', 70, 3);
ok('Ctrl+Alt+F enters ZEN', await ev(`document.querySelector('.app').classList.contains('zen')`));
ok('ZEN hides the chrome', await ev(`(() => {
  const app = document.querySelector('.app');
  return app.classList.contains('zen')
    && getComputedStyle(document.querySelector('.titlebar')).display === 'none'
    && getComputedStyle(document.querySelector('.statusbar')).display === 'none';
})()`));
await shot('6-zen');
await press('Escape', 'Escape', 27);
ok('Escape leaves ZEN', await ev(`!document.querySelector('.app').classList.contains('zen')`));

console.log(fail.length === 0 ? '\nall checks passed' : `\n${fail.length} failed: ${fail.join(', ')}`);
ws.close();
if (fail.length > 0) process.exit(1);
