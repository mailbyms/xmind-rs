// Open a shipped popover by clicking a selector, then capture it in the SAME
// CDP session (focus loss closes the popover, so a second process never sees it).
// Usage: node scripts/pop-probe.mjs "<selector>" out.png [scale]
import { writeFileSync } from 'node:fs';

const selector = process.argv[2];
const out = process.argv[3] || 'target/pop.png';
const scale = Number(process.argv[4] || 2);
const PORT = process.env.CDP_PORT || 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID))
  ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url))
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
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  return res.result.value;
};
await new Promise((r) => ws.addEventListener('open', r));

// Start from a clean slate: Esc closes whatever popover was left open.
for (const type of ['keyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}
await new Promise((r) => setTimeout(r, 200));

const opened = await evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { error: 'missing ' + ${JSON.stringify(selector)} };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { ok: true, cls: String(el.className).slice(0, 60) };
})()`);
if (opened.error) { console.error('OPEN FAIL', JSON.stringify(opened)); process.exit(1); }
await new Promise((r) => setTimeout(r, 400));

const info = await evaluate(`(() => {
  const vis = [...document.querySelectorAll('[class*="uk-pop"], [class*="uk-menu"]')]
    .map((e) => { const b = e.getBoundingClientRect(); return { e, b }; })
    .filter(({ e, b }) => b.width > 40 && b.height > 20
      && !/overlay/.test(String(e.className))
      && b.width < innerWidth - 8 && b.height < innerHeight - 8);
  if (!vis.length) return { error: 'no visible popover' };
  vis.sort((a, b) => b.b.width * b.b.height - a.b.width * a.b.height);
  const { e, b } = vis[0];
  return {
    cls: String(e.className),
    r: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    html: e.outerHTML.slice(0, 12000),
    text: (e.innerText || '').replace(/\\n+/g, ' | ').slice(0, 600),
  };
})()`);
if (info.error) { console.error('NO POPOVER', JSON.stringify(info)); process.exit(1); }

const [x, y, w, h] = info.r;
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: x - 6, y: y - 6, width: w + 12, height: h + 12, scale },
});
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify({ cls: info.cls, r: info.r, text: info.text ?? '' }, null, 1));
console.log('HTML:', info.html);
console.log('saved', out);
ws.close();
process.exit();
