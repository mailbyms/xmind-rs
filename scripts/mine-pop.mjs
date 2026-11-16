// Open one of *our* inspector popovers and capture it at 2x, in a single CDP
// session (so the outside-pointerdown handler never fires).
// Usage: node scripts/mine-pop.mjs "<control title>" out.png [port]
import { writeFileSync } from 'node:fs';

const title = process.argv[2];
const out = process.argv[3] || 'target/mine-pop.png';
const PORT = process.env.CDP_PORT || 9223;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID))
  ?? list.find((t) => t.type === 'page');

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
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval error');
  return res.result.value;
};
await new Promise((r) => ws.addEventListener('open', r));

// Close whatever was open.
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
await new Promise((r) => setTimeout(r, 150));

const opened = await evaluate(`(() => {
  const els = [...document.querySelectorAll('.fp [title]')];
  const el = els.find((e) => e.getAttribute('title') === ${JSON.stringify(title)})
    ?? els.find((e) => (e.getAttribute('title') || '').startsWith(${JSON.stringify(title)}));
  if (!el) return { error: 'missing title', have: els.map((e) => e.getAttribute('title')).join(' | ').slice(0, 400) };
  el.click();
  return { ok: true, tag: el.tagName, cls: String(el.className) };
})()`);
if (opened.error) { console.error('OPEN FAIL', JSON.stringify(opened, null, 1)); process.exit(1); }
await new Promise((r) => setTimeout(r, 350));

const rect = await evaluate(`(() => {
  const pop = document.querySelector('.pop');
  if (!pop) return { error: 'no popover' };
  const b = pop.getBoundingClientRect();
  return { r: [b.x, b.y, b.width, b.height], cls: String(pop.className),
    items: pop.querySelectorAll('li, .pop-tile, .pc-swatch').length };
})()`);
if (rect.error) { console.error('NO POPOVER'); process.exit(1); }

const [x, y, w, h] = rect.r;
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: Math.max(0, x - 10), y: Math.max(0, y - 10), width: w + 20, height: h + 20, scale: 2 },
});
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify({ cls: rect.cls, r: rect.r.map(Math.round), items: rect.items }));
console.log('saved', out);
ws.close();
process.exit();
