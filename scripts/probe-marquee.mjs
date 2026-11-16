// Probe the original's rubber-band multi-select: drag on blank canvas, then
// inspect selection chrome and topic classes.
import { writeFileSync } from 'node:fs';
const PORT = 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html/.test(t.url) && /source=new/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = async (type, x, y, buttons = 0, button = 'left') =>
  send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
await new Promise((r) => ws.addEventListener('open', r));

const snapshot = async () => evaluate(`(() => {
  const info = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const sel = [...document.querySelectorAll('[class*="select"], [class*="marquee"], [class*="rubber"], [class*="lasso"], rect')]
    .filter(vis).slice(0, 30).map((e) => ({ tag: e.tagName, cls: String(e.getAttribute('class') || e.className || '').slice(0, 110),
      r: info(e), fill: getComputedStyle(e).fill, stroke: getComputedStyle(e).stroke,
      border: getComputedStyle(e).border, bg: getComputedStyle(e).backgroundColor }));
  const fos = [...document.querySelectorAll('foreignObject')].map((e) => ({
    text: (e.textContent || '').trim().slice(0, 30),
    cls: String(e.getAttribute('class') || ''),
    parentCls: String(e.parentElement?.getAttribute('class') || e.parentElement?.parentElement?.getAttribute('class') || ''),
    r: info(e),
  }));
  const groups = [...document.querySelectorAll('.sheet-viewer g')].map((g) => String(g.getAttribute('data-view-id') || ''));
  const chrome = [...document.querySelectorAll('.sheet-viewer *')].filter((e) => {
    const key = String(e.getAttribute('class') || '') + String(e.getAttribute('data-view-id') || '');
    return /select|marquee|lasso|rubber|outline|focus|highlight/i.test(key) && vis(e);
  }).slice(0, 24).map((e) => ({ tag: e.tagName, cls: String(e.getAttribute('class') || ''), id: String(e.getAttribute('data-view-id') || ''),
    r: info(e), stroke: getComputedStyle(e).stroke, fill: getComputedStyle(e).fill,
    border: getComputedStyle(e).border, bg: getComputedStyle(e).backgroundColor }));
  return { sel, fos, chrome, groupSample: groups.slice(0, 12), bodyTail: (document.body.innerText || '').slice(-180) };
})()`);

const before = await snapshot();
// Drag a rectangle that encloses right-side branch topics 1 and 2, using
// their live DOM positions so window size changes cannot break the probe.
const pts = await evaluate(`(() => {
  const fos = [...document.querySelectorAll('foreignObject')];
  const pick = (t) => fos.find((e) => (e.textContent || '').trim() === t)?.getBoundingClientRect();
  const a = pick('分支主题 1'), b = pick('分支主题 2');
  if (!a || !b) return null;
  return { x0: Math.round(Math.min(a.x, b.x) - 45), y0: Math.round(Math.min(a.y, b.y) - 45),
    x1: Math.round(Math.max(a.right, b.right) + 45), y1: Math.round(Math.max(a.bottom, b.bottom) + 45) };
})()`);
if (!pts) throw new Error('no branch topics');
console.log('marquee', pts);
await mouse('mouseMoved', pts.x0, pts.y0, 0);
await mouse('mousePressed', pts.x0, pts.y0, 1);
for (const [x, y] of [[pts.x0 + 30, pts.y0 + 30], [(pts.x0 + pts.x1) / 2, (pts.y0 + pts.y1) / 2], [pts.x1, pts.y1]]) {
  await mouse('mouseMoved', x, y, 1); await wait(80);
}
const during = await snapshot();
await mouse('mouseReleased', pts.x1, pts.y1, 0);
await wait(350);
const after = await snapshot();

// Ctrl+click a third topic (left branch) to see the additive behaviour.
await mouse('mousePressed', 360, 490, 1, 'left');
await mouse('mouseReleased', 360, 490, 0, 'left');
const ctrl = await evaluate(`(() => ({ text: (document.body.innerText || '').slice(-200) }))()`);

const out = { before, during, after, ctrl };
writeFileSync('target/marquee-probe.json', JSON.stringify(out, null, 1));
const brief = (s) => ({ chrome: s.chrome, fos: s.fos.slice(0, 8), groupSample: s.groupSample });
console.log('BEFORE', JSON.stringify(brief(before), null, 1));
console.log('DURING', JSON.stringify(brief(during), null, 1));
console.log('AFTER ', JSON.stringify(brief(after), null, 1));
ws.close();
process.exit();
