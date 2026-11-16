// Apply a hand-drawn skeleton in the shipped app and read back how the hatch
// texture is actually painted (per-topic fill value / pattern defs).
import fs from 'node:fs';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
let target = null;
for (const t of list.filter((x) => /editor\.html/.test(x.url))) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
  await new Promise((r) => ws.addEventListener('open', r));
  const ev = (x) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: x, returnByValue: true } })); });
  const has = await ev('!!document.querySelector(".uk-format-panel")');
  ws.close();
  if (has.result?.value) { target = t; break; }
}
if (!target) { console.error('no editor page'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result?.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await ev(`(() => {
  const a = [...document.querySelectorAll('.uk-tab a')].find(x => x.innerText.trim() === '画布');
  a && a.click();
})()`);
await sleep(400);

// Open the 骨架 library and click the 6th Mind Map card (hand-drawn).
await ev(`(() => {
  const b = document.querySelector('button[title="选择骨架。"]');
  b.scrollIntoView({ block: 'center' });
  if (b.getAttribute('aria-expanded') !== 'true') b.click();
})()`);
await sleep(800);
const clicked = await ev(`(() => {
  const pop = [...document.querySelectorAll('.uk-pop.uk-popover.uk-open')].find((p) => p.innerText.includes('思维导图'));
  if (!pop) return 'no popover';
  const groups = [...pop.querySelectorAll('h5')];
  const g = groups.find((h) => h.innerText.trim().startsWith('思维导图'));
  const box = g.parentElement.parentElement;
  const cards = [...box.querySelectorAll('.uk-card-selectable')];
  if (cards.length < 6) return 'cards ' + cards.length;
  cards[5].click();
  return 'clicked ' + cards.length;
})()`);
console.log('click:', clicked);
await sleep(1200);

const info = await ev(`(() => {
  const topic = document.querySelector('[data-topic-id] .topic, foreignObject .topic, .topic');
  const styles = [...document.querySelectorAll('foreignObject')].slice(0, 4).map((f) => {
    const el = f.firstElementChild?.firstElementChild || f.firstElementChild;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      cls: el.className.toString().slice(0, 80),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage.slice(0, 160),
      boxShadow: cs.boxShadow.slice(0, 60),
      html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 320),
    };
  });
  const pats = [...document.querySelectorAll('pattern')].map((p) => p.outerHTML.slice(0, 500));
  const svgFill = [...document.querySelectorAll('svg path[fill]')].map((e) => e.getAttribute('fill')).filter((v) => v && v.startsWith('url')).slice(0, 6);
  return { styles, pats, svgFill, topic: topic ? topic.outerHTML.slice(0, 300) : null };
})()`);
console.log(JSON.stringify(info, null, 1).slice(0, 4000));

// Full window screenshot for a visual check.
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('target/handdrawn-original.png', Buffer.from(shot.data, 'base64'));
console.log('shot saved');
ws.close();
