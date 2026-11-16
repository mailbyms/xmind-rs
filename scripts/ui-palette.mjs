// Open the 分支配色 popover, screenshot it open, then pick a palette.
// Usage: node scripts/ui-palette.mjs [outdir]
import { writeFileSync, mkdirSync } from 'node:fs';

const outdir = process.argv[2] || 'target/verify';
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outdir}/${name}.png`, Buffer.from(res.data, 'base64'));
  console.log('  shot', name);
};
await new Promise((r) => ws.addEventListener('open', r));
await send('Page.bringToFront').catch(() => {});

await evaluate(`(() => { [...document.querySelectorAll('.fp-tabs button')].find((b) => b.textContent.trim() === '画布')?.click(); return 1; })()`);
await wait(400);
await evaluate(`(() => { document.querySelector('.fp-rainbow')?.click(); return 1; })()`);
await wait(500);
const info = await evaluate(`(() => {
  const pop = document.querySelector('.pop.is-palette');
  const discs = [...document.querySelectorAll('.pal-disc')];
  const r = pop?.getBoundingClientRect();
  return { open: Boolean(pop), count: discs.length,
    rect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
    names: discs.map((d) => d.title),
    dials: discs.map((d) => (d.querySelector('.pal-disc-art')?.getAttribute('style') || '').slice(0, 60)) };
})()`);
console.log(JSON.stringify(info, null, 1));
await shot('12-palette-open');
await evaluate(`(() => { [...document.querySelectorAll('.pal-disc')][2]?.click(); return 1; })()`);
await wait(800);
await shot('13-palette-applied');
ws.close();
