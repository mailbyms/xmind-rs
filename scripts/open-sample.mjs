// Open a sample through the app's own UI (主菜单 → 文件 → 最近打开), so React
// state actually updates — invoking `doc_open` over IPC only changes the Rust
// document and leaves the canvas showing the previous map.
//
//   node scripts/open-sample.mjs <file-name> [shot.png]
//
// The sample must already be in the app's recent list (`settings.json`).
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9223;
const target = process.argv[2];
const out = process.argv[3] || '';
if (!target) {
  console.log('usage: node scripts/open-sample.mjs <file-name.xmind> [shot.png]');
  process.exit(1);
}

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const move = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
};
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

/** Centre of the visible element whose own label matches `text`. */
const centre = (text) => ev(`(() => {
  const want = ${JSON.stringify(text)};
  const all = [...document.querySelectorAll('.xm-item')].filter((b) => b.offsetParent !== null);
  const hit = all.find((b) => (b.querySelector('.xm-label')?.textContent ?? '').trim() === want)
    ?? all.find((b) => (b.querySelector('.xm-label')?.textContent ?? '').includes(want));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);

const [viewW, viewH] = (process.env.VIEW_SIZE || '1500x950').split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: viewW, height: viewH, deviceScaleFactor: 1, mobile: false,
});
await wait(400);

// A leftover menu from an earlier run would make the hamburger click *close* it.
const esc = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(200);
};
await esc();

// 1. hamburger
const burger = await ev(`(() => {
  const r = document.querySelector('.menu-btn').getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);
await clickAt(burger.x, burger.y);
await wait(250);

// 2. 文件 → 最近打开
for (const label of ['文件', '最近打开']) {
  const at = await centre(label);
  if (!at) throw new Error(`menu item not found: ${label}`);
  await move(at.x, at.y);
  await wait(200);
}

// 3. the sample itself
const item = await centre(target);
if (!item) throw new Error(`recent file not in menu: ${target}`);
await move(item.x, item.y);
await clickAt(item.x, item.y);
await wait(900);

const title = await ev('document.querySelector(".doc-name")?.textContent ?? ""');
const nodes = await ev('document.querySelectorAll(".node").length');
console.log(`open ${target}: title=${title} nodes=${nodes}`);

if (out) {
  // Leaf menu items now dismiss the whole popup (see ui-menu-dismiss.mjs);
  // Escape + blank click stay as a belt-and-braces fallback so a leftover
  // `.xm-backdrop` can never swallow later pointer events / :hover.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(250);
  // A leftover `.xm-backdrop` swallows every later pointer event (and :hover),
  // so click a blank spot to dismiss it before anything else touches the page.
  await clickAt(120, 760);
  await wait(250);
  // Re-fit: the viewport was resized before the file opened, so the initial
  // zoom was still computed for the old size. The status-bar menu has 适应画布.
  const zoomBtn = await ev(`(() => {
    const b = document.querySelector('.sb-zoom');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (zoomBtn) {
    await clickAt(zoomBtn.x, zoomBtn.y);
    await wait(250);
    const fitItem = await ev(`(() => {
      const b = [...document.querySelectorAll('.zoom-item')]
        .find((n) => (n.textContent ?? '').includes('适应画布'));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (fitItem) { await clickAt(fitItem.x, fitItem.y); await wait(350); }
  }
  console.log('zoom', await ev('document.querySelector(".sb-zoom-label")?.textContent ?? ""'));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('shot ->', out);
}
ws.close();
