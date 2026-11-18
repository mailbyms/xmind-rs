// Open the shipped XMind's toolbar 插入 dropdown over CDP 9222, dump every
// row (label, shortcut, position, disabled), then screenshot.
//
//   node scripts/probe-orig-insert-menu.mjs [outdir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
if (!page) throw new Error('no editor page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
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
  const mid = ++id;
  pending.set(mid, { resolve: ok, reject: rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const waitFor = async (expression, label, timeout = 8000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await ev(expression)) return;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timeout waiting for ${label}`);
};
const click = async (x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
};

await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
await waitFor(`[...document.querySelectorAll('[data-view-id]')].some(e => e.getAttribute('data-view-id').indexOf('topic-node:') === 0)`, 'topics');

// The toolbar has an 插入 button/tile.  Find by visible text or title.
const btn = await ev(`(() => {
  const all = [...document.querySelectorAll('button,[role=button],.uk-button,a,div')];
  const hit = all.find((e) => {
    const t = (e.textContent || '').trim();
    return t === '插入' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 120;
  });
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { tag: hit.tagName, cls: hit.className?.toString?.().slice(0, 160),
    x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
})()`);
console.log('BUTTON', JSON.stringify(btn));
if (!btn) throw new Error('insert toolbar button not found');
await click(btn.x, btn.y);
await new Promise((r) => setTimeout(r, 500));

const dump = await ev(`(() => {
  const isVisible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const candidates = [...document.querySelectorAll('[class*="menu"],[class*="dropdown"],[role="menu"],[class*="insert"]')]
    .filter(isVisible)
    .map((e) => ({
      cls: typeof e.className === 'string' ? e.className.slice(0, 180) : '',
      tag: e.tagName,
      rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
      text: (e.innerText || '').trim().slice(0, 1200),
    }));
  // Look for the element that contains all the insert row labels.
  const keys = ['笔记','标签','贴纸','插画','方程','附件','语音备注'];
  const panel = candidates.find((c) => keys.filter((k) => c.text.includes(k)).length >= 4);
  let rows = [];
  if (panel) {
    const root = [...document.querySelectorAll('[class*="menu"],[class*="dropdown"],[role="menu"],[class*="insert"]')]
      .filter(isVisible).find((e) => (e.innerText || '').trim() === panel.text);
    if (root) {
      rows = [...root.querySelectorAll('li,[role="menuitem"],a,button,[class*="item"]')]
        .filter((e) => isVisible(e) && e.children.length < 6)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return {
            tag: e.tagName,
            cls: typeof e.className === 'string' ? e.className.slice(0, 140) : '',
            text: (e.innerText || '').trim().slice(0, 120),
            disabled: /disabled|uk-disabled/.test(e.className) || e.getAttribute('aria-disabled') === 'true',
            rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          };
        })
        .filter((r) => r.text && r.rect[2] > 0);
    }
  }
  return { candidates: candidates.slice(-20), panel: panel || null, rows };
})()`);
writeFileSync(resolve(OUT, 'menu.json'), JSON.stringify(dump, null, 1));
console.log('PANEL', JSON.stringify(dump.panel));
console.log('ROWS', JSON.stringify(dump.rows, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'insert-dropdown.png'), Buffer.from(shot.data, 'base64'));
console.log('written', OUT);
ws.close();
