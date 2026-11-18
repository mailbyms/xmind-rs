// Robust probe: select a topic, click the toolbar 插入 button, diff DOM to find
// the dropdown panel, dump every row, then screenshot.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.ORIG_PORT || 9222);
const OUT = resolve(process.argv[2] || 'target/verify/insert-menu');
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url) && /example\.xmind/.test(decodeURIComponent(t.url)));
if (!page) throw new Error('no example.xmind editor page');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(60);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await sleep(60);
  }
};

await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
await sleep(500);

// Snapshot visible elements before click.
const snapshotFn = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll('[class]')].filter(vis).map((e) => {
    const r = e.getBoundingClientRect();
    return { cls: (typeof e.className === 'string' ? e.className : '').slice(0,120),
      text: (e.innerText || '').trim().slice(0,300),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
})()`;
const before = await ev(snapshotFn);

// Click the central topic first so a topic is selected.
const topic = await ev(`(() => {
  const e = [...document.querySelectorAll('[data-view-id]')].find((n) => n.getAttribute('data-view-id') === 'topic-title:1');
  const target = e || [...document.querySelectorAll('[data-view-id^="topic-content"]')][0];
  if (!target) return null;
  const r = target.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
})()`);
console.log('TOPIC', JSON.stringify(topic));
if (topic) await click(topic.x, topic.y);
await sleep(300);

// Click the chevron-down arrow of the 插入 toolbar item (the + adds a child;
// the arrow opens the dropdown). Use a real JS click via mouse events on the
// exact element so Vue's handler fires regardless of coordinate scaling.
const btn = await ev(`(() => {
  const root = document.querySelector('[data-id="insert"]');
  const arrow = root?.querySelector('.uk-icon[uk-icon*="chevron-down"]');
  const b = arrow || root?.querySelector('button') || root;
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height,
    which: arrow ? 'arrow' : 'button' };
})()`);
console.log('BUTTON', JSON.stringify(btn));
if (!btn) throw new Error('insert button not found');
// Dispatch real mouse events right on the arrow element.
await ev(`(() => {
  const root = document.querySelector('[data-id="insert"]');
  const arrow = root?.querySelector('.uk-icon[uk-icon*="chevron-down"]');
  const b = arrow || root?.querySelector('button') || root;
  for (const type of ['mousedown','mouseup','click']) {
    b.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  return true;
})()`);
await sleep(700);

const after = await ev(snapshotFn);
// New elements = class not present before, or text changed significantly.
const beforeKeys = new Set(before.map((b) => b.cls + '|' + b.text));
const added = after.filter((a) => !beforeKeys.has(a.cls + '|' + a.text));
console.log('ADDED COUNT', added.length);
added.slice(-40).forEach((a, i) => console.log('ADD', i, a.cls.slice(0,60),'|',JSON.stringify(a.text.slice(0,220)),'|',[a.x,a.y,a.w,a.h]));

// Try to find a panel containing insert row keywords.
const dump = await ev(`(() => {
  const keys = ['笔记','标签','贴纸','插画','方程','附件','语音备注','图片','概要','外框','联系','标记'];
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const panels = [...document.querySelectorAll('[class]')].filter(vis).filter((e) => {
    const t = (e.innerText || '').trim();
    return keys.filter((k) => t.includes(k)).length >= 3;
  }).map((e) => {
    const r = e.getBoundingClientRect();
    return { cls: (typeof e.className === 'string' ? e.className : '').slice(0,160),
      text: (e.innerText || '').trim().slice(0,1500),
      rect: [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] };
  });
  // Keep the smallest (deepest) panels that still contain many keywords.
  return panels;
})()`);
console.log('=== MATCHING PANELS ===', JSON.stringify(dump, null, 1));
writeFileSync(resolve(OUT, 'menu2.json'), JSON.stringify({ topic, btn, added, panels: dump }, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve(OUT, 'insert-dropdown2.png'), Buffer.from(shot.data, 'base64'));
console.log('written', OUT);
ws.close();
